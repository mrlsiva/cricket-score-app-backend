# Cricket Scoring & Tournament Management API

The backend for the Kotlin Android cricket scoring app, built with NestJS 11, Prisma 6, MySQL/MariaDB, Socket.IO, Redis and BullMQ.

**Developed by Sling Groups**

## Quick start (XAMPP / local)

1. Start MySQL from the XAMPP control panel. The `cricket` database must exist (create it in phpMyAdmin if it doesn't).
2. Install and migrate:
   ```bash
   npm install
   cp .env.example .env              # then edit DATABASE_URL, JWT secret, Google client IDs
   npx prisma migrate deploy         # creates all tables in `cricket`
   npm run db:seed                   # roles & permissions (also ensured on boot)
   npm run web:install && npm run web:build   # web app, served at http://localhost:3000/
   npm run start:dev
   ```
3. Open the web app at <http://localhost:3000/> and the API docs at <http://localhost:3000/docs>. The OpenAPI JSON is at `/docs/openapi.json`. A Postman collection and environment are in `postman/` (run the **Quick Start** folder first).

| URL | Purpose |
|---|---|
| `http://localhost:3000/` | Web app (React), built from `web/` |
| `http://localhost:3000/api/v1/...` | REST API |
| `ws://localhost:3000/live` | Socket.IO live score namespace |
| `http://localhost:3000/health` | Liveness / readiness |
| `http://localhost:3000/uploads/...` | Local uploaded files |

Local development works without Redis (`REDIS_ENABLED=false`): locks, cache and job queues fall back to in-process versions. **Enable Redis for any multi-instance deployment.**

### Testing without Google
With `AUTH_DEV_LOGIN=true` (the server always disables it in production), `POST /api/v1/auth/dev-login { email, name }` returns tokens without Google.

```bash
npm test              # unit tests (scoring engine, fixtures, NRR, MVP model)
npm run test:smoke    # end-to-end: plays a full match + tournament against a running server
npm run postman       # regenerate postman/ collection from the running API
```

## Web app (`web/`)

The web app is React 19, Vite, Tailwind 4, React Query and Socket.IO. It talks only to the public REST and WebSocket API, so it behaves exactly like the Android app will. It covers:
- **Sign-in:** Google Sign-In (when `GOOGLE_CLIENT_IDS` is set) or dev login, then onboarding.
- **Matches:** live, upcoming, completed and my matches, regular and quick match creation, and match pages with live score, scorecard, commentary, worm and Manhattan graphs, squads, gallery, awards, timeline, audit, and manage (toss, edit, scorer assignment, result override, cancel, delete).
- **Scoring console:**
  - start, next innings and super over
  - run and extras pad, wicket dialog, new batter and bowler prompts with the consecutive-overs rule
  - undo, swap strike, end over, penalty, retired hurt and timed out, pause and resume, end innings
  - ball log with edit and delete
  - scorer transfer, claim and release
  - offline queue with local strike tracking and sync
- **Tournaments:** create and edit, logo and banner, teams with groups and seeds, fixture generation, points table with NRR, awards and stats.
- **Teams:** create and edit, squad with registered or temporary players, QR and join code (download and WhatsApp share), join requests, matches and stats.
- **Everything else:** players and career statistics, record claims, leaderboards, head-to-head, grounds and seasons, notifications, my profile, and admin (audit logs, role permissions, user roles and status).

The **Android team** uses the same endpoints; see `/docs` and `postman/`.

```bash
npm run web:dev     # Vite dev server on :5173 with hot reload (proxies /api and /socket.io to :3000)
npm run web:build   # production build into web/dist (restart the API once after the first build)
```

## Architecture

```
src/
  config/            env config + validation
  prisma/            PrismaService
  infrastructure/    Redis (lock, cache), BullMQ jobs, storage (local / S3)
  common/            guards' decorators, DTO pagination, filters, interceptors, utils
  docs/              Swagger setup (auth flow, WebSocket events, ER diagram)
  modules/
    auth  users  roles  access(ownership rules)  audit
    teams (QR join)  players (claims)  tournaments (fixtures, points table)
    matches  scorer (lock & transfer)  scoring (engine, innings, balls, live state)
    commentary  statistics (post-match pipeline)  awards  gallery
    notifications (FCM)  live (Socket.IO gateway)  exports (PDF/PNG)  uploads  health
```

Each feature module follows **Controller → Service → Repository/Prisma**. Modules talk to each other through services and domain events (`match.completed`, `players.merged`). The heavy post-match work runs on BullMQ.

### Scoring model
- Every delivery is stored in `balls`. The innings is **replayed** by a pure engine (`scoring/engine/scoring-engine.ts`) that derives score, over numbering, batting and bowling figures, partnerships, fall of wickets and over summaries. Undo, edit and delete of any ball stay consistent, and editing an earlier innings updates the chase target.
- Wides, no-balls (off bat / byes), byes, leg byes, penalty runs, all 8 dismissal types, retired hurt (not a wicket), short overs (`over/end`), the consecutive-overs rule, auto innings end (all out / overs / target), result calculation, and super overs are all supported.
- Wide and no-ball runs and balls per over are configurable per match for local formats.

### Scorer lock
- `POST /matches/:id/start` acquires the lock. Every write checks it, and everyone else is in viewer mode (403).
- Transfer: `POST /matches/:id/scorer/transfer`, then the target calls `POST /scorer/transfers/:id/accept`. The lock changes atomically, `scorer:changed` is broadcast, and the transfer is recorded in history. Requests expire after 5 minutes.
- Organizers can force-transfer (`/scorer/force-transfer`). All lock mutations run under a Redis mutex, and all ball writes for a match are serialised.

### Offline scoring
The app generates a UUID per ball and sends `strikerId / nonStrikerId / bowlerId` with each ball. `POST /matches/:id/balls/sync` applies queued balls in `clientSequence` order, reports already-stored ids as `DUPLICATE`, and stops at the first rejection so balls are never applied out of order. `GET /matches/:id/resume-state` gives a restarted device everything it needs.

### Post-match pipeline (automatic)
match awards + MVP impact points → career stats → team stats → points table & NRR → knockout progression (next rounds and semis/final created automatically) → tournament stats & awards → spectator broadcast.

MVP weights are in `awards/mvp-calculator.ts`. Organizers can override any match award (`PUT /matches/:id/awards/:type`).

### Commentary
Commentary is generated from rules and templates: ball, boundary, six, wicket, milestone, partnership, over, innings and match summaries. Each line is deterministic per ball, so an edited ball regenerates stable text. It is stored permanently and pushed on `commentary:update`. It does not call an LLM. `commentary.generator.ts` is the single place to add an LLM-backed generator later.

## Security
- Google ID tokens are verified (signature, audience and verified email). Access tokens are short-lived JWTs. Refresh tokens are opaque, stored as SHA-256 hashes, and rotated; reusing one revokes the whole family.
- A global JWT guard applies role/permission checks (the permission matrix lives in the `roles` table, editable by Super Admin) plus ownership checks per resource (`access.service.ts`).
- Other protections: throttling (global and stricter on auth), helmet, CORS allow-list, whitelisting ValidationPipe, and a global exception filter with a consistent error envelope.
- Uploads are sniffed by magic bytes (never by client mimetype), limited in size, and stored under random names.
- Audit logs record every ball edit, delete and undo, penalties, result overrides, scorer changes, award overrides, team and tournament changes, and claim merges.

## Production
```bash
docker compose up -d --build        # API + MySQL 8 + Redis
```
- Set `NODE_ENV=production`, `REDIS_ENABLED=true`, a strong `JWT_ACCESS_SECRET`, `GOOGLE_CLIENT_IDS`, `CORS_ORIGINS`, `STORAGE_DRIVER=s3`, and `FIREBASE_SERVICE_ACCOUNT_PATH`.
- Scale out horizontally. The Socket.IO Redis adapter fans out broadcasts across instances, and BullMQ workers run in every instance. Use sticky sessions only if you allow long-polling (the Android client should use `transports: ['websocket']`).
- Set `LOG_JSON=true` for structured logs.

## Android integration cheatsheet
```kotlin
// Socket.IO
val socket = IO.socket("$BASE/live", IO.Options().apply {
    auth = mapOf("token" to accessToken); transports = arrayOf("websocket")
})
socket.emit("match:join", JSONObject().put("matchId", id), Ack { /* joined */ })
socket.on("score:updated") { args -> render(args[0] as JSONObject) }
```
Push: register the FCM token with `POST /notifications/devices`, and follow matches with `POST /notifications/topics/subscribe { "topic": "match_<id>" }`.

---
Developed by Sling Groups
