export type InteractionPhase = 'idle' | 'listening' | 'input' | 'result';

export interface ModeContext {
    startListening: (options: {
        loop?: boolean;
        muteAudio?: boolean;
        playbackRate?: number;
        autoStart?: boolean;
        onComplete?: () => void;
    }) => void;
    setPhase: (phase: InteractionPhase) => void;
    setActiveNoteIds: (ids: string[]) => void;
    setActiveStoneIds: (ids: string[]) => void;
    trainingTempo: number;
    pitchToStoneId: Map<number, string>;
    applyColorToNoteId: (noteId: string, color: string, scale?: number) => void;
    baseColorById: Map<string, string>;
    notesById: Map<string, Array<{ noteId: string; pitch: number; gNote: any }>>;
}

export interface GameModeStrategy {
    start: (ctx: ModeContext) => void;
    handleActiveNotes: (ctx: ModeContext, noteIds: string[]) => void;
    shouldAllowInput: (phase: InteractionPhase) => boolean;
    handleInput?: (params: any) => void;
}
