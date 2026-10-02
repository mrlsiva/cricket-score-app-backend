// Generates a Postman v2.1 collection + local environment from the live OpenAPI document.
// Usage: start the API, then `npm run postman` (API_HOST defaults to http://localhost:3000).
// Developed by Sling Groups
import { mkdirSync, writeFileSync } from 'fs';

const HOST = process.env.API_HOST ?? 'http://localhost:3000';
const spec = await (await fetch(`${HOST}/docs/openapi.json`)).json();
const PREFIX = '/api/v1';

// ── helpers ──────────────────────────────────────────────────────────────
const deref = (s) => (s?.$ref ? deref(spec.components.schemas[s.$ref.split('/').pop()]) : s);

/** Variables captured by test scripts and reused in URLs / bodies. */
const VARS = [
  'accessToken', 'refreshToken', 'userId', 'otherUserId', 'playerId', 'teamId', 'teamBId', 'tournamentId',
  'matchId', 'ballId', 'strikerId', 'nonStrikerId', 'bowlerId', 'bowler2Id', 'fielderId', 'transferId',
  'claimId', 'requestId', 'notificationId', 'galleryId', 'commentaryId', 'joinCode', 'tempPlayerId',
];

/** Maps `{id}` in a path to the right variable based on the resource before it. */
function pathVar(name, prevSegment) {
  if (name !== 'id') return name === 'type' ? 'MAN_OF_THE_MATCH' : name === 'name' ? 'ORGANIZER' : name === 'season' ? '2026' : name === 'token' ? 'fcmToken' : name;
  return (
    {
      teams: 'teamId', tournaments: 'tournamentId', matches: 'matchId', players: 'playerId', users: 'userId',
      notifications: 'notificationId', gallery: 'galleryId', commentary: 'commentaryId',
    }[prevSegment] ?? 'id'
  );
}

/** Pick a sensible example value for a schema property. */
function example(name, s) {
  s = deref(s) ?? {};
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (s.enum) return s.enum[0];
  const idVar = {
    teamAId: 'teamId', teamBId: 'teamBId', tossWinnerId: 'teamId', winnerTeamId: 'teamId', captainId: 'playerId',
    keeperId: 'playerId', wicketKeeperId: 'playerId', managerId: 'userId', toUserId: 'otherUserId',
    temporaryPlayerId: 'tempPlayerId', dismissedPlayerId: 'strikerId', batsmanId: 'strikerId',
  }[name] ?? (VARS.includes(name) ? name : null);
  if (s.format === 'uuid' || (s.type === 'string' && /Id$/.test(name))) return idVar ? `{{${idVar}}}` : `{{${name}}}`;
  if (s.format === 'date-time' || s.format === 'date') return '2026-10-01T09:00:00.000Z';
  if (s.type === 'integer' || s.type === 'number') return s.minimum ?? 1;
  if (s.type === 'boolean') return false;
  if (s.type === 'array') return s.items ? [example(name.replace(/s$/, ''), s.items)] : [];
  if (s.type === 'object' || s.properties) return buildBody(s);
  return name;
}

function buildBody(schema) {
  schema = deref(schema);
  if (!schema?.properties) return {};
  const required = new Set(schema.required ?? []);
  const out = {};
  for (const [k, v] of Object.entries(schema.properties)) {
    // keep bodies short: required fields + a few meaningful optionals
    if (required.has(k) || ['reason', 'caption', 'message', 'city', 'ground', 'name'].includes(k)) out[k] = example(k, v);
  }
  return out;
}

