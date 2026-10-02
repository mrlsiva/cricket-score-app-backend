import { knockoutFirstRound, knockoutNextRound, roundRobin, schedule, stageForTeams } from './fixture-generator';
import { netRunRate } from '../../../common/utils/cricket.util';

describe('roundRobin', () => {
  it('every team plays every other team exactly once', () => {
    const teams = ['A', 'B', 'C', 'D', 'E'];
    const fixtures = roundRobin(teams);
    expect(fixtures).toHaveLength(10);
    const keys = new Set(fixtures.map((f) => [f.teamAId, f.teamBId].sort().join('-')));
    expect(keys.size).toBe(10);
    // no team plays twice in the same round
    for (const r of new Set(fixtures.map((f) => f.round))) {
      const inRound = fixtures.filter((f) => f.round === r).flatMap((f) => [f.teamAId, f.teamBId]);
      expect(new Set(inRound).size).toBe(inRound.length);
    }
  });

  it('double round robin reverses fixtures', () => {
    expect(roundRobin(['A', 'B', 'C', 'D'], true)).toHaveLength(12);
  });
});

describe('knockout', () => {
  it('gives byes to top seeds when field is not a power of two', () => {
    const { pairings, byes } = knockoutFirstRound(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    expect(byes).toEqual(['S1', 'S2']);
    expect(pairings).toEqual([
      { round: 1, teamAId: 'S3', teamBId: 'S6' },
      { round: 1, teamAId: 'S4', teamBId: 'S5' },
    ]);
    expect(knockoutNextRound(['S1', 'S2', 'S3', 'S4'], 2)).toHaveLength(2);
  });

  it('names stages', () => {
    expect(stageForTeams(2)).toBe('FINAL');
    expect(stageForTeams(4)).toBe('SEMI_FINAL');
    expect(stageForTeams(8)).toBe('QUARTER_FINAL');
    expect(stageForTeams(16)).toBe('KNOCKOUT');
  });
});

describe('schedule', () => {
  it('spreads matches across days', () => {
    const dates = schedule(3, new Date(2026, 0, 1), 2, '09:00', 240);
    expect(dates.map((d) => [d.getDate(), d.getHours()])).toEqual([
      [1, 9],
      [1, 13],
      [2, 9],
    ]);
  });
});

describe('netRunRate', () => {
  it('computes NRR from runs and balls', () => {
    // 180 in 20 overs, conceded 150 in 20 overs => 9 - 7.5 = 1.5
    expect(netRunRate(180, 120, 150, 120)).toBe(1.5);
    expect(netRunRate(0, 0, 10, 6)).toBe(0);
  });
});
