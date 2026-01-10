# AI-Driven Individual & Broadcast Messaging System

## Overview

The AI Messaging System enables intelligent, context-aware communication with players during quest gameplay. The system can send:
- **Individual messages**: Personalized messages to specific players based on their progress
- **Broadcast messages**: Synchronous messages to all team members for collaborative moments

Messages are delivered in real-time via WebSocket with full delivery and read tracking, ensuring no message is lost even if players are temporarily offline.

## Architecture

```
┌─────────────────┐
│   Game Event    │
│ (Node Complete, │
│ Object Arrive,  │
│ Puzzle Submit)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ Quest Runtime API       │
│ (lambda_handler.py)     │
│ - Publishes to          │
│   EventBridge           │
│ - Deterministic         │
│   event IDs             │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ EventBridge             │
│ - Routes game events    │
│ - Scheduled checks      │
│   (every 5 minutes)     │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ AI Message Orchestrator │
│ (lambda_handler.py)     │
│ - Analyzes game state   │
│ - Decides if message    │
│   should be sent        │
│ - Enforces cooldown     │
│ - Generates content     │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ DynamoDB                │
│ quest-chat-history-v2   │
│ - Fan-out storage       │
│ - One item per player   │
│ - Deterministic keys    │
│ - 48-hour TTL           │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ WebSocket API           │
│ - Real-time delivery    │
│ - Includes SK in payload│
│ - Handles stale conns   │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Frontend                │
│ - useTeamWebSocket hook │
│ - AIMessageNotification │
│ - Acknowledgment        │
│   (delivered/read)      │
└─────────────────────────┘
```

## Key Design Principles

### 1. Fan-Out on Write for Broadcasts

**Problem**: Storing `deliveredTo` Set in a single DynamoDB item hits 400KB limit with large teams.

**Solution**: Create one DynamoDB item per recipient player, even for broadcasts.

**Benefits**:
- Scales to 100+ player teams
- Simple per-player status tracking
- Efficient per-player inbox queries

### 2. Deterministic Keys for Idempotency

**SK Format**: `ai-msg#{playerId}#{dedupeKey}`

Where `dedupeKey` is a hash of game event properties: `sessionId|eventType|playerId|nodeId|objectId`

**Benefits**:
- Retries overwrite the same item (natural idempotency)
- No need for ConditionExpression (batch_writer compatible)
- 100% deduplication even with EventBridge retry storms

### 3. Efficient Player Inbox via GSI

**GSI Pattern**:
- `PK = sessionId#playerId`
- `SK = createdAt`

**Benefits**:
- O(log n) queries for undelivered messages
- O(1) cooldown checks (newest message query)
- No full-session scans required

### 4. Dual-Item Connection Tracking

**Problem**: Querying connections with FilterExpression scans all connections in session.

**Solution**: Store two DynamoDB items per connection:
- Item 1: `PK=sessionId#playerId, SK=conn#{connectionId}` - For player → connections query
- Item 2: `PK=sessionId, SK=conn#{connectionId}` - For connection → player lookup

**Benefits**:
- O(1) lookups in both directions
- Supports multiple devices per player
- TTL auto-cleanup (24 hours)

### 5. Security: Derive playerId from connectionId

**Problem**: Malicious clients can spoof playerId in acknowledgment messages.

**Solution**: Backend queries playerId from connectionId, ignores client payload.

**Implementation**:
```python
# SECURITY: Derive playerId from connectionId, not from payload
player_id = get_player_id_from_connection(session_id, connection_id)

if not player_id:
    return {"statusCode": 403, "body": json.dumps({"error": "Unauthorized"})}

# SECURITY: Validate that SK belongs to this player
if not sk.startswith(f"ai-msg#{player_id}#"):
    return {"statusCode": 403, "body": json.dumps({"error": "SK does not belong to this player"})}
```

### 6. Include SK in WebSocket Payload for O(1) Updates

**Problem**: Acknowledgment handlers would need to query with FilterExpression to find message item.

**Solution**: Server includes `sk` in WebSocket message, client echoes it back in acknowledgment.

