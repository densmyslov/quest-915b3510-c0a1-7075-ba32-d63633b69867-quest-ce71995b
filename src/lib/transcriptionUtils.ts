/**
 * Utility functions for handling transcription data
 * Includes DynamoDB Decimal conversion and data normalization
 */

import type {
    Transcription,
    TranscriptionWord,
    TranscriptionRaw,
    TranscriptionWordRaw
} from '@/types/transcription';

/**
 * Normalize a time value (convert DynamoDB Decimal to number)
 */
export function normalizeTime(time: number | { toNumber?: () => number }): number {
    if (typeof time === 'object' && time !== null && 'toNumber' in time && typeof time.toNumber === 'function') {
        return time.toNumber();
    }
    return Number(time);
}

/**
 * Normalize a single transcription word
 */
export function normalizeWord(word: TranscriptionWordRaw): TranscriptionWord {
    const raw: any = word as any;

    // Support common alternate shapes from different transcription providers.
    // Examples:
    // - { word, start_time, end_time }
    // - { text, startTime, endTime }
    // - [start, end, word]
    const fallbackFromArray = Array.isArray(raw)
        ? { start: raw[0], end: raw[1], word: raw[2] }
        : null;
    const source = fallbackFromArray ?? raw;

    const rawWord =
        source?.word ??
        source?.text ??
        source?.token ??
        source?.value ??
        '';

    const rawStart =
        source?.start ??
        source?.start_time ??
        source?.startTime ??
        source?.start_ms ??
        source?.startMs ??
        source?.begin ??
        source?.begin_time;

    const rawEnd =
        source?.end ??
        source?.end_time ??
        source?.endTime ??
        source?.end_ms ??
        source?.endMs ??
        source?.finish ??
        source?.finish_time;

    return {
        word: String(rawWord || ''),
        start: normalizeTime(rawStart),
        end: normalizeTime(rawEnd)
    };
}

/**
 * Normalize transcription data from raw format (e.g., DynamoDB)
 * Converts Decimal objects to numbers and ensures proper types
 */
export function normalizeTranscription(raw: TranscriptionRaw | null | undefined): Transcription {
    if (!raw) {
        return {
            words: [],
            fullText: ''
        };
    }

    if (!raw.words || !Array.isArray(raw.words) || raw.words.length === 0) {
        return {
            words: [],
            fullText: raw.fullText || ''
        };
    }

    let words: TranscriptionWord[] = raw.words
        .map((w) => {
            try {
                return normalizeWord(w);
            } catch {
                return { word: '', start: NaN, end: NaN };
            }
        })
        .filter((w) => w.word.trim().length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end))
        .map((w) => {
            const start = w.start;
            const end = w.end;
            if (end >= start) return w;
            return { ...w, start: end, end: start };
        });

    // Heuristic: detect millisecond-based timestamps and convert to seconds.
    // Many transcription sources use ms (e.g. 250 instead of 0.25).
    if (words.length > 0) {
        const maxEnd = Math.max(...words.map((w) => w.end));
        const durations = words
            .map((w) => Math.max(0, w.end - w.start))
            .filter((d) => Number.isFinite(d) && d > 0)
            .sort((a, b) => a - b);
        const medianDuration = durations.length ? durations[Math.floor(durations.length / 2)] : 0;
        const looksLikeMs = maxEnd > 10_000 || medianDuration > 10;
        if (looksLikeMs) {
            words = words.map((w) => ({ ...w, start: w.start / 1000, end: w.end / 1000 }));
        }
    }

    // Ensure deterministic ordering for binary-search consumers.
    words = words
        .map((w, idx) => ({ w, idx }))
        .sort((a, b) => (a.w.start - b.w.start) || (a.w.end - b.w.end) || (a.idx - b.idx))
        .map(({ w }) => w);

    return {
        words,
        fullText: raw.fullText
    };
}

/**
 * Validate transcription data
 * Returns true if transcription has valid word-level data
 */
export function hasWordLevelTranscription(transcription: Transcription | null | undefined): boolean {
    return !!(transcription?.words && transcription.words.length > 0);
}

/**
 * Get transcription duration in seconds
 */
export function getTranscriptionDuration(transcription: Transcription | null | undefined): number {
    if (!hasWordLevelTranscription(transcription)) {
        return 0;
    }

    const lastWord = transcription!.words[transcription!.words.length - 1];
    return normalizeTime(lastWord.end);
}

/**
 * Find word at specific timestamp
 */
export function findWordAtTime(
    transcription: Transcription | null | undefined,
    currentTime: number
): TranscriptionWord | null {
    if (!hasWordLevelTranscription(transcription)) {
        return null;
    }

    const word = transcription!.words.find((w) => {
        const start = normalizeTime(w.start);
        const end = normalizeTime(w.end);
        return currentTime >= start && currentTime < end;
    });

    return word || null;
}

/**
 * Get all words up to current time (for cumulative display)
 */
export function getWordsUpToTime(
    transcription: Transcription | null | undefined,
    currentTime: number
): TranscriptionWord[] {
    if (!hasWordLevelTranscription(transcription)) {
        return [];
    }

    const currentWordIndex = transcription!.words.findIndex((w) => {
        const start = normalizeTime(w.start);
        const end = normalizeTime(w.end);
        return currentTime >= start && currentTime < end;
    });

    if (currentWordIndex === -1) {
        return transcription!.words;
    }

    return transcription!.words.slice(0, currentWordIndex + 1);
}

/**
 * Format time in MM:SS format
 */
export function formatTimestamp(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
