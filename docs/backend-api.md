# Esino Lario Quest - Backend API

Backend API for the Esino Lario Quest app, handling player registration, team management, and game state.

## Architecture

\`\`\`
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│   Next.js App   │────▶│  Cloudflare Worker  │────▶│    DynamoDB     │
│   (Frontend)    │     │       API           │     │   (AWS)         │
└─────────────────┘     └─────────────────────┘     └─────────────────┘
\`\`\`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/api/sessions\` | POST | Create solo session |
| \`/api/sessions/:id\` | GET | Get session state |
| \`/api/teams\` | POST | Create team + get code |
| \`/api/teams/:code\` | GET | Get team state (debug / initial load) |
| \`/api/teams/:code/join\` | POST | Join existing team |

WebSocket:
- \`/ws?teamCode=GHIT-1926-XXXX\` (upgrade to WebSocket)

## Setup

### 1. DynamoDB Tables

First, create the DynamoDB tables in AWS:

\`\`\`bash
# Install dependencies
pip install boto3

# Configure AWS credentials
aws configure

# Run setup script
python setup_dynamodb.py
\`\`\`

This creates two tables:
- \`quest-sessions\` - Individual player sessions
- \`quest-teams\` - Team coordination

### 2. Cloudflare Worker

\`\`\`bash
# Install dependencies
npm install

# Set up secrets (don't commit these!)
wrangler secret put AWS_ACCESS_KEY_ID
wrangler secret put AWS_SECRET_ACCESS_KEY

# Local development
npm run dev

# Deploy to Cloudflare
npm run deploy
\`\`\`

### 3. Environment Variables

For the Next.js app, add to \`.env.local\`:

\`\`\`
NEXT_PUBLIC_QUEST_API_URL=https://esino-quest-api.<your-subdomain>.workers.dev
\`\`\`

For Cloudflare Pages deployments (recommended), set a server-side env var so the Next.js API routes can proxy to the worker:
\`\`\`
QUEST_API_URL=https://esino-quest-api.<your-subdomain>.workers.dev
\`\`\`

For local development:
\`\`\`
NEXT_PUBLIC_QUEST_API_URL=http://localhost:8787
\`\`\`

## Client Integration

Copy the client files to your Next.js app:

\`\`\`
client/
├── questApi.ts          → lib/questApi.ts
├── useQuestSession.ts   → lib/useQuestSession.ts
├── useTeamWebSocket.ts  → lib/useTeamWebSocket.ts
└── Registration.tsx     → components/Registration.tsx
\`\`\`

For real-time team sync, use \`src/lib/useTeamWebSocket.ts\` (auto-reconnect + ping/pong + presence).

### Usage Example

\`\`\`tsx
import { useQuestSession, useQuestTimer } from '../lib/useQuestSession';

function QuestPage() {
  const { session, team, loading } = useQuestSession();
  const { remaining, isExpired } = useQuestTimer(session);

  if (loading) return <div>Loading...</div>;
  if (!session) return <Registration />;
  if (isExpired) return <div>Time's up!</div>;

  return (
    <div>
      <h1>Welcome, {session.playerName}!</h1>
      {remaining && <p>Time remaining: {formatRemainingTime(remaining)}</p>}
      {/* Quest content */}
    </div>
  );
}
\`\`\`

## Data Flow

### Solo Player
\`\`\`
1. POST /api/sessions { playerName }
2. Returns session with startedAt & expiresAt (2 hours)
3. Player proceeds to quest
\`\`\`

### Team Play
\`\`\`
1. Leader: POST /api/teams { playerName }
   → Returns teamCode (e.g., "GHIT-1926-X7K")

2. Members: POST /api/teams/:code/join { playerName }
   → Returns sessionId + websocketUrl

3. Everyone connects to WebSocket and sends { type: 'join', sessionId, playerName }
   → Receives real-time member join/leave/presence updates
\`\`\`

## Game State Sync

For team puzzle completion:

\`\`\`javascript
// When a player completes a puzzle at a stop
POST /api/sessions/:id/complete-stop
{
  stopId: 'casa-della-stria',
  puzzleData: { ... }
}

// Team state tracks who completed each stop
{
  stopCompletions: {
    'casa-della-stria': ['session1', 'session2'],  // 2 of 3 done
    'fontana-della-fesa': ['session1']              // 1 of 3 done
  }
}

// When all members complete a stop, next stop is revealed
\`\`\`

## TTL & Cleanup

- Sessions auto-delete 4 hours after creation
- Teams auto-delete 4 hours after creation
- DynamoDB TTL handles cleanup automatically

## Security Notes

- AWS credentials are stored as Cloudflare secrets
- CORS allows all origins (restrict in production)
- No authentication yet (add if needed for admin features)

## Local Development

\`\`\`bash
# Terminal 1: Run the worker
npm run dev

# Terminal 2: Run Next.js app
cd ../your-nextjs-app
npm run dev
\`\`\`

Test with curl:
\`\`\`bash
# Create solo session
curl -X POST http://localhost:8787/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"playerName": "Marco"}'

# Create team
curl -X POST http://localhost:8787/api/teams \
  -H "Content-Type: application/json" \
  -d '{"playerName": "Sofia"}'

# Join team
curl -X POST http://localhost:8787/api/teams/GHIT-1926-ABC/join \
  -H "Content-Type: application/json" \
  -d '{"playerName": "Luca"}'
\`\`\`
