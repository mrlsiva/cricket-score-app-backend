/**
 * Pure cricket scoring engine.
 *
 * The ball log of an innings is the single source of truth. Every derived value (score, over
 * numbering, batting / bowling figures, partnerships, fall of wickets, over summaries) is produced
 * by replaying the log in `sequence` order. This makes undo / edit / delete of any ball trivially
 * consistent and keeps the engine free of I/O so it can be unit tested exhaustively.
 */

export type BallKind = 'DELIVERY' | 'PENALTY' | 'DISMISSAL' | 'OVER_END';
export type ExtraType = 'NONE' | 'WIDE' | 'NO_BALL' | 'BYE' | 'LEG_BYE' | 'PENALTY';
export type WicketType = 'BOWLED' | 'CAUGHT' | 'LBW' | 'RUN_OUT' | 'STUMPED' | 'HIT_WICKET' | 'RETIRED_HURT' | 'TIMED_OUT';

export interface EngineBall {
  id: string;
  sequence: number;
  kind: BallKind;
  batsmanId: string | null;
  nonStrikerId: string | null;
  bowlerId: string | null;
  runsOffBat: number;
  extraType: ExtraType;
  extraRuns: number;
  isBoundary: boolean;
  isWicket: boolean;
  wicketType: WicketType | null;
  dismissedPlayerId: string | null;
  fielderId: string | null;
}

export interface EngineConfig {
  ballsPerOver: number;
  wideRuns: number;
  noBallRuns: number;
}

export const DEFAULT_CONFIG: EngineConfig = { ballsPerOver: 6, wideRuns: 1, noBallRuns: 1 };

/** Wickets credited to the bowler. */
export const BOWLER_WICKETS: WicketType[] = ['BOWLED', 'CAUGHT', 'LBW', 'STUMPED', 'HIT_WICKET'];

/** Allowed dismissal types per delivery extra type. */
export const WICKETS_ALLOWED: Record<ExtraType, WicketType[]> = {
  NONE: ['BOWLED', 'CAUGHT', 'LBW', 'RUN_OUT', 'STUMPED', 'HIT_WICKET'],
  WIDE: ['STUMPED', 'RUN_OUT', 'HIT_WICKET'],
  NO_BALL: ['RUN_OUT'],
  BYE: ['RUN_OUT'],
  LEG_BYE: ['RUN_OUT'],
  PENALTY: [],
};

export interface ComputedBall {
  id: string;
  overNumber: number;
  ballInOver: number;
  label: string;
  isLegal: boolean;
  totalRuns: number;
  isFour: boolean;
  isSix: boolean;
  scoreAfter: number;
  wicketsAfter: number;
  /** True when this ball completed an over. */
  completesOver: boolean;
}

export interface BatLine {
  playerId: string;
  position: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  dots: number;
  isOut: boolean;
  retiredHurt: boolean;
  wicketType: WicketType | null;
  bowlerId: string | null;
  fielderId: string | null;
}

export interface BowlLine {
  playerId: string;
  balls: number;
  runs: number;
  wickets: number;
  maidens: number;
  wides: number;
  noBalls: number;
  dots: number;
  order: number;
}

export interface FieldLine {
  playerId: string;
  catches: number;
  runOuts: number;
  stumpings: number;
}

export interface PartnershipLine {
  wicketNumber: number;
  batter1Id: string;
  batter2Id: string;
  runs: number;
  balls: number;
  batter1Runs: number;
  batter1Balls: number;
  batter2Runs: number;
  batter2Balls: number;
  isUnbroken: boolean;
}

export interface FallOfWicket {
  wicketNumber: number;
  playerId: string;
  score: number;
  overLabel: string;
}

export interface OverSummary {
  overNumber: number;
  bowlerIds: string[];
  runs: number;
  wickets: number;
  legalBalls: number;
  isComplete: boolean;
  isMaiden: boolean;
  cumulativeRuns: number;
  cumulativeWickets: number;
  balls: string[];
}

