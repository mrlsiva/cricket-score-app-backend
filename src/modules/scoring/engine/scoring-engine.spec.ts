import { EngineBall, normalizeRuns, pointersAfter, replayInnings } from './scoring-engine';

let seq = 0;
const ball = (over: Partial<EngineBall> = {}): EngineBall => ({
  id: `b${++seq}`,
  sequence: seq,
  kind: 'DELIVERY',
  batsmanId: 'A',
  nonStrikerId: 'B',
  bowlerId: 'X',
  runsOffBat: 0,
  extraType: 'NONE',
  extraRuns: 0,
  isBoundary: false,
  isWicket: false,
  wicketType: null,
  dismissedPlayerId: null,
  fielderId: null,
  ...over,
});

beforeEach(() => (seq = 0));

describe('replayInnings', () => {
  it('counts a maiden over and over numbering', () => {
    const r = replayInnings(Array.from({ length: 6 }, () => ball()));
    expect(r.totals).toMatchObject({ runs: 0, legalBalls: 6, completedOvers: 1, ballsInOver: 0 });
    expect(r.bowling[0]).toMatchObject({ playerId: 'X', balls: 6, maidens: 1, dots: 6 });
    expect(r.balls.map((b) => b.label)).toEqual(['0.1', '0.2', '0.3', '0.4', '0.5', '0.6']);
    expect(r.overs[0].isMaiden).toBe(true);
  });

  it('handles wides / no-balls as illegal deliveries charged to bowler', () => {
    const r = replayInnings([
      ball({ extraType: 'WIDE', extraRuns: 1 }),
      ball({ extraType: 'NO_BALL', extraRuns: 1, runsOffBat: 4, isBoundary: true }),
      ball({ extraType: 'LEG_BYE', extraRuns: 2 }),
      ball({ runsOffBat: 6, isBoundary: true }),
    ]);
    expect(r.totals).toMatchObject({ runs: 14, legalBalls: 2, wides: 1, noBalls: 1, legByes: 2, extras: 4, fours: 1, sixes: 1 });
    const a = r.batting.find((b) => b.playerId === 'A')!;
    expect(a).toMatchObject({ runs: 10, balls: 3, fours: 1, sixes: 1 }); // wide not faced, no-ball faced
    expect(r.bowling[0]).toMatchObject({ runs: 12, balls: 2, wides: 1, noBalls: 1 }); // leg byes not charged
    expect(r.balls[0].label).toBe('0.1');
    expect(r.balls[1].label).toBe('0.1');
    expect(r.balls[2].label).toBe('0.1');
    expect(r.balls[3].label).toBe('0.2');
  });

  it('records wickets, fall of wickets, fielding and partnerships', () => {
    const r = replayInnings([
      ball({ runsOffBat: 1 }),
      ball({ batsmanId: 'B', nonStrikerId: 'A', runsOffBat: 2 }),
      ball({ batsmanId: 'B', nonStrikerId: 'A', isWicket: true, wicketType: 'CAUGHT', dismissedPlayerId: 'B', fielderId: 'F' }),
      ball({ batsmanId: 'C', nonStrikerId: 'A', runsOffBat: 4, isBoundary: true }),
      ball({ batsmanId: 'C', nonStrikerId: 'A', isWicket: true, wicketType: 'RUN_OUT', dismissedPlayerId: 'A', fielderId: 'G' }),
    ]);
    expect(r.totals.wickets).toBe(2);
    expect(r.fallOfWickets).toEqual([
      { wicketNumber: 1, playerId: 'B', score: 3, overLabel: '0.3' },
      { wicketNumber: 2, playerId: 'A', score: 7, overLabel: '0.5' },
    ]);
    expect(r.bowling[0].wickets).toBe(1); // run-out not credited to bowler
    expect(r.fielding.find((f) => f.playerId === 'F')!.catches).toBe(1);
    expect(r.fielding.find((f) => f.playerId === 'G')!.runOuts).toBe(1);
    expect(r.partnerships).toHaveLength(2);
    expect(r.partnerships[0]).toMatchObject({ wicketNumber: 1, runs: 3, balls: 3, isUnbroken: false });
    expect(r.partnerships[1]).toMatchObject({ wicketNumber: 2, runs: 4, isUnbroken: false });
    expect(r.batting.map((b) => b.playerId)).toEqual(['A', 'B', 'C']);
  });

  it('retired hurt does not count as a wicket', () => {
    const r = replayInnings([ball({ kind: 'DISMISSAL', wicketType: 'RETIRED_HURT', dismissedPlayerId: 'A', bowlerId: null })]);
    expect(r.totals.wickets).toBe(0);
    expect(r.batting[0]).toMatchObject({ playerId: 'A', isOut: false, retiredHurt: true });
  });

  it('forced over end closes a short over', () => {
    const r = replayInnings([ball(), ball(), ball({ kind: 'OVER_END' }), ball({ bowlerId: 'Y' })]);
    expect(r.totals).toMatchObject({ completedOvers: 1, ballsInOver: 1, legalBalls: 3 });
    expect(r.balls[3].label).toBe('1.1');
    expect(r.overs[0].isMaiden).toBe(false);
  });

  it('penalty runs add to total only', () => {
    const r = replayInnings([ball({ kind: 'PENALTY', extraType: 'PENALTY', extraRuns: 5, batsmanId: null, bowlerId: null })]);
    expect(r.totals).toMatchObject({ runs: 5, penaltyRuns: 5, legalBalls: 0 });
    expect(r.bowling).toHaveLength(0);
  });
});

