// End-to-end smoke test against a running API: npm run test:smoke (requires AUTH_DEV_LOGIN=true)
import { randomUUID } from 'crypto';
import { io } from 'socket.io-client';

const HOST = process.env.API_HOST ?? 'http://localhost:3000';
const BASE = `${HOST}/api/v1`;
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

async function call(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, headers: res.headers };
}

const stamp = Date.now();
// â”€â”€ auth â”€â”€
const org = await call('POST', '/auth/dev-login', null, { email: `org${stamp}@test.local`, name: 'Org Tester' });
ok(org.status === 200 && org.data.data.requiresOnboarding, 'dev-login organizer (requires onboarding)');
const T = org.data.data.accessToken;
const onb = await call('POST', '/auth/onboarding', T, { accountTypes: ['ORGANIZER', 'INDIVIDUAL'], city: 'Chennai' });
ok(onb.status === 200 && onb.data.data.roles.includes('ORGANIZER') && onb.data.data.player, 'onboarding assigns roles + player profile');

const viewer = await call('POST', '/auth/dev-login', null, { email: `viewer${stamp}@test.local`, name: 'Viewer Tester' });
const V = viewer.data.data.accessToken;
await call('POST', '/auth/onboarding', V, { accountTypes: ['INDIVIDUAL'] });
const viewerId = viewer.data.data.user.id;

const refreshed = await call('POST', '/auth/refresh', null, { refreshToken: org.data.data.refreshToken });
ok(refreshed.status === 200 && refreshed.data.data.accessToken, 'refresh token rotation');
const reuse = await call('POST', '/auth/refresh', null, { refreshToken: org.data.data.refreshToken });
ok(reuse.status === 401, 'refresh token reuse rejected');

const val = await call('POST', '/matches/quick', T, { teamAName: 'X', overs: 0 });
ok(val.status === 400 && Array.isArray(val.data.details), 'validation errors -> 400 with details');

// â”€â”€ quick match: 2 overs, 3 a side â”€â”€
const qm = await call('POST', '/matches/quick', T, { teamAName: 'Lions', teamBName: 'Tigers', playersPerTeam: 3, overs: 2, tossWinner: 'A', tossDecision: 'BAT' });
ok(qm.status === 201, `quick match created (${qm.status})`);
const m = qm.data.data;
const A = m.squads.teamA.map((p) => p.player);
const B = m.squads.teamB.map((p) => p.player);
ok(A.map((p) => p.name).join() === 'T1,T2,T3' && B.map((p) => p.name).join() === 'P1,P2,P3', 'placeholder players T1..T3 / P1..P3');
const M = m.id;

// websocket spectator
const events = [];
const sock = io(`${HOST}/live`, { auth: { token: V }, transports: ['websocket'] });
await new Promise((r) => sock.on('connect', r));
sock.onAny((ev) => events.push(ev));
const ack = await sock.emitWithAck('match:join', { matchId: M });
ok(ack.ok, 'spectator joined match room over WebSocket');

// start
const start = await call('POST', `/matches/${M}/start`, T, { strikerId: A[0].id, nonStrikerId: A[1].id, bowlerId: B[0].id });
ok(start.status === 200 && start.data.data.match.status === 'LIVE', 'match started (scorer lock acquired)');

// viewer cannot score
const denied = await call('POST', `/matches/${M}/balls`, V, { runs: 1 });
ok(denied.status === 403, 'viewer cannot submit score (403)');

const ball = (b) => call('POST', `/matches/${M}/balls`, T, b);
// over 1: 1, wd, 4, 0, 6, W(bowled T2 after strike rotation), 2
let r = await ball({ runs: 1 }); // T1 -> strike to T2
ok(r.data.data.snapshot.current.striker.id === A[1].id, 'strike rotates on single');
await ball({ runs: 0, extraType: 'WIDE' });
await ball({ runs: 4 });
const idem = randomUUID();
await ball({ id: idem, runs: 0 });
const dup = await ball({ id: idem, runs: 0 });
ok(dup.data.data.duplicate === true, 'idempotent ball id (duplicate ignored)');
r = await ball({ runs: 6 });
ok(r.data.data.snapshot.current.score === '12/0', `score 12/0 after 1,wd,4,0,6 (got ${r.data.data.snapshot.current.score})`);
r = await ball({ runs: 0, wicketType: 'BOWLED' });
ok(r.data.data.snapshot.current.needsNewBatsman, 'wicket -> needs new batter');
// undo the wicket, then redo
r = await call('POST', `/matches/${M}/balls/undo`, T, {});
ok(r.status === 200 && r.data.data.snapshot.current.score === '12/0', 'undo restores score & batters');
r = await ball({ runs: 0, wicketType: 'BOWLED' });
r = await call('POST', `/matches/${M}/batsmen`, T, { strikerId: A[2].id });
ok(r.status === 200, 'new batter set');
r = await ball({ runs: 2 }); // 6th legal ball ends over
ok(r.data.data.snapshot.current.overs === '1.0' && r.data.data.snapshot.current.needsNewBowler, 'over complete -> needs new bowler');
const consecutive = await ball({ runs: 0, bowlerId: B[0].id });
ok(consecutive.status === 422, 'same bowler consecutive overs rejected (422)');