export interface InningsTotals {
  runs: number;
  wickets: number;
  legalBalls: number;
  completedOvers: number;
  ballsInOver: number;
  wides: number;
  noBalls: number;
  byes: number;
  legByes: number;
  penaltyRuns: number;
  extras: number;
  fours: number;
  sixes: number;
}

export interface InningsReplay {
  totals: InningsTotals;
  balls: ComputedBall[];
  batting: BatLine[];
  bowling: BowlLine[];
  fielding: FieldLine[];
  partnerships: PartnershipLine[];
  fallOfWickets: FallOfWicket[];
  overs: OverSummary[];
}

export const isLegalDelivery = (b: Pick<EngineBall, 'kind' | 'extraType'>) =>
  b.kind === 'DELIVERY' && (b.extraType === 'NONE' || b.extraType === 'BYE' || b.extraType === 'LEG_BYE');

/** Runs conceded by the bowler on a delivery (byes / leg byes are not charged). */
export const bowlerRuns = (b: EngineBall) =>
  b.runsOffBat + (b.extraType === 'WIDE' || b.extraType === 'NO_BALL' ? b.extraRuns : 0);

/** Short symbol used in over summaries: 0 1 4 6 W wd nb lb b. */
export function ballSymbol(b: EngineBall): string {
  if (b.kind === 'PENALTY') return `${b.extraRuns}P`;
  if (b.kind === 'OVER_END') return '|';
  if (b.kind === 'DISMISSAL') return b.wicketType === 'RETIRED_HURT' ? 'RH' : 'W';
  const w = b.isWicket && b.wicketType !== 'RETIRED_HURT' ? 'W' : '';
  switch (b.extraType) {
    case 'WIDE':
      return `${b.extraRuns > 1 ? b.extraRuns : ''}wd${w}`;
    case 'NO_BALL':
      return `${b.runsOffBat > 0 ? b.runsOffBat : ''}nb${w}`;
    case 'BYE':
      return `${b.extraRuns}b${w}`;
    case 'LEG_BYE':
      return `${b.extraRuns}lb${w}`;
    default:
      return w ? (b.runsOffBat ? `${b.runsOffBat}W` : 'W') : String(b.runsOffBat);
  }
}

