import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MatchStatus, NotificationType, Prisma } from '@prisma/client';
import { DomainEvent } from '../../common/constants/domain-events';
import { Permission } from '../../common/constants/permissions';
import { orderBy, pageArgs, paginate } from '../../common/dto/pagination.dto';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { LiveEvent } from '../live/live.events';
import { LiveService } from '../live/live.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamsService } from '../teams/teams.service';
import {
  CreateMatchDto,
  MatchQueryDto,
  QuickMatchDto,
  ResultOverrideDto,
  SquadDto,
  TimelineQueryDto,
  TossDto,
  UpdateMatchDto,
} from './dto/matches.dto';
import { MatchesRepository } from './matches.repository';

const IN_PLAY: MatchStatus[] = ['LIVE', 'INNINGS_BREAK'];

@Injectable()
export class MatchesService {
  constructor(
    private readonly repo: MatchesRepository,
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly live: LiveService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  // ─────────────── Create ───────────────

  async create(user: AuthUser, dto: CreateMatchDto) {
    if (dto.teamAId === dto.teamBId) throw new BadRequestException('Team A and Team B must be different');
    if (![dto.teamAId, dto.teamBId].includes(dto.tossWinnerId)) throw new BadRequestException('Toss winner must be one of the two teams');
    const teams = await this.prisma.team.findMany({ where: { id: { in: [dto.teamAId, dto.teamBId] }, deletedAt: null } });
    if (teams.length !== 2) throw new NotFoundException('Team not found');

    if (dto.tournamentId) {
      await this.access.assertCanManageTournament(user, dto.tournamentId);
      const inTournament = await this.prisma.tournamentTeam.count({ where: { tournamentId: dto.tournamentId, teamId: { in: [dto.teamAId, dto.teamBId] } } });
      if (inTournament !== 2) throw new BadRequestException('Both teams must be registered in the tournament');
    } else if (!user.permissions.includes(Permission.MATCH_CREATE) && !user.permissions.includes('*')) {
      throw new ForbiddenException('Missing permission: match:create');
    }

    const { teamAPlayerIds, teamBPlayerIds, fillWithTemporaryPlayers, scheduledAt, ...data } = dto;
    const match = await this.prisma.$transaction(async (tx) => {
      const m = await tx.match.create({
        data: {
          ...data,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
          stage: dto.stage ?? (dto.tournamentId ? 'LEAGUE' : 'FRIENDLY'),
          status: 'TOSS_COMPLETED',
          createdById: user.id,
        },
      });
      await this.buildSquad(tx, m.id, dto.teamAId, teamAPlayerIds, dto.playersPerTeam, !!fillWithTemporaryPlayers, 'T', user.id);
      await this.buildSquad(tx, m.id, dto.teamBId, teamBPlayerIds, dto.playersPerTeam, !!fillWithTemporaryPlayers, 'P', user.id);
      await this.repo.event(m.id, 'MATCH_CREATED', user.id, { quick: false }, undefined, undefined, tx);
      await this.repo.event(m.id, 'TOSS_COMPLETED', user.id, { tossWinnerId: dto.tossWinnerId, decision: dto.tossDecision }, undefined, undefined, tx);
      return m;
    });
    await this.audit.log({ userId: user.id, matchId: match.id, entityType: 'MATCH', entityId: match.id, action: 'CREATE', newValue: dto });
    return this.get(match.id);
  }

  /**
   * Quick match: creates two temporary teams with placeholder players (T1..Tn / P1..Pn),
   * which can be renamed at any time and later claimed by real players.
   */
  async quick(user: AuthUser, dto: QuickMatchDto) {
    const prefixA = dto.prefixA ?? 'T';
    const prefixB = dto.prefixB ?? 'P';
    if (prefixA === prefixB) throw new BadRequestException('prefixA and prefixB must differ');

    const match = await this.prisma.$transaction(
      async (tx) => {
        const mkTeam = (name: string) => tx.team.create({ data: { name, isTemporary: true, createdById: user.id, ...TeamsService.newCodes() } });
        const [teamA, teamB] = [await mkTeam(dto.teamAName), await mkTeam(dto.teamBName)];
        const m = await tx.match.create({
          data: {
            name: dto.name ?? `${dto.teamAName} vs ${dto.teamBName}`,
            teamAId: teamA.id,
            teamBId: teamB.id,
            playersPerTeam: dto.playersPerTeam,
            overs: dto.overs,
            ground: dto.ground,
            scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : new Date(),
            ballType: dto.ballType,
            pitchType: dto.pitchType,
            umpireName: dto.umpireName,
            wideRuns: dto.wideRuns,
            noBallRuns: dto.noBallRuns,
            ballsPerOver: dto.ballsPerOver,
            isQuickMatch: true,
            stage: 'FRIENDLY',
            status: 'TOSS_COMPLETED',
            tossWinnerId: dto.tossWinner === 'A' ? teamA.id : teamB.id,
            tossDecision: dto.tossDecision,
            createdById: user.id,
          },
        });
        for (const [team, prefix, names] of [
          [teamA, prefixA, dto.teamAPlayerNames ?? []],
          [teamB, prefixB, dto.teamBPlayerNames ?? []],
        ] as const) {
          for (let i = 0; i < dto.playersPerTeam; i++) {
            const code = `${prefix}${i + 1}`;
            const p = await tx.player.create({ data: { name: names[i]?.trim() || code, tempCode: code, isTemporary: true, createdById: user.id } });
            await tx.teamPlayer.create({ data: { teamId: team.id, playerId: p.id } });
            await tx.matchPlayer.create({ data: { matchId: m.id, teamId: team.id, playerId: p.id, battingOrder: i + 1 } });
          }
        }
        await this.repo.event(m.id, 'MATCH_CREATED', user.id, { quick: true }, undefined, undefined, tx);
        await this.repo.event(m.id, 'TOSS_COMPLETED', user.id, { tossWinnerId: m.tossWinnerId, decision: dto.tossDecision }, undefined, undefined, tx);
        return m;
      },
      { timeout: 30_000 },
    );
    await this.audit.log({ userId: user.id, matchId: match.id, entityType: 'MATCH', entityId: match.id, action: 'CREATE_QUICK', newValue: dto });
    return this.get(match.id);
  }

  /** Builds a team's playing XI from explicit ids / team roster, optionally padding with temporary players. */
  private async buildSquad(
    tx: Prisma.TransactionClient,
    matchId: string,
    teamId: string,
    playerIds: string[] | undefined,
    size: number,
    fill: boolean,
    prefix: string,
    userId: string,
  ) {
    let ids = playerIds ?? [];
    if (ids.length) {
      const found = await tx.player.count({ where: { id: { in: ids }, deletedAt: null } });
      if (found !== ids.length) throw new BadRequestException('One or more players do not exist');
      if (ids.length > size) throw new BadRequestException(`Squad cannot exceed ${size} players`);
      for (const pid of ids) {
        await tx.teamPlayer.upsert({
          where: { teamId_playerId: { teamId, playerId: pid } },
          update: { status: 'ACTIVE', removedAt: null },
          create: { teamId, playerId: pid },
        });
      }
    } else {
      const roster = await tx.teamPlayer.findMany({ where: { teamId, status: 'ACTIVE', player: { deletedAt: null } }, orderBy: { joinedAt: 'asc' }, take: size });
      ids = roster.map((r) => r.playerId);
    }
    if (fill && ids.length < size) {
      for (let i = ids.length; i < size; i++) {
        const code = `${prefix}${i + 1}`;
        const p = await tx.player.create({ data: { name: code, tempCode: code, isTemporary: true, createdById: userId } });
        await tx.teamPlayer.create({ data: { teamId, playerId: p.id } });
        ids.push(p.id);
      }
    }
    if (ids.length) {
      await tx.matchPlayer.createMany({ data: ids.map((playerId, i) => ({ matchId, teamId, playerId, battingOrder: i + 1 })), skipDuplicates: true });
    }
  }

  // ─────────────── Read ───────────────

  async get(id: string) {
    const m = await this.repo.findDetail(id);
    if (!m) throw new NotFoundException('Match not found');
    const awards = await this.prisma.award.findMany({
      where: { matchId: id },
      include: { player: { select: { id: true, name: true, photoUrl: true } }, secondPlayer: { select: { id: true, name: true } } },
    });
    return {
      ...m,
      tossText: m.tossWinner && m.tossDecision ? `${m.tossWinner.name} won the toss and chose to ${m.tossDecision === 'BAT' ? 'bat' : 'bowl'}` : null,
      squads: {
        teamA: m.players.filter((p) => p.teamId === m.teamAId),
        teamB: m.players.filter((p) => p.teamId === m.teamBId),
      },
      awards,
    };
  }

  async list(user: AuthUser, q: MatchQueryDto) {
    const where: Prisma.MatchWhereInput = {
      deletedAt: null,
      status: q.status?.length ? { in: q.status } : undefined,
      tournamentId: q.tournamentId,
      stage: q.stage,
      isQuickMatch: q.includeQuick || q.mine || q.teamId || q.playerId ? undefined : false,
      ground: q.ground ? { contains: q.ground } : undefined,
      scheduledAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
      AND: [
        q.teamId ? { OR: [{ teamAId: q.teamId }, { teamBId: q.teamId }] } : {},
        q.playerId ? { players: { some: { playerId: q.playerId } } } : {},
        q.search
          ? { OR: [{ name: { contains: q.search } }, { teamA: { name: { contains: q.search } } }, { teamB: { name: { contains: q.search } } }, { ground: { contains: q.search } }] }
          : {},
        q.mine
          ? {
              OR: [
                { createdById: user.id },
                { scorerLock: { userId: user.id } },
                ...(user.playerId ? [{ players: { some: { playerId: user.playerId } } }] : []),
                { tournament: { organizerId: user.id } },
              ],
            }
          : {},
      ],
    };
    const primary = orderBy(q, ['scheduledAt', 'createdAt', 'completedAt', 'startedAt'], 'scheduledAt');
    const { skip, take } = pageArgs(q);
    const [items, total] = await this.repo.search(where, skip, take, [primary, { createdAt: 'desc' }]);
    return paginate(items, total, q);
  }

  // ─────────────── Update ───────────────

  async update(user: AuthUser, id: string, dto: UpdateMatchDto) {
    await this.access.assertCanManageMatch(user, id);
    const m = await this.repo.findActive(id);
    if (!m) throw new NotFoundException('Match not found');
    const started = !['SCHEDULED', 'TOSS_COMPLETED'].includes(m.status);
    if (started && (dto.overs || dto.playersPerTeam || dto.ballsPerOver || dto.wideRuns !== undefined || dto.noBallRuns !== undefined)) {
      throw new ConflictException('Match format cannot change after the match has started');
    }
    const updated = await this.prisma.match.update({
      where: { id },
      data: { ...dto, scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined },
    });
    await this.audit.log({ userId: user.id, matchId: id, entityType: 'MATCH', entityId: id, action: 'UPDATE', oldValue: m, newValue: dto });
    return updated;
  }

  async toss(user: AuthUser, id: string, dto: TossDto) {
    await this.access.assertCanManageMatch(user, id);
    const m = await this.repo.findActive(id);
    if (!m) throw new NotFoundException('Match not found');
    if (!['SCHEDULED', 'TOSS_COMPLETED'].includes(m.status)) throw new ConflictException('Toss can only be recorded before the match starts');
    if (![m.teamAId, m.teamBId].includes(dto.tossWinnerId)) throw new BadRequestException('Toss winner must be one of the two teams');
    await this.prisma.match.update({ where: { id }, data: { tossWinnerId: dto.tossWinnerId, tossDecision: dto.tossDecision, status: 'TOSS_COMPLETED' } });
    await this.repo.event(id, 'TOSS_COMPLETED', user.id, dto);
    const match = await this.get(id);
    this.live.toMatch(id, LiveEvent.TOSS_COMPLETED, { tossText: match.tossText, tossWinnerId: dto.tossWinnerId, decision: dto.tossDecision });
    await this.notifications.notifyTopic(`match_${id}`, {
      type: NotificationType.TOSS_COMPLETED,
      title: `${match.teamA.name} vs ${match.teamB.name}`,
      body: match.tossText ?? 'Toss completed',
      data: { matchId: id },
    });
    return match;
  }

  async setSquad(user: AuthUser, id: string, dto: SquadDto) {
    await this.access.assertCanManageMatch(user, id);
    const m = await this.repo.findActive(id);
    if (!m) throw new NotFoundException('Match not found');
    if (![m.teamAId, m.teamBId].includes(dto.teamId)) throw new BadRequestException('Team is not part of this match');
    if (['COMPLETED', 'CANCELLED'].includes(m.status)) throw new ConflictException('Match is finished');
    const inPlay = IN_PLAY.includes(m.status);
    if (dto.playerIds.length > m.playersPerTeam + 5) throw new BadRequestException('Too many players');
    const players = await this.prisma.player.findMany({ where: { id: { in: dto.playerIds }, deletedAt: null }, select: { id: true } });
    if (players.length !== dto.playerIds.length) throw new BadRequestException('One or more players do not exist');
    const otherTeam = await this.prisma.matchPlayer.count({ where: { matchId: id, playerId: { in: dto.playerIds }, NOT: { teamId: dto.teamId } } });
    if (otherTeam) throw new BadRequestException('A player cannot play for both teams');

    await this.prisma.$transaction(async (tx) => {
      if (!inPlay) await tx.matchPlayer.deleteMany({ where: { matchId: id, teamId: dto.teamId, playerId: { notIn: dto.playerIds } } });
      for (const [i, playerId] of dto.playerIds.entries()) {
        await tx.teamPlayer.upsert({
          where: { teamId_playerId: { teamId: dto.teamId, playerId } },
          update: { status: 'ACTIVE', removedAt: null },
          create: { teamId: dto.teamId, playerId },
        });
        await tx.matchPlayer.upsert({
          where: { matchId_playerId: { matchId: id, playerId } },
          update: { battingOrder: i + 1, isCaptain: dto.captainId === playerId, isKeeper: dto.keeperId === playerId },
          create: { matchId: id, teamId: dto.teamId, playerId, battingOrder: i + 1, isCaptain: dto.captainId === playerId, isKeeper: dto.keeperId === playerId },
        });
      }
    });
    await this.audit.log({ userId: user.id, matchId: id, entityType: 'MATCH_SQUAD', entityId: dto.teamId, action: 'SET', newValue: dto });
    return this.get(id);
  }

  async remove(user: AuthUser, id: string) {
    await this.access.assertCanManageMatch(user, id);
    const m = await this.repo.findActive(id);
    if (!m) throw new NotFoundException('Match not found');
    await this.prisma.match.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, matchId: id, entityType: 'MATCH', entityId: id, action: 'DELETE', oldValue: { status: m.status } });
    // a deleted completed match must drop out of career / tournament statistics
    if (m.status === 'COMPLETED') this.events.emit(DomainEvent.MATCH_COMPLETED, { matchId: id });
    return { deleted: true };
  }

  async cancel(user: AuthUser, id: string, reason?: string) {
    await this.access.assertCanManageMatch(user, id);
    const m = await this.repo.findActive(id);
    if (!m) throw new NotFoundException('Match not found');
    if (m.status === 'COMPLETED') throw new ConflictException('Completed matches cannot be cancelled; override the result instead');
    await this.prisma.match.update({ where: { id }, data: { status: 'CANCELLED', isPaused: false } });
    await this.audit.log({ userId: user.id, matchId: id, entityType: 'MATCH', entityId: id, action: 'CANCEL', reason });
    this.live.toMatch(id, LiveEvent.MATCH_END, { status: 'CANCELLED', resultText: 'Match cancelled' });
    return { cancelled: true };
  }

  /** Organizer sets / corrects the result (no result, abandoned, DLS, awarded...). */
  async overrideResult(user: AuthUser, id: string, dto: ResultOverrideDto) {
    await this.access.assertCanManageMatch(user, id);
    const m = await this.prisma.match.findFirst({ where: { id, deletedAt: null }, include: { teamA: true, teamB: true } });
    if (!m) throw new NotFoundException('Match not found');
    if (dto.resultType === 'WIN' && ![m.teamAId, m.teamBId].includes(dto.winnerTeamId ?? '')) {
      throw new BadRequestException('winnerTeamId must be one of the teams for a WIN result');
    }
    const winner = dto.winnerTeamId === m.teamAId ? m.teamA : dto.winnerTeamId === m.teamBId ? m.teamB : null;
    const resultText =
      dto.resultText ??
      (dto.resultType === 'WIN'
        ? `${winner!.name} won${dto.winMargin ? ` by ${dto.winMargin} ${dto.winMarginType === 'WICKETS' ? 'wickets' : 'runs'}` : ''}`
        : dto.resultType === 'TIE'
          ? 'Match tied'
          : dto.resultType === 'NO_RESULT'
            ? 'No result'
            : 'Match abandoned');
    await this.prisma.$transaction([
      this.prisma.match.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          isPaused: false,
          resultType: dto.resultType,
          winnerTeamId: dto.resultType === 'WIN' ? dto.winnerTeamId : null,
          winMargin: dto.winMargin ?? null,
          winMarginType: dto.winMarginType ?? null,
          resultText,
          completedAt: m.completedAt ?? new Date(),
        },
      }),
      this.prisma.innings.updateMany({ where: { matchId: id, status: 'IN_PROGRESS' }, data: { status: 'COMPLETED', endedAt: new Date(), endReason: 'RESULT_OVERRIDE' } }),
    ]);
    await this.repo.event(id, 'RESULT_OVERRIDDEN', user.id, { ...dto, resultText });
    await this.audit.log({
      userId: user.id,
      matchId: id,
      entityType: 'MATCH_RESULT',
      entityId: id,
      action: 'OVERRIDE',
      oldValue: { resultType: m.resultType, winnerTeamId: m.winnerTeamId, resultText: m.resultText },
      newValue: { ...dto, resultText },
      reason: dto.reason,
    });
    this.live.toMatch(id, LiveEvent.MATCH_END, { status: 'COMPLETED', resultText, winnerTeamId: dto.winnerTeamId ?? null });
    this.events.emit(DomainEvent.MATCH_COMPLETED, { matchId: id });
    return this.get(id);
  }

  async timeline(id: string, q: TimelineQueryDto) {
    const where = { matchId: id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.scoreEvent.findMany({ where, ...pageArgs(q), orderBy: { createdAt: q.sortOrder === 'asc' ? 'asc' : 'desc' } }),
      this.prisma.scoreEvent.count({ where }),
    ]);
    return paginate(items, total, q);
  }
}
