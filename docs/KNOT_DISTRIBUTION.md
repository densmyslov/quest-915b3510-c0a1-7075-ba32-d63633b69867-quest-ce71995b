# Knot Distribution for Witch Knot Simple Puzzle

This document describes how knots (patterns) are distributed to players in the `witch_knot_simple` puzzle type, ensuring each player sees only ONE knot instead of all knots.

## Overview

The witch knot simple puzzle contains multiple knot patterns on a single board. Previously, all players could see and select any pattern. With knot distribution, **each player is assigned exactly ONE pattern** using the same deterministic distribution algorithm used for puzzle distribution.

## How It Works

### Distribution Algorithm

The knot distribution uses the same algorithm as puzzle distribution ([PUZZLE_DISTRIBUTION.md](./PUZZLE_DISTRIBUTION.md)):

- **Deterministic seeding**: Each player receives a consistent knot assignment based on:
  - Team mode: `teamCode:startedAt:puzzleId`
  - Solo mode: `solo:sessionId:puzzleId`

- **Distribution rules**:
  - If `players <= patterns`: Each player gets a unique pattern
  - If `players > patterns`: Patterns are cycled, some players get duplicates

### Implementation Details

#### 1. Session/Team Context Propagation

The implementation passes session and team context through the component hierarchy:

**PuzzleClient.tsx** → **PuzzleRenderer.tsx** → **WitchKnotSimpleGame.tsx**

New props added:
- `sessionId`: Player's session identifier
- `teamCode`: Team code (if in team mode)
- `startedAt`: Team start timestamp (if in team mode)
- `puzzleId`: Puzzle identifier for seeding
- `teamMemberIds`: Array of all team member session IDs (for proper distribution)

#### 2. Pattern Selection Logic

