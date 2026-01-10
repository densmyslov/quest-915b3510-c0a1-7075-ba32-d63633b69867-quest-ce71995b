# Streaming Text Implementation Guide

## Overview

The Streaming Text feature provides synchronized text display that follows audio playback. It is implemented in two distinct contexts within the application:

1.  **Immersive Overlay ("Black Board")**: Used in Steps Mode for blocking/narration items.
2.  **Audio Panel Player**: Used in the persistent audio player panel (bottom right).

## Shared Architecture

### Data Structure

Both implementations use the same transcription data structure:

```typescript
interface TranscriptionWord {
    word: string;
    start: number;  // Start time in seconds
    end: number;    // End time in seconds
}

interface Transcription {
    words: TranscriptionWord[];
    fullText?: string;  // Fallback text
}
```

### Data Flow

```
┌─────────────────────────────────────┐
│             useMapAudio             │
│   (Manages <audio> & playback)      │
└──────────────┬──────────────────────┘
               │  audioCurrentTime
               ▼
┌─────────────────────────────────────┐
│            QuestMap                 │
│      (Orchestrates Overlays)        │
└──────────────┬──────────────────────┘
               │
      ┌────────┴──────────────────────────────┐
      ▼                                       ▼
┌───────────────────────────┐       ┌───────────────────────────┐
│   TimelineTextOverlay     │       │     QuestMapOverlay       │
│   (Immersive / Steps)     │       │      (Audio Panel)        │
│                           │       │                           │
│  - Uses SyncedTextRenderer│       │  - Uses StreamingText     │
│  - Smooth Fade-in         │       │  - Scroll-to-view         │
└───────────────────────────┘       └───────────────────────────┘
```

## 1. Immersive Overlay Implementation

Used for `streaming_text_audio` items in the object timeline. This provides a "black board" style overlay where text appears relative to audio timing.

### Component: `TimelineTextOverlay.tsx`

Located in `src/components/object-timeline/TimelineTextOverlay.tsx`.

It uses an internal `SyncedTextRenderer` component to handle the synchronization:

- **Logic**: Iterates through `transcription.words`.
- **Visibility**: Calculates visibility based on `currentTime >= wordData.start - 0.2` (including a 200ms buffer).
- **Animation**: Uses CSS `opacity` transition (0.3 -> 1.0) for a smooth, non-jerky reveal.
- **Future Text**: Future words are dimmed (opacity 0.3) rather than hidden, allowing users to read ahead.

```typescript
// SyncedTextRenderer example logic
{transcription.words.map((wordData, i) => {
  const isVisible = currentTime >= wordData.start - 0.2; // 200ms pre-fade
  return (
    <span style={{ opacity: isVisible ? 1 : 0.3, transition: 'opacity 0.2s ease-out' }}>
      {wordData.word}
    </span>
  );
})}
```

### Integration

Threaded through `QuestMap` -> `MapOverlays` -> `TimelineTextOverlay`.

```xml
<TimelineTextOverlay
    overlay={timelineTextOverlay}
    currentTime={audioCurrentTime} // Passed from useMapAudio hook
/>
```

## 2. Audio Panel Implementation

Used in the expandable audio control panel (`QuestMapOverlay.tsx`).

### Component: `StreamingText.tsx`

Located in `src/components/StreamingText.tsx`.

- **Features**:
    - Highlights the *current* word (yellow background).
    - Auto-scrolls the container to keep the current word in view.
    - Handles user scroll interruptions (pauses auto-scroll).

### Integration

Used directly inside `QuestMapOverlay`:

```xml
<StreamingText
    transcription={audioPanel.transcription}
    currentTime={audioPanel.currentTime}
    isPlaying={audioPanel.isPlaying}
/>
```

---

## Data Loading (Shared)

Transcription data is loaded alongside object data. When a `streaming_text_audio` item is encountered:

1.  **Backend**: Returns `transcription` object with words and timestamps (DynamoDB Decimals converted to numbers).
2.  **Runtime**: `useObjectTimeline` extracts this data.
3.  **Execution**: Passed to `showTimelineText` (for immersive) and `playAudioBlocking` (for panel).

## Troubleshooting

### Text not syncing?
1.  Verify `audioCurrentTime` is updating in React DevTools components (`QuestMap`).
2.  Check if `useMapAudio` is returning the time (added in `useMapAudio.ts`).

### "Jerky" text?
- **Immersive**: Ensure CSS transitions are active on opacity.
- **Panel**: Auto-scroll logic is debounced; check for scroll conflicts.

## 3. Timing Modes

The `StreamingText` component supports two modes for determining word timing, which are automatically selected based on data quality:

### A. Timestamp Mode (Default)
Used when the transcription contains valid `start` and `end` timestamps for each word.
- **Logic**: Precise highlighting based on `currentTime >= word.start && currentTime < word.end`.
- **Requirements**: `transcription.words` must have non-zero timestamps.

### B. Interpolation Mode (Fallback)
Used when timestamps are missing or invalid (e.g., all 0.0s) but the full text is available.
- **Logic**: Calculates word timing by distributing all words evenly across the audio duration.
- **Formula**: `durationPerWord = audioDuration / totalWords`.
- **Requirements**:
    - `transcription.words` must exist.
    - `audioDuration` prop MUST be passed to `StreamingText`.
    - `transcription.words` timestamps are deemed invalid (max end time < 0.1s).

> [!IMPORTANT]
> If `audioDuration` is not passed to `StreamingText`, the component cannot calculate interpolated timings, and text will fail to stream (it may show all at once or none, depending on the implementation state). Always pass `audioDuration` from `useMapAudio` or the audio element.
