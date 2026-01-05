# Object Completion - Migration Guide

## Overview

Objects in the quest runtime are **automatically completed** when their timeline reaches the `__end` state node. There is no need to manually call a "complete object" endpoint.

## How It Works

### Automatic Completion Flow

1. **Timeline Execution**: Players complete timeline nodes (media, puzzle, action, etc.)
2. **Node Completion**: Each completed node unlocks its outgoing nodes
3. **Auto-Advance**: When a state node (`__start` or `__end`) is unlocked, `autoAdvanceStateNodes` runs automatically
4. **Object Complete**: When the `__end` node completes, the object is marked as complete with `OBJECT_COMPLETED` delta

### Code Flow (TypeScript Engine)

```typescript
// engine.ts - autoAdvanceStateNodes function
if (node.stateKind === 'end') {
  const objState = getObjectState(session, playerId, node.objectId);
  if (!objState.completedAt) {
    objState.completedAt = nowIso();
    deltas.push({ type: 'OBJECT_COMPLETED', playerId, objectId: node.objectId });
  }
}
```

## Migration Path

### ❌ Old Way (Deprecated)

```typescript
// Using useQuestProgress
const { completeObject } = useQuestProgress(sessionId);

// Manually calling complete after last puzzle
await completeObject(objectId, points);
```

### ✅ New Way (Automatic)

```typescript
// Using useQuestRuntime
const runtime = useQuestRuntime({ teamCode, questId, playerId });

// Just complete the timeline nodes normally
// When the last node completes, it unlocks __end which auto-completes the object
await runtime.completeNode({
  nodeId: lastNodeId,
  eventId: `complete:${Date.now()}`,
  dedupeKey: `complete:${playerId}:${lastNodeId}`
});

// Object completion happens automatically via runtime engine
// Listen for OBJECT_COMPLETED delta via runtime.deltas or WebSocket
```

## Timeline Structure Example

For an object `temple`:

```
tl_temple__start (state:start) [auto-completes on OBJECT_ARRIVE]
    ↓
tl_temple_intro (text)
    ↓
tl_temple_video (video)
    ↓
tl_temple_puzzle (puzzle) [branches on success/fail]
    ↓ (success)
tl_temple__end (state:end) [auto-completes → triggers OBJECT_COMPLETED]
```

## Compatibility Shim

The `/api/quest/complete-object` endpoint still exists for backward compatibility but is **deprecated**:

```typescript
// src/app/api/quest/complete-object/route.ts
/**
 * @deprecated This endpoint is a compatibility shim
 * Objects should complete automatically when __end node is reached
 */
export async function POST(request: NextRequest) {
  console.warn('[DEPRECATED] /api/quest/complete-object called');
  // ... forces completion of __end node
}
```

This endpoint will be removed once all code migrates to `useQuestRuntime`.

## Benefits of Automatic Completion

1. **Deterministic**: Object completion is a natural consequence of timeline execution
2. **No Race Conditions**: Completion is part of the atomic event application
3. **Realtime**: `OBJECT_COMPLETED` delta broadcasts immediately to all players via WebSocket
4. **Simpler Code**: No manual "complete object" calls needed
5. **Consistent State**: Timeline and object state stay in sync

## Verification

To verify object completion is working:

1. Watch the `runtime.completedObjects` array from `useQuestRuntime`
2. Listen for `OBJECT_COMPLETED` delta in `runtime.deltas`
3. Check object state via `runtime.snapshot.objects[objectId].completedAt`

```typescript
// Example: Watch for object completion
useEffect(() => {
  const latestDelta = runtime.deltas[runtime.deltas.length - 1];
  if (latestDelta?.type === 'OBJECT_COMPLETED') {
    console.log('Object completed:', latestDelta.objectId);
    // Show celebration UI, unlock next object, etc.
  }
}, [runtime.deltas]);
```

## FAQ

**Q: Do I need to call anything to complete an object?**
A: No. Just complete the timeline nodes normally. The `__end` node will auto-complete when unlocked.

**Q: What if my last node is a puzzle?**
A: When the puzzle succeeds, it unlocks `__end` (via `successOutNodeIds`), which auto-completes immediately.

**Q: Can I manually force object completion?**
A: You can, but it's discouraged. If needed, complete the `__end` node directly via `runtime.completeNode(endNodeId)`.

**Q: How do I know when an object completes?**
A: Listen for `OBJECT_COMPLETED` delta or check `runtime.completedObjects` array or `snapshot.objects[id].completedAt`.

**Q: Does this work in multiplayer?**
A: Yes! Each player has their own object state. Completion is per-player unless using session-scope gates.
