# Puzzle System Architecture

## Overview
The Puzzle system allows users to play interactive jigsaw-like puzzles. The system is designed to separate **metadata** (JSON) from **assets** (Images) for performance and security.

## Data Flow & Architecture

### 1. Metadata (`data.json`)
- **Source**: Stored in a private **R2 Bucket** named `quest-platform-users`.
- **Access**: Fetched via a **Cloudflare Worker** data proxy (e.g. `quest-data-proxy` / `quest-image-manager`).
- **Why**: The JSON data contains logic (piece positions, etc.) and is kept in a private bucket. The Worker authenticates/authorizes the request (or at least obfuscates the bucket structure) and serves the file.
- **URL Structure**:
  ```
  ${NEXT_PUBLIC_PUZZLE_DATA_WORKER_URL}/clients/<CLIENT_ID>/platform-library/<PUZZLE_ID>/data.json
  ```

### 2. Assets (Images)
- **Source**: **Cloudflare Images** service.
- **Access**: Fetched directly via `imagedelivery.net` CDN.
- **Why**: Highly optimized for image delivery (resizing, format conversion to WebP/AVIF) and caching.
- **URL Structure**:
  ```
  https://imagedelivery.net/<ACCOUNT_HASH>/clients/<CLIENT_ID>/platform-library/<PUZZLE_ID>/board.png/public
  ```

## Frontend Implementation

### Key Components
- **`src/app/play/page.tsx`**: Orchestrates the loading logic. It determines whether to use embedded data or fetch from the network. It handles the URL construction for the Worker.
- **`PuzzleRenderer.tsx`**: A wrapper that selects the correct puzzle engine (e.g., Fabric.js vs Jigsaw).
- **`PuzzleGame.tsx`** (Mozaic): The main Fabric.js-based game logic.

### Data Types (`types/puzzle.ts`)
The `PuzzleData` interface drives the game:
- `imageDimensions`: The logical size of the puzzle.
- `pieces`: Array of pieces, where each piece contains:
    - `imageDataUrl`: The visual asset (URL to Cloudflare Images). **LEGACY**
    - `shapeData`: **NEW** Coordinate-based rendering data (reduces payload by 90%+)
    - `correctPosition`: Normalized (0.0-1.0) or absolute coordinates for the solution.
    - `id`: Unique identifier.

## Coordinate-Based Rendering (NEW)

### Overview
The Mozaic puzzle now supports **dynamic piece texture generation** from coordinate data instead of pre-extracted images. This provides significant benefits:

- **90%+ smaller payload**: Stores polygon coordinates instead of base64 images
- **Transparent pieces**: Perfect alpha masking without rectangular backgrounds
- **Backward compatible**: Automatically falls back to `imageDataUrl` if `shapeData` is not present

### How It Works

#### 1. Data Structure
Each piece can now include a `shapeData` property:

```typescript
interface PieceData {
  id: string;
  shapeData?: {
    type: 'polygon' | 'path';
    points?: Array<{ x: number; y: number }>;  // Normalized coordinates
    pathData?: string;  // For freehand paths
  };
  // Fallback to legacy format
  imageDataUrl?: string;
  imageUrl?: string;
  correctPosition: { x: number; y: number };
  correctRotation: number;
}
```

#### 2. Rendering Process ([PuzzleGame.tsx](../src/components/puzzles/mozaic/PuzzleGame.tsx:256-374))

When loading a puzzle:

1. **Load original image** once for all pieces
2. **For each piece**:
   - If `shapeData` exists: Generate texture dynamically from coordinates
   - Otherwise: Load from `imageUrl` or `imageDataUrl` (legacy fallback)
3. **Dynamic generation**:
   - Calculate bounding box from polygon points
   - Draw image portion to canvas
   - Create polygon mask
   - Apply mask using `destination-in` compositing
   - Convert to PIXI texture

