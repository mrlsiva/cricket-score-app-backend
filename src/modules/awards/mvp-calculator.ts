/**
 * Weighted impact-points model used for Man of the Match and tournament awards.
 * Weights are intentionally simple and documented so organizers can reason about results.
 */
export const MVP_WEIGHTS = {
  run: 1,
  four: 1,
  six: 2,
  fifty: 10,
  hundred: 25,
  thirty: 4,
  duck: -5,
  /** strike-rate bonus per SR point above 100 (min 10 balls), clamped */
  srFactor: 0.1,
  srMin: -10,
  srMax: 15,
  wicket: 25,
  threeWickets: 10,
  fiveWickets: 25,
  maiden: 12,
  dot: 1,
  /** economy bonus per run below the match run-rate (min 2 overs), clamped */
  ecoFactor: 3,
  ecoMin: -15,
  ecoMax: 15,
  catch: 8,
  runOut: 10,
  stumping: 10,
} as const;

export interface StatLine {
  runs: number;
  ballsFaced: number;
  fours: number;
  sixes: number;
  isOut: boolean;
  batted: boolean;
  ballsBowled: number;
  runsConceded: number;
  wickets: number;
  maidens: number;
  dotsBowled: number;
  catches: number;
  runOuts: number;
  stumpings: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (n: number) => Math.round(n * 100) / 100;

export function impactPoints(s: StatLine, matchRunRate: number, ballsPerOver = 6) {
  const w = MVP_WEIGHTS;
  let batting = s.runs * w.run + s.fours * w.four + s.sixes * w.six;
  if (s.runs >= 100) batting += w.hundred;
  else if (s.runs >= 50) batting += w.fifty;
  else if (s.runs >= 30) batting += w.thirty;
  if (s.batted && s.isOut && s.runs === 0) batting += w.duck;
  if (s.ballsFaced >= 10) batting += clamp(((s.runs / s.ballsFaced) * 100 - 100) * w.srFactor, w.srMin, w.srMax);

  let bowling = s.wickets * w.wicket + s.maidens * w.maiden + s.dotsBowled * w.dot;
  if (s.wickets >= 5) bowling += w.fiveWickets;
  else if (s.wickets >= 3) bowling += w.threeWickets;
  if (s.ballsBowled >= ballsPerOver * 2) {
    const eco = s.runsConceded / (s.ballsBowled / ballsPerOver);
    bowling += clamp((matchRunRate - eco) * w.ecoFactor, w.ecoMin, w.ecoMax);
  }

  const fielding = s.catches * w.catch + s.runOuts * w.runOut + s.stumpings * w.stumping;
  return { batting: r2(batting), bowling: r2(bowling), fielding: r2(fielding), total: r2(batting + bowling + fielding) };
}