// scorer transfer: organizer -> viewer, accept, viewer scores, force back
const tr = await call('POST', `/matches/${M}/scorer/transfer`, T, { toUserId: viewerId });
ok(tr.status === 201, 'transfer requested');
const acc = await call('POST', `/scorer/transfers/${tr.data.data.id}/accept`, V);
ok(acc.status === 200 && acc.data.data.status === 'ACCEPTED', 'transfer accepted');
const orgDenied = await call('POST', `/matches/${M}/balls`, T, { runs: 1, bowlerId: B[1].id });
ok(orgDenied.status === 403, 'previous scorer is now a viewer (403)');
r = await call('POST', `/matches/${M}/balls`, V, { runs: 1, bowlerId: B[1].id });
ok(r.status === 201, 'new scorer can score');
const force = await call('POST', `/matches/${M}/scorer/force-transfer`, T, { toUserId: org.data.data.user.id, reason: 'test' });
ok(force.status === 200 && force.data.data.isMe, 'organizer force transfer back');

// offline sync of the rest of over 2 (5 balls), with a duplicate included
const inn1 = (await call('GET', `/matches/${M}/live`, T)).data.data.current;
const offline = [1, 0, 1, 0, 4].map((runs, i) => ({ id: randomUUID(), clientSequence: i + 1, runs, inningsNumber: 1 }));
const sync = await call('POST', `/matches/${M}/balls/sync`, T, { balls: [...offline, offline[0]] });
ok(sync.status === 200 && sync.data.data.created === 5 && sync.data.data.duplicates === 1, `offline sync created 5, duplicate 1 (got ${JSON.stringify({ c: sync.data.data.created, d: sync.data.data.duplicates, r: sync.data.data.results?.find((x) => x.error)?.error })})`);
let live = (await call('GET', `/matches/${M}/live`, T)).data.data;
ok(live.match.status === 'INNINGS_BREAK', `innings 1 auto-ended after 2 overs (status ${live.match.status}, score ${live.innings[0]?.score})`);
const target = live.innings[0] ? Number(live.innings[0].score.split('/')[0]) + 1 : 0;

// edit a ball in completed innings 1 (the first 1 â†’ 3) and check target follows
const balls = (await call('GET', `/matches/${M}/balls?inningsNumber=1`, T)).data.data;
const edit = await call('PATCH', `/matches/${M}/balls/${balls[0].id}`, T, { runs: 3, reason: 'scorer correction' });
ok(edit.status === 200, 'edit ball in completed innings');

// innings 2
r = await call('POST', `/matches/${M}/innings`, T, { strikerId: B[0].id, nonStrikerId: B[1].id, bowlerId: A[0].id });
ok(r.status === 200 && r.data.data.current.target === target + 2, `2nd innings target ${r.data.data.current?.target} (expected ${target + 2})`);
ok(r.data.data.current.requiredRunRate !== null && r.data.data.current.equation, `chase equation: ${r.data.data.current.equation}`);
// chase with sixes
let res;
for (let i = 0; i < 12; i++) {
  res = await ball({ runs: 6, bowlerId: i < 6 ? A[0].id : A[1].id });
  if (res.data.data?.inningsEnded) break;
}
live = (await call('GET', `/matches/${M}/live`, T)).data.data;
ok(live.match.status === 'COMPLETED' && /Tigers won by/.test(live.match.resultText), `result: ${live.match.resultText}`);

// post-match pipeline (inline jobs)
await new Promise((r) => setTimeout(r, 2500));
const awards = (await call('GET', `/matches/${M}/awards`, T)).data.data;
ok(awards.some((a) => a.type === 'MAN_OF_THE_MATCH'), `awards computed: ${awards.map((a) => a.type).join(', ')}`);
const card = (await call('GET', `/matches/${M}/scorecard`, T)).data.data;
ok(card.innings.length === 2 && card.innings[0].batting.length >= 2, 'scorecard has both innings');
const stats = (await call('GET', `/statistics/players/${B[0].id}`, T)).data.data;
ok(stats.career?.runs > 0, `career stats updated (P1 runs ${stats.career?.runs})`);
const comm = (await call('GET', `/matches/${M}/commentary?limit=50`, T)).data;
ok(comm.meta.total > 10 && comm.data.some((c) => c.type === 'SIX'), `commentary stored (${comm.meta.total} lines)`);
const graphs = (await call('GET', `/matches/${M}/graphs`, T)).data.data;
ok(graphs[0].manhattan.length === 2, 'worm / manhattan data');