```typescript
// NEW: Try coordinate-based rendering first
if (pieceData.shapeData && originalImageElement) {
  texture = generatePieceTexture(pieceData, originalImageElement);
}

// FALLBACK: Use pre-extracted image if available
if (!texture) {
  const imageUrl = pieceData.imageUrl || pieceData.imageDataUrl;
  texture = await loadTextureWithFallback(pieceData.id, imageUrl);
}
```

#### 3. Benefits vs Trade-offs

**Benefits:**
- Massive payload reduction (coordinates are much smaller than images)
- Perfect transparency and anti-aliasing
- Single source image (no duplication)
- Easier to modify puzzle cutting algorithms

**Trade-offs:**
- Requires loading original image (one-time cost)
- Slightly more CPU work during initial load
- Only supports polygon shapes currently (freehand `pathData` not yet implemented)

### Migration Guide

**Existing puzzles** with `imageDataUrl` will continue to work without changes.

**New puzzles** should use `shapeData` for optimal performance:

```json
{
  "puzzleId": "puz-modern",
  "originalImageUrl": "https://imagedelivery.net/.../original.png/public",
  "pieces": [
    {
      "id": "piece_0",
      "shapeData": {
        "type": "polygon",
        "points": [
          { "x": 0, "y": 0 },
          { "x": 100, "y": 0 },
          { "x": 100, "y": 100 },
          { "x": 0, "y": 100 }
        ]
      },
      "correctPosition": { "x": 512, "y": 384 },
      "correctRotation": 0
    }
  ]
}
```

## Debugging

### Common Issues
1.  **404 Not Found (data.json)**:
    - Check if the **Quest Image Manager** worker is deployed and correctly mapping the route to the R2 bucket.
    - Verify the path in `src/app/play/page.tsx` correctly extracts the `clients/...` relative path.
    - Ensure `data.json` exists in the R2 bucket.

2.  **403 Forbidden**:
    - Usually means you are trying to access a private S3/R2 bucket directly from the browser without a proxy or signed URL. **Solution**: Ensure you are using the Worker URL.


3.  **Missing Pieces / CORS Errors**:
    - Check that `imagedelivery.net` serves the images with `Access-Control-Allow-Origin: *`. Fabric.js requires CORS to read pixel data for hit detection.

## Puzzle Features
### Witch Knot Simple
- **Interactive Zoom & Pan**: Supports pinch-to-zoom (1x-3x) and 1-finger panning with vertical constraints (3/4 height limits).
- **Reveal Logic**: Sequential revealing of dots upon correct selection.
- **Visual Hints**: The next correct dot (after the start) blinks (alpha oscillates) to guide the player, enabling it to be seen before clicking.
- **Audio Feedback**: Distinct sounds for correct and incorrect clicks (including background clicks).

## Puzzle Completion & Scoring

### Overview
When a player completes a puzzle, the system:
1. Records the completion on the server with validation
2. Awards points to the player
3. Shows a congratulations popup with the points earned
4. Persists the progress (survives page refreshes and crashes)

### Architecture

#### Client-Side Flow ([PuzzleClient.tsx](../src/app/puzzle/[id]/PuzzleClient.tsx))

```typescript
const handlePuzzleComplete = React.useCallback(async () => {
    // 1. Extract points from puzzle data (default: 100)
    const points = puzzle.points || puzzleData?.points || 100;

    // 2. Call server-side API to record completion
    const response = await fetch('/api/quest/complete-puzzle', {
        method: 'POST',
        body: JSON.stringify({
            sessionId,
            puzzleId,
            timestamp: new Date().toISOString(),
            points
        })
    });

    // 3. Show congratulations popup
    setCongratsPoints(points);
}, [sessionId, puzzleId, puzzle, puzzleData]);
```

**Key Features:**
- ✅ **Optimistic UI**: Popup shows immediately even if API call fails
- ✅ **Duplicate prevention**: `isSubmitting` flag prevents multiple submissions
- ✅ **Server validation**: All completions are validated server-side
- ✅ **Persistent scoring**: Progress saved to database (see [SCORING_ARCHITECTURE.md](./SCORING_ARCHITECTURE.md))

