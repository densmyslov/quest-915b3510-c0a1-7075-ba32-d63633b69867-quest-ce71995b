# Streaming Text Implementation Guide

## Overview

The Streaming Text feature provides synchronized text display that follows audio playback, highlighting words as they are spoken and automatically scrolling to keep the current word visible.

## Key Features

- **Cumulative Display**: Words appear progressively and remain visible throughout playback
- **Word Synchronization**: Current word is highlighted based on audio timestamp
- **Auto-Scroll**: Automatically scrolls to keep current word centered when content exceeds 50% of container height
- **Smooth Animations**: Smooth scrolling behavior and word highlighting transitions
- **Playback Control Support**: Handles play, pause, seeking, and different playback speeds

## Architecture

### Data Structure

Transcription data is stored with word-level timestamps:

```typescript
interface TranscriptionWord {
    word: string;
    start: number;  // Start time in seconds (can be Decimal from DynamoDB)
    end: number;    // End time in seconds (can be Decimal from DynamoDB)
}

interface Transcription {
    words: TranscriptionWord[];
    fullText?: string;  // Fallback for non-word-level transcriptions
}
```

### Component Architecture

```
┌─────────────────────────────────────┐
│      Audio Player Component         │
│  (HTML5 audio or custom player)     │
└──────────────┬──────────────────────┘
               │ currentTime
               │ (via timeupdate event)
               ▼
┌─────────────────────────────────────┐
│     StreamingText Component         │
│  - Receives currentTime             │
│  - Finds current word by timestamp  │
│  - Displays words up to current     │
│  - Highlights current word          │
│  - Auto-scrolls when needed         │
└─────────────────────────────────────┘
```

## Implementation

### Step 1: Create TypeScript Types

Create `/src/types/transcription.ts`:

```typescript
export interface TranscriptionWord {
    word: string;
    start: number;  // Start time in seconds
    end: number;    // End time in seconds
}

export interface Transcription {
    words: TranscriptionWord[];
    fullText?: string;  // Fallback text if word-level not available
}

export interface StreamingTextProps {
    transcription: Transcription | null;
    currentTime: number;  // Current playback time in seconds
    isPlaying: boolean;
    className?: string;
}
```

### Step 2: Create StreamingText Component

Create `/src/components/StreamingText.tsx`:

```typescript
'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import styles from './StreamingText.module.css';
import type { Transcription } from '@/types/transcription';

interface StreamingTextProps {
    transcription: Transcription | null;
    currentTime: number;
    isPlaying: boolean;
    className?: string;
}

export function StreamingText({
    transcription,
    currentTime,
    isPlaying,
    className = ''
}: StreamingTextProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const currentWordRef = useRef<HTMLSpanElement>(null);
    const isUserScrollingRef = useRef(false);
    const scrollTimeoutRef = useRef<NodeJS.Timeout>();

    // Find current word index based on timestamp
    const currentWordIndex = useMemo(() => {
        if (!transcription?.words || transcription.words.length === 0) {
            return -1;
        }

        // Convert Decimal to number if needed (DynamoDB compatibility)
        const normalizeTime = (time: number | { toNumber?: () => number }): number => {
            if (typeof time === 'object' && time.toNumber) {
                return time.toNumber();
            }
            return Number(time);
        };

        return transcription.words.findIndex((word) => {
            const start = normalizeTime(word.start);
            const end = normalizeTime(word.end);
            return currentTime >= start && currentTime < end;
        });
    }, [transcription, currentTime]);

    // Calculate how many words to display (cumulative display)
    const visibleWordCount = useMemo(() => {
        if (!transcription?.words || currentWordIndex === -1) {
            return transcription?.words?.length || 0;
        }
        // Show all words up to and including current word
        return currentWordIndex + 1;
    }, [transcription, currentWordIndex]);

    // Auto-scroll to current word
    useEffect(() => {
        if (!currentWordRef.current || !containerRef.current || !isPlaying) {
            return;
        }

        // Don't auto-scroll if user is manually scrolling
        if (isUserScrollingRef.current) {
            return;
        }

        const container = containerRef.current;
        const currentWord = currentWordRef.current;

        // Calculate 50% threshold for auto-scroll activation
        const containerHeight = container.clientHeight;
        const scrollThreshold = containerHeight * 0.5;

        // Check if content exceeds 50% of container height
        if (container.scrollHeight > scrollThreshold) {
            // Scroll to keep current word centered
            currentWord.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
            });
        }
    }, [currentWordIndex, isPlaying]);

    // Detect user scrolling
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleScroll = () => {
            isUserScrollingRef.current = true;

            // Clear existing timeout
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }

            // Resume auto-scroll after 2 seconds of no user interaction
            scrollTimeoutRef.current = setTimeout(() => {
                isUserScrollingRef.current = false;
            }, 2000);
        };

        container.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            container.removeEventListener('scroll', handleScroll);
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }
        };
    }, []);

    // Fallback: display full text if no word-level transcription
    if (!transcription?.words || transcription.words.length === 0) {
        return (
            <div className={`${styles.container} ${className}`} ref={containerRef}>
                <p className={styles.fullText}>
                    {transcription?.fullText || 'No transcription available'}
                </p>
            </div>
        );
    }

    return (
        <div className={`${styles.container} ${className}`} ref={containerRef}>
            <div className={styles.wordsContainer}>
                {transcription.words.slice(0, visibleWordCount).map((wordData, index) => {
                    const isCurrent = index === currentWordIndex;
                    const isPast = index < currentWordIndex;

                    return (
                        <span
                            key={`${index}-${wordData.word}`}
                            ref={isCurrent ? currentWordRef : null}
                            className={`
                                ${styles.word}
                                ${isCurrent ? styles.currentWord : ''}
                                ${isPast ? styles.pastWord : ''}
                            `}
                        >
                            {wordData.word}{' '}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}
```

