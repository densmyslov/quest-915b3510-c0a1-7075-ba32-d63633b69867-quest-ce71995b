# Musical Code Fountain Puzzle

## Status

Implemented:
- Phase 1–2 gameplay (score render + highlighting, stones, judging, fountain hit regions):
  - `quest-app-template/src/components/puzzles/musical-code-fountain/MusicalCodeFountainGame.tsx`
- Phase 5 editor workflow (crop, preview/alignment, content outputs) in the platform Puzzle Editor:
  - `quest-platform/frontend/components/puzzles/musical-code-fountain/MusicalCodeFountainCreator.tsx`
- Server-side physical MP3 cropping (FFmpeg → public R2 audio bucket):
  - `quest-platform/backend/src/tools/puzzle-manager/lambda_handler.py`
  - `quest-platform/backend/src/tools/ffmpeg-operator/lambda_handler.py`

Not implemented yet:
- Phase 4 multiplayer ensemble mode (server time sync + aggregation + judge)

## Target experience

- Play a short reference melody (looped **3×**, with count-in)
- Show MusicXML score while it plays, with note-by-note highlighting and per-pitch colours
- Let the player repeat the melody by tapping coloured “stones”
- Judge pass/fail from pitch sequence + timing (± window)
- Later: team “ensemble mode” with server-authoritative time

---

## MVP puzzle data shape

The puzzle JSON payload (inline `interaction_data.puzzle_data` or via `interaction_data.puzzle_data_url`) should look like:

```json
{
  "musicXmlUrl": "https://.../music.musicxml",
  "fountainImageUrl": "https://imagedelivery.net/<HASH>/clients/<client>/platform-library/<puzzleId>/fountain.jpg/public",
  "fountainMapUrl": "clients/<client>/platform-library/<puzzleId>/fountain_map.json",
  "fountainHintMode": "memory",
  "fountainHintDurationMs": 1200,
  "fountainHintFadeMs": 900,
  "fountainEffectsEnabled": true,
  "audioOriginalUrl": "clients/<client>/platform-library/<puzzleId>/audio_original.wav",
  "audioUrl": "https://<PUBLIC_R2_DOMAIN>/clients/<client>/platform-library/<puzzleId>/audio.mp3",
  "audioCrop": { "cropStartSec": 0.0, "cropEndSec": 12.34 },
  "adjustmentMode": "timeline_shift",
  "visualNudgeMs": 0,
  "referenceUrl": "clients/.../reference.json",
  "reference": {
    "version": 1,
    "metadata": { "ticksPerQuarter": 960, "source": { "type": "musicxml" } },
    "tempo": { "bpm": 120 },
    "events": [
      {
        "noteId": "pP1-mi0-t0-s1-v1-c0",
        "partId": "P1",
        "pitch": 69,
        "startBeat": 0,
        "durationBeats": 1,
        "startTimeMs": 0,
        "durationMs": 500,
        "measure": 1,
        "measureIndex": 0,
        "voice": "1",
        "staff": 1
      }
    ]
  },
  "selectedPartId": "P1",
  "loops": 3,
  "countInBeats": 4,
  "hitWindowMs": 180,
  "passThreshold": 0.8,
  "maxExtraNotes": 2,
  "maxMissingNotes": 0,
  "stones": [
    { "stoneId": "blue", "pitch": 69, "color": "#3b82f6", "label": "A" }
  ],
  "fountainMap": {
    "version": 1,
    "coordinateSpace": "normalized",
    "regions": [
      {
        "regionId": "region_1",
        "stoneId": "blue",
        "points": [{ "x": 0.12, "y": 0.62 }, { "x": 0.18, "y": 0.58 }, { "x": 0.2, "y": 0.7 }]
      }
    ]
  }
}
```

Notes:
- `reference` is recommended (Phase 0 output). If omitted, the client can generate a basic reference timeline from MusicXML for simple monophonic scores.
- `stones` is optional; if omitted, stones are derived from unique pitches in `reference.events`.
- Stone `color` should be a Canvas-friendly CSS color (recommend `#RRGGBB`). Older space-separated forms like `hsl(120 85% 55%)` are normalized at runtime for compatibility.
- `noteId` is stable per score note and is based on `partId`, `measureIndex` (0-based), local tick within the measure, staff, voice, and chord index.
- `fountainImageUrl` is the background image used for Phase 2 hit regions.
- `fountainMapUrl`/`fountainMap` define polygon regions that map `stoneId` → user input; `stoneId` is then mapped to a pitch via `stones`.
- `fountainMap` is only persisted when the platform editor saves it (it’s gated by `includeFountainMap` in the creator UI). Preview does not persist.
- `fountainHintMode`: `always` (default), `memory` (show then fade during input), or `off` (no hints).
- `fountainHintDurationMs`/`fountainHintFadeMs`: how long hints stay visible and how fast they fade (memory mode).
- `fountainEffectsEnabled`: enables glow/ripple/particle feedback on presses.
- `audioUrl`/`audioOriginalUrl`: optional reference audio for playback (if omitted, playback uses a synth).
  - `audioOriginalUrl` points to the “source of truth” upload (e.g. `audio_original.wav`).
  - `audioUrl` points to the “runtime playback” file. If you export a physical crop, this is `audio.mp3` in the public R2 audio bucket.
