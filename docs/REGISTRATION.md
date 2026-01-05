# Registration (Legacy)

This doc describes the older AWS `/register`-based flow.

For the current Esino real-time team registration + lobby flow (REST `/api/teams` + WebSocket `/ws`), see `docs/PLAYERS_REGISTRATION.md`.

## Key Files

- UI: `src/components/RegistrationView.tsx`
- Landing flow: `src/app/page.tsx` (`handleRegistrationComplete`)
- Session + persistence: `src/lib/useQuestSession.ts`
- API client + types: `src/lib/questApi.ts`

## Configuration (Legacy)

- Backend base URL: `NEXT_PUBLIC_API_URL` (legacy)
  - If unset, `src/lib/questApi.ts` falls back to its default `API_URL` (not recommended).

## What We Persist (Browser)

`src/lib/useQuestSession.ts` stores state in `sessionStorage` (per-tab) with a migration from legacy `localStorage`:

- `quest_deviceId`: stable device identifier (generated once)
- `quest_sessionId`: active session id (string)
- `quest_teamCode`: active team code (string, optional)
- `quest_expiresAt`: unix seconds (number, optional)

On load, `useQuestSession()` reconstructs a minimal session from these keys.

## Backend Call

All registration modes call the same endpoint via `questApi.register()`:

```http
POST {NEXT_PUBLIC_API_URL}/register
Content-Type: application/json
```

### Request Shapes

See types in `src/lib/questApi.ts`:

- Solo:
  ```json
  { "mode": "solo", "firstName": "Ada", "lastName": "Lovelace", "deviceId": "...", "questId": "..." }
  ```
- Team create:
  ```json
  { "mode": "team_create", "firstName": "Ada", "lastName": "Lovelace", "deviceId": "...", "questId": "...", "teamName": "Ada's Team", "expectedPlayers": 2 }
  ```
- Team join:
  ```json
  { "mode": "team_join", "firstName": "Ada", "lastName": "Lovelace", "deviceId": "...", "questId": "...", "teamCode": "GHIT-1926-ABC" }
  ```

### Response Shape (High Level)

```json
{
  "success": true,
  "player": { "playerId": "...", "firstName": "...", "lastName": "..." },
  "session": { "sessionId": "...", "mode": "solo|team", "teamCode": "...", "teamName": "...", "status": "pending|ready" }
}
```

## Frontend Flows

### Solo

1. User enters name and selects “Solo”.
2. `LandingPage` calls `createSession(name, questId)`.
3. `useQuestSession` splits name → `{ firstName, lastName }`, generates/reads `quest_deviceId`, then calls `questApi.register({ mode: 'solo', ... })`.
4. `quest_sessionId` and `quest_expiresAt` are stored; the app proceeds to the intro/quest.

### Team (Create)

1. User selects “Team” → “Create”.
2. UI shows a *generated* share code (currently a front-end-only placeholder).
3. `LandingPage` calls `createTeam(name, questId, expectedPlayers, teamName)`, which calls `questApi.register({ mode: 'team_create', ... })`.
4. The returned `teamCode` is persisted to `quest_teamCode`.
5. The creator also calls `createSession(...)` to start their own session.

### Team (Join)

1. User selects “Team” → “Join” and enters a team code.
2. `LandingPage` calls `joinTeam(code, name, questId)`, which calls `questApi.register({ mode: 'team_join', teamCode: code, ... })`.
3. The joined `teamCode` is persisted to `quest_teamCode`.
4. The joiner also calls `createSession(...)` to start their own session.

## Common Gotchas

- `questId` is required: `src/app/page.tsx` throws if `data?.quest?.id` is missing.
- Team “Generate Team Code” in the UI is currently cosmetic; the backend-generated `teamCode` from `team_create` is the source of truth.