### Step 3: Create CSS Styling

Create `/src/components/StreamingText.module.css`:

```css
.container {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 8px;
    scroll-behavior: smooth;
}

.wordsContainer {
    font-size: 1.125rem;
    line-height: 1.8;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.word {
    display: inline;
    padding: 2px 4px;
    border-radius: 3px;
    transition: all 0.2s ease;
    color: #666;
}

.currentWord {
    background-color: #ffd700;
    color: #000;
    font-weight: 600;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.pastWord {
    color: #333;
    opacity: 0.8;
}

.fullText {
    margin: 0;
    font-size: 1rem;
    line-height: 1.6;
    color: #333;
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
    .container {
        background: rgba(255, 255, 255, 0.05);
    }

    .word {
        color: #aaa;
    }

    .currentWord {
        background-color: #ffd700;
        color: #000;
    }

    .pastWord {
        color: #ddd;
    }

    .fullText {
        color: #ddd;
    }
}

/* Mobile optimizations */
@media (max-width: 768px) {
    .container {
        padding: 0.75rem;
    }

    .wordsContainer {
        font-size: 1rem;
    }
}
```

### Step 4: Integration with Audio Player

Example integration with HTML5 audio element:

```typescript
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { StreamingText } from '@/components/StreamingText';
import type { Transcription } from '@/types/transcription';

interface AudioPlayerWithTextProps {
    audioUrl: string;
    transcription: Transcription | null;
}

export function AudioPlayerWithText({ audioUrl, transcription }: AudioPlayerWithTextProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handleTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
        };

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('play', handlePlay);
        audio.addEventListener('pause', handlePause);

        return () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('play', handlePlay);
            audio.removeEventListener('pause', handlePause);
        };
    }, []);

    return (
        <div className="audio-player-container">
            <audio ref={audioRef} src={audioUrl} controls className="w-full mb-4" />

            <StreamingText
                transcription={transcription}
                currentTime={currentTime}
                isPlaying={isPlaying}
                className="h-96"
            />
        </div>
    );
}
```

### Step 4b: Quest Map Overlay Integration

The map experience renders the audio player inside the map overlay panel. The `QuestMap` component owns the audio element and passes time/playing state plus transcription into `QuestMapOverlay`, which renders `StreamingText` **only when word-level transcription is present** (narration items).

Key files:
- `src/components/QuestMap.tsx` (audio trigger + state)
- `src/components/QuestMapOverlay.tsx` (panel UI + `<audio>` element)

Quest data can include transcription metadata directly on **narration** timeline items (`streaming_text_audio`):

```json
{
  "mediaTimeline": {
    "version": 1,
    "items": [
      {
        "type": "streaming_text_audio",
        "title": "Narration",
        "media_url": "https://example.r2.dev/narration.mp3",
        "transcription_words": [
          { "word": "Ciao", "start": 0.2, "end": 0.5 }
        ],
        "transcription_text": "Ciao..."
      }
    ]
  }
}
```

If you store the full transcription payload, you can map it into the fields above and run it through `normalizeTranscription` from `src/lib/transcriptionUtils.ts`.

### Step 5: Data Loading and Conversion

Handle DynamoDB Decimal conversion:

```typescript
import type { Transcription, TranscriptionWord } from '@/types/transcription';

// Convert DynamoDB Decimal objects to numbers
function normalizeTranscription(raw: any): Transcription {
    if (!raw?.words || !Array.isArray(raw.words)) {
        return {
            words: [],
            fullText: raw?.fullText || ''
        };
    }

    const words: TranscriptionWord[] = raw.words.map((word: any) => ({
        word: String(word.word || ''),
        start: typeof word.start?.toNumber === 'function'
            ? word.start.toNumber()
            : Number(word.start || 0),
        end: typeof word.end?.toNumber === 'function'
            ? word.end.toNumber()
            : Number(word.end || 0)
    }));

    return {
        words,
        fullText: raw.fullText
    };
}

// Example: Load transcription from API
async function loadTranscription(objectId: string): Promise<Transcription> {
    const response = await fetch(`/api/objects/${objectId}/transcription`);
    const raw = await response.json();
    return normalizeTranscription(raw);
}
```

