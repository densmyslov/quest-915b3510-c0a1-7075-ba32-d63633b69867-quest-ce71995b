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
    return {
        word: String(word.word || ''),
        start: normalizeTime(word.start),
        end: normalizeTime(word.end)
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

    const words: TranscriptionWord[] = raw.words.map(normalizeWord);

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
