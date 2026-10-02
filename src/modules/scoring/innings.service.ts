import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Innings, Match, NotificationType, Prisma, ResultType, WinMarginType } from '@prisma/client';
import { DomainEvent } from '../../common/constants/domain-events';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { LockService } from '../../infrastructure/redis/lock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { CommentaryService } from '../commentary/commentary.service';
import { LiveEvent } from '../live/live.events';
import { LiveService } from '../live/live.service';
import { MatchesRepository } from '../matches/matches.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { ScorerService } from '../scorer/scorer.service';
import { StartInningsDto } from './dto/scoring.dto';
import { InningsTotals } from './engine/scoring-engine';
import { MatchStateService } from './match-state.service';

export type MatchWithTeams = Match & { teamA: { id: string; name: string }; teamB: { id: string; name: string } };

@Injectable()
export class InningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MatchStateService,
    private readonly scorer: ScorerService,
    private readonly locks: LockService,
    private readonly access: AccessService,
    private readonly commentary: CommentaryService,
    private readonly live: LiveService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly repo: MatchesRepository,
    private readonly events: EventEmitter2,
  ) {}

  // ─────────────── shared helpers ───────────────

  lockKey(matchId: string) {
    return `score:${matchId}`;
  }

  async loadMatch(matchId: string): Promise<MatchWithTeams> {
    const m = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      include: { teamA: { select: { id: true, name: true } }, teamB: { select: { id: true, name: true } } },
    });
    if (!m) throw new NotFoundException('Match not found');
    return m;
  }

  latestInnings(matchId: string) {
    return this.prisma.innings.findFirst({ where: { matchId }, orderBy: { number: 'desc' } });
  }

  teamName(m: MatchWithTeams, teamId: string) {
    return teamId === m.teamAId ? m.teamA.name : m.teamB.name;
  }

  async squad(matchId: string, teamId: string) {
    const rows = await this.prisma.matchPlayer.findMany({ where: { matchId, teamId }, select: { playerId: true } });
    return new Set(rows.map((r) => r.playerId));
  }

  /** Linked user ids of everyone involved (players, creator, organizer) for personal notifications. */
  async participantUserIds(matchId: string) {
    const m = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { createdById: true, tournament: { select: { organizerId: true } }, players: { select: { player: { select: { userId: true } } } } },
    });
    return [m?.createdById, m?.tournament?.organizerId, ...(m?.players.map((p) => p.player.userId) ?? [])].filter(Boolean) as string[];
  }

  /** Rebuilds the live snapshot and pushes it to all spectators. */
  async publish(matchId: string) {
    await this.state.invalidate(matchId);
    const snap = await this.state.snapshot(matchId);
    this.live.toMatch(matchId, LiveEvent.SCORE_UPDATED, snap as object);
    return snap;
  }

  /** Serialises all scoring writes for a match and enforces the scorer lock. */
  async asScorer<T>(user: AuthUser, matchId: string, fn: () => Promise<T>): Promise<T> {
    return this.locks.withLock(this.lockKey(matchId), async () => {
      await this.scorer.assertScorer(user, matchId);
      return fn();
    });
  }

  private assertPlayers(dto: StartInningsDto, batting: Set<string>, bowling: Set<string>) {
    if (dto.strikerId === dto.nonStrikerId) throw new BadRequestException('Striker and non-striker must be different players');
    if (!batting.has(dto.strikerId) || !batting.has(dto.nonStrikerId)) throw new BadRequestException('Openers must be in the batting team squad');
    if (!bowling.has(dto.bowlerId)) throw new BadRequestException('Bowler must be in the bowling team squad');
  }

  /** Fills empty squads from team rosters. */
  private async ensureSquads(m: Match) {
    for (const teamId of [m.teamAId, m.teamBId]) {
      const count = await this.prisma.matchPlayer.count({ where: { matchId: m.id, teamId } });
      if (count) continue;
      const roster = await this.prisma.teamPlayer.findMany({
        where: { teamId, status: 'ACTIVE', player: { deletedAt: null } },
        orderBy: { joinedAt: 'asc' },
        take: m.playersPerTeam,
      });
      if (roster.length < 2) throw new BadRequestException('Each team needs at least 2 players. Set the squad or add temporary players.');
      await this.prisma.matchPlayer.createMany({ data: roster.map((r, i) => ({ matchId: m.id, teamId, playerId: r.playerId, battingOrder: i + 1 })) });
    }
  }

  // ─────────────── lifecycle ───────────────

  /** Starts the match: acquires the scorer lock, builds squads and opens innings 1. */
  async startMatch(user: AuthUser, matchId: string, dto: StartInningsDto) {
    const m = await this.loadMatch(matchId);
    if (m.status === 'SCHEDULED') throw new ConflictException('Record the toss before starting the match');
    if (m.status !== 'TOSS_COMPLETED') throw new ConflictException(`Match is already ${m.status.toLowerCase()}`);
    const holder = await this.scorer.holder(matchId);
    if (!holder) await this.scorer.acquire(user, matchId, 'CLAIMED');
    else if (holder !== user.id) throw new ForbiddenException('Another user holds the scorer lock for this match');

    return this.asScorer(user, matchId, async () => {
      await this.ensureSquads(m);
      const battingTeamId = m.tossDecision === 'BAT' ? m.tossWinnerId! : m.tossWinnerId === m.teamAId ? m.teamBId : m.teamAId;
      const bowlingTeamId = battingTeamId === m.teamAId ? m.teamBId : m.teamAId;
      const batting = await this.squad(matchId, battingTeamId);
      this.assertPlayers(dto, batting, await this.squad(matchId, bowlingTeamId));

      await this.prisma.$transaction(async (tx) => {
        await tx.innings.create({
          data: {
            matchId,
            number: 1,
            battingTeamId,
            bowlingTeamId,
            maxOvers: m.overs,
            maxWickets: Math.max(1, batting.size - 1),
            strikerId: dto.strikerId,
            nonStrikerId: dto.nonStrikerId,
            bowlerId: dto.bowlerId,
          },
        });
        await tx.match.update({ where: { id: matchId }, data: { status: 'LIVE', startedAt: new Date(), currentInningsNo: 1 } });
        await this.repo.event(matchId, 'MATCH_STARTED', user.id, dto, 1, undefined, tx);
      });
      this.live.toMatch(matchId, LiveEvent.MATCH_STARTED, { battingTeamId, bowlingTeamId });
      const title = `${m.teamA.name} vs ${m.teamB.name}`;
      const body = `Match started! ${this.teamName(m, battingTeamId)} are batting.`;
      await this.notifications.notifyTopic(`match_${matchId}`, { type: NotificationType.MATCH_STARTED, title, body, data: { matchId } });
      await this.notifications.notifyUsers(await this.participantUserIds(matchId), { type: NotificationType.MATCH_STARTED, title, body, data: { matchId } });
      if (m.tournamentId) await this.prisma.tournament.updateMany({ where: { id: m.tournamentId, status: 'UPCOMING' }, data: { status: 'ONGOING' } });
      return this.publish(matchId);
    });
  }

  /** Starts the next innings of a pair (2nd innings / 2nd super-over innings) with target set. */
  async startNextInnings(user: AuthUser, matchId: string, dto: StartInningsDto) {
    return this.asScorer(user, matchId, async () => {
      const m = await this.loadMatch(matchId);
      if (m.status !== 'INNINGS_BREAK') throw new ConflictException('Match is not at an innings break');
      const last = await this.latestInnings(matchId);
      if (!last || last.status !== 'COMPLETED' || last.number % 2 === 0) throw new ConflictException('No innings to follow');
      const batting = await this.squad(matchId, last.bowlingTeamId);
      this.assertPlayers(dto, batting, await this.squad(matchId, last.battingTeamId));
      const number = last.number + 1;
      await this.prisma.$transaction(async (tx) => {
        await tx.innings.create({
          data: {
            matchId,
            number,
            isSuperOver: last.isSuperOver,
            battingTeamId: last.bowlingTeamId,
            bowlingTeamId: last.battingTeamId,
            maxOvers: last.isSuperOver ? 1 : m.overs,
            maxWickets: last.isSuperOver ? Math.min(2, batting.size - 1) : Math.max(1, batting.size - 1),
            target: last.runs + 1,
            strikerId: dto.strikerId,
            nonStrikerId: dto.nonStrikerId,
            bowlerId: dto.bowlerId,
          },
        });
        await tx.match.update({ where: { id: matchId }, data: { status: 'LIVE', currentInningsNo: number } });
        await this.repo.event(matchId, 'INNINGS_STARTED', user.id, { ...dto, target: last.runs + 1 }, number, undefined, tx);
      });
      this.live.toMatch(matchId, LiveEvent.INNINGS_STARTED, { inningsNumber: number, battingTeamId: last.bowlingTeamId, target: last.runs + 1 });
      return this.publish(matchId);
    });
  }

  /** Starts a super over after a tie: the side that batted second bats first. */
  async startSuperOver(user: AuthUser, matchId: string, dto: StartInningsDto) {
    const m = await this.loadMatch(matchId);
    if (!(m.status === 'COMPLETED' && m.resultType === 'TIE')) throw new ConflictException('A super over can only be played after a tie');
    if (!(await this.scorer.holder(matchId))) await this.scorer.acquire(user, matchId, 'CLAIMED');
    return this.asScorer(user, matchId, async () => {
      const last = await this.latestInnings(matchId);
      if (!last || last.number % 2 !== 0) throw new ConflictException('Innings pair not complete');
      const batting = await this.squad(matchId, last.battingTeamId);
      this.assertPlayers(dto, batting, await this.squad(matchId, last.bowlingTeamId));
      const number = last.number + 1;
      await this.prisma.$transaction(async (tx) => {
        await tx.innings.create({
          data: {
            matchId,
            number,
            isSuperOver: true,
            battingTeamId: last.battingTeamId,
            bowlingTeamId: last.bowlingTeamId,
            maxOvers: 1,
            maxWickets: Math.min(2, batting.size - 1),
            strikerId: dto.strikerId,
            nonStrikerId: dto.nonStrikerId,
            bowlerId: dto.bowlerId,
          },
        });
        await tx.match.update({
          where: { id: matchId },
          data: { status: 'LIVE', currentInningsNo: number, resultType: null, winnerTeamId: null, winMargin: null, winMarginType: null, resultText: null, completedAt: null },
        });
        await this.repo.event(matchId, 'SUPER_OVER_STARTED', user.id, dto, number, undefined, tx);
      });
      await this.commentary.add(matchId, null, 'MATCH_SUMMARY', `SUPER OVER! ${this.teamName(m, last.battingTeamId)} will bat first.`);
      this.live.toMatch(matchId, LiveEvent.INNINGS_STARTED, { inningsNumber: number, isSuperOver: true, battingTeamId: last.battingTeamId });
      return this.publish(matchId);
    });
  }

  async manualEnd(user: AuthUser, matchId: string, reason?: string) {
    return this.asScorer(user, matchId, async () => {
      const m = await this.loadMatch(matchId);
      const inn = await this.latestInnings(matchId);
      if (m.status !== 'LIVE' || !inn || inn.status !== 'IN_PROGRESS') throw new ConflictException('No innings in progress');
      await this.finishInnings(m, inn, reason ? `MANUAL: ${reason}`.slice(0, 100) : 'MANUAL', user.id);
      await this.audit.log({ userId: user.id, matchId, entityType: 'INNINGS', entityId: inn.id, action: 'END', reason });
      return this.publish(matchId);
    });
  }

  async setPaused(user: AuthUser, matchId: string, paused: boolean, reason?: string) {
    const run = async () => {
      const m = await this.loadMatch(matchId);
      if (m.status !== 'LIVE' && m.status !== 'INNINGS_BREAK') throw new ConflictException('Match is not in progress');
      if (m.isPaused === paused) return this.publish(matchId);
      await this.prisma.match.update({ where: { id: matchId }, data: { isPaused: paused, pauseReason: paused ? (reason ?? null) : null } });
      await this.repo.event(matchId, paused ? 'MATCH_PAUSED' : 'MATCH_RESUMED', user.id, { reason });
      this.live.toMatch(matchId, paused ? LiveEvent.MATCH_PAUSED : LiveEvent.MATCH_RESUMED, { reason });
      if (reason) await this.commentary.add(matchId, null, 'MANUAL', paused ? `Play suspended: ${reason}` : 'Play resumes.', null, user.id);
      return this.publish(matchId);
    };
    // organizers can pause / resume even without holding the scorer lock
    if (await this.access.canManageMatch(user, matchId)) return this.locks.withLock(this.lockKey(matchId), run);
    return this.asScorer(user, matchId, run);
  }

  // ─────────────── end-of-innings & result ───────────────

  endReason(inn: Innings, t: Pick<InningsTotals, 'runs' | 'wickets' | 'completedOvers'>) {
    if (inn.target && t.runs >= inn.target) return 'TARGET_REACHED';
    if (t.wickets >= inn.maxWickets) return 'ALL_OUT';
    if (t.completedOvers >= inn.maxOvers) return 'OVERS_COMPLETED';
    return null;
  }

  /** Closes an innings; opens the innings break or decides the match. */
  async finishInnings(m: MatchWithTeams, inn: Innings, reason: string, userId: string | null) {
    const fresh = await this.prisma.innings.findUniqueOrThrow({ where: { id: inn.id } });
    await this.prisma.innings.update({
      where: { id: inn.id },
      data: { status: 'COMPLETED', endedAt: new Date(), endReason: reason, isAllOut: fresh.wickets >= fresh.maxWickets },
    });
    await this.repo.event(m.id, 'INNINGS_ENDED', userId, { reason, runs: fresh.runs, wickets: fresh.wickets }, fresh.number);

    const batting = this.teamName(m, fresh.battingTeamId);
    const overs = `${fresh.completedOvers}.${fresh.ballsInOver}`;
    let summary = `${fresh.isSuperOver ? 'Super over: ' : 'Innings break: '}${batting} ${fresh.runs}/${fresh.wickets} (${overs} ov).`;
    if (fresh.number % 2 === 1) summary += ` ${this.teamName(m, fresh.bowlingTeamId)} need ${fresh.runs + 1} to win.`;
    await this.commentary.add(m.id, fresh.id, 'INNINGS_SUMMARY', summary);
    this.live.toMatch(m.id, LiveEvent.INNINGS_END, { inningsNumber: fresh.number, runs: fresh.runs, wickets: fresh.wickets, overs, reason, summary });
    await this.notifications.notifyTopic(`match_${m.id}`, { type: NotificationType.INNINGS_END, title: `${m.teamA.name} vs ${m.teamB.name}`, body: summary, data: { matchId: m.id } });

    if (fresh.number % 2 === 1) {
      await this.prisma.match.update({ where: { id: m.id }, data: { status: 'INNINGS_BREAK' } });
    } else {
      await this.decideResult(m, fresh.number, userId, true);
    }
  }

  /** Computes the result from the last innings pair and completes the match. */
  async decideResult(m: MatchWithTeams, secondNumber: number, userId: string | null, announce: boolean) {
    const [first, second] = await Promise.all([
      this.prisma.innings.findUniqueOrThrow({ where: { matchId_number: { matchId: m.id, number: secondNumber - 1 } } }),
      this.prisma.innings.findUniqueOrThrow({ where: { matchId_number: { matchId: m.id, number: secondNumber } } }),
    ]);
    const target = second.target ?? first.runs + 1;
    let resultType: ResultType = 'WIN';
    let winnerTeamId: string | null = null;
    let winMargin: number | null = null;
    let winMarginType: WinMarginType | null = null;
    let resultText: string;

    if (second.runs >= target) {
      winnerTeamId = second.battingTeamId;
      winMargin = second.maxWickets - second.wickets;
      winMarginType = second.isSuperOver ? 'SUPER_OVER' : 'WICKETS';
    } else if (second.runs === target - 1) {
      resultType = 'TIE';
    } else {
      winnerTeamId = first.battingTeamId;
      winMargin = target - 1 - second.runs;
      winMarginType = second.isSuperOver ? 'SUPER_OVER' : 'RUNS';
    }
    if (resultType === 'TIE') resultText = second.isSuperOver ? 'Super over tied' : 'Match tied';
    else if (winMarginType === 'SUPER_OVER') resultText = `${this.teamName(m, winnerTeamId!)} won the Super Over`;
    else resultText = `${this.teamName(m, winnerTeamId!)} won by ${winMargin} ${winMarginType === 'WICKETS' ? 'wicket' : 'run'}${winMargin === 1 ? '' : 's'}`;

    await this.prisma.match.update({
      where: { id: m.id },
      data: { status: 'COMPLETED', isPaused: false, resultType, winnerTeamId, winMargin, winMarginType, resultText, completedAt: new Date() },
    });
    await this.repo.event(m.id, 'MATCH_ENDED', userId, { resultType, winnerTeamId, winMargin, winMarginType, resultText });

    if (announce) {
      await this.commentary.add(m.id, null, 'MATCH_SUMMARY', `${resultText}!${resultType === 'TIE' ? ' A super over may decide it.' : ''}`);
      this.live.toMatch(m.id, LiveEvent.MATCH_END, { status: 'COMPLETED', resultType, winnerTeamId, winMargin, winMarginType, resultText });
      const title = `${m.teamA.name} vs ${m.teamB.name}`;
      await this.notifications.notifyTopic(`match_${m.id}`, { type: NotificationType.MATCH_RESULT, title, body: resultText, data: { matchId: m.id } });
      await this.notifications.notifyUsers(await this.participantUserIds(m.id), { type: NotificationType.MATCH_RESULT, title, body: resultText, data: { matchId: m.id } });
    }
    this.events.emit(DomainEvent.MATCH_COMPLETED, { matchId: m.id });
  }

  /** Re-opens the latest innings (used when undoing the ball that ended it). */
  async reopen(m: Match, inn: Innings, tx: Prisma.TransactionClient) {
    await tx.innings.update({ where: { id: inn.id }, data: { status: 'IN_PROGRESS', endedAt: null, endReason: null, isAllOut: false } });
    await tx.match.update({
      where: { id: m.id },
      data: { status: 'LIVE', resultType: null, winnerTeamId: null, winMargin: null, winMarginType: null, resultText: null, completedAt: null },
    });
  }
}