**Benefits**:
- Direct PK/SK update (O(1), no query needed)
- Efficient acknowledgment processing

## Data Model

### DynamoDB Table: `quest-chat-history-v2-{env}`

**Per-Player Message Item Schema**:
```typescript
{
  // Base table keys (DETERMINISTIC for idempotency)
  sessionId: "session-123",                                   // PK
  sk: "ai-msg#player-456#NodeComplete-7f8a9b2c",             // SK (deterministic)

  // GSI for player inbox
  GSI1PK: "session-123#player-456",                          // sessionId#playerId
  GSI1SK: "2026-01-09T10:30:00.000Z",                        // createdAt

  // Message identity
  messageId: "msg-uuid",                    // Shared across fanout copies
  messageType: "individual" | "broadcast",
  targetPlayerId: "player-456",
  senderId: "ai",
  role: "assistant",
  content: "Message text",

  // Delivery tracking (per player)
  delivered: false,
  // deliveredAt: "..." (added when delivered)
  read: false,
  // readAt: "..." (added when read)

  // Trigger context
  triggerEvent: {
    eventType: "NodeComplete",
    eventId: "NodeComplete-7f8a9b2c",
    playerId: "player-456",
    objectId: "obj-1",
    nodeId: "node-3"
  },

  // Metadata
  createdAt: "2026-01-09T10:30:00.000Z",
  expiresAt: 1736421000                     // TTL (48 hours)
}
```

**GSI Definition**:
- **Name**: `GSI1-PlayerInbox`
- **PK**: `GSI1PK` (String) = `{sessionId}#{playerId}`
- **SK**: `GSI1SK` (String) = `{createdAt}` (ISO timestamp)
- **Projection**: ALL

### Access Patterns

1. **Fetch undelivered messages for player**
   ```python
   response = chat_table.query(
       IndexName="GSI1-PlayerInbox",
       KeyConditionExpression=Key("GSI1PK").eq(f"{session_id}#{player_id}"),
       FilterExpression=Attr("delivered").eq(False),
       ScanIndexForward=True  # Oldest first
   )
   ```
   - **Complexity**: O(log n)
   - **Use case**: Reconnection catch-up

2. **Check last message time for cooldown**
   ```python
   response = chat_table.query(
       IndexName="GSI1-PlayerInbox",
       KeyConditionExpression=Key("GSI1PK").eq(f"{session_id}#{player_id}"),
       ScanIndexForward=False,  # Newest first
       Limit=1,
       ProjectionExpression="createdAt"
   )
   ```
   - **Complexity**: O(1)
   - **Use case**: Cooldown enforcement

3. **Update delivery status**
   ```python
   chat_table.update_item(
       Key={"sessionId": session_id, "sk": sk},
       UpdateExpression="SET delivered = :true, deliveredAt = :timestamp",
       ExpressionAttributeValues={":true": True, ":timestamp": timestamp},
       ConditionExpression="attribute_exists(sessionId)"
   )
   ```
   - **Complexity**: O(1)
   - **Use case**: Delivery acknowledgment

## Backend Components

### 1. Quest Runtime API

**File**: `quest-platform/backend/src/tools/quest-runtime-api/lambda_handler.py`

**New Functionality**:

#### Deterministic Event ID Generation
```python
def generate_deterministic_event_id(session_id: str, event_type: str, details: Dict) -> str:
    """Generate stable event ID from game event properties."""
    components = [
        session_id,
        event_type,
        details.get("playerId", ""),
        details.get("nodeId", ""),
        details.get("objectId", ""),
        details.get("puzzleId", ""),
    ]
    stable_string = "|".join(str(c) for c in components if c)
    event_id = hashlib.sha256(stable_string.encode()).hexdigest()[:16]
    return f"{event_type}-{event_id}"
```

#### EventBridge Publishing
Game events are published to EventBridge after state changes:
- **NodeComplete**: After completing timeline node
- **ObjectArrive**: After player arrives at object
- **PuzzleSubmit**: After puzzle submission

#### New API Endpoint
**GET /runtime/messages/undelivered**

