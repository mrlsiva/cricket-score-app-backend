import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Ball, Innings, NotificationType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { DomainEvent } from '../../common/constants/domain-events';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { oversText } from '../../common/utils/cricket.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { commentaryForBall, overSummaryText } from '../commentary/commentary.generator';
import { CommentaryService } from '../commentary/commentary.service';
import { LiveEvent } from '../live/live.events';
import { LiveService } from '../live/live.service';
import { MatchesRepository } from '../matches/matches.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { ScorerService } from '../scorer/scorer.service';
import {
  AddBallDto,
  BallQueryDto,
  ChangeBowlerDto,
  EditBallDto,
  NonDeliveryDismissalDto,
  PenaltyDto,
  SetBatsmenDto,
  SyncDto,
} from './dto/scoring.dto';
import {
  EngineBall,
  EngineConfig,
  InningsReplay,
  normalizeRuns,
  Pointers,
  pointersAfter,
  replayInnings,
  WICKETS_ALLOWED,
} from './engine/scoring-engine';
import { InningsService, MatchWithTeams } from './innings.service';
import { engineConfig, MatchStateService, toEngineBall } from './match-state.service';

type BallRow = Omit<Prisma.BallUncheckedCreateInput, 'id'> & { id: string };

@Injectable()
export class ScoringService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MatchStateService,
    private readonly innings: InningsService,
    private readonly scorer: ScorerService,
    private readonly commentary: CommentaryService,
    private readonly live: LiveService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly repo: MatchesRepository,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.live.setSnapshotProvider((id) => this.state.snapshot(id));
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ context helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async liveContext(matchId: string) {
    const match = await this.innings.loadMatch(matchId);
    if (match.status !== 'LIVE') throw new ConflictException(`Match is ${match.status.toLowerCase().replace('_', ' ')}`);
    if (match.isPaused) throw new ConflictException('Match is paused. Resume it before scoring.');
    const inn = await this.innings.latestInnings(matchId);
    if (!inn || inn.status !== 'IN_PROGRESS') throw new ConflictException('No innings in progress');
    return { match, inn };
  }

  private pointers(inn: Innings): Pointers {
    return { strikerId: inn.strikerId, nonStrikerId: inn.nonStrikerId, bowlerId: inn.bowlerId, previousBowlerId: inn.previousBowlerId };
  }

  private async nextSequence(inningsId: string, tx: Prisma.TransactionClient = this.prisma) {
    const agg = await tx.ball.aggregate({ where: { inningsId }, _max: { sequence: true } });
    return (agg._max.sequence ?? 0) + 1;
  }

  /** Recovers the original "runs" input from a stored ball (inverse of normalizeRuns). */
  private inputRuns(b: Ball, cfg: EngineConfig) {
    switch (b.extraType) {
      case 'WIDE':
        return Math.max(0, b.extraRuns - cfg.wideRuns);
      case 'NO_BALL':
        return b.runsOffBat > 0 || b.extraRuns <= cfg.noBallRuns ? b.runsOffBat : b.extraRuns - cfg.noBallRuns;
      case 'BYE':
      case 'LEG_BYE':
        return b.extraRuns;
      default:
        return b.runsOffBat;
    }
  }

  private validateWicket(extraType: EngineBall['extraType'], wicketType: EngineBall['wicketType'], dismissed: string | null, striker: string, nonStriker: string) {
    if (!wicketType) return;
    if (!WICKETS_ALLOWED[extraType].includes(wicketType)) {
      throw new UnprocessableEntityException(`${wicketType} is not possible on a ${extraType === 'NONE' ? 'legal delivery' : extraType.toLowerCase().replace('_', ' ')}`);
    }
    if (dismissed !== striker && dismissed !== nonStriker) throw new BadRequestException('Dismissed player must be one of the batters at the crease');
    if (wicketType !== 'RUN_OUT' && dismissed !== striker) throw new BadRequestException(`Only the striker can be ${wicketType.toLowerCase()}`);
  }

  /** Previous-over bowler after the log changed (for the consecutive-overs rule). */
  private previousBowler(replay: InningsReplay, balls: EngineBall[]) {
    const current = replay.totals.completedOvers;
    const byId = new Map(balls.map((b) => [b.id, b]));
    for (let i = replay.balls.length - 1; i >= 0; i--) {
      const c = replay.balls[i];
      const src = byId.get(c.id);
      if (c.overNumber < current && src?.kind === 'DELIVERY' && src.bowlerId) return src.bowlerId;
    }
    return null;
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ queries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listBalls(matchId: string, q: BallQueryDto) {
    return this.prisma.ball.findMany({
      where: {
        matchId,
        deletedAt: q.includeDeleted ? undefined : null,
        innings: q.inningsNumber ? { number: q.inningsNumber } : undefined,
        sequence: q.afterSequence !== undefined ? { gt: q.afterSequence } : undefined,
      },
      orderBy: [{ innings: { number: 'asc' } }, { sequence: 'asc' }],
      take: 1000,
    });
  }

  /** Everything a scorer device needs to resume an interrupted match. */
  async resumeState(user: AuthUser, matchId: string) {
    const [snapshot, scorer, inn] = await Promise.all([this.state.snapshot(matchId), this.scorer.status(user, matchId), this.innings.latestInnings(matchId)]);
    const lastBall = inn
      ? await this.prisma.ball.findFirst({ where: { inningsId: inn.id, deletedAt: null }, orderBy: { sequence: 'desc' } })
      : null;
    const squads = await this.prisma.matchPlayer.findMany({
      where: { matchId },
      orderBy: { battingOrder: 'asc' },
      include: { player: { select: { id: true, name: true, tempCode: true, isTemporary: true } } },
    });
    return {
      snapshot,
      scorer,
      innings: inn,
      lastBall,
      squads,
      syncedBallIds: inn ? (await this.prisma.ball.findMany({ where: { inningsId: inn.id, deletedAt: null }, select: { id: true } })).map((b) => b.id) : [],
    };
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ add ball â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async addBall(user: AuthUser, matchId: string, dto: AddBallDto) {
    return this.innings.asScorer(user, matchId, () => this.addBallLocked(user, matchId, dto));
  }

  private async addBallLocked(user: AuthUser, matchId: string, dto: AddBallDto) {
    if (dto.id) {
      const existing = await this.prisma.ball.findUnique({ where: { id: dto.id } });
      if (existing) {
        if (existing.matchId !== matchId) throw new ConflictException('Ball id already used in another match');
        return { duplicate: true, ball: existing, snapshot: await this.state.snapshot(matchId) };
      }
    }
    const { match, inn } = await this.liveContext(matchId);
    const cfg = engineConfig(match);
    const striker = dto.strikerId ?? inn.strikerId;
    const nonStriker = dto.nonStrikerId ?? inn.nonStrikerId;
    const bowler = dto.bowlerId ?? inn.bowlerId;
    if (!striker || !nonStriker) throw new UnprocessableEntityException('Select the new batter before scoring the next ball');
    if (!bowler) throw new UnprocessableEntityException('Select the bowler for this over');
    if (striker === nonStriker) throw new BadRequestException('Striker and non-striker must be different');

    const [battingSquad, bowlingSquad] = await Promise.all([this.innings.squad(matchId, inn.battingTeamId), this.innings.squad(matchId, inn.bowlingTeamId)]);
    if (!battingSquad.has(striker) || !battingSquad.has(nonStriker)) throw new BadRequestException('Batters must be in the batting squad');
    if (!bowlingSquad.has(bowler)) throw new BadRequestException('Bowler must be in the bowling squad');
    if (dto.fielderId && !bowlingSquad.has(dto.fielderId)) throw new BadRequestException('Fielder must be in the bowling squad');

    const existing = await this.state.inningsBalls(inn.id);
    const engineBalls = existing.map(toEngineBall);
    const before = replayInnings(engineBalls, cfg);
    const out = new Set(before.batting.filter((b) => b.isOut).map((b) => b.playerId));
    if (out.has(striker) || out.has(nonStriker)) throw new UnprocessableEntityException('A dismissed batter cannot bat again');
    if (
      before.totals.ballsInOver === 0 &&
      inn.previousBowlerId === bowler &&
      !dto.allowConsecutiveOvers &&
      bowlingSquad.size > 1 &&
      before.totals.completedOvers > 0
    ) {
      throw new UnprocessableEntityException('The same bowler cannot bowl consecutive overs (send allowConsecutiveOvers=true to override)');
    }

    const extraType = dto.extraType ?? 'NONE';
    const wicketType = dto.wicketType ?? null;
    const dismissed = wicketType ? (dto.dismissedPlayerId ?? striker) : null;
    this.validateWicket(extraType, wicketType, dismissed, striker, nonStriker);
    if (wicketType === 'CAUGHT' && !dto.fielderId) throw new BadRequestException('fielderId is required for a catch (use the bowler for caught & bowled)');

    const runs = normalizeRuns({ runs: dto.runs, extraType, noBallRunsType: dto.noBallRunsType, isBoundary: dto.isBoundary }, cfg);
    const sequence = await this.nextSequence(inn.id);
    const engineBall: EngineBall = {
      id: dto.id ?? randomUUID(),
      sequence,
      kind: 'DELIVERY',
      batsmanId: striker,
      nonStrikerId: nonStriker,
      bowlerId: bowler,
      ...runs,
      extraType,
      isWicket: !!wicketType,
      wicketType,
      dismissedPlayerId: dismissed,
      fielderId: wicketType ? (dto.fielderId ?? null) : null,
    };
    return this.persistNewBall(user, match, inn, engineBalls, before, engineBall, { clientSequence: dto.clientSequence, clientCreatedAt: dto.clientCreatedAt });
  }

  /** Shared write path for deliveries, penalties, non-delivery dismissals and forced over ends. */
  private async persistNewBall(
    user: AuthUser,
    match: MatchWithTeams,
    inn: Innings,
    engineBalls: EngineBall[],
    before: InningsReplay,
    ball: EngineBall,
    extra: { clientSequence?: number; clientCreatedAt?: string } = {},
  ) {
    const cfg = engineConfig(match);
    const after = replayInnings([...engineBalls, ball], cfg);
    const computed = after.balls.find((b) => b.id === ball.id)!;
    const next = pointersAfter(ball, computed.completesOver, this.pointers(inn), cfg);

    const row: BallRow = {
      id: ball.id,
      matchId: match.id,
      inningsId: inn.id,
      sequence: ball.sequence,
      kind: ball.kind,
      batsmanId: ball.batsmanId,
      nonStrikerId: ball.nonStrikerId,
      bowlerId: ball.bowlerId,
      runsOffBat: ball.runsOffBat,
      extraType: ball.extraType,
      extraRuns: ball.extraRuns,
      isBoundary: ball.isBoundary,
      isWicket: ball.isWicket,
      wicketType: ball.wicketType,
      dismissedPlayerId: ball.dismissedPlayerId,
      fielderId: ball.fielderId,
      overNumber: computed.overNumber,
      ballInOver: computed.ballInOver,
      isLegal: computed.isLegal,
      totalRuns: computed.totalRuns,
      isFour: computed.isFour,
      isSix: computed.isSix,
      scoreAfter: computed.scoreAfter,
      wicketsAfter: computed.wicketsAfter,
      clientSequence: extra.clientSequence,
      clientCreatedAt: extra.clientCreatedAt ? new Date(extra.clientCreatedAt) : undefined,
      scoredById: user.id,
    };

    const saved = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.ball.create({ data: row });
        await tx.innings.update({ where: { id: inn.id }, data: next });
        await this.state.recalculate(match, inn, tx);
        await this.repo.event(match.id, ball.kind === 'OVER_END' ? 'OVER_ENDED' : 'BALL_ADDED', user.id, { label: computed.label, runs: computed.totalRuns }, inn.number, ball.id, tx);
        return created;
      },
      { timeout: 20_000 },
    );

    await this.afterBall(match, inn, before, after, ball, computed.label, computed.completesOver);
    const refreshed = await this.prisma.innings.findUniqueOrThrow({ where: { id: inn.id } });
    const reason = this.innings.endReason(refreshed, after.totals);
    if (reason) await this.innings.finishInnings(match, refreshed, reason, user.id);

    const snapshot = await this.innings.publish(match.id);
    return { duplicate: false, ball: saved, label: computed.label, inningsEnded: !!reason, endReason: reason, snapshot };
  }

  /** Commentary, spectator events and push notifications for a newly scored ball. */
  private async afterBall(m: MatchWithTeams, inn: Innings, before: InningsReplay, after: InningsReplay, ball: EngineBall, label: string, completesOver: boolean) {
    const names = await this.state.names(m.id);
    const batBefore = before.batting.find((b) => b.playerId === ball.batsmanId);
    const batAfter = after.batting.find((b) => b.playerId === ball.batsmanId);
    const victimLine = after.batting.find((b) => b.playerId === (ball.dismissedPlayerId ?? ball.batsmanId));
    const pBefore = before.partnerships.at(-1);
    // the partnership this ball contributed to
    const pAfter = ball.isWicket ? after.partnerships.at(-1) : after.partnerships.filter((p) => p.isUnbroken).at(-1) ?? after.partnerships.at(-1);
    const sameP = pBefore && pAfter && pBefore.batter1Id === pAfter.batter1Id && pBefore.batter2Id === pAfter.batter2Id;
    const teamScore = `${this.innings.teamName(m, inn.battingTeamId)} ${after.totals.runs}/${after.totals.wickets}`;

    const items = commentaryForBall({
      ball,
      label,
      names,
      batsmanRuns: ball.isWicket ? (victimLine?.runs ?? 0) : (batAfter?.runs ?? 0),
      batsmanBalls: ball.isWicket ? (victimLine?.balls ?? 0) : (batAfter?.balls ?? 0),
      batsmanRunsBefore: batBefore?.runs ?? 0,
      partnershipRuns: pAfter?.runs ?? 0,
      partnershipRunsBefore: sameP ? pBefore!.runs : 0,
      partnershipNames: pAfter ? [names[pAfter.batter1Id], names[pAfter.batter2Id]] : undefined,
      teamScore,
    });
    // milestone checks need the batter's own running total, not the victim's
    if (ball.isWicket && batAfter && ball.dismissedPlayerId !== ball.batsmanId) {
      items.push(...commentaryForBall({ ...{ ball: { ...ball, isWicket: false }, label, names, teamScore }, batsmanRuns: batAfter.runs, batsmanBalls: batAfter.balls, batsmanRunsBefore: batBefore?.runs ?? 0, partnershipRuns: 0, partnershipRunsBefore: 0 }).filter((c) => c.type === 'MILESTONE'));
    }
    if (completesOver || ball.kind === 'OVER_END') {
      const o = after.overs.filter((x) => x.isComplete).at(-1);
      const bl = o ? after.bowling.find((b) => b.playerId === o.bowlerIds.at(-1)) : undefined;
      if (o) {
        const figures = bl ? `${oversText(bl.balls, m.ballsPerOver)}-${bl.maidens}-${bl.runs}-${bl.wickets}` : '';
        items.push({ type: 'OVER_SUMMARY', text: overSummaryText(o, names, this.innings.teamName(m, inn.battingTeamId), figures) });
      }
    }
    await this.commentary.saveForBall(m.id, inn.id, ball.id, label, items);

    const payload = { inningsNumber: inn.number, ballId: ball.id, label, runs: ball.runsOffBat + ball.extraRuns, extraType: ball.extraType, score: `${after.totals.runs}/${after.totals.wickets}` };
    this.live.toMatch(m.id, LiveEvent.BALL_COMPLETED, { ...payload, ball });
    const title = `${m.teamA.name} vs ${m.teamB.name}`;
    const topic = `match_${m.id}`;

    if (ball.isWicket && ball.wicketType !== 'RETIRED_HURT') {
      const victim = names[ball.dismissedPlayerId ?? ball.batsmanId ?? ''] ?? 'Batter';
      this.live.toMatch(m.id, LiveEvent.WICKET, { ...payload, playerId: ball.dismissedPlayerId, wicketType: ball.wicketType, runs: victimLine?.runs, balls: victimLine?.balls });
      await this.notifications.notifyTopic(topic, { type: NotificationType.WICKET, title, body: `WICKET! ${victim} ${victimLine?.runs ?? 0}(${victimLine?.balls ?? 0}). ${teamScore}`, data: { matchId: m.id } });
    } else if (ball.kind === 'DISMISSAL' && ball.wicketType === 'TIMED_OUT') {
      this.live.toMatch(m.id, LiveEvent.WICKET, { ...payload, playerId: ball.dismissedPlayerId, wicketType: ball.wicketType });
    }
    if (ball.runsOffBat === 6) {
      this.live.toMatch(m.id, LiveEvent.SIX, { ...payload, playerId: ball.batsmanId });
      await this.notifications.notifyTopic(topic, { type: NotificationType.SIX, title, body: `SIX! ${names[ball.batsmanId ?? '']} goes big. ${teamScore}`, data: { matchId: m.id } });
    } else if (ball.runsOffBat === 4 && ball.isBoundary) {
      this.live.toMatch(m.id, LiveEvent.BOUNDARY, { ...payload, playerId: ball.batsmanId });
    }
    for (const c of items.filter((i) => i.type === 'MILESTONE')) {
      this.live.toMatch(m.id, LiveEvent.MILESTONE, { ...payload, text: c.text, playerId: ball.batsmanId });
      const hundred = /HUNDRED/.test(c.text);
      await this.notifications.notifyTopic(topic, { type: hundred ? NotificationType.HUNDRED : NotificationType.FIFTY, title, body: c.text, data: { matchId: m.id } });
    }
    if (completesOver || ball.kind === 'OVER_END') {
      const o = after.overs.filter((x) => x.isComplete).at(-1);
      this.live.toMatch(m.id, LiveEvent.OVER_COMPLETED, { inningsNumber: inn.number, over: o });
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ other scoring events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async addPenalty(user: AuthUser, matchId: string, dto: PenaltyDto) {
    return this.innings.asScorer(user, matchId, async () => {
      const { match, inn } = await this.liveContext(matchId);
      const balls = (await this.state.inningsBalls(inn.id)).map(toEngineBall);
      const before = replayInnings(balls, engineConfig(match));
      const ball: EngineBall = {
        id: dto.id ?? randomUUID(),
        sequence: await this.nextSequence(inn.id),
        kind: 'PENALTY',
        batsmanId: inn.strikerId,
        nonStrikerId: inn.nonStrikerId,
        bowlerId: inn.bowlerId,
        runsOffBat: 0,
        extraType: 'PENALTY',
        extraRuns: dto.runs ?? 5,
        isBoundary: false,
        isWicket: false,
        wicketType: null,
        dismissedPlayerId: null,
        fielderId: null,
      };
      await this.audit.log({ userId: user.id, matchId, entityType: 'BALL', entityId: ball.id, action: 'PENALTY', newValue: { runs: ball.extraRuns }, reason: dto.reason });
      return this.persistNewBall(user, match, inn, balls, before, ball);
    });
  }

  /** Retired hurt / timed out - dismissals that are not deliveries. */
  async addDismissal(user: AuthUser, matchId: string, dto: NonDeliveryDismissalDto) {
    return this.innings.asScorer(user, matchId, async () => {
      const { match, inn } = await this.liveContext(matchId);
      if (dto.playerId !== inn.strikerId && dto.playerId !== inn.nonStrikerId) throw new BadRequestException('Player must be at the crease');
      const balls = (await this.state.inningsBalls(inn.id)).map(toEngineBall);
      const before = replayInnings(balls, engineConfig(match));
      const ball: EngineBall = {
        id: dto.id ?? randomUUID(),
        sequence: await this.nextSequence(inn.id),
        kind: 'DISMISSAL',
        batsmanId: inn.strikerId,
        nonStrikerId: inn.nonStrikerId,
        bowlerId: inn.bowlerId,
        runsOffBat: 0,
        extraType: 'NONE',
        extraRuns: 0,
        isBoundary: false,
        isWicket: true,
        wicketType: dto.wicketType,
        dismissedPlayerId: dto.playerId,
        fielderId: null,
      };
      return this.persistNewBall(user, match, inn, balls, before, ball);
    });
  }

  /** Scorer ends a short over (miscount / local rules). */
  async endOver(user: AuthUser, matchId: string) {
    return this.innings.asScorer(user, matchId, async () => {
      const { match, inn } = await this.liveContext(matchId);
      if (inn.ballsInOver === 0) throw new ConflictException('The current over has not started');
      const balls = (await this.state.inningsBalls(inn.id)).map(toEngineBall);
      const before = replayInnings(balls, engineConfig(match));
      const ball: EngineBall = {
        id: randomUUID(),
        sequence: await this.nextSequence(inn.id),
        kind: 'OVER_END',
        batsmanId: inn.strikerId,
        nonStrikerId: inn.nonStrikerId,
        bowlerId: inn.bowlerId,
        runsOffBat: 0,
        extraType: 'NONE',
        extraRuns: 0,
        isBoundary: false,
        isWicket: false,
        wicketType: null,
        dismissedPlayerId: null,
        fielderId: null,
      };
      await this.audit.log({ userId: user.id, matchId, entityType: 'INNINGS', entityId: inn.id, action: 'FORCE_END_OVER', ballLabel: `${inn.completedOvers}.${inn.ballsInOver}` });
      return this.persistNewBall(user, match, inn, balls, before, ball);
    });
  }

  async swapStrike(user: AuthUser, matchId: string) {
    return this.innings.asScorer(user, matchId, async () => {
      const { inn } = await this.liveContext(matchId);
      await this.prisma.innings.update({ where: { id: inn.id }, data: { strikerId: inn.nonStrikerId, nonStrikerId: inn.strikerId } });
      await this.repo.event(matchId, 'STRIKER_CHANGED', user.id, { strikerId: inn.nonStrikerId }, inn.number);
      return this.innings.publish(matchId);
    });
  }

  async setBatsmen(user: AuthUser, matchId: string, dto: SetBatsmenDto) {
    return this.innings.asScorer(user, matchId, async () => {
      const { match, inn } = await this.liveContext(matchId);
      const striker = dto.strikerId ?? inn.strikerId;
      const nonStriker = dto.nonStrikerId ?? inn.nonStrikerId;
      if (!striker || !nonStriker) throw new BadRequestException('Both batters must be set');
      if (striker === nonStriker) throw new BadRequestException('Striker and non-striker must be different');
      const squad = await this.innings.squad(matchId, inn.battingTeamId);
      if (!squad.has(striker) || !squad.has(nonStriker)) throw new BadRequestException('Batters must be in the batting squad');
      const replay = replayInnings((await this.state.inningsBalls(inn.id)).map(toEngineBall), engineConfig(match));
      const out = replay.batting.filter((b) => b.isOut).map((b) => b.playerId);
      if (out.includes(striker) || out.includes(nonStriker)) throw new UnprocessableEntityException('A dismissed batter cannot return');
      await this.prisma.innings.update({ where: { id: inn.id }, data: { strikerId: striker, nonStrikerId: nonStriker } });
      await this.repo.event(matchId, 'BATSMEN_SET', user.id, { strikerId: striker, nonStrikerId: nonStriker }, inn.number);
      return this.innings.publish(matchId);
    });
  }

  async changeBowler(user: AuthUser, matchId: string, dto: ChangeBowlerDto) {
    return this.innings.asScorer(user, matchId, async () => {
      const { inn } = await this.liveContext(matchId);
      const squad = await this.innings.squad(matchId, inn.bowlingTeamId);
      if (!squad.has(dto.bowlerId)) throw new BadRequestException('Bowler must be in the bowling squad');
      if (inn.ballsInOver === 0 && inn.previousBowlerId === dto.bowlerId && !dto.allowConsecutiveOvers && squad.size > 1) {
        throw new UnprocessableEntityException('The same bowler cannot bowl consecutive overs (send allowConsecutiveOvers=true to override)');
      }
      await this.prisma.innings.update({ where: { id: inn.id }, data: { bowlerId: dto.bowlerId } });
      await this.repo.event(matchId, 'BOWLER_CHANGED', user.id, { bowlerId: dto.bowlerId, midOver: inn.ballsInOver > 0 }, inn.number);
      return this.innings.publish(matchId);
    });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ undo / edit / delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Undo the most recent ball of the latest innings (re-opens an innings / match it had ended). */
  async undo(user: AuthUser, matchId: string, reason?: string) {
    return this.innings.asScorer(user, matchId, async () => {
      const match = await this.innings.loadMatch(matchId);
      const inn = await this.innings.latestInnings(matchId);
      if (!inn) throw new ConflictException('Nothing to undo');
      const last = await this.prisma.ball.findFirst({ where: { inningsId: inn.id, deletedAt: null }, orderBy: { sequence: 'desc' } });
      if (!last) throw new ConflictException('No balls to undo in the current innings');
      if (!['LIVE', 'INNINGS_BREAK', 'COMPLETED'].includes(match.status)) throw new ConflictException('Match is not in play');
      await this.removeLastBall(user, match, inn, last, 'BALL_UNDONE', reason);
      return { undone: last.id, snapshot: await this.innings.publish(matchId) };
    });
  }

  private async removeLastBall(user: AuthUser, match: MatchWithTeams, inn: Innings, ball: Ball, event: 'BALL_UNDONE' | 'BALL_DELETED', reason?: string) {
    const wasCompleted = match.status === 'COMPLETED';
    await this.prisma.$transaction(
      async (tx) => {
        if (inn.status === 'COMPLETED') await this.innings.reopen(match, inn, tx);
        await tx.ball.update({ where: { id: ball.id }, data: { deletedAt: new Date() } });
        const remaining = (await this.state.inningsBalls(inn.id, tx)).map(toEngineBall);
        const replay = await this.state.recalculate(match, inn, tx);
        const restored: Pointers =
          ball.kind === 'PENALTY'
            ? this.pointers(inn)
            : { strikerId: ball.batsmanId, nonStrikerId: ball.nonStrikerId, bowlerId: ball.bowlerId, previousBowlerId: this.previousBowler(replay, remaining) };
        await tx.innings.update({ where: { id: inn.id }, data: restored });
        await this.repo.event(match.id, event, user.id, { label: `${ball.overNumber}.${ball.ballInOver}`, reason }, inn.number, ball.id, tx);
      },
      { timeout: 20_000 },
    );
    await this.commentary.removeForBall(ball.id);
    await this.audit.log({
      userId: user.id,
      matchId: match.id,
      entityType: 'BALL',
      entityId: ball.id,
      action: event === 'BALL_UNDONE' ? 'UNDO' : 'DELETE',
      ballLabel: `${ball.overNumber}.${ball.ballInOver}`,
      oldValue: ball,
      reason,
    });
    this.live.toMatch(match.id, LiveEvent.BALL_DELETED, { ballId: ball.id, inningsNumber: inn.number, undo: event === 'BALL_UNDONE' });
    // the match is live again: its statistics / awards / points must be withdrawn until it completes
    if (wasCompleted) this.events.emit(DomainEvent.MATCH_COMPLETED, { matchId: match.id });
  }

  async editBall(user: AuthUser, matchId: string, ballId: string, dto: EditBallDto) {
    return this.innings.asScorer(user, matchId, async () => {
      const match = await this.innings.loadMatch(matchId);
      const ball = await this.prisma.ball.findFirst({ where: { id: ballId, matchId, deletedAt: null }, include: { innings: true } });
      if (!ball) throw new NotFoundException('Ball not found');
      if (ball.kind !== 'DELIVERY') throw new UnprocessableEntityException('Only deliveries can be edited; delete and re-add other events');
      const inn = ball.innings;
      const cfg = engineConfig(match);

      const batsmanId = dto.batsmanId ?? ball.batsmanId!;
      const nonStrikerId = dto.nonStrikerId ?? ball.nonStrikerId!;
      const bowlerId = dto.bowlerId ?? ball.bowlerId!;
      const extraType = dto.extraType ?? (ball.extraType as Exclude<typeof ball.extraType, 'PENALTY'>);
      const runsInput = dto.runs ?? this.inputRuns(ball, cfg);
      const noBallRunsType = dto.noBallRunsType ?? (ball.extraType === 'NO_BALL' && ball.runsOffBat === 0 && ball.extraRuns > cfg.noBallRuns ? 'BYE' : 'BAT');
      const wicketType = dto.wicketType === undefined ? ball.wicketType : dto.wicketType;
      const dismissed = wicketType ? (dto.dismissedPlayerId ?? ball.dismissedPlayerId ?? batsmanId) : null;
      const fielderId = wicketType ? (dto.fielderId ?? ball.fielderId) : null;

      const [battingSquad, bowlingSquad] = await Promise.all([this.innings.squad(matchId, inn.battingTeamId), this.innings.squad(matchId, inn.bowlingTeamId)]);
      if (!battingSquad.has(batsmanId) || !battingSquad.has(nonStrikerId) || batsmanId === nonStrikerId) throw new BadRequestException('Invalid batters');
      if (!bowlingSquad.has(bowlerId)) throw new BadRequestException('Bowler must be in the bowling squad');
      this.validateWicket(extraType, wicketType, dismissed, batsmanId, nonStrikerId);
      if (wicketType === 'CAUGHT' && !fielderId) throw new BadRequestException('fielderId is required for a catch');

      const runs = normalizeRuns({ runs: runsInput, extraType, noBallRunsType, isBoundary: dto.isBoundary ?? (dto.runs === undefined ? ball.isBoundary : undefined) }, cfg);
      const data = { batsmanId, nonStrikerId, bowlerId, extraType, ...runs, isWicket: !!wicketType, wicketType, dismissedPlayerId: dismissed, fielderId };

      const lastBall = await this.prisma.ball.findFirst({ where: { inningsId: inn.id, deletedAt: null }, orderBy: { sequence: 'desc' } });
      const isLast = lastBall?.id === ball.id;

      const replay = await this.prisma.$transaction(
        async (tx) => {
          await tx.ball.update({ where: { id: ball.id }, data });
          const r = await this.state.recalculate(match, inn, tx);
          if (isLast && inn.status === 'IN_PROGRESS') {
            const edited = { ...toEngineBall(ball), ...data } as EngineBall;
            const computed = r.balls.find((b) => b.id === ball.id)!;
            const prevPointers: Pointers = { strikerId: ball.batsmanId, nonStrikerId: ball.nonStrikerId, bowlerId: ball.bowlerId, previousBowlerId: inn.previousBowlerId };
            await tx.innings.update({ where: { id: inn.id }, data: pointersAfter(edited, computed.completesOver, prevPointers, cfg) });
          }
          await this.repo.event(matchId, 'BALL_EDITED', user.id, { reason: dto.reason }, inn.number, ball.id, tx);
          return r;
        },
        { timeout: 20_000 },
      );

      await this.audit.log({
        userId: user.id,
        matchId,
        entityType: 'BALL',
        entityId: ball.id,
        action: 'UPDATE',
        ballLabel: `${ball.overNumber}.${ball.ballInOver}`,
        oldValue: ball,
        newValue: data,
        reason: dto.reason,
      });
      await this.regenerateCommentary(match, inn, ball.id);
      await this.afterHistoricalChange(user, match, inn, replay);
      this.live.toMatch(matchId, LiveEvent.BALL_UPDATED, { ballId: ball.id, inningsNumber: inn.number });
      return { ball: await this.prisma.ball.findUnique({ where: { id: ball.id } }), snapshot: await this.innings.publish(matchId) };
    });
  }

  async deleteBall(user: AuthUser, matchId: string, ballId: string, reason: string) {
    return this.innings.asScorer(user, matchId, async () => {
      const match = await this.innings.loadMatch(matchId);
      const ball = await this.prisma.ball.findFirst({ where: { id: ballId, matchId, deletedAt: null }, include: { innings: true } });
      if (!ball) throw new NotFoundException('Ball not found');
      const inn = ball.innings;
      const latest = await this.innings.latestInnings(matchId);
      const lastBall = await this.prisma.ball.findFirst({ where: { inningsId: inn.id, deletedAt: null }, orderBy: { sequence: 'desc' } });
      if (latest?.id === inn.id && lastBall?.id === ball.id) {
        const { innings: _i, ...plain } = ball;
        await this.removeLastBall(user, match, inn, plain, 'BALL_DELETED', reason);
        return { deleted: ball.id, snapshot: await this.innings.publish(matchId) };
      }
      const replay = await this.prisma.$transaction(
        async (tx) => {
          await tx.ball.update({ where: { id: ball.id }, data: { deletedAt: new Date() } });
          const r = await this.state.recalculate(match, inn, tx);
          await this.repo.event(matchId, 'BALL_DELETED', user.id, { reason }, inn.number, ball.id, tx);
          return r;
        },
        { timeout: 20_000 },
      );
      await this.commentary.removeForBall(ball.id);
      await this.audit.log({ userId: user.id, matchId, entityType: 'BALL', entityId: ball.id, action: 'DELETE', ballLabel: `${ball.overNumber}.${ball.ballInOver}`, oldValue: ball, reason });
      await this.afterHistoricalChange(user, match, inn, replay);
      this.live.toMatch(matchId, LiveEvent.BALL_DELETED, { ballId: ball.id, inningsNumber: inn.number, undo: false });
      return { deleted: ball.id, snapshot: await this.innings.publish(matchId) };
    });
  }

  private async regenerateCommentary(match: MatchWithTeams, inn: Innings, ballId: string) {
    const balls = await this.state.inningsBalls(inn.id);
    const idx = balls.findIndex((b) => b.id === ballId);
    if (idx < 0) return;
    const cfg = engineConfig(match);
    const engine = balls.map(toEngineBall);
    const before = replayInnings(engine.slice(0, idx), cfg);
    const after = replayInnings(engine.slice(0, idx + 1), cfg);
    const names = await this.state.names(match.id);
    const b = engine[idx];
    const batAfter = after.batting.find((l) => l.playerId === (b.isWicket ? (b.dismissedPlayerId ?? b.batsmanId) : b.batsmanId));
    const items = commentaryForBall({
      ball: b,
      label: `${balls[idx].overNumber}.${balls[idx].ballInOver}`,
      names,
      batsmanRuns: batAfter?.runs ?? 0,
      batsmanBalls: batAfter?.balls ?? 0,
      batsmanRunsBefore: before.batting.find((l) => l.playerId === b.batsmanId)?.runs ?? 0,
      partnershipRuns: 0,
      partnershipRunsBefore: 0,
      teamScore: `${this.innings.teamName(match, inn.battingTeamId)} ${after.totals.runs}/${after.totals.wickets}`,
    }).filter((c) => c.type !== 'PARTNERSHIP');
    await this.commentary.saveForBall(match.id, inn.id, ballId, `${balls[idx].overNumber}.${balls[idx].ballInOver}`, items);
  }

  /** After editing history: end the innings if now due, or refresh a completed match's result. */
  private async afterHistoricalChange(user: AuthUser, match: MatchWithTeams, inn: Innings, replay: InningsReplay) {
    const fresh = await this.prisma.innings.findUniqueOrThrow({ where: { id: inn.id } });
    if (fresh.status === 'IN_PROGRESS') {
      const reason = this.innings.endReason(fresh, replay.totals);
      if (reason) await this.innings.finishInnings(match, fresh, reason, user.id);
      return;
    }
    const current = await this.innings.loadMatch(match.id);
    if (current.status === 'COMPLETED' && current.resultType && ['WIN', 'TIE'].includes(current.resultType)) {
      const latest = await this.innings.latestInnings(match.id);
      if (latest && latest.number % 2 === 0) await this.innings.decideResult(current, latest.number, user.id, false);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ offline sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Applies balls recorded offline in `clientSequence` order. Already-synced ids are skipped (idempotent),
   * processing stops at the first rejected ball so later balls are never applied out of order.
   */
  async sync(user: AuthUser, matchId: string, dto: SyncDto) {
    const ordered = [...dto.balls].sort((a, b) => a.clientSequence - b.clientSequence);
    const results: { id: string; clientSequence: number; status: 'CREATED' | 'DUPLICATE' | 'REJECTED' | 'SKIPPED'; label?: string; error?: string }[] = [];
    let failed = false;
    for (const b of ordered) {
      if (failed) {
        results.push({ id: b.id, clientSequence: b.clientSequence, status: 'SKIPPED' });
        continue;
      }
      try {
        const res = await this.innings.asScorer(user, matchId, async () => {
          if (b.inningsNumber) {
            const inn = await this.innings.latestInnings(matchId);
            const exists = await this.prisma.ball.findUnique({ where: { id: b.id } });
            if (!exists && inn?.number !== b.inningsNumber) throw new ConflictException(`Ball belongs to innings ${b.inningsNumber} but innings ${inn?.number ?? '-'} is active`);
          }
          return this.addBallLocked(user, matchId, b);
        });
        results.push({ id: b.id, clientSequence: b.clientSequence, status: res.duplicate ? 'DUPLICATE' : 'CREATED', label: 'label' in res ? res.label : undefined });
      } catch (e: any) {
        failed = true;
        results.push({ id: b.id, clientSequence: b.clientSequence, status: 'REJECTED', error: e?.response?.message ?? e?.message });
      }
    }
    return {
      results,
      created: results.filter((r) => r.status === 'CREATED').length,
      duplicates: results.filter((r) => r.status === 'DUPLICATE').length,
      rejected: results.filter((r) => r.status === 'REJECTED').length,
      snapshot: await this.state.snapshot(matchId),
    };
  }

}
