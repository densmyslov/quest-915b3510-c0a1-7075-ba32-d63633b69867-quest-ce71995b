# WebSocket Runtime System

## Overview

The quest runtime uses WebSocket connections for real-time bidirectional communication between quest players and the backend. Each player's device establishes its own WebSocket connection to enable live updates during gameplay.

### Architecture

**Client-Side**: Each team member's phone/browser creates a WebSocket connection (see `src/lib/useTeamWebSocket.ts`)
**Server-Side**: Cloudflare Worker + Durable Object “team room” (see `docs/PLAYERS_REGISTRATION.md`)
**Broadcasting**: Team state changes + runtime deltas are pushed to all connected clients in the team room

## WebSocket Connection Flow

### 1. Registration
When a player registers (solo or team), the `/api/teams` endpoint returns:
```typescript
{
  teamCode: "7TCJEM",
  session: { sessionId, playerName, mode },
  websocketUrl: "wss://<your-worker-domain>/ws?teamCode=7TCJEM"
}
```

### 2. Connection Establishment
Each player's device:
1. Receives the `websocketUrl` from registration response
2. Stores it in sessionStorage
3. Creates a WebSocket connection: `new WebSocket(websocketUrl)`
4. Sends a join message after connection opens

### 3. Session Join
After the WebSocket connection opens, each client sends:
```json
{
  "type": "join",
  "sessionId": "7TCJEM",
  "playerName": "Player Name"
}
```

The server associates the connection with the team room keyed by `teamCode`.

### 4. Multi-Player Scenario
For a team of 3 players:
- Player A → joins team `7TCJEM`
- Player B → joins team `7TCJEM`
- Player C → joins team `7TCJEM`

When Player A completes a puzzle:
- The backend processes the event and generates deltas (state changes)
- The backend broadcasts deltas to all connections in the team room
- All 3 phones receive the update simultaneously

## Client-Side Implementation

**Status**: ✅ Implemented (commit e264ff0)

The client listens for `runtime_delta` messages and dispatches a browser event:

```typescript
// In useTeamWebSocket.ts
if (type === 'runtime_delta') {
  if (typeof window !== 'undefined') {
    const event = new CustomEvent('quest_runtime_deltas', { detail: msg.deltas });
    window.dispatchEvent(event);
  }
  return;
}
```

The `useQuestRuntime` hook subscribes to this event and triggers a refresh:

```typescript
// In useQuestRuntime.ts
useEffect(() => {
  if (typeof window === 'undefined') return;
  const handler = () => void refresh();
  window.addEventListener('quest_runtime_deltas', handler);
  return () => {
    window.removeEventListener('quest_runtime_deltas', handler);
  };
}, [refresh]);
```

## Server-Side Broadcasting (Team Backend)

**Status**: ✅ Implemented (team Worker + Durable Object)

### Message Types (selected)

- `runtime_delta`: runtime state changes that should trigger `useQuestRuntime()` to refresh
- `score_update`: points/score updates for team UI
- `player_state_update`: throttled position/state updates
- `puzzle_interaction`: ephemeral “micro-events” for puzzle UI effects (ghost clicks, etc.)

### Debugging

To log WebSocket send/recv from the client:
- Add `?wsDebug=1` to the URL, or set `localStorage.quest_ws_debug = "1"`
- Look for `[useTeamWebSocket] send` and `[useTeamWebSocket] recv` logs

### Message Format

When a runtime event occurs (e.g., player completes node, arrives at object, submits puzzle), the server should broadcast to all connected clients in the same session:

```json
{
  "type": "runtime_delta",
  "sessionId": "session-abc123",
  "deltas": [
    {
      "type": "NODE_COMPLETED",
      "playerId": "player-xyz",
      "nodeId": "tl_object1__audio_intro",
      "timestamp": "2025-12-30T12:34:56.789Z"
    },
    {
      "type": "OBJECT_ARRIVED",
      "playerId": "player-xyz",
      "objectId": "object2",
      "timestamp": "2025-12-30T12:35:01.123Z"
    }
  ]
}
```

### Player Position Sync (High Frequency)

Apart from "Runtime Deltas" (which track game state), the WebSocket also handles real-time player position updates (`player_state_update`).

**Optimization (Team Travel Mode):**
To optimize bandwidth and battery, the frequency of these updates is controlled by the Quest's `teamTravelMode`:
*   **Co-Located (Default)**: Position updates are **disabled**. The server does NOT receive continuous GPS streams.
*   **Independent**: Position updates are **throttled** (e.g., once every 5-10s).

*Note: Critical events like `OBJECT_ARRIVED` are always sent immediately as Runtime Deltas, regardless of this setting.*

### Delta Types

The `deltas` array contains runtime state changes. Common delta types include:

- `PLAYER_JOINED` - New player joined session
- `PLAYER_LEFT` - Player left session
- `OBJECT_AVAILABLE` - Object became visible (sliding window)
- `OBJECT_ARRIVED` - Player arrived at object
- `OBJECT_COMPLETED` - Player completed object
- `NODE_UNLOCKED` - Timeline node became unlocked
- `NODE_COMPLETED` - Timeline node completed
- `PUZZLE_SUBMITTED` - Puzzle attempt submitted
- `ACTION_ATTEMPTED` - Action attempt started
- `ACTION_SUCCESS` - Action succeeded
- `ACTION_FAIL` - Action failed
- `CONSENSUS_UPDATED` - Session-scope gate progress changed (e.g., "2/4 players succeeded")

### Implementation Notes

1. **Team rooms**: Each WebSocket client joins a room keyed by `teamCode`
2. **Broadcasting**: When the runtime engine processes an event, it returns `{ snapshot, deltas }`
   - The HTTP response includes both for the requesting client
   - The deltas should be broadcast to all other clients in the session room
3. **Deduplication**: Clients may receive deltas via both HTTP response and WebSocket broadcast
   - The `useQuestRuntime` hook handles this by triggering a single `refresh()` call
4. **Reconnection**: On reconnect, clients fetch the full snapshot via `GET /api/runtime/session/{sessionId}`

## Testing

To verify the WebSocket integration works:

1. Open two browser tabs with the same `teamCode`
2. In tab 1, complete a timeline node or arrive at an object
3. Verify tab 2's `useQuestRuntime` hook refreshes automatically (check Network tab for `GET /api/runtime/session/...` calls)

Once server-side broadcasting is implemented, tab 2 should refresh immediately without polling delay.
