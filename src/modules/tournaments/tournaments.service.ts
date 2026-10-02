import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MatchStage, NotificationType, Prisma, Tournament } from '@prisma/client';
import { orderBy, pageArgs, paginate } from '../../common/dto/pagination.dto';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamsService } from '../teams/teams.service';
import { AddTournamentTeamDto, CreateTournamentDto, GenerateFixturesDto, TournamentQueryDto, UpdateTournamentDto } from './dto/tournaments.dto';
import { knockoutFirstRound, knockoutNextRound, Pairing, roundRobin, schedule, stageForTeams } from './fixtures/fixture-generator';
import { PointsTableService } from './points-table.service';
import { TournamentsRepository } from './tournaments.repository';

const KNOCKOUT_STAGES: MatchStage[] = ['KNOCKOUT', 'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL'];

@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(
    private readonly repo: TournamentsRepository,
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly points: PointsTableService,
  ) {}

  async create(user: AuthUser, dto: CreateTournamentDto) {
    if (new Date(dto.endDate) < new Date(dto.startDate)) throw new BadRequestException('endDate must be after startDate');
    const t = await this.prisma.tournament.create({
      data: {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        season: dto.season ?? String(new Date(dto.startDate).getFullYear()),
        organizerId: user.id,
      },
    });
    await this.audit.log({ userId: user.id, entityType: 'TOURNAMENT', entityId: t.id, action: 'CREATE', newValue: dto });
    return this.get(t.id);
  }

  async list(user: AuthUser, q: TournamentQueryDto) {
    const where: Prisma.TournamentWhereInput = {
      deletedAt: null,
      status: q.status,
      type: q.type,
      season: q.season,
      city: q.city ? { contains: q.city } : undefined,
      organizerId: q.mine ? user.id : undefined,
      OR: q.search ? [{ name: { contains: q.search } }, { ground: { contains: q.search } }, { city: { contains: q.search } }] : undefined,
    };
    const { skip, take } = pageArgs(q);
    const [items, total] = await this.repo.search(where, skip, take, orderBy(q, ['startDate', 'createdAt', 'name', 'endDate'], 'startDate'));
    return paginate(items, total, q);
  }

  async get(id: string) {
    const t = await this.repo.findById(id);
    if (!t) throw new NotFoundException('Tournament not found');
    return t;
  }

  async update(user: AuthUser, id: string, dto: UpdateTournamentDto) {
    await this.access.assertCanManageTournament(user, id);
    const before = await this.get(id);
    const started = await this.prisma.match.count({ where: { tournamentId: id, deletedAt: null, status: { notIn: ['SCHEDULED', 'TOSS_COMPLETED', 'CANCELLED'] } } });
    if (started && (dto.overs || dto.playersPerTeam || dto.type)) throw new ConflictException('Format cannot change once matches have started');
    const t = await this.prisma.tournament.update({
      where: { id },
      data: { ...dto, startDate: dto.startDate ? new Date(dto.startDate) : undefined, endDate: dto.endDate ? new Date(dto.endDate) : undefined },
    });
    await this.audit.log({ userId: user.id, entityType: 'TOURNAMENT', entityId: id, action: 'UPDATE', oldValue: before, newValue: dto });
    return t;
  }

  async remove(user: AuthUser, id: string) {
    await this.access.assertCanManageTournament(user, id);
    const live = await this.prisma.match.count({ where: { tournamentId: id, deletedAt: null, status: { in: ['LIVE', 'INNINGS_BREAK'] } } });
    if (live) throw new ConflictException('Tournament has live matches');
    await this.prisma.tournament.update({ where: { id }, data: { deletedAt: new Date(), status: 'CANCELLED' } });
    await this.audit.log({ userId: user.id, entityType: 'TOURNAMENT', entityId: id, action: 'DELETE' });
    return { deleted: true };
  }

  async setImage(user: AuthUser, id: string, file: Express.Multer.File, kind: 'logo' | 'banner') {
    await this.access.assertCanManageTournament(user, id);
    const stored = await this.storage.save(file, kind === 'logo' ? 'tournament-logo' : 'tournament-banner');
    return this.prisma.tournament.update({ where: { id }, data: kind === 'logo' ? { logoUrl: stored.url } : { bannerUrl: stored.url } });
  }

  // ─────────────── teams ───────────────

  teams(id: string) {
    return this.repo.teams(id);
  }

  async addTeam(user: AuthUser, id: string, dto: AddTournamentTeamDto) {
    await this.access.assertCanManageTournament(user, id);
    const t = await this.get(id);
    let teamId = dto.teamId;
    if (!teamId) {
      const team = await this.prisma.team.create({ data: { name: dto.name!, createdById: user.id, ...TeamsService.newCodes() } });
      teamId = team.id;
    } else if (!(await this.prisma.team.findFirst({ where: { id: teamId, deletedAt: null, isTemporary: false } }))) {
      throw new NotFoundException('Team not found');
    }
    const entry = await this.prisma.tournamentTeam.create({ data: { tournamentId: id, teamId, groupName: dto.groupName, seed: dto.seed } });
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { name: true, createdById: true, managerId: true, captain: { select: { userId: true } } } });
    await this.notifications.notifyUsers([team.createdById, team.managerId, team.captain?.userId].filter((u) => u && u !== user.id), {
      type: NotificationType.TOURNAMENT_INVITATION,
      title: `Tournament invitation`,
      body: `${team.name} has been added to ${t.name}`,
      data: { tournamentId: id, teamId },
    });
    await this.audit.log({ userId: user.id, entityType: 'TOURNAMENT', entityId: id, action: 'ADD_TEAM', newValue: { teamId } });
    return entry;
  }

  async removeTeam(user: AuthUser, id: string, teamId: string) {
    await this.access.assertCanManageTournament(user, id);
    const played = await this.prisma.match.count({
      where: { tournamentId: id, deletedAt: null, status: { notIn: ['SCHEDULED', 'TOSS_COMPLETED', 'CANCELLED'] }, OR: [{ teamAId: teamId }, { teamBId: teamId }] },
    });
    if (played) throw new ConflictException('Team has already played in this tournament');
    await this.prisma.$transaction([
      this.prisma.match.updateMany({ where: { tournamentId: id, OR: [{ teamAId: teamId }, { teamBId: teamId }], status: { in: ['SCHEDULED', 'TOSS_COMPLETED'] } }, data: { deletedAt: new Date() } }),
      this.prisma.tournamentTeam.delete({ where: { tournamentId_teamId: { tournamentId: id, teamId } } }),
    ]);
    await this.audit.log({ userId: user.id, entityType: 'TOURNAMENT', entityId: id, action: 'REMOVE_TEAM', oldValue: { teamId } });
    return { removed: true };
  }

  // ─────────────── fixtures ───────────────

  async generateFixtures(user: AuthUser, id: string, dto: GenerateFixturesDto) {
    await this.access.assertCanManageTournament(user, id);
    const t = await this.get(id);
    if (t.type === 'FRIENDLY') throw new BadRequestException('Friendly tournaments have no automatic fixtures; create matches manually');
    const entries = await this.repo.teams(id);
    if (entries.length < 2) throw new BadRequestException('Add at least 2 teams first');

    const existing = await this.prisma.match.count({ where: { tournamentId: id, deletedAt: null } });
    if (existing) {
      if (!dto.regenerate) throw new ConflictException('Fixtures already exist. Pass regenerate=true to replace unplayed fixtures.');
      const played = await this.prisma.match.count({ where: { tournamentId: id, deletedAt: null, status: { notIn: ['SCHEDULED', 'TOSS_COMPLETED', 'CANCELLED'] } } });
      if (played) throw new ConflictException('Cannot regenerate: matches have already been played');
      await this.prisma.match.updateMany({ where: { tournamentId: id, deletedAt: null }, data: { deletedAt: new Date() } });
    }

    const seeded = [...entries].sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999)).map((e) => e.teamId);
    let pairings: (Pairing & { stage: MatchStage })[];
    if (t.type === 'KNOCKOUT') {
      const { pairings: first } = knockoutFirstRound(seeded);
      const stage = stageForTeams(first.length * 2 + (seeded.length - first.length * 2));
      pairings = first.map((p) => ({ ...p, stage }));
    } else if (t.type === 'LEAGUE_KNOCKOUT' && entries.some((e) => e.groupName)) {
      // group stage: round robin inside each group
      const groups = new Map<string, string[]>();
      entries.forEach((e) => groups.set(e.groupName ?? '-', [...(groups.get(e.groupName ?? '-') ?? []), e.teamId]));
      pairings = [...groups.values()].flatMap((g) => roundRobin(g, !!dto.doubleRoundRobin)).map((p) => ({ ...p, stage: 'LEAGUE' as MatchStage }));
      pairings.sort((a, b) => a.round - b.round);
    } else {
      pairings = roundRobin(seeded, !!dto.doubleRoundRobin).map((p) => ({ ...p, stage: 'LEAGUE' as MatchStage }));
    }

    const created = await this.createFixtureMatches(t, user.id, pairings, t.startDate, dto);
    await this.prisma.tournament.update({ where: { id }, data: { fixturesGeneratedAt: new Date(), status: 'UPCOMING' } });
    await this.audit.log({ userId: user.id, entityType: 'TOURNAMENT', entityId: id, action: 'GENERATE_FIXTURES', newValue: { count: created, ...dto } });
    return { created, fixtures: await this.fixtures(id) };
  }

  private async createFixtureMatches(
    t: Tournament,
    organizerId: string,
    pairings: (Pairing & { stage: MatchStage })[],
    from: Date,
    opts: Pick<GenerateFixturesDto, 'matchesPerDay' | 'startTime' | 'gapMinutes'> = {},
  ) {
    if (!pairings.length) return 0;
    const lastNumber = (await this.prisma.match.aggregate({ where: { tournamentId: t.id, deletedAt: null }, _max: { matchNumber: true } }))._max.matchNumber ?? 0;
    const slots = schedule(pairings.length, from < new Date() ? new Date() : from, opts.matchesPerDay ?? 2, opts.startTime ?? '09:00', opts.gapMinutes ?? 240);
    await this.prisma.match.createMany({
      data: pairings.map((p, i) => ({
        tournamentId: t.id,
        name: `Match ${lastNumber + i + 1}${p.stage !== 'LEAGUE' ? ` - ${p.stage.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}` : ''}`,
        teamAId: p.teamAId,
        teamBId: p.teamBId,
        playersPerTeam: t.playersPerTeam,
        overs: t.overs,
        ballType: t.ballType,
        ground: t.ground,
        scheduledAt: slots[i],
        stage: p.stage,
        roundNumber: p.round,
        matchNumber: lastNumber + i + 1,
        status: 'SCHEDULED',
        createdById: organizerId,
      })),
    });
    return pairings.length;
  }

  fixtures(id: string) {
    return this.prisma.match.findMany({
      where: { tournamentId: id, deletedAt: null },
      orderBy: [{ roundNumber: 'asc' }, { matchNumber: 'asc' }],
      include: {
        teamA: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        teamB: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        winner: { select: { id: true, name: true } },
      },
    });
  }

  pointsTable(id: string) {
    return this.points.table(id);
  }

  async recalculatePoints(user: AuthUser, id: string) {
    await this.access.assertCanManageTournament(user, id);
    return this.points.recalculate(id);
  }

  /**
   * Knockout progression, run after every completed tournament match:
   *  - KNOCKOUT: when a round is fully decided, create the next round (bye teams join round 2).
   *  - LEAGUE_KNOCKOUT: when all league games are done, seed the top N into knockouts.
   *  - Tournament completes after the final (or last league game for pure leagues).
   */
  async progress(tournamentId: string) {
    const t = await this.prisma.tournament.findFirst({ where: { id: tournamentId, deletedAt: null } });
    if (!t || t.type === 'FRIENDLY') return;
    const matches = await this.prisma.match.findMany({ where: { tournamentId, deletedAt: null, status: { not: 'CANCELLED' } }, orderBy: [{ roundNumber: 'asc' }, { matchNumber: 'asc' }] });
    const decided = (m: (typeof matches)[number]) => m.status === 'COMPLETED' && m.resultType === 'WIN' && !!m.winnerTeamId;
    const knockout = matches.filter((m) => KNOCKOUT_STAGES.includes(m.stage));
    const organizerId = t.organizerId;

    if (t.type === 'LEAGUE') {
      if (matches.length && matches.every((m) => m.status === 'COMPLETED')) await this.complete(t.id);
      return;
    }

    if (t.type === 'LEAGUE_KNOCKOUT' && !knockout.length) {
      const league = matches.filter((m) => m.stage === 'LEAGUE');
      if (!league.length || league.some((m) => m.status !== 'COMPLETED')) return;
      const table = await this.points.recalculate(tournamentId);
      const n = Math.min(table.length, 4);
      const q = table.slice(0, n >= 4 ? 4 : 2).map((r) => r.team.id);
      const round = Math.max(...league.map((m) => m.roundNumber ?? 0)) + 1;
      const pairings = q.length === 4 ? [{ round, teamAId: q[0], teamBId: q[3] }, { round, teamAId: q[1], teamBId: q[2] }] : [{ round, teamAId: q[0], teamBId: q[1] }];
      await this.createFixtureMatches(t, organizerId, pairings.map((p) => ({ ...p, stage: stageForTeams(q.length) })), new Date(Date.now() + 86400_000));
      await this.prisma.tournamentTeam.updateMany({ where: { tournamentId, teamId: { notIn: q } }, data: { isEliminated: true } });
      this.logger.log(`Tournament ${tournamentId}: knockouts seeded with ${q.length} teams`);
      return;
    }

    if (!knockout.length) return;
    const lastRound = Math.max(...knockout.map((m) => m.roundNumber ?? 0));
    const current = knockout.filter((m) => m.roundNumber === lastRound);
    if (!current.every(decided)) return;
    if (current.length === 1 && current[0].stage === 'FINAL') {
      await this.complete(t.id);
      return;
    }
    const winners = current.map((m) => m.winnerTeamId!);
    let qualified = winners;
    if (t.type === 'KNOCKOUT' && knockout.every((m) => m.roundNumber === lastRound) && lastRound === Math.min(...knockout.map((m) => m.roundNumber ?? 1))) {
      // first knockout round just finished: add teams that received byes (in seed order)
      const played = new Set(current.flatMap((m) => [m.teamAId, m.teamBId]));
      const entries = await this.repo.teams(tournamentId);
      const byes = entries.sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999)).map((e) => e.teamId).filter((id) => !played.has(id));
      qualified = [...byes, ...winners];
    }
    const losers = current.map((m) => (m.winnerTeamId === m.teamAId ? m.teamBId : m.teamAId));
    await this.prisma.tournamentTeam.updateMany({ where: { tournamentId, teamId: { in: losers } }, data: { isEliminated: true } });
    const next = knockoutNextRound(qualified, lastRound + 1);
    await this.createFixtureMatches(t, organizerId, next.map((p) => ({ ...p, stage: stageForTeams(qualified.length) })), new Date(Date.now() + 86400_000));
    this.logger.log(`Tournament ${tournamentId}: created round ${lastRound + 1} (${next.length} matches)`);
  }

  private async complete(id: string) {
    await this.prisma.tournament.update({ where: { id }, data: { status: 'COMPLETED' } });
  }
}