// ── hand-curated bodies / scripts for the main scoring flow ──────────────
const CURATED = {
  'POST /auth/dev-login': { body: { email: 'organizer@test.local', name: 'Test Organizer' } },
  'POST /auth/onboarding': { body: { accountTypes: ['ORGANIZER', 'INDIVIDUAL'], city: 'Chennai' } },
  'POST /auth/refresh': { body: { refreshToken: '{{refreshToken}}' } },
  'POST /auth/logout': { body: { refreshToken: '{{refreshToken}}' } },
  'POST /matches/quick': {
    body: { teamAName: 'Lions', teamBName: 'Tigers', playersPerTeam: 6, overs: 5, tossWinner: 'A', tossDecision: 'BAT', ground: 'Marina Ground' },
  },
  'POST /matches': {
    body: { teamAId: '{{teamId}}', teamBId: '{{teamBId}}', playersPerTeam: 11, overs: 20, tossWinnerId: '{{teamId}}', tossDecision: 'BAT', fillWithTemporaryPlayers: true },
  },
  'POST /matches/{matchId}/start': { body: { strikerId: '{{strikerId}}', nonStrikerId: '{{nonStrikerId}}', bowlerId: '{{bowlerId}}' } },
  'POST /matches/{matchId}/innings': { body: { strikerId: '{{strikerId}}', nonStrikerId: '{{nonStrikerId}}', bowlerId: '{{bowlerId}}' } },
  'POST /matches/{matchId}/super-over': { body: { strikerId: '{{strikerId}}', nonStrikerId: '{{nonStrikerId}}', bowlerId: '{{bowlerId}}' } },
  'POST /matches/{matchId}/balls': { body: { id: '{{$guid}}', runs: 1 } },
  'PATCH /matches/{matchId}/balls/{ballId}': { body: { runs: 4, reason: 'Scorer correction' } },
  'DELETE /matches/{matchId}/balls/{ballId}': { body: { reason: 'Recorded twice' } },
  'POST /matches/{matchId}/balls/sync': {
    body: {
      balls: [
        { id: '{{$guid}}', clientSequence: 1, inningsNumber: 1, runs: 1, strikerId: '{{strikerId}}', nonStrikerId: '{{nonStrikerId}}', bowlerId: '{{bowlerId}}' },
        { id: '{{$guid}}', clientSequence: 2, inningsNumber: 1, runs: 4, strikerId: '{{nonStrikerId}}', nonStrikerId: '{{strikerId}}', bowlerId: '{{bowlerId}}' },
      ],
    },
  },
  'POST /matches/{matchId}/bowler': { body: { bowlerId: '{{bowler2Id}}' } },
  'POST /matches/{matchId}/batsmen': { body: { strikerId: '{{strikerId}}' } },
  'POST /matches/{matchId}/penalty': { body: { runs: 5, reason: 'Ball hit fielding helmet' } },
  'POST /matches/{matchId}/dismissal': { body: { playerId: '{{strikerId}}', wicketType: 'RETIRED_HURT' } },
  'POST /matches/{matchId}/result': { body: { resultType: 'NO_RESULT', reason: 'Rain stopped play' } },
  'POST /tournaments': {
    body: { name: 'Chennai Premier League 2026', type: 'LEAGUE_KNOCKOUT', overs: 20, playersPerTeam: 11, ballType: 'TENNIS', ground: 'Marina Ground', startDate: '2026-10-01', endDate: '2026-10-20' },
  },
  'POST /tournaments/{id}/teams': { body: { name: 'Chennai Strikers' } },
  'POST /tournaments/{id}/fixtures': { body: { matchesPerDay: 2, startTime: '09:00', gapMinutes: 240 } },
  'POST /teams': { body: { name: 'Chennai Strikers', shortName: 'CHS', color: '#FFCC00', joinAsPlayer: true } },
  'POST /teams/join': { body: { code: '{{joinCode}}', message: 'Opening batter, available weekends' } },
  'POST /teams/{id}/players': { body: { name: 'Guest Player' } },
  'POST /players/claims': { body: { temporaryPlayerId: '{{tempPlayerId}}', message: 'I played as T3' } },
  'POST /statistics/leaderboards': {},
};