- `audioCrop`: `{ cropStartSec, cropEndSec? }` defines the segment of the original audio to use.
  - If `audioUrl` is already physically cropped (`audioUrl !== audioOriginalUrl`), runtime plays from offset `0`.
  - Otherwise runtime plays from offset `cropStartSec` into `audioOriginalUrl`.
- `adjustmentMode`:
  - `timeline_shift` (default): MusicXML unchanged; generated reference timeline is shifted by `cropStartSec` (notes before the crop are dropped).
  - `musicxml_cut`: editor rewrites `music.musicxml` to keep only measures intersecting the crop window, and converts non-overlapping notes in the first/last measure into rests (so the score stays valid), then regenerates the reference from that rewritten MusicXML.
- `visualNudgeMs`: optional highlight-only micro-offset (±200ms) for last-mile alignment tweaks.
- `editorPreview` is an internal flag used by the platform editor Preview overlay (it should not be persisted into `data.json`).

---

## Phase 0 — Reference generation (foundation)

Canonical input: MusicXML.

Unified reference model (what playback/highlighting/judging use):
- `noteId` (stable)
- `pitch` (MIDI)
- `startTimeMs`, `durationMs` (derived from tempo)

Current helper:
- `quest-app-template/src/lib/musicxmlToReference.ts` exports `musicXmlToReference(xml)` and produces a per-note event timeline with stable `noteId`s (handles ties; supports tempo marks + changes).

---

## Phase 5 — Editor pipeline (implemented)

The in-browser Puzzle Editor (platform) supports a “publishable puzzle pack” workflow without any out-of-browser tools.

### 5.1 Audio: upload + crop + export (physical MP3)

- Upload `audio_original.*` (many formats accepted); store it in the public R2 audio bucket (same bucket used for other MP3 assets).
- Set crop start/end (`audioCrop.cropStartSec`, `audioCrop.cropEndSec`).
- Click **Export Cropped MP3**:
  - Calls the platform API crop action, which invokes FFmpeg in `ffmpeg-operator`.
  - Writes `clients/<client>/platform-library/<puzzleId>/audio.mp3` to the public R2 bucket.
  - Updates `audioUrl` to the new public URL.

### 5.2 Notation alignment

Two supported adjustment modes:

1) `timeline_shift` (non-destructive)
- Keep `music.musicxml` unchanged.
- Generate `reference` by shifting note times by `cropStartSec` (dropping notes before the crop).

2) `musicxml_cut` (destructive; measure-based)
- Rewrite `music.musicxml` to remove measures outside the crop window.
- Copies the latest `<attributes>` and tempo marking into the new first measure to keep rendering/parsing consistent.
- Renumbers measures starting at `1`.
- If crop start/end are not exactly on measure boundaries, the editor keeps the overlapping measures and converts non-overlapping notes in the first/last measure into rests (so the score still renders cleanly).

### 5.3 Preview & alignment polish

- **Preview Puzzle** opens a fullscreen overlay to test audio + score + highlighting + stones using the current in-editor data.
- Preview does not persist `fountainMap` / regions; use **Save Musical Code** to persist.
- `visualNudgeMs` has both a number input and a slider for quick highlight alignment (audio remains unchanged).
- **Restore Original** deletes the exported `audio.mp3` from the public R2 audio bucket and switches `audioUrl` back to `audioOriginalUrl` (also resets crop start/end in the editor).

---

## Phase 1 — Single-player “listen and repeat” (MVP)

UI:
- Score panel: OSMD renders MusicXML (SVG)
- Stone panel: clickable coloured buttons (fallback) or fountain image hit regions (Phase 2)
- HUD: mode + loop counter + result

Playback:
- Tone.js schedules reference notes with a count-in and loops the melody 3×

Highlighting:
- Indexes OSMD graphical notes by computed `noteId` and applies per-pitch colours
- During playback, highlights the currently-playing noteId(s) (chords/stacked onsets highlight together)

Judging:
- Phase 3 judge aligns the attempt to the reference (anchor search + DP alignment) and handles missing/extra notes.
- Pass if `pitchAccuracy >= passThreshold` AND `timingAccuracy >= passThreshold`, while staying within `maxExtraNotes` / `maxMissingNotes`.
- Timing windows are adaptive per-note (based on inter-onset interval), capped by `hitWindowMs`.

Integration:
- On pass, calls `onComplete()` so `PuzzleClient` submits `outcome: "success"` via `/api/runtime/puzzle/submit`

Small correctness note:
- `judgeAttemptV3` previously skipped notes with `actualMs === 0` due to a falsy check; this was fixed so the first correctly-timed hit is counted.

---

## Next steps

- Phase 4: multiplayer ensemble mode via WebSocket time sync + server-side aggregation/judge
- Optional: smarter partial-measure cuts (today: notes crossing crop boundaries are converted to rests; there’s no attempt to split durations)
