export interface PuzzlePiece {
    id: string;
    image: string;
    targetX: number; // Position on board where piece belongs
    targetY: number;
    currentX?: number; // Current dragged position
    currentY?: number;
    placed: boolean;
    unlocked?: boolean; // For location-based unlocking
    locationId?: string; // ID of the location trigger
}

export interface LocationTrigger {
    locationId: string;
    pieceId: string;
    lat: number;
    lng: number;
    unlockMessage: string;
}

export interface TouchPoint {
    x: number;
    y: number;
}

export interface PuzzleState {
    pieces: PuzzlePiece[];
    scale: number;
    translate: TouchPoint;
    isComplete: boolean;
}

export interface PuzzleGameOptions {
    initialPieces: PuzzlePiece[];
    snapThreshold?: number;
    onPiecePlace?: (pieceId: string) => void;
    onPuzzleComplete?: () => void;
}