// Test scripts that capture ids for the following requests.
const T = (lines) => [...lines, "pm.test('status is 2xx', () => pm.expect(pm.response.code).to.be.within(200, 299));"];
const SCRIPTS = {
  'POST /auth/dev-login': T([
    'const d = pm.response.json().data;',
    "pm.collectionVariables.set('accessToken', d.accessToken);",
    "pm.collectionVariables.set('refreshToken', d.refreshToken);",
    "pm.collectionVariables.set('userId', d.user.id);",
  ]),
  'POST /auth/google': T([
    'const d = pm.response.json().data;',
    "pm.collectionVariables.set('accessToken', d.accessToken);",
    "pm.collectionVariables.set('refreshToken', d.refreshToken);",
    "pm.collectionVariables.set('userId', d.user.id);",
  ]),
  'POST /auth/refresh': T([
    'const d = pm.response.json().data;',
    "pm.collectionVariables.set('accessToken', d.accessToken);",
    "pm.collectionVariables.set('refreshToken', d.refreshToken);",
  ]),
  'POST /auth/onboarding': T(["const d = pm.response.json().data; if (d.player) pm.collectionVariables.set('playerId', d.player.id);"]),
  'POST /matches/quick': T([
    'const m = pm.response.json().data;',
    "pm.collectionVariables.set('matchId', m.id);",
    "pm.collectionVariables.set('teamId', m.teamAId); pm.collectionVariables.set('teamBId', m.teamBId);",
    'const a = m.squads.teamA.map(p => p.player.id), b = m.squads.teamB.map(p => p.player.id);',
    "const batA = m.tossDecision === 'BAT' ? (m.tossWinnerId === m.teamAId) : (m.tossWinnerId !== m.teamAId);",
    'const bat = batA ? a : b, bowl = batA ? b : a;',
    "pm.collectionVariables.set('strikerId', bat[0]); pm.collectionVariables.set('nonStrikerId', bat[1]);",
    "pm.collectionVariables.set('bowlerId', bowl[0]); pm.collectionVariables.set('bowler2Id', bowl[1]); pm.collectionVariables.set('fielderId', bowl[2] ?? bowl[0]);",
    "pm.collectionVariables.set('tempPlayerId', a[a.length - 1]);",
  ]),
  'POST /matches': T(["pm.collectionVariables.set('matchId', pm.response.json().data.id);"]),
  'POST /matches/{matchId}/balls': T([
    'const d = pm.response.json().data;',
    "pm.collectionVariables.set('ballId', d.ball.id);",
    'const c = d.snapshot.current;',
    "if (c) console.log(`${c.score} (${c.overs})  ${c.equation ?? ''}`, c.needsNewBatsman ? '→ set new batter' : '', c.needsNewBowler ? '→ change bowler' : '');",
  ]),
  'POST /tournaments': T(["pm.collectionVariables.set('tournamentId', pm.response.json().data.id);"]),
  'POST /teams': T(["pm.collectionVariables.set('teamId', pm.response.json().data.id);"]),
  'GET /teams/{id}/qr': T(["pm.collectionVariables.set('joinCode', pm.response.json().data.joinCode);"]),
  'POST /teams/join': T(["pm.collectionVariables.set('requestId', pm.response.json().data.id);"]),
  'POST /matches/{matchId}/scorer/transfer': T(["pm.collectionVariables.set('transferId', pm.response.json().data.id);"]),
  'POST /players/claims': T(["pm.collectionVariables.set('claimId', pm.response.json().data.id);"]),
  'GET /notifications': T(["const n = pm.response.json().data; if (n.length) pm.collectionVariables.set('notificationId', n[0].id);"]),
  'POST /matches/{matchId}/gallery': T(["pm.collectionVariables.set('galleryId', pm.response.json().data.id);"]),
};

// ── build ────────────────────────────────────────────────────────────────
const folders = new Map();
const TAG_ORDER = [
  'Authentication', 'Users', 'Roles & Permissions', 'Players', 'Teams', 'Tournaments', 'Matches', 'Scorer Management',
  'Live Scoring', 'Commentary', 'Statistics', 'Awards', 'Gallery', 'Scorecard Export', 'Notifications', 'File Upload', 'Audit Logs', 'Health',
];

for (const [rawPath, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    const path = rawPath.startsWith(PREFIX) ? rawPath.slice(PREFIX.length) : rawPath;
    const key = `${method.toUpperCase()} ${path}`;
    const segments = path.split('/').filter(Boolean);
    const urlSegments = segments.map((seg, i) => {
      const m = seg.match(/^\{(.+)\}$/);
      return m ? `{{${pathVar(m[1], segments[i - 1])}}}` : seg;
    });
    const isPublic = !op.security?.length && ['/auth/google', '/auth/dev-login', '/auth/refresh', '/auth/logout', '/health'].includes(path);

    const query = (op.parameters ?? [])
      .filter((p) => p.in === 'query')
      .map((p) => {
        const s = deref(p.schema) ?? {};
        let value = s.default ?? s.example ?? (s.enum ? s.enum[0] : s.items?.enum ? s.items.enum[0] : '');
        if (p.name === 'tournamentId') value = '{{tournamentId}}';
        if (p.name === 'teamA') value = '{{teamId}}';
        if (p.name === 'teamB') value = '{{teamBId}}';
        if (p.name === 'kind') value = 'team-logo';
        if (p.name === 'category') value = 'runs';
        if (p.name === 'name' && path === '/statistics/grounds') value = 'Marina Ground';
        return { key: p.name, value: String(value ?? ''), description: p.description ?? '', disabled: !p.required };
      });

    const request = {
      method: method.toUpperCase(),
      header: [],
      url: {
        raw: `{{baseUrl}}${path === '/health' ? '' : PREFIX}/${urlSegments.join('/')}${query.length ? '?' + query.filter((q) => !q.disabled).map((q) => `${q.key}=${q.value}`).join('&') : ''}`,
        host: ['{{baseUrl}}'],
        path: [...(path === '/health' ? [] : PREFIX.split('/').filter(Boolean)), ...urlSegments],
        query,
      },
      description: [op.summary, op.description].filter(Boolean).join('\n\n'),
    };
    if (isPublic) request.auth = { type: 'noauth' };

    const content = op.requestBody?.content ?? {};
    if (content['multipart/form-data']) {
      const props = deref(content['multipart/form-data'].schema)?.properties ?? {};
      request.body = {
        mode: 'formdata',
        formdata: Object.entries(props).map(([k, v]) =>
          v.format === 'binary' ? { key: k, type: 'file', src: [], description: 'Select an image / video file' } : { key: k, type: 'text', value: '', description: v.description ?? '' },
        ),
      };
    } else if (content['application/json'] || CURATED[key]?.body) {
      const body = CURATED[key]?.body ?? buildBody(content['application/json']?.schema);
      request.header.push({ key: 'Content-Type', value: 'application/json' });
      request.body = { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } };
    }

    const item = { name: op.summary ?? key, request, response: [] };
    if (SCRIPTS[key]) item.event = [{ listen: 'test', script: { type: 'text/javascript', exec: SCRIPTS[key] } }];

    const tag = op.tags?.[0] ?? 'Other';
    if (!folders.has(tag)) folders.set(tag, []);
    folders.get(tag).push(item);
  }
}