export function replayInnings(input: EngineBall[], cfg: EngineConfig = DEFAULT_CONFIG): InningsReplay {
  const balls = [...input].sort((a, b) => a.sequence - b.sequence);
  const t: InningsTotals = {
    runs: 0, wickets: 0, legalBalls: 0, completedOvers: 0, ballsInOver: 0,
    wides: 0, noBalls: 0, byes: 0, legByes: 0, penaltyRuns: 0, extras: 0, fours: 0, sixes: 0,
  };
  const computed: ComputedBall[] = [];
  const batting = new Map<string, BatLine>();
  const bowling = new Map<string, BowlLine>();
  const fielding = new Map<string, FieldLine>();
  const partnerships: PartnershipLine[] = [];
  const fow: FallOfWicket[] = [];
  const overs: OverSummary[] = [];

  const ps: { current: PartnershipLine | null } = { current: null };
  let over = newOver(0);
  // bowler -> runs conceded in current over (maiden detection)
  let overBowlerRuns = new Map<string, number>();

  function newOver(n: number): OverSummary {
    return { overNumber: n, bowlerIds: [], runs: 0, wickets: 0, legalBalls: 0, isComplete: false, isMaiden: false, cumulativeRuns: 0, cumulativeWickets: 0, balls: [] };
  }
  function bat(id: string): BatLine {
    let l = batting.get(id);
    if (!l) {
      l = { playerId: id, position: batting.size + 1, runs: 0, balls: 0, fours: 0, sixes: 0, dots: 0, isOut: false, retiredHurt: false, wicketType: null, bowlerId: null, fielderId: null };
      batting.set(id, l);
    }
    return l;
  }
  function bowl(id: string): BowlLine {
    let l = bowling.get(id);
    if (!l) {
      l = { playerId: id, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0, dots: 0, order: bowling.size + 1 };
      bowling.set(id, l);
    }
    return l;
  }
  function field(id: string): FieldLine {
    let l = fielding.get(id);
    if (!l) {
      l = { playerId: id, catches: 0, runOuts: 0, stumpings: 0 };
      fielding.set(id, l);
    }
    return l;
  }
  function closeOver(complete: boolean) {
    over.isComplete = complete;
    over.cumulativeRuns = t.runs;
    over.cumulativeWickets = t.wickets;
    // A maiden: a full over by a single bowler conceding nothing.
    if (complete && over.legalBalls === cfg.ballsPerOver && over.bowlerIds.length === 1) {
      const conceded = overBowlerRuns.get(over.bowlerIds[0]) ?? 0;
      if (conceded === 0) {
        over.isMaiden = true;
        bowl(over.bowlerIds[0]).maidens++;
      }
    }
    overs.push(over);
    t.completedOvers++;
    t.ballsInOver = 0;
    over = newOver(t.completedOvers);
    overBowlerRuns = new Map();
  }
  function ensurePartnership(a: string | null, b: string | null) {
    if (!a || !b) return;
    const cur = ps.current;
    const same = cur && ((cur.batter1Id === a && cur.batter2Id === b) || (cur.batter1Id === b && cur.batter2Id === a));
    if (same) return;
    if (cur) cur.isUnbroken = false;
    const next: PartnershipLine = { wicketNumber: t.wickets + 1, batter1Id: a, batter2Id: b, runs: 0, balls: 0, batter1Runs: 0, batter1Balls: 0, batter2Runs: 0, batter2Balls: 0, isUnbroken: true };
    ps.current = next;
    partnerships.push(next);
  }
  function recordDismissal(b: EngineBall) {
    const victim = b.dismissedPlayerId ?? b.batsmanId;
    if (!victim || !b.wicketType) return;
    const line = bat(victim);
    if (b.wicketType === 'RETIRED_HURT') {
      line.retiredHurt = true;
      line.wicketType = 'RETIRED_HURT';
    } else {
      line.isOut = true;
      line.retiredHurt = false;
      line.wicketType = b.wicketType;
      line.bowlerId = BOWLER_WICKETS.includes(b.wicketType) ? b.bowlerId : null;
      line.fielderId = b.fielderId;
      t.wickets++;
      over.wickets++;
      fow.push({ wicketNumber: t.wickets, playerId: victim, score: t.runs, overLabel: `${t.completedOvers}.${t.ballsInOver}` });
      if (b.bowlerId && BOWLER_WICKETS.includes(b.wicketType)) bowl(b.bowlerId).wickets++;
      if (b.fielderId) {
        if (b.wicketType === 'CAUGHT') field(b.fielderId).catches++;
        if (b.wicketType === 'RUN_OUT') field(b.fielderId).runOuts++;
        if (b.wicketType === 'STUMPED') field(b.fielderId).stumpings++;
      }
    }
    if (ps.current) ps.current.isUnbroken = false;
    ps.current = null;
  }

  for (const b of balls) {
    if (b.kind === 'OVER_END') {
      if (t.ballsInOver > 0) closeOver(true);
      computed.push(result(b, false, 0, false, false, false));
      continue;
    }
    if (b.kind === 'PENALTY') {
      t.runs += b.extraRuns;
      t.penaltyRuns += b.extraRuns;
      t.extras += b.extraRuns;
      over.runs += b.extraRuns;
      over.balls.push(ballSymbol(b));
      computed.push(result(b, false, b.extraRuns, false, false, false));
      continue;
    }
    if (b.kind === 'DISMISSAL') {
      if (b.batsmanId) bat(b.batsmanId);
      if (b.nonStrikerId) bat(b.nonStrikerId);
      ensurePartnership(b.batsmanId, b.nonStrikerId);
      recordDismissal(b);
      over.balls.push(ballSymbol(b));
      computed.push(result(b, false, 0, false, false, false));
      continue;
    }

    // â”€â”€ DELIVERY â”€â”€
    const legal = isLegalDelivery(b);
    const total = b.runsOffBat + b.extraRuns;
    const isSix = b.runsOffBat === 6 && (b.extraType === 'NONE' || b.extraType === 'NO_BALL');
    const isFour = b.isBoundary && b.runsOffBat === 4 && (b.extraType === 'NONE' || b.extraType === 'NO_BALL');

    if (b.batsmanId) bat(b.batsmanId);
    if (b.nonStrikerId) bat(b.nonStrikerId);
    ensurePartnership(b.batsmanId, b.nonStrikerId);

    t.runs += total;
    over.runs += total;
    switch (b.extraType) {
      case 'WIDE': t.wides += b.extraRuns; break;
      case 'NO_BALL': t.noBalls += b.extraRuns; break;
      case 'BYE': t.byes += b.extraRuns; break;
      case 'LEG_BYE': t.legByes += b.extraRuns; break;
    }
    t.extras += b.extraRuns;
    if (isFour) t.fours++;
    if (isSix) t.sixes++;

    if (b.batsmanId) {
      const line = bat(b.batsmanId);
      line.runs += b.runsOffBat;
      if (b.extraType !== 'WIDE') {
        line.balls++;
        if (b.runsOffBat === 0) line.dots++;
      }
      if (isFour) line.fours++;
      if (isSix) line.sixes++;
    }
    if (b.bowlerId) {
      const bl = bowl(b.bowlerId);
      const conceded = bowlerRuns(b);
      bl.runs += conceded;
      if (legal) bl.balls++;
      if (b.extraType === 'WIDE') bl.wides++;
      if (b.extraType === 'NO_BALL') bl.noBalls++;
      if (legal && conceded === 0) bl.dots++;
      if (!over.bowlerIds.includes(b.bowlerId)) over.bowlerIds.push(b.bowlerId);
      overBowlerRuns.set(b.bowlerId, (overBowlerRuns.get(b.bowlerId) ?? 0) + conceded);
    }
    if (ps.current) {
      const cp = ps.current;
      cp.runs += total;
      if (legal) cp.balls++;
      if (b.batsmanId === cp.batter1Id) {
        cp.batter1Runs += b.runsOffBat;
        if (b.extraType !== 'WIDE') cp.batter1Balls++;
      } else if (b.batsmanId === cp.batter2Id) {
        cp.batter2Runs += b.runsOffBat;
        if (b.extraType !== 'WIDE') cp.batter2Balls++;
      }
    }

    const overNumber = t.completedOvers;
    if (legal) {
      t.legalBalls++;
      t.ballsInOver++;
      over.legalBalls++;
    }
    // extras are shown against the ball being bowled (e.g. 0.1 wd, then 0.1)
    const ballInOver = legal ? t.ballsInOver : t.ballsInOver + 1;
    if (b.isWicket) recordDismissal(b);
    over.balls.push(ballSymbol(b));

    const completesOver = legal && t.ballsInOver === cfg.ballsPerOver;
    computed.push({
      id: b.id,
      overNumber,
      ballInOver,
      label: `${overNumber}.${ballInOver}`,
      isLegal: legal,
      totalRuns: total,
      isFour,
      isSix,
      scoreAfter: t.runs,
      wicketsAfter: t.wickets,
      completesOver,
    });
    if (completesOver) closeOver(true);
  }

  // trailing partial over
  if (over.balls.length) {
    over.cumulativeRuns = t.runs;
    over.cumulativeWickets = t.wickets;
    overs.push(over);
  }

  return {
    totals: t,
    balls: computed,
    batting: [...batting.values()].sort((a, b) => a.position - b.position),
    bowling: [...bowling.values()].sort((a, b) => a.order - b.order),
    fielding: [...fielding.values()],
    partnerships,
    fallOfWickets: fow,
    overs,
  };

  function result(b: EngineBall, isLegal: boolean, total: number, isFour: boolean, isSix: boolean, completesOver: boolean): ComputedBall {
    return {
      id: b.id,
      overNumber: t.completedOvers,
      ballInOver: t.ballsInOver,
      label: `${t.completedOvers}.${t.ballsInOver}`,
      isLegal,
      totalRuns: total,
      isFour,
      isSix,
      scoreAfter: t.runs,
      wicketsAfter: t.wickets,
      completesOver,
    };
  }
}