for (const f of ['scorecard.pdf', 'summary.pdf', 'scorecard.png', 'share.png']) {
  const e = await call('GET', `/matches/${M}/export/${f}`, T);
  ok(e.status === 200 && e.data.byteLength > 1000, `export ${f} (${e.data.byteLength} bytes)`);
}

// claim flow: viewer claims T3 records; organizer approves
const claim = await call('POST', '/players/claims', V, { temporaryPlayerId: A[2].id });
ok(claim.status === 201, 'claim requested');
const approve = await call('POST', `/players/claims/${claim.data.data.id}/approve`, T);
ok(approve.status === 200 && approve.data.data.status === 'ACCEPTED', 'claim approved & merged');
const merged = (await call('GET', `/players/${A[2].id}`, T)).data.data;
ok(merged.userId === viewerId, 'temporary player id resolves to claimed permanent profile');

const audit = await call('GET', `/matches/${M}/audit-logs`, T);
ok(audit.status === 200 && audit.data.meta.total > 0, `audit log entries: ${audit.data.meta.total}`);
const timeline = await call('GET', `/matches/${M}/timeline?limit=100`, T);
ok(timeline.data.meta.total > 20, `timeline events: ${timeline.data.meta.total}`);

// ── tournament: LEAGUE_KNOCKOUT with 4 teams → round robin → semis → final ──
const tour = await call('POST', '/tournaments', T, { name: `Smoke Cup ${stamp}`, type: 'LEAGUE_KNOCKOUT', overs: 5, playersPerTeam: 5, startDate: '2026-10-01', endDate: '2026-10-20', ground: 'Test Ground' });
ok(tour.status === 201, 'tournament created');
const TID = tour.data.data.id;
const teamIds = [];
for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta']) {
  const t = await call('POST', `/tournaments/${TID}/teams`, T, { name: `${name} ${stamp}` });
  teamIds.push(t.data.data.teamId);
}
const gen = await call('POST', `/tournaments/${TID}/fixtures`, T, { matchesPerDay: 3 });
ok(gen.status === 201 && gen.data.data.created === 6, `round-robin fixtures generated (${gen.data.data?.created})`);
const winAll = async (fixtures) => {
  for (const f of fixtures) {
    // lower index team always wins → deterministic table: Alpha > Bravo > Charlie > Delta
    const winner = teamIds.indexOf(f.teamAId) < teamIds.indexOf(f.teamBId) ? f.teamAId : f.teamBId;
    const res = await call('POST', `/matches/${f.id}/result`, T, { resultType: 'WIN', winnerTeamId: winner, reason: 'smoke test' });
    if (res.status !== 200) ok(false, `override result ${res.status} ${JSON.stringify(res.data)}`);
  }
  await new Promise((r) => setTimeout(r, 2500));
};
await winAll(gen.data.data.fixtures);
const table = (await call('GET', `/tournaments/${TID}/points-table`, T)).data.data;
ok(table[0].team.id === teamIds[0] && table[0].points === 6 && table[3].points === 0, `points table: ${table.map((r) => `${r.team.name.split(' ')[0]}=${r.points}`).join(' ')}`);
let fx = (await call('GET', `/tournaments/${TID}/fixtures`, T)).data.data;
const semis = fx.filter((f) => f.stage === 'SEMI_FINAL');
ok(semis.length === 2 && semis[0].teamAId === teamIds[0] && semis[0].teamBId === teamIds[3], 'semi-finals auto-seeded 1v4, 2v3');
await winAll(semis);
fx = (await call('GET', `/tournaments/${TID}/fixtures`, T)).data.data;
const final = fx.filter((f) => f.stage === 'FINAL');
ok(final.length === 1 && final[0].teamAId === teamIds[0] && final[0].teamBId === teamIds[1], 'final auto-created from semi winners');
await winAll(final);
const tDone = (await call('GET', `/tournaments/${TID}`, T)).data.data;
ok(tDone.status === 'COMPLETED', `tournament completed (${tDone.status})`);
const h2h = (await call('GET', `/statistics/head-to-head?teamA=${teamIds[0]}&teamB=${teamIds[1]}`, T)).data.data;
ok(h2h.played === 2 && h2h.wins[teamIds[0]] === 2, `head-to-head: played ${h2h.played}`);
const lb = await call('GET', `/statistics/leaderboards?category=runs&tournamentId=${TID}`, T);
ok(lb.status === 200, 'leaderboard endpoint');

ok(['score:updated', 'ball:completed', 'six', 'wicket', 'over:completed', 'innings:ended', 'match:ended', 'commentary:update', 'scorer:changed'].every((e) => events.includes(e)), `socket events received: ${[...new Set(events)].join(', ')}`);
sock.close();

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