// ── "Quick Start" folder: a runnable end-to-end scoring flow ─────────────
const find = (tag, pred) => structuredClone(folders.get(tag).find(pred));
const byUrl = (tag, method, suffix) => find(tag, (i) => i.request.method === method && i.request.url.path.join('/').endsWith(suffix));
const rename = (item, name) => ({ ...item, name });
const ballReq = (name, body) => {
  const it = byUrl('Live Scoring', 'POST', '{{matchId}}/balls');
  it.name = name;
  it.request.body.raw = JSON.stringify({ id: '{{$guid}}', ...body }, null, 2);
  return it;
};
const quickStart = [
  rename(byUrl('Authentication', 'POST', 'dev-login'), '1. Login (dev) - saves tokens'),
  rename(byUrl('Authentication', 'POST', 'onboarding'), '2. Onboarding: Organizer + Individual'),
  rename(byUrl('Matches', 'POST', 'matches/quick'), '3. Create quick match - saves match & player ids'),
  rename(byUrl('Live Scoring', 'POST', '{{matchId}}/start'), '4. Start match (acquires scorer lock)'),
  ballReq('5. Ball: single', { runs: 1 }),
  ballReq('6. Ball: wide', { runs: 0, extraType: 'WIDE' }),
  ballReq('7. Ball: FOUR', { runs: 4 }),
  ballReq('8. Ball: SIX', { runs: 6 }),
  ballReq('9. Ball: caught', { runs: 0, wicketType: 'CAUGHT', fielderId: '{{fielderId}}' }),
  rename(byUrl('Live Scoring', 'POST', '{{matchId}}/balls/undo'), '10. Undo last ball'),
  rename(byUrl('Live Scoring', 'GET', '{{matchId}}/live'), '11. Live snapshot'),
  rename(byUrl('Live Scoring', 'GET', '{{matchId}}/scorecard'), '12. Scorecard'),
  rename(byUrl('Commentary', 'GET', '{{matchId}}/commentary'), '13. Commentary'),
];

const collection = {
  info: {
    name: 'Cricket Scoring & Tournament API',
    description:
      'Complete REST collection for the Cricket Scoring & Tournament Management backend.\n\n' +
      '**Getting started:** run the **Quick Start** folder top to bottom. Login stores `accessToken` automatically ' +
      '(collection-level Bearer auth); creating resources stores their ids in collection variables used by later requests.\n\n' +
      '- `POST /auth/dev-login` works when `AUTH_DEV_LOGIN=true` (never in production). With a real Google ID token use **Authentication → Sign in with Google**.\n' +
      '- Use a second login (different email) + **Scorer Management** to try scorer transfer; set `otherUserId` to that user id.\n' +
      '- WebSocket events are not covered by Postman REST; connect to `{{baseUrl}}/live` with Socket.IO (see API docs at /docs).\n\n' +
      'Developed by Sling Groups',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
  variable: [{ key: 'baseUrl', value: HOST }, ...VARS.map((k) => ({ key: k, value: '' })), { key: 'fcmToken', value: 'fcm-device-token' }],
  item: [
    { name: '⚡ Quick Start (run in order)', item: quickStart },
    ...[...folders.keys()]
      .sort((a, b) => (TAG_ORDER.indexOf(a) + 1 || 99) - (TAG_ORDER.indexOf(b) + 1 || 99))
      .map((tag) => ({ name: tag, item: folders.get(tag) })),
  ],
};

const environment = {
  name: 'Cricket API - Local (XAMPP)',
  values: [{ key: 'baseUrl', value: HOST, enabled: true }],
  _postman_variable_scope: 'environment',
};

mkdirSync('postman', { recursive: true });
writeFileSync('postman/Cricket-API.postman_collection.json', JSON.stringify(collection, null, 2));
writeFileSync('postman/Cricket-API-Local.postman_environment.json', JSON.stringify(environment, null, 2));
const count = [...folders.values()].reduce((n, f) => n + f.length, 0);
console.log(`Wrote postman/Cricket-API.postman_collection.json (${count} requests in ${folders.size} folders + ${quickStart.length} quick-start steps)`);