Query parameters:
- `sessionId` (required)
- `playerId` (required)

Response:
```json
{
  "success": true,
  "messages": [
    {
      "messageId": "msg-uuid",
      "messageType": "individual",
      "content": "Great job!",
      "timestamp": "2026-01-09T10:30:00.000Z",
      "sk": "ai-msg#player-456#NodeComplete-7f8a9b2c",
      "sessionId": "session-123"
    }
  ]
}
```

### 2. WebSocket Handler

**File**: `quest-platform/backend/src/tools/quest-runtime-api/websocket_handler.py`

**New Message Types**:

#### join_session (Enhanced)
Now requires `playerId` for connection tracking:
```json
{
  "type": "join_session",
  "sessionId": "session-123",
  "playerId": "player-456"
}
```

#### ai_message_delivered
Client acknowledges message delivery:
```json
{
  "type": "ai_message_delivered",
  "sessionId": "session-123",
  "sk": "ai-msg#player-456#NodeComplete-7f8a9b2c",
  "timestamp": "2026-01-09T10:30:00Z"
}
```

**Security**: Backend validates that `sk` belongs to the player associated with this connection.

#### ai_message_read
Client marks message as read:
```json
{
  "type": "ai_message_read",
  "sessionId": "session-123",
  "sk": "ai-msg#player-456#NodeComplete-7f8a9b2c",
  "timestamp": "2026-01-09T10:30:00Z"
}
```

**Connection Tracking Functions**:
- `store_connection()`: Dual-item storage for O(1) lookups
- `get_player_id_from_connection()`: O(1) GetItem
- `get_connection_ids_for_player()`: O(1) Query
- `remove_connection()`: Delete both items

### 3. AI Message Orchestrator

**File**: `quest-platform/backend/src/tools/ai-message-orchestrator/lambda_handler.py`

**Main Functions**:

#### `lambda_handler()`
Processes EventBridge events and scheduled checks.

#### `get_system_prompt()`
Retrieves system prompt from S3 bucket for consistent AI character behavior.

**Implementation**:
- Fetches from `s3://{QUESTS_BUCKET}/{AGENT_PROMPT_S3_KEY}`
- Supports Python files (executes and extracts `system_prompt` variable) or plain text
- Caches result for subsequent invocations
- Raises RuntimeError if S3 fetch fails or configuration is missing

**Configuration**:
- `AGENT_PROMPT_S3_KEY`: Path to agent prompt file (default: `config/agent_prompt.py`)
- `QUESTS_BUCKET`: S3 bucket name

#### `openai_generate_message()`
Generates contextual AI messages using OpenAI Chat Completions API.

**Parameters**:
- `system_prompt`: Character definition and role instructions
- `user_context`: Game event context (node completion, object arrival, etc.)
- `api_key`: OpenAI API key from SSM Parameter Store

**Configuration**:
- `CHAT_MANAGER_MODEL`: OpenAI model to use (default: `gpt-5.2-2025-12-11`)
- `max_tokens`: 150
- `temperature`: 0.7

#### `ai_decide_message_action()`
Analyzes game state to determine if message should be sent.

**Current Implementation**: OpenAI-powered contextual message generation
- **NodeComplete**: Generates encouraging message acknowledging player progress
- **ObjectArrive**: Creates contextual message enhancing immersive experience
- **PuzzleSubmit**:
  - Correct answer: Congratulatory message
  - Incorrect answer: Encouraging message to keep trying
- **Periodic checks**: Skipped to avoid spam

**Fallback Strategy**: If OpenAI API fails, uses simple hardcoded messages to ensure reliability

#### `store_ai_messages_fanout()`
Creates one DynamoDB item per recipient player with deterministic keys.

**Idempotency**: Retries overwrite same item (no ConditionExpression needed).

#### `should_send_message()`
Enforces 5-minute cooldown via O(1) GSI query.

#### `send_ai_message_via_websocket()`
Sends messages to connected players via API Gateway Management API.

