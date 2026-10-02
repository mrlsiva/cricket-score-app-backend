/** Pure fixture generation helpers (unit tested). */

export interface Pairing {
  round: number;
  teamAId: string;
  teamBId: string;
}

/**
 * Round robin via the circle method. With an odd number of teams one team rests each round.
 * `double` adds the reverse fixtures (home/away).
 */
export function roundRobin(teamIds: string[], double = false): Pairing[] {
  if (teamIds.length < 2) return [];
  const teams: (string | null)[] = [...teamIds];
  if (teams.length % 2) teams.push(null);
  const n = teams.length;
  const rounds = n - 1;
  const out: Pairing[] = [];
  let arr = [...teams];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a && b) out.push(r % 2 === 0 ? { round: r + 1, teamAId: a, teamBId: b } : { round: r + 1, teamAId: b, teamBId: a });
    }
    // keep first fixed, rotate the rest clockwise
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  if (double) {
    const second = out.map((p) => ({ round: p.round + rounds, teamAId: p.teamBId, teamBId: p.teamAId }));
    return [...out, ...second];
  }
  return out;
}

export const nextPowerOfTwo = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/**
 * First knockout round for seeded teams (index 0 = top seed). Top seeds receive byes when the
 * field is not a power of two; the remaining teams play high-vs-low seed.
 */
export function knockoutFirstRound(seededTeamIds: string[]): { pairings: Pairing[]; byes: string[] } {
  const size = nextPowerOfTwo(seededTeamIds.length);
  const byeCount = size - seededTeamIds.length;
  const byes = seededTeamIds.slice(0, byeCount);
  const playing = seededTeamIds.slice(byeCount);
  const pairings: Pairing[] = [];
  for (let i = 0; i < playing.length / 2; i++) {
    pairings.push({ round: 1, teamAId: playing[i], teamBId: playing[playing.length - 1 - i] });
  }
  return { pairings, byes };
}

/** Pairs adjacent qualifiers (bye teams first, then winners in match order). */
export function knockoutNextRound(qualified: string[], round: number): Pairing[] {
  const out: Pairing[] = [];
  for (let i = 0; i + 1 < qualified.length; i += 2) out.push({ round, teamAId: qualified[i], teamBId: qualified[i + 1] });
  return out;
}

export function stageForTeams(teamsInRound: number): 'FINAL' | 'SEMI_FINAL' | 'QUARTER_FINAL' | 'KNOCKOUT' {
  if (teamsInRound <= 2) return 'FINAL';
  if (teamsInRound <= 4) return 'SEMI_FINAL';
  if (teamsInRound <= 8) return 'QUARTER_FINAL';
  return 'KNOCKOUT';
}

/** Spreads fixtures over days: `perDay` matches per day starting at `startTime`, `gapMinutes` apart. */
export function schedule(count: number, startDate: Date, perDay: number, startTime: string, gapMinutes: number): Date[] {
  const [h, m] = startTime.split(':').map(Number);
  const out: Date[] = [];
  for (let i = 0; i < count; i++) {
    const day = Math.floor(i / perDay);
    const slot = i % perDay;
    const d = new Date(startDate);
    d.setDate(d.getDate() + day);
    d.setHours(h, m + slot * gapMinutes, 0, 0);
    out.push(d);
  }
  return out;
}