describe('pointersAfter', () => {
  const prev = { strikerId: 'A', nonStrikerId: 'B', bowlerId: 'X', previousBowlerId: null };

  it('rotates strike on odd runs', () => {
    expect(pointersAfter(ball({ runsOffBat: 1 }), false, prev)).toMatchObject({ strikerId: 'B', nonStrikerId: 'A' });
    expect(pointersAfter(ball({ runsOffBat: 2 }), false, prev)).toMatchObject({ strikerId: 'A', nonStrikerId: 'B' });
  });

  it('rotates on wide + ran runs and at over end clears bowler', () => {
    expect(pointersAfter(ball({ extraType: 'WIDE', extraRuns: 2 }), false, prev)).toMatchObject({ strikerId: 'B' });
    expect(pointersAfter(ball({ runsOffBat: 1 }), true, prev)).toMatchObject({ strikerId: 'A', nonStrikerId: 'B', bowlerId: null, previousBowlerId: 'X' });
  });

  it('vacates the dismissed batter end', () => {
    expect(pointersAfter(ball({ isWicket: true, wicketType: 'BOWLED', dismissedPlayerId: 'A' }), false, prev)).toMatchObject({ strikerId: null, nonStrikerId: 'B' });
    // run out of the non-striker going for the first run
    expect(pointersAfter(ball({ runsOffBat: 1, isWicket: true, wicketType: 'RUN_OUT', dismissedPlayerId: 'B' }), false, prev)).toMatchObject({
      strikerId: null,
      nonStrikerId: 'A',
    });
  });
});

describe('normalizeRuns', () => {
  it('maps scorer input to stored fields', () => {
    expect(normalizeRuns({ runs: 4, extraType: 'NONE' })).toEqual({ runsOffBat: 4, extraRuns: 0, isBoundary: true });
    expect(normalizeRuns({ runs: 1, extraType: 'WIDE' })).toEqual({ runsOffBat: 0, extraRuns: 2, isBoundary: false });
    expect(normalizeRuns({ runs: 6, extraType: 'NO_BALL' })).toEqual({ runsOffBat: 6, extraRuns: 1, isBoundary: true });
    expect(normalizeRuns({ runs: 2, extraType: 'NO_BALL', noBallRunsType: 'LEG_BYE' })).toEqual({ runsOffBat: 0, extraRuns: 3, isBoundary: false });
    expect(normalizeRuns({ runs: 3, extraType: 'BYE' })).toEqual({ runsOffBat: 0, extraRuns: 3, isBoundary: false });
  });
});
