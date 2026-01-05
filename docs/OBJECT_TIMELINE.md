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

- `state`, `text`, `chat`, `audio`, `video`, `image`, `puzzle`, `action`, `effect`

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