**Flow**:
1. Get connection IDs for each target player
2. Post message to each connection
3. Include `sk` in payload for efficient acknowledgment
4. Handle stale connections (410 Gone)

## Frontend Components

### 1. WebSocket Hook (TODO)

**File**: `quest-app-template/src/lib/useTeamWebSocket.ts`

**New Message Handler**:
```typescript
if (type === 'ai_message') {
  const { messageId, messageType, content, timestamp, sk, sessionId } = msg;

  // Store locally with SK for later acknowledgment
  setAiMessages(prev => [...prev, {
    messageId,
    messageType,
    content,
    timestamp,
    sk,  // CRITICAL: Store SK for direct update
    sessionId,
    delivered: false,
    read: false
  }]);

  // Immediately acknowledge delivery using SK
  sendRaw({
    type: 'ai_message_delivered',
    sessionId,
    sk,  // CRITICAL: Use SK for O(1) update
    timestamp: new Date().toISOString()
  });

  // Trigger callback
  optionsRef.current.onAiMessage?.(messageId, messageType, content, timestamp, sk);
}
```

**Enhanced Join Message**:
```typescript
sendRaw({
  type: 'join_session',
  sessionId: session.sessionId,
  playerId: session.playerId  // CRITICAL: Required for connection tracking
});
```

**Reconnect Logic**:
```typescript
useEffect(() => {
  if (connectionStatus === 'connected' && session) {
    // Fetch undelivered messages on reconnect
    fetch(`${apiUrl}/runtime/messages/undelivered?sessionId=${session.sessionId}&playerId=${session.playerId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.messages) {
          data.messages.forEach((msg: any) => {
            // Display message
            optionsRef.current.onAiMessage?.(msg.messageId, msg.messageType, msg.content, msg.createdAt, msg.sk);

            // Acknowledge delivery
            sendRaw({
              type: 'ai_message_delivered',
              sessionId: msg.sessionId,
              sk: msg.sk,
              timestamp: new Date().toISOString()
            });
          });
        }
      })
      .catch(err => console.error('Error fetching undelivered messages:', err));
  }
}, [connectionStatus, session, apiUrl]);
```

### 2. AI Message Notification Component (TODO)

**File**: `quest-app-template/src/components/AIMessageNotification.tsx`

**Features**:
- Positioned top-right
- Different styling for broadcast vs individual
- User-triggered read tracking (not auto-timer)
- Dismiss button
- Slide-in animations
- IntersectionObserver for visibility tracking

**Read Tracking Logic**:
Mark as read when:
- User clicks "Got it" button, OR
- User expands/interacts with notification, OR
- Notification has been visible for 10+ seconds (passive read)

**Props**:
```typescript
interface AIMessageNotificationProps {
  messageId: string;
  messageType: 'individual' | 'broadcast';
  content: string;
  timestamp: string;
  sk: string;
  sessionId: string;
  onDismiss: (messageId: string) => void;
  onRead: (sk: string, sessionId: string) => void;
}
```

## Message Flow Examples

### Example 1: Individual Message (Player Online)

1. **Game Event**: Player completes puzzle node
2. **Runtime API**: Publishes `NodeComplete` event to EventBridge with deterministic event ID
3. **EventBridge**: Routes event to AI Message Orchestrator
4. **AI Orchestrator**:
   - Checks cooldown (last message > 5 minutes ago)
   - Fetches system prompt from S3 (cached)
   - Calls OpenAI API with context: "Player completed node X"
   - Generates contextual content: "Great job completing that challenge!"
   - Stores item with `sk = ai-msg#player-456#NodeComplete-7f8a9b2c`
5. **WebSocket**: Sends message to player's connection(s)
   ```json
   {
     "type": "ai_message",
     "messageId": "msg-uuid",
     "messageType": "individual",
     "content": "Great job completing that challenge!",
     "timestamp": "2026-01-09T10:30:00.000Z",
     "sk": "ai-msg#player-456#NodeComplete-7f8a9b2c",
     "sessionId": "session-123"
   }
   ```
6. **Frontend**:
   - Displays notification
   - Immediately sends `ai_message_delivered` with `sk`