#### Server-Side Validation ([/api/quest/complete-puzzle](../src/app/api/quest/complete-puzzle/route.ts))

The server validates:
1. **Session exists**: Player must have an active quest session
2. **Puzzle exists**: Puzzle ID must be valid in quest data
3. **Timestamp validity**: Not too far in past/future (prevents replay attacks)
4. **Linked objects**: Player must have completed required objects (if any)
5. **Action cooldown**: Prevents rapid-fire completions (anti-spam)

```typescript
// Server-side validation
const validation = validateCompletePuzzle({
    questData,
    puzzleId,
    timestamp,
    points,
    completedObjects: currentSession.completedObjects,
    lastActionTimestamp: currentSession.lastUpdatedAt
});

if (!validation.valid) {
    return { success: false, error: validation.errors.join(', ') };
}

// Record completion (idempotent - safe to call multiple times)
const session = await completePuzzle(sessionId, puzzleId, points);
```

See [Server-Side Validation](./SCORING_ARCHITECTURE.md#server-side-validation) for complete validation rules.

### Congratulations Popup ([CongratulationsPopup.tsx](../src/components/CongratulationsPopup.tsx))

**Display:**
- 🎉 Animated popup with fade-in effect
- Shows points earned in large text
- Displays "votes" terminology (configurable)
- Close button to dismiss

**User Experience:**
- Appears automatically after puzzle completion
- Click anywhere outside or press "Close" to dismiss
- Smooth fade-out animation when closing
- **Returns to map automatically** when popup closes, showing updated scores
- Does not block navigation (can still use browser back button)

**Map Navigation ([PuzzleClient.tsx:199-203](../src/app/puzzle/[id]/PuzzleClient.tsx#L199-L203)):**
```typescript
const handleClosePopup = React.useCallback(() => {
    setCongratsPoints(null);
    router.push('/'); // Navigate back to map with updated score
}, [router]);
```

When the player closes the popup, they are automatically redirected to the map page where:
- **Solo mode**: Updated score is displayed immediately
- **Team mode**: All team members see the updated total score in real-time

### Session Initialization

Quest sessions are automatically initialized when a player opens a puzzle:

```typescript
// Initialize quest session on mount
React.useEffect(() => {
    await fetch('/api/quest/start', {
        method: 'POST',
        body: JSON.stringify({
            sessionId,
            questId: data.quest.id,
            teamCode: teamSync.teamCode // Optional for team mode
        })
    });
}, [sessionId, data?.quest?.id, teamSync.teamCode]);
```

This ensures the server is ready to track completions before the player finishes the puzzle.

### Points Configuration

Points can be configured at multiple levels:

1. **Puzzle-level points** (recommended):
   ```json
   {
       "id": "puzzle-witch-knot-1",
       "type": "witch_knot_simple",
       "points": 150,
       "data": { ... }
   }
   ```

2. **Puzzle data points** (alternative):
   ```json
   {
       "puzzleId": "puz-123",
       "points": 200,
       "pieces": [ ... ]
   }
   ```

3. **Default fallback**: 100 points if not specified

### Team Mode vs Solo Mode

**Solo Mode:**
- Session ID from `sessionStorage`
- Points awarded to individual player
- Popup shows immediately after puzzle completion
- Score displayed on map updates when player returns from puzzle

**Team Mode (with WebSocket):**
- Session ID from team context
- Points broadcast to all team members via WebSocket
- Popup triggered by `score_update` WebSocket message
- **All team members see real-time score updates** as any player completes puzzles
- Team score calculated by summing all members' `totalPoints`
- **Synchronized Completion**: In certain puzzle types (e.g., Simple Witch Knot), the UI enforces that **ALL** team members must complete the puzzle before the session can be closed. This ensures that no team member is left behind.

### Real-Time Team Score Updates

When playing in team mode, the map displays a dynamic team score that updates in real-time as any team member completes puzzles.

**Score Calculation ([QuestMap.tsx:267-284](../src/components/QuestMap.tsx#L267-L284)):**
```typescript
// Calculate current player/team score
const currentScore = useMemo(() => {
    // For team mode: sum all team members' totalPoints
    if (teamSync.team?.members) {
        return teamSync.team.members.reduce((sum, member) => {
            return sum + (member.totalPoints || 0);
        }, 0);
    }
    // For solo mode: use static votesFor from quest data as fallback
    return data?.quest?.votesFor || 0;
}, [teamSync.team?.members, data?.quest?.votesFor]);
```

**How It Works:**
1. Player A completes puzzle → earns 150 points
2. Server broadcasts `score_update` WebSocket message to all team members
3. `useTeamWebSocket` hook updates `TeamMember.totalPoints` for Player A
4. All players' maps recalculate `currentScore` by summing all members' points
5. GameStatusPanel displays updated team total immediately

**WebSocket Integration ([PuzzleClient.tsx:50-55](../src/app/puzzle/[id]/PuzzleClient.tsx#L50-L55)):**
```typescript
useTeamWebSocket(teamSync.teamCode, teamSync.session, {
    onScoreUpdate: (points) => {
        // Show congratulations popup when player earns points
        setCongratsPoints(points);
    },
});
```

This ensures all team members stay synchronized and can see the team's progress in real-time.

### Debugging

**Popup not appearing?**
1. Check browser console for API errors
2. Verify `sessionId` exists in sessionStorage or team context
3. Ensure quest session was initialized (check Network tab for `/api/quest/start`)
4. Check server logs for validation errors

**Points incorrect?**
1. Verify `points` field in puzzle data
2. Check server-side validation (may have rejected custom points)
3. Look for validation errors in API response

**Multiple popups?**
- `isSubmitting` flag should prevent this
- Check if `onComplete` is called multiple times (puzzle logic bug)

**Map not showing updated score?**
1. **Solo mode**: Verify score is persisted to database/storage
2. **Team mode**: Check if WebSocket connection is active:
   - Open DevTools → Network → WS (WebSocket) tab
   - Look for `score_update` messages after puzzle completion
   - Verify `teamSync.team.members` array has correct `totalPoints` values
3. Check console for errors in `currentScore` calculation
4. Verify `data?.quest?.votesFor` fallback has correct value for solo mode
5. Refresh page to force re-fetch of team data

**Team members not seeing each other's scores?**
1. Verify all players are connected to the same team (check `teamSync.teamCode`)
2. Check WebSocket connection status for each player
3. Verify server is broadcasting `score_update` to all team members (check server logs)
4. Look for `useTeamWebSocket` errors in browser console
5. Confirm `TeamMember.totalPoints` is being updated in team context:
   ```typescript
   console.log('Team members:', teamSync.team?.members);
   ```

## Setup for Development
- Ensure team backend is configured: `QUEST_API_URL` (Pages proxy) or `NEXT_PUBLIC_QUEST_API_URL` / `NEXT_PUBLIC_API_URL` (client build-time).
- Ensure `CLOUDFLARE_ACCOUNT_HASH` (or `CLOUDFLARE_STREAM_CUSTOMER_CODE`) is set so relative image keys like `clients/.../board.png` render via Cloudflare Images.
- Ensure `NEXT_PUBLIC_PUZZLE_DATA_WORKER_URL` is set to your JSON proxy worker base URL (e.g. `https://quest-data-proxy-dev.denslov.workers.dev`).
- We typically use the **Dev** environment URLs for local development.

### Example `data.json`
```json
{
  "puzzleId": "puz-123",
  "imageDimensions": { "width": 1024, "height": 768 },
  "pieces": [
    {
      "id": "piece_0",
      "imageDataUrl": "https://imagedelivery.net/.../piece_0.png/public",
      "correctPosition": { "x": 0.1, "y": 0.1 }
    }
  ]
}
```
