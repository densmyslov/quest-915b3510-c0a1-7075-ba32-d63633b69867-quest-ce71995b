# Object Timeline Runtime (graph-driven, authoritative progress)

Each quest object has a **timeline graph** compiled into `compiled.json`. The runtime tracks per-player progress through timeline nodes and applies deterministic transitions.

This replaces the “localStorage-only timeline progress” model.

## Timeline model

Timeline nodes are keyed by `nodeId` in `timelineNodes`:

- Linear nodes: `outNodeIds[]`
- Branching nodes (`puzzle`, `action`): `successOutNodeIds[]` / `failureOutNodeIds[]`
- Default nodes per object:
  - `tl_<objectId>__start` (`stateKind=start`)
  - `tl_<objectId>__end` (`stateKind=end`)

Supported node types (compiler + runtime):

- `state`, `text`, `chat`, `audio`, `video`, `image`, `ar`, `puzzle`, `action`, `effect`

## AR timeline item (`type: "ar"`)
The template supports an `ar` timeline item that:
1. Captures a player photo (camera)
2. (Optional) Calls `POST /api/v1/match-vlm` to verify the photo matches a target image
3. Calls `POST /api/v1/ar/analyze` (Florence-2) and renders the selected overlay effect on the detected region

### Configuration (from quest-platform dashboard)
`mediaTimeline.items[].ar`:
```json
{
  "task_prompt": "<REFERRING_EXPRESSION_SEGMENTATION>",
  "text_input": "red car",
  "overlay": "smoke",
  "origin": "top",
  "match_target_image_key": "clients/<client>/<quest>/images/base-images/.../image.webp",
  "match_target_image_url": "https://..."
}
```

Behavior:
- If the match gate is configured and returns `NO`, the player sees: `Giev it another try` and can retry.

## Client responsibilities

The client:

1. Plays/executes node payloads locally (audio/video/text/effects).
2. Reports completions to the runtime (authoritative):
   - Linear nodes: `POST /api/runtime/node/complete`
   - Puzzle outcomes: `POST /api/runtime/puzzle/submit` (currently reached via `POST /api/quest/complete-puzzle`)
3. Applies server responses/deltas (WS broadcast is the next step; HTTP already returns `{ snapshot, deltas }`).

## Current implementation notes (template)

- Timeline runner hook: `quest-app-template/src/components/object-timeline/useObjectTimeline.ts`
  - Still uses local progress as a UX cache, but now also reports node completion to the runtime via `/api/runtime/node/complete`.
  - Puzzle completion is reported on the puzzle page via `/api/quest/complete-puzzle` → runtime submission.

## Node ID mapping (local dev / template)

For timelines sourced from `quest.json` (`mediaTimeline`), the compiler assigns node IDs deterministically from the normalized timeline item key:

- `nodeId = makeTimelineItemNodeId(objectId, item.key)`
- Helper: `quest-app-template/src/runtime-core/compileQuest.ts` (exported `makeTimelineItemNodeId`)

## Objects Timeline Dashboard

The Objects Timeline Dashboard provides a visual interface for creators to configure the sequence of events and actions that occur when a player interacts with an object.

### Functionalities

#### Item Management
- **Add Actions**: Insert various types of timeline items:
  - **Audio**: Play sound effects or audio tracks.
  - **Video**: Play video files (in a popup player).
  - **Image**: Display images (fullscreen/modal).
  - **Narration**: synchronised audio with streaming text transcript.
  - **Map Effect**: Trigger visual effects on the map (e.g., pulsating circles).
  - **Puzzle**: Trigger a puzzle challenge that blocks progress until solved.
  - **Chat**: Opens a chat window (blocking until closed).
  - **Text**: Display simple text messages.
- **Reorder**: Move items up or down to change the execution sequence.
- **Remove**: Delete items from the timeline.
- **Insert**: Add new items at specific positions between existing ones.

#### Item Configuration
- **Type**: Switch the type of an existing item dynamically.
- **Enabled**: Toggle items on or off to skip them without deletion.
- **Delay**: Set a delay (in milliseconds) before the item executes.
- **Blocking**:
  - **Blocks next items**: The timeline pauses until this item completes (e.g., audio finishes, image is closed).
  - **Always blocks**: Puzzles and Chat always block execution until completed/closed.
  - **Audio auto-blocking**: Audio items automatically block if there's any enabled next item in the timeline. This ensures audio playback completes before proceeding to the next step, preventing race conditions where subsequent items (actions, puzzles, etc.) would be displayed while audio is still playing.
- **Role** (Audio/Narration):
  - **Normal**: Standard sequential playback.
  - **Background**: Continues playing while the timeline proceeds (e.g., ambient music during a puzzle).