7. **Backend**: Updates `delivered = true` using PK/SK (O(1) update)
8. **Frontend** (after user interaction): Sends `ai_message_read` with `sk`
9. **Backend**: Updates `read = true` using PK/SK (O(1) update)

### Example 2: Broadcast Message (Multiple Players)

1. **Game Event**: All players reach milestone location
2. **AI Orchestrator**:
   - Decides to broadcast to all active players
   - Gets list: ["player-1", "player-2", "player-3"]
   - Fan-out: Creates 3 DynamoDB items (one per player)
     - `ai-msg#player-1#Milestone-abc123`
     - `ai-msg#player-2#Milestone-abc123`
     - `ai-msg#player-3#Milestone-abc123`
3. **WebSocket**: Sends to all player connections
4. **Frontend**: Each player acknowledges independently
5. **Backend**: Updates delivery/read status per player

### Example 3: Message During Offline (Catch-Up)

1. **Game Event**: Player completes node while offline
2. **AI Orchestrator**: Stores message in DynamoDB (delivered = false)
3. **Player Reconnects**:
   - WebSocket connects
   - Sends `join_session` with `playerId`
   - Frontend fetches `GET /runtime/messages/undelivered`
4. **Backend**: Returns undelivered messages via GSI query
5. **Frontend**: Displays messages, acknowledges delivery
6. **Backend**: Updates delivery status

## Configuration

### Environment Variables

**Quest Runtime API**:
```bash
DYNAMODB_TABLE_RUNTIME_SESSIONS=quest-runtime-sessions-{env}
CHAT_HISTORY_TABLE=quest-chat-history-v2-{env}
S3_BUCKET_QUESTS=quest-platform-quests-{env}-{region}
WEBSOCKET_API_ENDPOINT=wss://{api-id}.execute-api.{region}.amazonaws.com/{env}
```

**AI Message Orchestrator**:
```bash
CHAT_HISTORY_TABLE=quest-chat-history-v2-{env}
RUNTIME_SESSIONS_TABLE=quest-runtime-sessions-{env}
QUESTS_BUCKET=quest-platform-quests-{env}-{region}
WEBSOCKET_API_ENDPOINT=https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
MESSAGE_COOLDOWN_SECONDS=300
AGENT_PROMPT_S3_KEY=config/agent_prompt.py
CHAT_MANAGER_MODEL=gpt-5.2-2025-12-11
```

**Note**: WebSocket endpoint uses `wss://` for client connections but `https://` for API Gateway Management API.

### CDK Infrastructure

**EventBridge Rules**:
1. **Game Events**: Routes NodeComplete, ObjectArrive, PuzzleSubmit to AI Orchestrator
2. **Scheduled Checks**: Triggers AI Orchestrator every 5 minutes

**IAM Permissions**:
- Runtime API: `events:PutEvents` (EventBridge publishing)
- AI Orchestrator:
  - `dynamodb:Query/GetItem/PutItem/BatchWriteItem` (chat history and runtime sessions)
  - `s3:GetObject` (system prompt from quests bucket)
  - `ssm:GetParameter` (OpenAI API key)
  - `execute-api:ManageConnections` (WebSocket messaging)
- WebSocket Handler: `dynamodb:Query/GetItem/PutItem/UpdateItem/DeleteItem`

**Lambda Configuration**:
- AI Orchestrator reads `AGENT_PROMPT_S3_KEY` from deployment config params
- System prompt file stored in S3 at `{QUESTS_BUCKET}/{AGENT_PROMPT_S3_KEY}`
- Same system prompt used for both model-chat-manager and AI orchestrator for consistency

## Error Handling

### Offline Players
- Messages stored in DynamoDB with 48-hour TTL
- On reconnect, frontend fetches via efficient GSI query
- Guaranteed catch-up delivery

### Message Cooldown
- Enforced via O(1) GSI query (newest message check)
- Prevents AI spam (5-minute minimum)

### Broadcast Synchronization
- Only broadcast when all active players meet condition
- "Active" defined as `status = "active"` in runtime session