export interface Pointers {
  strikerId: string | null;
  nonStrikerId: string | null;
  bowlerId: string | null;
  previousBowlerId: string | null;
}

/** Runs physically run by the batters (determines strike rotation). */
export function runsRan(b: EngineBall, cfg: EngineConfig = DEFAULT_CONFIG): number {
  if (b.isBoundary) return 0;
  switch (b.extraType) {
    case 'NONE':
    case 'NO_BALL':
      return b.runsOffBat + (b.extraType === 'NO_BALL' ? Math.max(0, b.extraRuns - cfg.noBallRuns) : 0);
    case 'WIDE':
      return Math.max(0, b.extraRuns - cfg.wideRuns);
    case 'BYE':
    case 'LEG_BYE':
      return b.extraRuns;
    default:
      return 0;
  }
}

/**
 * Crease state after a ball: rotates strike on odd runs, vacates the dismissed batter's end,
 * and at the end of an over swaps ends and clears the bowler.
 */
export function pointersAfter(b: EngineBall, completesOver: boolean, prev: Pointers, cfg: EngineConfig = DEFAULT_CONFIG): Pointers {
  let striker = b.batsmanId ?? prev.strikerId;
  let nonStriker = b.nonStrikerId ?? prev.nonStrikerId;
  let bowler = b.bowlerId ?? prev.bowlerId;
  let previousBowler = prev.previousBowlerId;

  if (b.kind === 'PENALTY') return { ...prev };

  if (b.kind === 'DELIVERY' && runsRan(b, cfg) % 2 === 1) [striker, nonStriker] = [nonStriker, striker];

  if ((b.kind === 'DELIVERY' && b.isWicket) || b.kind === 'DISMISSAL') {
    const victim = b.dismissedPlayerId ?? b.batsmanId;
    if (victim && striker === victim) striker = null;
    else if (victim && nonStriker === victim) nonStriker = null;
  }

  if (completesOver || b.kind === 'OVER_END') {
    [striker, nonStriker] = [nonStriker, striker];
    previousBowler = bowler;
    bowler = null;
  }
  return { strikerId: striker, nonStrikerId: nonStriker, bowlerId: bowler, previousBowlerId: previousBowler };
}