- **Display Mode** (Text/Narration/Image):
  - **Seconds**: Item remains visible for a fixed duration.
  - **Until Close**: Item remains visible until the user explicitly closes it.

## Chat timeline item

When a `mediaTimeline` item has `type: "chat"`, the player app opens a chat overlay:

- The user can send messages; the app calls `POST {NEXT_PUBLIC_QUEST_API_URL}/api/v1/chat` with body `{ "message": "..." }`.
- The app waits for the reply and appends it to the chat window.
- The API response is parsed as `r[0]['output'][0]['content'][0]['text']`.
- If the API returns `goal_achieved: true` (currently at `r[0]['goal_achieved']`), the chat auto-closes a few seconds later.
- The node is marked complete when the chat overlay is closed (blocking timeline step).

#### Media & Preview
- **Selection**: Choose from uploaded media files via dropdown menus or provide a direct URL.
- **In-Dash Preview**:
  - **Audio**: Play/Pause audio tracks directly within the dashboard.
  - **Video**: Watch video previews in a popup modal.
  - **Image**: View thumbnail previews of selected images.

#### Advanced Configuration
- **Effects**: Customize map effects with JSON parameters (color, radius, speed, duration).
- **Puzzles**: Link specific puzzles to timeline items.

## GPS-Based Timeline Triggers

GPS triggers enable timeline items to be conditionally enabled/disabled based on the player's proximity to a specific location. This allows you to create location-aware quest experiences where certain timeline content only becomes available when players reach specific GPS coordinates.

### Overview