### Race Conditions & Idempotency
- Deterministic dedupe keys ensure 100% deduplication
- EventBridge event IDs stable across retries
- DynamoDB writes naturally idempotent (same PK/SK)

### Stale Connections
- WebSocket catches 410 Gone errors
- Connections auto-expire via TTL (24 hours)

### Player Spoofing (Security)
- Backend validates playerId from connectionId
- Client-provided playerId in ack messages ignored
- SK validation ensures player owns message

### OpenAI API Failures
- Fallback to hardcoded messages if OpenAI API call fails
- Ensures messages are always sent even if AI generation fails
- Logs errors for monitoring and debugging

## Testing Strategy

### Unit Tests (TODO)
- AI decision logic
- Cooldown enforcement
- Message generation
- Deduplication

### Integration Tests (TODO)
- End-to-end WebSocket delivery
- Offline player catch-up
- Delivery/read acknowledgment
- Security validation

### Load Tests (TODO)
- 50 concurrent players across 10 sessions
- 100 rapid game events
- Verify no dropped/duplicate messages

## Metrics and Monitoring

### Real-Time Delivery (Online Players)
- `online_delivery_latency_p95`: <2 seconds
- `online_delivery_success_rate`: >99%

### Catch-Up Delivery (Offline → Online)
- `offline_catchup_latency_p95`: <5 seconds
- `offline_message_persistence`: 100%

### Message Quality
- `cooldown_compliance`: 100%
- `broadcast_fanout_accuracy`: 100%
- `deduplication_effectiveness`: 100%

### System Health
- `lambda_error_rate`: <0.5%
- `websocket_410_stale_rate`: <5%
- `dynamodb_throttling`: 0

## Development Status

### ✅ Phase 1: Backend Infrastructure (COMPLETE)
- [x] DynamoDB schema with GSI
- [x] EventBridge integration
- [x] AI Message Orchestrator Lambda
- [x] WebSocket handler extensions
- [x] Undelivered messages endpoint
- [x] CDK infrastructure
- [x] System prompt integration
- [x] OpenAI API integration
- [x] Context-aware message generation

### 🚧 Phase 2: Frontend Integration (IN PROGRESS)
- [ ] WebSocket hook updates
- [ ] AI message notification component
- [ ] Reconnect catch-up logic

### 📋 Phase 3: AI Enhancement (PLANNED)
- [ ] Advanced personalization (player history, learning style)
- [ ] Team dynamics analysis
- [ ] Adaptive timing with ML-based optimization

### 📋 Phase 4: Production Readiness (PLANNED)
- [ ] Unit tests
- [ ] Integration tests
- [ ] Load testing
- [ ] CloudWatch metrics and alarms

## Future Enhancements

1. **Advanced Personalization**: Player progress history, learning style adaptation
2. **Team Dynamics**: Analyze team collaboration patterns
3. **Adaptive Timing**: ML-based optimal message timing
4. **A/B Testing**: Message content optimization
5. **Multi-Language Support**: I18n for global audiences
6. **Rich Media**: Images, videos, audio in messages
7. **Prompt Engineering**: Fine-tuned system prompts per quest type

## Related Documentation

- [Quest Runtime](QUEST_RUNTIME.md)
- [WebSocket Runtime Deltas](WEBSOCKET_RUNTIME_DELTAS.md)
- [Backend API](backend-api.md)
- [AI Message Orchestrator README](../../../quest-platform/backend/src/tools/ai-message-orchestrator/README.md)
- [Quest Runtime API README](../../../quest-platform/backend/src/tools/quest-runtime-api/README.md)

## Notes

- All message items have 48-hour TTL (automatic cleanup)
- Deterministic keys ensure 100% deduplication across retries
- WebSocket endpoint format differs: `wss://` for clients, `https://` for Management API
- Security is enforced server-side (playerId validation from connectionId)
- Fan-out strategy scales to 100+ player teams without hitting DynamoDB item size limits
- System prompt integration ensures consistent AI character behavior across chat and messaging systems
- OpenAI API generates contextual messages with fallback to hardcoded messages for reliability