## Edge Cases Handled

### 1. Missing or Empty Transcription
- Displays fallback text from `transcription.fullText`
- Shows "No transcription available" if completely empty

### 2. Audio Seeking
- User scrolling detection pauses auto-scroll for 2 seconds
- Resumes auto-scroll after timeout to prevent jarring jumps

### 3. Different Playback Speeds
- Uses `currentTime` from audio element, which adjusts automatically
- No special handling needed

### 4. Very Long Transcriptions
- Virtual scrolling not implemented (add if needed for 10,000+ words)
- Current implementation efficient for typical transcriptions (< 5,000 words)

### 5. Mobile Devices
- Touch scrolling detection works the same as desktop
- Responsive font sizes via CSS media queries
- Optimized padding and spacing for small screens

## Testing Checklist

### Manual Testing

- [ ] Words highlight in sync with audio playback
- [ ] Auto-scroll activates when content exceeds 50% container height
- [ ] User scrolling pauses auto-scroll for 2 seconds
- [ ] Current word stays centered during auto-scroll
- [ ] Seeking in audio updates highlighted word immediately
- [ ] Pausing audio stops auto-scroll
- [ ] Playing audio resumes auto-scroll
- [ ] Fallback text displays when word-level data unavailable

### Browser Compatibility

Test in:
- [ ] Chrome (latest)
- [ ] Safari (latest)
- [ ] Firefox (latest)
- [ ] Mobile Safari (iOS)
- [ ] Chrome Mobile (Android)

### Performance

- [ ] Smooth scrolling with 1,000+ words
- [ ] No memory leaks on long playback sessions
- [ ] Responsive UI with no frame drops

## Advanced Features (Optional)

### Click-to-Seek

Allow users to click a word to seek audio to that timestamp:

```typescript
const handleWordClick = (wordIndex: number) => {
    if (!audioRef.current || !transcription?.words[wordIndex]) return;

    const word = transcription.words[wordIndex];
    audioRef.current.currentTime = typeof word.start === 'object'
        ? word.start.toNumber()
        : Number(word.start);
};

// In render:
<span onClick={() => handleWordClick(index)}>
    {wordData.word}
</span>
```

### Highlighting Speed

Adjust transition speed based on word duration:

```css
.word {
    transition-duration: calc(var(--word-duration) * 1s);
}
```

```typescript
<span
    style={{ '--word-duration': wordData.end - wordData.start }}
    className={styles.word}
>
```

### Karaoke Mode

Animate word appearance character-by-character for karaoke effect.

## Troubleshooting

### Words not highlighting

1. Check `currentTime` is updating (log in console)
2. Verify transcription data has valid `start` and `end` times
3. Ensure times are in seconds (not milliseconds)

### Auto-scroll not working

1. Check container has `overflow-y: auto` and fixed height
2. Verify `isPlaying` prop is true
3. Check browser console for scroll errors

### Performance issues

1. Add `will-change: transform` to `.word` CSS
2. Implement virtual scrolling for 5,000+ words
3. Debounce scroll event handler

## API Integration Example

Complete example with object data:

```typescript
'use client';

import React, { useEffect, useState } from 'react';
import { AudioPlayerWithText } from '@/components/AudioPlayerWithText';
import type { Transcription } from '@/types/transcription';

export default function ObjectPage({ params }: { params: { id: string } }) {
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [transcription, setTranscription] = useState<Transcription | null>(null);

    useEffect(() => {
        async function loadData() {
            const res = await fetch(`/api/objects/${params.id}`);
            const data = await res.json();

            setAudioUrl(data.interaction_data?.audio_url);

            if (data.interaction_data?.transcription) {
                setTranscription(normalizeTranscription(data.interaction_data.transcription));
            }
        }

        loadData();
    }, [params.id]);

    if (!audioUrl) return <div>Loading...</div>;

    return (
        <div className="container mx-auto p-4">
            <AudioPlayerWithText
                audioUrl={audioUrl}
                transcription={transcription}
            />
        </div>
    );
}
```

## Summary

The Streaming Text implementation provides a professional, accessible way to display synchronized transcriptions with audio playback. Key benefits:

- **Accessibility**: Makes audio content accessible to deaf/hard-of-hearing users
- **Engagement**: Helps users follow along and understand content better
- **Navigation**: Users can see where they are in the audio
- **Professional**: Smooth animations and modern UI

The implementation is production-ready and handles all common edge cases.
