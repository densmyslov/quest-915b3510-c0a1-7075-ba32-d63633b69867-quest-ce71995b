# Musical Code Fountain Puzzle

## Status

Phase 2 (fountain image + polygon hit regions) is implemented in:
- `quest-app-template/src/components/puzzles/musical-code-fountain/MusicalCodeFountainGame.tsx`

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
- `noteId` is stable per score note and is based on `partId`, `measureIndex` (0-based), local tick within the measure, staff, voice, and chord index.
- `fountainImageUrl` is the background image used for Phase 2 hit regions.
- `fountainMapUrl`/`fountainMap` define polygon regions that map `stoneId` → user input; `stoneId` is then mapped to a pitch via `stones`.
- `fountainHintMode`: `always` (default), `memory` (show then fade during input), or `off` (no hints).
- `fountainHintDurationMs`/`fountainHintFadeMs`: how long hints stay visible and how fast they fade (memory mode).
- `fountainEffectsEnabled`: enables glow/ripple/particle feedback on presses.

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

---

## Next steps

- Phase 3: improve judge (anchoring, miss/extra handling, adaptive windows)
- Phase 4: multiplayer ensemble mode via WebSocket time sync + server-side aggregation/judge
