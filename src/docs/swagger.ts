import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { BRANDING } from '../config/configuration';
import { LiveEvent } from '../modules/live/live.events';

const AUTH_FLOW = `
### Authentication flow
1. The Android app signs in with Google (Credential Manager) and obtains an **ID token** whose audience is one of \`GOOGLE_CLIENT_IDS\`.
2. \`POST /auth/google { idToken }\` → \`{ accessToken, refreshToken, expiresIn, requiresOnboarding, user }\`.
3. First login: \`POST /auth/onboarding { accountTypes: ["ORGANIZER" | "INDIVIDUAL"] }\` (one account may hold both).
4. Call every endpoint with \`Authorization: Bearer <accessToken>\` (15 min).
5. Before expiry: \`POST /auth/refresh { refreshToken }\` → new pair (refresh tokens rotate; reuse revokes all sessions).
`;

const RESPONSES = `
### Response envelope
Success: \`{ "success": true, "data": ..., "meta": { "page", "limit", "total", "totalPages" } }\` (meta only on lists)

Error: \`{ "success": false, "statusCode": 422, "error": "UNPROCESSABLE_ENTITY", "message": "...", "details": [...], "path": "...", "timestamp": "..." }\`

| Status | Meaning |
|---|---|
| 400 | Validation failed (\`details\` lists each field error) |
| 401 | Missing / invalid / expired access token |
| 403 | Missing role / permission, or not the active scorer (viewer mode) |
| 404 | Resource not found |
| 409 | Conflict (duplicate, wrong match state, lock held by another scorer) |
| 422 | Cricket rule violation (e.g. consecutive overs, stumped off a no-ball) |
| 429 | Rate limit exceeded |

Lists accept \`page\`, \`limit\` (≤100), \`search\`, \`sortBy\`, \`sortOrder\` (asc|desc) plus endpoint-specific filters.
`;

const WS_DOC = `
### Live WebSocket (Socket.IO)
Connect to namespace **\`/live\`** with \`io(BASE_URL + "/live", { auth: { token: accessToken }, transports: ["websocket"] })\`.
Unlimited spectators; all score **writes** go through REST and require the scorer lock.

**Client → server**

| Event | Payload | Ack |
|---|---|---|
| \`${LiveEvent.JOIN_MATCH}\` | \`{ matchId }\` | \`{ ok, room, spectators }\` + immediate \`${LiveEvent.SCORE_UPDATED}\` snapshot |
| \`${LiveEvent.LEAVE_MATCH}\` | \`{ matchId }\` | \`{ ok }\` |
| \`${LiveEvent.JOIN_TOURNAMENT}\` | \`{ tournamentId }\` | \`{ ok, room }\` |
| \`${LiveEvent.LEAVE_TOURNAMENT}\` | \`{ tournamentId }\` | \`{ ok }\` |

**Server → client** (room \`match:<id>\` unless noted; every payload includes \`matchId\` and \`at\`)

| Event | When | Payload (main fields) |
|---|---|---|
| \`${LiveEvent.MATCH_STARTED}\` | Match started | battingTeamId, bowlingTeamId |
| \`${LiveEvent.TOSS_COMPLETED}\` | Toss recorded | tossText, tossWinnerId, decision |
| \`${LiveEvent.BALL_COMPLETED}\` | Every ball | inningsNumber, ballId, label, runs, extraType, score, ball |
| \`${LiveEvent.SCORE_UPDATED}\` | After every change | Full live snapshot (same as \`GET /matches/:id/live\`) |
| \`${LiveEvent.WICKET}\` | Wicket | playerId, wicketType, runs, balls |
| \`${LiveEvent.BOUNDARY}\` | Four | playerId |
| \`${LiveEvent.SIX}\` | Six | playerId |
| \`${LiveEvent.MILESTONE}\` | 50 / 100 | text, playerId |
| \`${LiveEvent.OVER_COMPLETED}\` | Over ends | over summary (runs, wickets, balls, maiden) |
| \`${LiveEvent.BALL_UPDATED}\` / \`${LiveEvent.BALL_DELETED}\` | Edit / delete / undo | ballId, inningsNumber, undo |
| \`${LiveEvent.INNINGS_STARTED}\` | Next innings / super over | inningsNumber, battingTeamId, target |
| \`${LiveEvent.INNINGS_END}\` | Innings ends | runs, wickets, overs, reason, summary |
| \`${LiveEvent.MATCH_END}\` | Result | resultType, winnerTeamId, winMargin, resultText |
| \`${LiveEvent.MATCH_PAUSED}\` / \`${LiveEvent.MATCH_RESUMED}\` | Pause / resume | reason |
| \`${LiveEvent.COMMENTARY_UPDATE}\` | New commentary | items[] |
| \`${LiveEvent.GALLERY_UPDATE}\` | Media added / edited / deleted | action, item |
| \`${LiveEvent.SCORER_TRANSFER_REQUESTED}\` | Transfer requested (also to target user room) | transferId, from, expiresAt |
| \`${LiveEvent.SCORER_TRANSFER}\` | Scorer changed | fromUserId, scorer, status |
| \`${LiveEvent.AWARDS_UPDATED}\` | Awards computed (match & tournament rooms) | awards[] |
| \`${LiveEvent.POINTS_TABLE_UPDATED}\` | Tournament room: points table changed | table[] |
| \`${LiveEvent.ERROR}\` | Auth failure before disconnect | code, message |
`;

