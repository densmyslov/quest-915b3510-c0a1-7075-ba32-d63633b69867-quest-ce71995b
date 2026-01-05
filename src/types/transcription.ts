/**
 * Transcription data types for audio streaming text display
 */

export interface TranscriptionWord {
    word: string;
    start: number;  // Start time in seconds (can be Decimal from DynamoDB)
    end: number;    // End time in seconds (can be Decimal from DynamoDB)
}

export interface Transcription {
    words: TranscriptionWord[];
    fullText?: string;  // Fallback text if word-level transcription not available
}

export interface StreamingTextProps {
    transcription: Transcription | null;
    currentTime: number;  // Current playback time in seconds
    isPlaying: boolean;
    className?: string;
}

/**
 * Helper type for DynamoDB Decimal compatibility
 * DynamoDB returns Decimal objects that need conversion to number
 */
export type DynamoDBDecimal = {
    toNumber(): number;
};

export type TranscriptionWordRaw = {
    word: string;
    start: number | DynamoDBDecimal;
    end: number | DynamoDBDecimal;
};

export type TranscriptionRaw = {
    words?: TranscriptionWordRaw[];
    fullText?: string;
};
