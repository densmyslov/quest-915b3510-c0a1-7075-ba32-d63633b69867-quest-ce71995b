# Players Registration (Solo + Team Sync)

This doc describes the **current** player registration and team flow used by the Quest app template, including the real-time team lobby (WebSocket + Durable Objects).

## Key Files

- UI: `src/components/RegistrationView.tsx`
- Landing flow (state machine): `src/app/page.tsx`
- Session persistence: `src/lib/useQuestSession.ts`
- Team REST + WebSocket client: `src/lib/useTeamWebSocket.ts`
- App-level provider: `src/context/TeamSyncContext.tsx`

## Environment Variables

- `QUEST_API_URL` (recommended for Cloudflare Pages) — server-side base URL of the Quest API Worker (e.g. `https://esino-quest-api-dev.<account>.workers.dev`)
- `NEXT_PUBLIC_QUEST_API_URL` (optional) — client-side base URL of the Quest API Worker (preferred over `NEXT_PUBLIC_API_URL` when set)
- `NEXT_PUBLIC_API_URL` (legacy fallback) — used only if `NEXT_PUBLIC_QUEST_API_URL` is not set

Notes for Pages deployments:
- `QUEST_API_URL` is read by the Next.js API routes at runtime (recommended).
- `NEXT_PUBLIC_QUEST_API_URL` / `NEXT_PUBLIC_API_URL` are inlined into client bundles and must be set at build time.

## Storage (Browser)

Stored in `sessionStorage` (per-tab) to avoid cross-tab session collisions:

- `quest_deviceId` (localStorage): stable device identifier (generated once)
- `quest_sessionId` (sessionStorage): active session id
- `quest_teamCode` (sessionStorage): active team code
- `quest_playerName` (sessionStorage): player name
- `quest_expiresAt` (sessionStorage): unix seconds (solo session timer)
- `quest_soloTeam` (sessionStorage): `1` when “solo as team-of-one” is active
- `quest_teamStartedAt` (sessionStorage): ISO timestamp used as `startedAt` for solo team-of-one

`TeamSyncProvider` reads these keys and keeps a WebSocket connected in the background during the lobby / quest.

## REST Endpoints

### Team Management

#### `POST /api/teams`
Creates a new team and returns the team code.

**Request:**
```json
{
  "playerName": "Alice",
  "questId": "sample-quest",
  "questVersion": "v1"
}
```

**Response:**
```json
{
  "teamCode": "ABC123",
  "session": {
    "sessionId": "session_1234567890_xyz",
    "playerName": "Alice",
    "mode": "team",
    "teamCode": "ABC123"
  },
  "websocketUrl": "ws://localhost:3000/ws?teamCode=ABC123"
}
```

**Implementation:** [src/app/api/teams/route.ts](../src/app/api/teams/route.ts)

#### `POST /api/teams/{teamCode}/join`
Joins an existing team.

**Request:**
```json
{
  "playerName": "Bob"
}
```

**Response:**
```json
{
  "teamCode": "ABC123",
  "session": {
    "sessionId": "session_1234567891_abc",
    "playerName": "Bob",
    "mode": "team",
    "teamCode": "ABC123"
  },
  "websocketUrl": "ws://localhost:3000/ws?teamCode=ABC123"
}
```

**Error Responses:**
- `404` - Team not found
- `400` - Missing or invalid player name

**Implementation:** [src/app/api/teams/[teamCode]/join/route.ts](../src/app/api/teams/[teamCode]/join/route.ts)

### Storage

**Production Architecture:**

Team and session data is managed by the **`esino-quest-api` Cloudflare Worker** ([source code](../../quest-platform/backend/workers/esino-quest-api/)) using:
- **Durable Objects**: Stateful instances for real-time WebSocket connections and in-memory team state
- **DynamoDB**: Persistent backup storage for sessions and teams

The Next.js app calls the worker API via `useTeamWebSocket.ts` - it does NOT implement team storage locally.

**Deployed Worker URL:** `https://esino-quest-api-dev.denslov.workers.dev`

**Local Development Options:**

1. **Use the deployed worker** (recommended):
   - Set `NEXT_PUBLIC_QUEST_API_URL=https://esino-quest-api-dev.denslov.workers.dev` in `.env.local`
   - Full functionality including WebSocket support
   - State persists across requests

2. **Use local API routes** (limited - dev only):
   - The routes in [src/app/api/teams/](../src/app/api/teams/) provide a basic implementation
   - **Limitations**:
     - State lost between requests (in-memory Map)
     - No WebSocket support (the routes return an empty `websocketUrl`)
     - Only for testing basic API responses
   - **Not suitable for production**

3. **Use Pages API proxy to the worker** (recommended for Pages):
   - Set `QUEST_API_URL=https://esino-quest-api-dev.denslov.workers.dev` in your Cloudflare Pages environment variables
   - The Next.js API routes proxy `/api/teams` and `/api/teams/{teamCode}/join` to the worker
   - The UI stores the returned `websocketUrl` and connects directly to the worker for real-time sync

**Configuration:**

Set in `.env.local`:
```env
NEXT_PUBLIC_QUEST_API_URL=https://esino-quest-api-dev.denslov.workers.dev
```

For local worker development:
```env
NEXT_PUBLIC_QUEST_API_URL=http://localhost:8787
```

## WebSocket (Team Room)

Connect to `/ws?teamCode=...` and immediately send:

```json
{ "type": "join", "sessionId": "…", "playerName": "…" }
```

### Leader Start

- Only the team leader can start the game (`team.leaderSessionId`).
- Leader sends `{ "type": "start_game", "sessionId": "…" }`.
- All clients receive:

```json
{ "type": "game_started", "startedAt": "…", "expiresAt": "…" }
```

The landing page transitions to the intro when `team.startedAt` is set.

## UI / UX Rules

### Team Founder (Create)

1. Tap **Create team** → the UI calls `createTeam()`.
2. The UI shows the shareable `teamCode`.
3. The UI shows the lobby member list.
4. Only the founder sees the **Enter / Start** button.
5. Tapping **Enter / Start** triggers `start_game` over WebSocket; the game begins for everyone.

### Joining Member (Join)

1. Enter `teamCode` → the UI calls `joinTeam()`.
2. After join succeeds, the UI shows the lobby member list.
3. The **Enter** button is hidden.
4. The user waits until the founder starts the game.

### Solo

Solo users are treated as a **team with a single player**:

- The client creates a 1-player team via `POST /api/teams`.
- The generated `teamCode` is stored but **not shown** in the UI.
- The client persists `quest_soloTeam=1` and a stable `quest_teamStartedAt` timestamp so puzzle distribution and gating behave like team mode.
- If `POST /api/teams` is unavailable, the client falls back to a local-only solo session (no team sync).

## Troubleshooting

- If join fails with `Invalid team code`, ensure the full code is pasted (the UI allows longer prefixes like `PSCIAC-...`) and no unicode dashes/whitespace remain (client + server normalize common paste issues).
- If the lobby flickers connect/disconnect: ensure the app build includes the sessionStorage change (per-tab) and avoid multiple tabs reusing the same session.
- If the browser tries to connect to `wss://<your-pages-domain>/ws?...` and fails: configure `QUEST_API_URL` (Pages) or `NEXT_PUBLIC_QUEST_API_URL` (client build time) so the app uses the worker `/ws`.
