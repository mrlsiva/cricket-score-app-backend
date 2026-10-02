import { randomBytes } from 'crypto';

/** Cricket arithmetic helpers (pure functions). */

export const oversText = (legalBalls: number, ballsPerOver = 6) =>
  `${Math.floor(legalBalls / ballsPerOver)}.${legalBalls % ballsPerOver}`;

export const oversDecimal = (legalBalls: number, ballsPerOver = 6) => legalBalls / ballsPerOver;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const strikeRate = (runs: number, balls: number) => (balls > 0 ? round2((runs / balls) * 100) : 0);

export const economy = (runs: number, balls: number, ballsPerOver = 6) =>
  balls > 0 ? round2(runs / (balls / ballsPerOver)) : 0;

export const runRate = (runs: number, balls: number, ballsPerOver = 6) =>
  balls > 0 ? round2(runs / (balls / ballsPerOver)) : 0;

export const average = (runs: number, dismissals: number) => (dismissals > 0 ? round2(runs / dismissals) : 0);

/**
 * Net Run Rate = (runs scored / overs faced) - (runs conceded / overs bowled).
 * A side bowled out is deemed to have faced its full quota of overs.
 */
export function netRunRate(runsScored: number, ballsFaced: number, runsConceded: number, ballsBowled: number, ballsPerOver = 6) {
  if (ballsFaced === 0 || ballsBowled === 0) return 0;
  const nrr = runsScored / (ballsFaced / ballsPerOver) - runsConceded / (ballsBowled / ballsPerOver);
  return Math.round(nrr * 1000) / 1000;
}

export const randomCode = (length = 8) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};