- **Introduced in**: Commit [79a6370](https://github.com/densmyslov/quest-app-template/commit/79a637026c308c9fc01cc3083a8d3f7867691b3e)
- **Works in**: Play mode only (disabled in Steps mode)
- **Backwards compatible**: Items without GPS triggers work as before
- **Timeline preservation**: Progress is preserved across zone exits/re-entries

### GPS Trigger Modes

Each timeline item can have one of three GPS trigger modes:

#### 1. Approach Mode
Item becomes enabled when the player **enters** a GPS zone.

**Use cases**:
- Audio narration that plays when approaching a landmark
- Text messages that appear when entering a specific area
- Puzzles that unlock upon arrival at a location

**Configuration**:
```json
{
  "gpsTrigger": {
    "enabled": true,
    "mode": "approach",
    "distanceMeters": 20
  }
}
```

#### 2. Departure Mode
Item becomes enabled when the player **leaves** a GPS zone.

**Use cases**:
- Farewell messages when leaving a location
- Content that triggers after exploring an area
- Sequential location-based storytelling

**Configuration**:
```json
{
  "gpsTrigger": {
    "enabled": true,
    "mode": "departure",
    "distanceMeters": 30
  }
}
```

#### 3. Distance Range Mode
Item is enabled when the player is **within a specific distance range**.

**Use cases**:
- Content that only plays at mid-range distances
- "Getting warmer/colder" gameplay mechanics
- Layered proximity-based content

**Configuration**:
```json
{
  "gpsTrigger": {
    "enabled": true,
    "mode": "distance_range",
    "minDistanceMeters": 10,
    "maxDistanceMeters": 50
  }
}
```

### Custom Coordinates

By default, GPS triggers use the parent object's coordinates. You can override this to trigger based on different locations:

```json
{
  "gpsTrigger": {
    "enabled": true,
    "mode": "approach",
    "distanceMeters": 20,
    "coordinates": {
      "lat": 45.4642,
      "lng": 9.1900
    }
  }
}
```

**Use cases**:
- Multi-location timelines (e.g., "walk from Point A to Point B")
- Scavenger hunts with GPS checkpoints
- Complex spatial narratives

### Technical Implementation

#### Type Definition
Located in [src/types/quest.ts:60-71](../quest-app-template/src/types/quest.ts#L60-L71):

```typescript
gpsTrigger?: {
  enabled: boolean;
  mode: 'approach' | 'departure' | 'distance_range';
  distanceMeters?: number;        // Default: 20m
  minDistanceMeters?: number;     // For distance_range mode
  maxDistanceMeters?: number;     // For distance_range mode
  coordinates?: {                 // Optional override
    lat: number;
    lng: number;
  };
};
```

#### Runtime Logic

**GPS Enablement Evaluation** ([useObjectTimeline.ts:83-147](../quest-app-template/src/components/object-timeline/useObjectTimeline.ts#L83-L147)):
- Runs `computeGpsEnabledItems()` to determine which items are GPS-enabled
- Calculates distance from user's GPS location to trigger coordinates
- Evaluates trigger condition based on mode
- Returns set of enabled item keys

**Distance Monitoring** ([QuestMap.tsx:933-1043](../quest-app-template/src/components/QuestMap.tsx#L933-L1043)):
- Continuous GPS monitoring (throttled to 1 update/second)
- Tracks `gpsEnabledItemsRef` set
- Re-evaluates timeline when GPS enablement changes
- Triggers timeline re-execution via `runObjectTimelineRef`

**Timeline Execution** ([useObjectTimeline.ts:222-265](../quest-app-template/src/components/object-timeline/useObjectTimeline.ts#L222-L265)):
- Items must be BOTH statically enabled AND GPS-enabled to execute
- GPS-locked items are skipped during timeline execution
- Progress is preserved for GPS-locked items

#### UI Indicators

**Timeline Panel** ([QuestMapOverlay.tsx:272-290](../quest-app-template/src/components/QuestMapOverlay.tsx#L272-L290)):
- Shows 📍 GPS lock badge on locked items
- Displays trigger mode hint: "Get closer", "Move away", or "GPS locked"
- Visual feedback with gold accent color

### Configuration in Editor

In the quest-platform timeline editor, GPS triggers can be configured via the **📍 GPS Trigger** section:

1. **Enable GPS Trigger**: Checkbox to activate GPS-based enablement
2. **Trigger Mode**: Dropdown to select approach/departure/distance_range
3. **Distance Threshold**: Input for distance in meters (approach/departure modes)
4. **Min/Max Distance**: Inputs for distance range (distance_range mode)
5. **Custom Coordinates**: Optional lat/lng override fields

### Best Practices

#### Distance Thresholds
- **Default**: 20 meters (good for precise locations)
- **Urban areas**: 15-30 meters (account for GPS accuracy)
- **Open areas**: 30-50 meters (account for GPS drift)
- **Large zones**: 50-100 meters (parks, buildings)

#### GPS Accuracy Considerations
- GPS accuracy varies (5-50 meters typical)
- Indoor/urban canyon environments have poor GPS
- Use larger thresholds in areas with known GPS issues
- Test on-site with actual GPS conditions

#### Performance
- Distance checks are throttled to 1/second
- Minimal battery impact
- GPS tracking only active in Play mode

#### Testing
- **Steps Mode**: GPS triggers are disabled for manual testing
- **Play Mode**: Requires actual GPS or location spoofing
- Use `console.log` output to debug GPS enablement changes

### Example Use Cases

#### Sequential Location-Based Story
```json
{
  "items": [
    {
      "type": "audio",
      "key": "intro",
      "media_url": "intro.mp3",
      "gpsTrigger": {
        "enabled": true,
        "mode": "approach",
        "distanceMeters": 20
      }
    },
    {
      "type": "text",
      "key": "midpoint",
      "text": "You've reached the halfway point!",
      "gpsTrigger": {
        "enabled": true,
        "mode": "approach",
        "distanceMeters": 25,
        "coordinates": {
          "lat": 45.4650,
          "lng": 9.1905
        }
      }
    },
    {
      "type": "audio",
      "key": "farewell",
      "media_url": "goodbye.mp3",
      "gpsTrigger": {
        "enabled": true,
        "mode": "departure",
        "distanceMeters": 30
      }
    }
  ]
}
```

#### Proximity Puzzle
```json
{
  "items": [
    {
      "type": "text",
      "key": "hint_far",
      "text": "You're getting warmer...",
      "gpsTrigger": {
        "enabled": true,
        "mode": "distance_range",
        "minDistanceMeters": 30,
        "maxDistanceMeters": 100
      }
    },
    {
      "type": "puzzle",
      "key": "secret_puzzle",
      "puzzleId": "hidden-riddle",
      "gpsTrigger": {
        "enabled": true,
        "mode": "approach",
        "distanceMeters": 15
      }
    }
  ]
}
```

### Troubleshooting

#### Item Never Enables
- Check GPS is enabled in Play mode
- Verify distance threshold is large enough
- Confirm coordinates are correct (lat/lng not swapped)
- Check GPS accuracy in device settings

#### Item Enables/Disables Repeatedly
- GPS jitter causing zone boundary crossing
- Increase distance threshold by 5-10 meters
- Check GPS accuracy indicator in app

#### Timeline Skips GPS Items
- Verify you're in Play mode (not Steps mode)
- Check item has `enabled: true` in addition to GPS trigger
- Confirm GPS permissions are granted

### Related Documentation
- [MAP_EFFECTS.md](MAP_EFFECTS.md#gps-proximity-tracking) - GPS proximity tracking system
- [STEPS_MODE.md](STEPS_MODE.md) - Manual testing without GPS
- [AUDIO_QUICK_START.md](AUDIO_QUICK_START.md) - GPS-triggered audio setup