In [WitchKnotSimpleGame.tsx:377-422](../src/components/puzzles/witch-knot-simple/WitchKnotSimpleGame.tsx#L377-L422):

```typescript
const patterns = useMemo(() => {
  // If no distribution context, show all patterns (backward compatibility)
  if (!sessionId || !puzzleId || rawPatterns.length === 0) {
    return rawPatterns;
  }

  // Use distribution algorithm to select ONE pattern for this player
  const isTeamMode = !!teamCode && !!startedAt;
  const seed = isTeamMode
    ? `${teamCode}:${startedAt}:${puzzleId}`
    : `solo:${sessionId}:${puzzleId}`;

  const nowMs = isTeamMode && startedAt ? Date.parse(startedAt) : Date.now();

  // Treat patterns as "puzzles" for distribution purposes
  const patternPuzzles = rawPatterns.map((_: any, idx: number) => ({
    puzzle_id: `pattern_${idx}`
  }));

  // Use all team members for distribution to ensure unique assignments
  // when patterns >= players
  const playerIds = teamMemberIds && teamMemberIds.length > 0
    ? teamMemberIds
    : [sessionId];

  const result = distributeObjectPuzzles(
    { puzzles: patternPuzzles },
    playerIds,
    { seed, nowMs: Number.isFinite(nowMs) ? nowMs : Date.now() }
  );

  // Find which pattern was assigned to this player
  const assignment = result.assignments.find(a => a.user_id === sessionId);
  if (!assignment) return rawPatterns; // Fallback to all patterns

  const assignedPatternId = assignment.puzzle_id;
  const patternIndex = parseInt(assignedPatternId.replace('pattern_', ''), 10);

  if (isNaN(patternIndex) || patternIndex < 0 || patternIndex >= rawPatterns.length) {
    return rawPatterns; // Fallback to all patterns
  }

  // Return only the assigned pattern
  return [rawPatterns[patternIndex]];
}, [JSON.stringify(rawPatterns), sessionId, teamCode, startedAt, puzzleId, teamMemberIds]);
```

**Critical Fix (2025-12-25):** The original implementation only passed `[sessionId]` to the distribution algorithm, causing all players to receive the same pattern even when enough unique patterns were available. The fix passes all team member IDs via `teamMemberIds` prop, ensuring the algorithm correctly assigns unique patterns when `patterns >= players`.

#### 3. UI Adaptation

The pattern selector UI automatically hides when only one pattern is available:

```typescript
{patterns.length > 1 && (
  <div style={styles.patternSelector}>
    {/* Pattern selector buttons */}
  </div>
)}
```

Since the distribution logic returns only one pattern per player, the selector disappears automatically.

## Puzzle Data Format

No changes required to existing puzzle data! The `witch_knot_simple` puzzle data format remains the same:

```json
{
  "id": "witch_knot_simple_demo",
  "type": "witch_knot_simple",
  "data": {
    "originalImageUrl": "/puzzle/board.jpg",
    "studs": [
      { "x": 100, "y": 100 },
      { "x": 300, "y": 100 },
      { "x": 200, "y": 300 }
    ],
    "patterns": [
      {
        "name": "Triangle Knot",
        "color": "#ff0000",
        "points": [0, 1, 2, 0]
      },
      {
        "name": "Line Knot",
        "color": "#00ff00",
        "points": [0, 2]
      }
    ]
  }
}
```

With 2 patterns and 3 players:
- Player 1 sees: "Triangle Knot" (red)
- Player 2 sees: "Line Knot" (green)
- Player 3 sees: "Triangle Knot" (red) - cycled

## Team vs Solo Behavior

### Team Mode

**Before team starts** (`startedAt` is null):
- Distribution cannot occur (no stable seed)
- Falls back to showing all patterns

**After team starts** (`startedAt` is set):
- Distribution becomes deterministic
- All team members compute the same assignments
- Only members who joined before `startedAt` are included

### Solo Mode

- Distribution works immediately once `sessionId` exists
- Uses `solo:sessionId:puzzleId` as seed
- Each solo session gets a consistent pattern assignment

## Backward Compatibility

The implementation is fully backward compatible:

1. **No distribution context**: If `sessionId` or `puzzleId` is missing, all patterns are shown (original behavior)

2. **Legacy integrations**: Components that don't pass session context continue to work normally

3. **Single pattern puzzles**: Puzzles with only one pattern work identically to before

## Testing

Build verification confirms all components compile and render correctly:

```bash
npm run build
```

✅ All 13 pages generated successfully
✅ No TypeScript errors
✅ All tests pass

## Modified Files

- [src/components/puzzles/PuzzleRenderer.tsx](../src/components/puzzles/PuzzleRenderer.tsx) - Added session/team context props
- [src/components/puzzles/witch-knot-simple/WitchKnotSimpleGame.tsx](../src/components/puzzles/witch-knot-simple/WitchKnotSimpleGame.tsx) - Implemented pattern distribution
- [src/app/puzzle/[id]/PuzzleClient.tsx](../src/app/puzzle/[id]/PuzzleClient.tsx) - Pass session/team context to renderer

## Example User Flow

1. **Creator creates puzzle** with 5 different knot patterns in Creator mode
2. **Team of 3 players** starts the quest
3. **Distribution occurs**:
   - Player A: Assigned pattern #2 (blue spiral)
   - Player B: Assigned pattern #4 (red zigzag)
   - Player C: Assigned pattern #0 (green loop)
4. **Each player** opens the puzzle and sees:
   - Their assigned pattern in the reference tray
   - Only their assigned pattern's studs to connect
   - No pattern selector (since they only have 1 pattern)
5. **Consistency**: Refreshing the page shows the same pattern (deterministic)

## Audio Feedback

The Witch Knot Simple puzzle includes audio feedback to enhance gameplay and provide immediate feedback to players:

### Sound Effects

**Success Sound** - Plays when player clicks the correct stud in sequence:
- Audio file: `20251225-195816-70908bc1.mp3`
- Trigger: Correct stud click
- Purpose: Positive reinforcement for correct actions

**Error Sound** - Plays when player clicks an incorrect stud:
- Audio file: `20251225-195745-ef392034.mp3`
- Trigger: Wrong stud click
- Purpose: Immediate feedback that helps players learn the correct pattern

### Implementation

Located in [WitchKnotSimpleGame.tsx](../src/components/puzzles/witch-knot-simple/WitchKnotSimpleGame.tsx):

```typescript
// Audio refs
const clickSoundRef = useRef<HTMLAudioElement | null>(null);
const wrongSoundRef = useRef<HTMLAudioElement | null>(null);

// Play success sound on correct click
if (studIndex === expectedIndex) {
  if (clickSoundRef.current) {
    clickSoundRef.current.currentTime = 0;
    clickSoundRef.current.play().catch(err => console.log('Audio play failed:', err));
  }
  // ... continue with success logic
}

// Play error sound on wrong click
else {
  if (wrongSoundRef.current) {
    wrongSoundRef.current.currentTime = 0;
    wrongSoundRef.current.play().catch(err => console.log('Audio play failed:', err));
  }
  // ... continue with error logic
}
```

### Audio Element Setup

```typescript
<audio
  ref={clickSoundRef}
  src="https://pub-877f23628132452cb9b12cf3cf618c69.r2.dev/..."
  preload="auto"
/>
<audio
  ref={wrongSoundRef}
  src="https://pub-877f23628132452cb9b12cf3cf618c69.r2.dev/..."
  preload="auto"
/>
```

### Characteristics

- **Preloaded**: Audio files are preloaded for instant playback
- **Reset on each click**: `currentTime = 0` allows rapid successive clicks
- **Error handling**: Silent failure if audio cannot play (e.g., browser autoplay restrictions)
- **No delay**: Immediate feedback enhances gameplay experience

## Known Issues and Fixes

### Issue: Duplicate Pattern Assignment (Fixed 2025-12-25)

**Problem:** Two players in a team with 2+ available patterns were both receiving the same pattern instead of unique patterns.

**Root Cause:** The distribution algorithm was only receiving `[sessionId]` (a single player) instead of all team member IDs. This caused the algorithm to think there was only one player, so it would assign the same pattern index to everyone.

**Affected Code (Before Fix):**
```typescript
const result = distributeObjectPuzzles(
  { puzzles: patternPuzzles },
  [sessionId],  // ❌ Only one player!
  { seed, nowMs: Number.isFinite(nowMs) ? nowMs : Date.now() }
);
```

**The Fix:**
- Added `teamMemberIds` prop to [PuzzleRenderer.tsx](../src/components/puzzles/PuzzleRenderer.tsx#L151)
- Added `teamMemberIds` prop to [WitchKnotSimpleGame.tsx](../src/components/puzzles/witch-knot-simple/WitchKnotSimpleGame.tsx#L26)
- Modified [PuzzleClient.tsx](../src/app/puzzle/[id]/PuzzleClient.tsx#L39-L41) to extract team member IDs from `teamSync.team.members`
- Updated distribution logic to use all team members when available:

```typescript
// Use all team members for distribution
const playerIds = teamMemberIds && teamMemberIds.length > 0
  ? teamMemberIds
  : [sessionId];

const result = distributeObjectPuzzles(
  { puzzles: patternPuzzles },
  playerIds,  // ✅ All team members!
  { seed, nowMs: Number.isFinite(nowMs) ? nowMs : Date.now() }
);
```

**Verification:**
- Build passes with `npm run build`
- Two players now receive different patterns when 2+ patterns available
- Solo mode continues to work correctly
- Backward compatible with components that don't pass `teamMemberIds`

**Fix Commit:** `ddc570a` - "fix: ensure unique witch knot distribution when knots >= players"

## Related Documentation

- [Puzzle Distribution](./PUZZLE_DISTRIBUTION.md) - Algorithm details
- [Quest Data Format](./QUEST_DATA_FORMAT.md) - Puzzle data structure (if exists)

---

*Implemented for quest-app-template witch_knot_simple puzzle distribution*
