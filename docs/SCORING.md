# Scoring & Voting Visualization

The Quest App displays scoring metrics on the map board (`GameStatusPanel`), showing player/team progress as "votes for" vs "votes against".

**Last Updated:** 2026-01-02
**Implementation Status:** ✅ Solo mode scoring bug fixed, object completion scoring fixed (2026-01-02), sliding window visibility implemented

---

## How Scoring Works

### Points System

- **Object Points**: Each quest object has a `points` value (configured in Quest Platform)
- **Award Trigger**: Points are awarded when the object's `__end` node is reached
- **Total Available**: Sum of all object points in the quest

### Object Completion and Point Distribution

Points are automatically awarded when a player completes an object's timeline:

1. **Timeline Execution**: Player progresses through timeline items (audio → text → puzzle → video → etc.)
2. **All Items Complete**: When all timeline items finish, the frontend explicitly completes the `__end` node
3. **Server Detection**: Lambda runtime engine's `auto_advance_state_nodes` detects the end node completion
4. **Point Calculation**: Server retrieves object's configured points and divides among active players
5. **Score Update**: Each active player's score increases
6. **Delta Emission**: Server emits `ScoreUpdatedDelta` events
7. **UI Update**: "Votes For" metric updates in real-time on the GameStatusPanel

**Implementation**: See [useObjectTimeline.ts:695-705](../src/components/object-timeline/useObjectTimeline.ts#L695-L705) and [runtime_engine.py:429-464](https://github.com/user/quest-platform/blob/dev/backend/src/tools/quest-runtime-api/runtime_engine.py#L429-L464)

**Debugging**:
- If points don't appear after object completion, check browser console for `[useObjectTimeline] __end node completed successfully`
- Check Lambda CloudWatch logs for `[AUTO_ADVANCE] Object {id} has {points} points configured`
- Verify the object has a `points` value > 0 in Quest Platform dashboard
- Inspect runtime snapshot: `window.runtime.snapshot.players[playerId].score` should show updated value

### Solo Mode Scoring

- Player earns points individually
- Score tracked in `PlayerState.score` (or `QuestSessionState.score` for legacy)
- Progress synced with server every 30 seconds
- Displayed as **"Favore"** (votes for) in GameStatusPanel

### Team Mode Scoring

- Each team member earns points individually
- Team score = sum of all member scores
- Real-time sync via WebSocket
- Displayed as team's **"Favore"** progress

---

## Voting Visualization

The **GameStatusPanel** (metrics board) shows:

- **Favore (Green Bar)**: Points earned by player or team
- **Contrari (Red Bar)**: Remaining points to earn
- **Total (Center)**: Sum of all available points

### Calculation Formula

```typescript
// Solo Mode (FIXED 2025-12-27)
votesFor = questProgress.score         // Actual points earned from useQuestProgress
votesAgainst = totalPoints - votesFor  // Remaining points

// Team Mode
votesFor = teamSync.team.members.reduce((sum, m) => sum + m.totalPoints, 0)
votesAgainst = totalPoints - votesFor  // Remaining points

// Implementation in QuestMap.tsx (lines 332-351)
const currentScore = useMemo(() => {
  // Team mode: sum all team members' totalPoints
  if (teamSync.team?.members && teamSync.team.members.length > 0) {
    return teamSync.team.members.reduce((sum, member) => {
      return sum + (member.totalPoints || 0);
    }, 0);
  }

  // Solo mode: Check session storage for actual score data
  const sessionId = sessionStorage.getItem('quest_sessionId');
  if (sessionId && teamSync.team?.members) {
    const soloMember = teamSync.team.members.find(m => m.sessionId === sessionId);
    if (soloMember?.totalPoints !== undefined) {
      return soloMember.totalPoints;
    }
  }

  // Fallback: legacy static value (deprecated)
  return data?.quest?.votesFor || 0;
}, [teamSync.team?.members, data?.quest?.votesFor]);
```

### Visual Representation

```
┌─────────────────────────────────────────┐
│           METRICHE (Metrics)            │
├─────────────────────────────────────────┤
│ ███████████░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ ← Progress bar
│ Red (against) ←  → Green (for)          │
├─────────────────────────────────────────┤
│  Contrari    Total Points    Favore     │
│    120            200          80        │
└─────────────────────────────────────────┘
```

---

## Object Visibility (Sliding Window)

**Status:** ✅ IMPLEMENTED (2025-12-27)

To create suspense and prevent route spoilers, only **2 objects** are visible at any time:

1. **Current Object**: Next object to complete (highest completed + 1)
2. **Previous Object**: Just completed object (highest completed)

### Implementation Details

**File:** `src/components/QuestMap.tsx` (lines 285-329)

The visibility filter works as follows:
1. Sort objects by itinerary number
2. Find highest completed number from `questProgress.completedObjects`
3. Show objects that match these criteria:
   - Is the start object (`isStartObject(obj)`)
   - Is the previous completed (number === highestCompleted AND is completed)
   - Is the current object (number === highestCompleted + 1)

### Visibility Rules

- At quest start: Only object #1 visible
- After completing object N:
  - Object N stays visible (as "previous")
  - Object N+1 becomes visible (as "current")
  - Object N-1 becomes hidden
- Quest end: Only final object visible

### Sequential Completion

**Status:** ✅ ENFORCED (2025-12-27)

Objects **must** be completed in order:
- Sequential validation active in all PlayerState-based quests
- Server-side enforcement in `/api/quest/complete-object` endpoint
- Attempting to complete object N before object N-1 returns error
- Enforces intended quest narrative flow
- Implemented in `quest-state.ts` via `completeObject()` function

---

## Configuration

### In Quest Platform Dashboard

1. **Go to Objects tab**
2. **Select your Quest** from the dropdown
3. **Edit object points**:
   - Click on an object tile
   - Set **"Points"** field (non-negative integer)
   - Default: 0 points
4. **Edit initial votes** (optional, legacy):
   - Edit **"For"** input in header (static display value)
   - Modern quests use dynamic scoring instead

### Object Configuration Fields

```python
# In quest-platform backend
{
  "number": 1,              # Itinerary sequence (required for sliding window)
  "points": 50,             # Points awarded on completion
  "triggerRadius": 30,      # GPS arrival detection radius (meters)
  "isVisible": false,       # Design-time visibility (runtime overrides)
  "isStart": true,          # Starting object (auto-visible)
  "isMain": true            # Main route vs optional side quest
}
```

---

## Implementation Details

### Data Source

All scoring data comes from the deployed `quest.json`:

```typescript
// Calculate total points available
const totalPointsAvailable = useMemo(() => {
  if (!data?.objects) return 0;
  return data.objects.reduce((sum, obj) => sum + (obj.points || 0), 0);
}, [data]);

// Calculate current player/team score
const currentScore = useMemo(() => {
  // Team mode: sum all team members' points
  if (teamSync.team?.members) {
    return teamSync.team.members.reduce((sum, member) => {
      return sum + (member.totalPoints || 0);
    }, 0);
  }

  // Solo mode: use quest progress score
  if (questProgress?.score) {
    return questProgress.score;
  }

  // Fallback: legacy static value
  return data?.quest?.votesFor || 0;
}, [teamSync.team?.members, questProgress, data?.quest?.votesFor]);

// Voting display values
const votesFor = currentScore;
const votesAgainst = Math.max(0, totalPointsAvailable - votesFor);
```

---

## See Also

- [Implementation Plan](IMPLEMENTATION_PLAN_QUEST_STATE.md) - Full technical design
- [Quest State Module](../src/lib/quest-state.ts) - State management code
- [Quest Platform Docs](../../quest-platform/docs/user-guide/scoring.md) - Platform configuration