export interface BallInput {
  runs: number;
  extraType: ExtraType;
  /** On a no-ball, whether the runs came off the bat (default) or were byes / leg byes. */
  noBallRunsType?: 'BAT' | 'BYE' | 'LEG_BYE';
  isBoundary?: boolean;
}

/** Converts scorer input (runs + extra type) into stored ball fields. */
export function normalizeRuns(input: BallInput, cfg: EngineConfig = DEFAULT_CONFIG) {
  const runs = input.runs;
  const boundaryDefault = runs === 4 || runs === 6;
  switch (input.extraType) {
    case 'WIDE':
      return { runsOffBat: 0, extraRuns: cfg.wideRuns + runs, isBoundary: input.isBoundary ?? runs === 4 };
    case 'NO_BALL':
      if (input.noBallRunsType && input.noBallRunsType !== 'BAT')
        return { runsOffBat: 0, extraRuns: cfg.noBallRuns + runs, isBoundary: input.isBoundary ?? runs === 4 };
      return { runsOffBat: runs, extraRuns: cfg.noBallRuns, isBoundary: input.isBoundary ?? boundaryDefault };
    case 'BYE':
    case 'LEG_BYE':
      return { runsOffBat: 0, extraRuns: runs, isBoundary: input.isBoundary ?? runs === 4 };
    default:
      return { runsOffBat: runs, extraRuns: 0, isBoundary: input.isBoundary ?? boundaryDefault };
  }
}
