import { impactPoints, StatLine } from './mvp-calculator';

const base: StatLine = {
  runs: 0, ballsFaced: 0, fours: 0, sixes: 0, isOut: false, batted: false,
  ballsBowled: 0, runsConceded: 0, wickets: 0, maidens: 0, dotsBowled: 0,
  catches: 0, runOuts: 0, stumpings: 0,
};

describe('impactPoints', () => {
  it('rewards a quick fifty', () => {
    const p = impactPoints({ ...base, batted: true, runs: 52, ballsFaced: 26, fours: 6, sixes: 2 }, 8);
    // 52 + 6 + 4 + 10 (fifty) + clamp((200-100)*0.1)=10
    expect(p.batting).toBe(82);
  });

  it('rewards an economical 3-wicket spell', () => {
    const p = impactPoints({ ...base, ballsBowled: 24, runsConceded: 16, wickets: 3, maidens: 1, dotsBowled: 12 }, 8);
    // 75 + 12 + 12 + 10 (3w) + clamp((8-4)*3)=12
    expect(p.bowling).toBe(121);
  });

  it('penalises a duck and counts fielding', () => {
    const p = impactPoints({ ...base, batted: true, isOut: true, catches: 2, runOuts: 1 }, 8);
    expect(p.batting).toBe(-5);
    expect(p.fielding).toBe(26);
    expect(p.total).toBe(21);
  });
});