const ER = `
### Database ER diagram (MySQL / MariaDB, UUID keys, soft deletes via \`deletedAt\`)
\`\`\`
users 1─* user_roles *─1 roles
users 1─* refresh_tokens            users 1─1 players (permanent profile)
users 1─* tournaments (organizer)   tournaments 1─* tournament_teams *─1 teams   (points table rows)
teams 1─* team_players *─1 players  teams 1─* team_join_requests *─1 users/players
players 1─* player_claim_requests (temporary → permanent merge)
tournaments 1─* matches *─1 teams (A, B, toss winner, winner)
matches 1─* match_players (playing XI)   matches 1─* innings 1─* balls
matches 1─* score_events (timeline)      innings 1─* partnerships
matches 1─* commentary (optionally per ball)
matches 1─* player_match_stats *─1 players      players 1─1 player_career_stats
teams 1─1 team_stats                    tournaments 1─1 tournament_stats
matches/tournaments 1─* awards *─1 players
matches 1─* galleries *─1 users         users 1─* notifications, device_tokens
matches 1─1 scorer_locks *─1 users      matches 1─* scorer_transfer_history
audit_logs *─1 users, matches
\`\`\`
See \`docs/ER-DIAGRAM.md\` for the full Mermaid diagram.
`;

export function setupSwagger(app: INestApplication, prefix: string) {
  const config = new DocumentBuilder()
    .setTitle('Cricket Scoring & Tournament Management API')
    .setDescription(`REST + WebSocket API for the Cricket Scoring Android app.\n\n**${BRANDING}**\n${AUTH_FLOW}${RESPONSES}${WS_DOC}${ER}\n---\n${BRANDING}`)
    .setVersion('1.0.0')
    .setContact('Sling Groups', '', '')
    .setLicense(BRANDING, '')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addServer('/', 'Current host')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  (document.info as unknown as Record<string, unknown>)['x-developed-by'] = 'Sling Groups';
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: `Cricket API Docs - ${BRANDING}`,
    customCss: `.swagger-ui .topbar { background:#0b3d2e } .swagger-ui::after { content: "${BRANDING}"; display:block; text-align:center; padding:24px; color:#666; font-size:13px }`,
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none', filter: true, tagsSorter: 'alpha' },
    jsonDocumentUrl: 'docs/openapi.json',
  });
  return document;
}
