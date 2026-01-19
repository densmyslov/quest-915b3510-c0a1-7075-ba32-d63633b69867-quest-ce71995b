export type JudgeResult = {
    pass: boolean;
    accuracy: number; // pitch + time
    pitchAccuracy: number;
    hitWindowMs: number;
    maxExtraNotes: number;
    maxMissingNotes: number;
    anchorOffsetMs: number;
    perNote: Array<{
        noteId: string;
        expectedMs: number;
        actualMs: number | null;
        pitchExpected: number;
        pitchActual: number | null;
        okPitch: boolean;
        okTime: boolean;
        offsetMs: number | null;
        windowMs: number;
        matchedPlayerIndex: number | null;
    }>;
    extras: Array<{ pitch: number; actualMs: number; playerIndex: number }>;
    telemetry: {
        matched: number;
        missing: number;
        extras: number;
        meanOffsetMs: number | null;
        stdOffsetMs: number | null;
    };
    _score?: {
        timeCorrect: number;
        pitchCorrect: number;
        missing: number;
        extras: number;
        cost: number;
    };
};

export type PlayerEvent = {
    pitch: number;
    tLocalMs: number;
};
