// types/puzzle.ts

/**
 * Represents a single puzzle piece
 */
export interface PieceData {
    /** Unique identifier for the piece */
    id: string;

    /** Base64 encoded PNG image of the piece (with transparency). Optional if `imageUrl` is present. */
    imageDataUrl?: string;

    /** URL to piece image after upload to storage (optional) */
    imageUrl?: string;

    /** Stable image identifier (Cloudflare Images custom ID/key-like path) */
    imageKey?: string;

    /** Bounding rectangle of the piece in canvas coordinates */
    boundingRect: {
        left: number;
        top: number;
        width: number;
        height: number;
    };

    /** 
     * The correct center position where this piece should be placed
     * Used for snap detection in the game
     */
    correctPosition: {
        x: number;
        y: number;
    };

    /** Correct rotation in degrees (0-359) */
    correctRotation: number;

    /** Whether the piece was flipped during creation */
    isFlipped: boolean;

    /** Optional: Original polygon vertices for precise collision detection */
    vertices?: Array<{ x: number; y: number }>;

    /** Optional: Width of the piece */
    width?: number;

    /** Optional: Height of the piece */
    height?: number;

    /** Optional: Original image data for Spot-the-Difference (the "correct" state) */
    origImageDataUrl?: string;

    /** Optional: URL to original piece image after upload */
    origImageUrl?: string;

    /** Stable image identifier (Cloudflare Images custom ID/key-like path) */
    origImageKey?: string;

    /**
     * Coordinate-based rendering (NEW)
     * Stores polygon/freehand coordinates for dynamic piece generation
     * Reduces payload size by 90%+ vs base64 images
     */
    shapeData?: {
        /** Type of shape data */
        type: 'polygon' | 'path';
        /** Normalized polygon points relative to original image origin */
        points?: Array<{ x: number; y: number }>;
        /** SVG path data for freehand shapes */
        pathData?: string;
    };
}

/**
 * Complete puzzle data structure
 */
export interface PuzzleData {
    /** Unique identifier for the puzzle */
    puzzleId: string;

    /** ISO timestamp of when the puzzle was created */
    createdAt: string;

    /** ISO timestamp of last update */
    updatedAt?: string;

    /** Dimensions of the puzzle board */
    imageDimensions: {
        width: number;
        height: number;
    };

    /** Array of all puzzle pieces */
    pieces: PieceData[];

    /** Total number of pieces */
    totalPieces: number;

    /** URL or data URL of the original source image */
    originalImageUrl: string;

    /** Optional: URL or data URL of the difference image */
    diffImageUrl?: string;

    /** 
     * Base64 encoded PNG of the board with holes punched out
     * Used as the background in the puzzle game
     */
    boardImageDataUrl?: string;

    /** URL to board image after upload to storage */
    boardImageUrl?: string;

    /** Stable image identifier (Cloudflare Images custom ID/key-like path) */
    boardImageKey?: string;

    /** Optional: Link to quest stop (for Esino Lario integration) */
    questStopId?: string;

    /** Difficulty setting */
    difficulty?: 'easy' | 'medium' | 'hard';

    /** Optional: Enable piece rotation */
    enableRotation?: boolean;

    /** Optional: Snap threshold in pixels */
    snapThreshold?: number;

    /** Optional metadata */
    metadata?: {
        title?: string;
        description?: string;
        author?: string;
        location?: string;
        type?: string;
        gridRows?: number;
        gridCols?: number;
        tabSize?: number;
    };

    /** Optional: Regions for Spot-the-Difference */
    regions?: Array<{
        id: string;
        points: { x: number; y: number }[];
        centerX: number;
        centerY: number;
        isSaved: boolean;
    }>;
    /** 
     * If true, correctPosition coordinates are already normalized relative to the image (0,0).
     * If false, they may include canvas margins and require auto-detection. 
     */
    isNormalized?: boolean;

    /** Stable image identifier (Cloudflare Images custom ID/key-like path) */
    originalImageKey?: string;

    /** Stable image identifier (Cloudflare Images custom ID/key-like path) */
    diffImageKey?: string;
}

/**
 * Game state for tracking puzzle progress
 */
export interface PuzzleGameState {
    /** IDs of pieces that have been correctly placed */
    placedPieceIds: Set<string>;

    /** Currently selected piece ID */
    selectedPieceId: string | null;

    /** Timer in seconds */
    timer: number;

    /** Number of moves (drags) made */
    moves: number;

    /** Whether the puzzle is complete */
    isComplete: boolean;

    /** Whether hint mode is active */
    showHint: boolean;
}

/**
 * Snap detection configuration
 */
export interface SnapConfig {
    /** Distance in pixels for position snapping */
    positionThreshold: number;

    /** Angle in degrees for rotation snapping */
    rotationThreshold: number;

    /** Allowed rotation increments (e.g., [0, 90, 180, 270]) */
    allowedRotations?: number[];
}

/**
 * Difficulty presets
 */
export const DIFFICULTY_PRESETS: Record<string, SnapConfig> = {
    easy: {
        positionThreshold: 50,
        rotationThreshold: 45,
        allowedRotations: [0, 180]
    },
    medium: {
        positionThreshold: 30,
        rotationThreshold: 20,
        allowedRotations: [0, 90, 180, 270]
    },
    hard: {
        positionThreshold: 15,
        rotationThreshold: 10,
        allowedRotations: undefined // Free rotation
    }
};

/**
 * Completion stats returned when puzzle is solved
 */
export interface PuzzleCompletionStats {
    /** Time to complete in seconds */
    time: number;

    /** Number of moves made */
    moves: number;

    /** Number of pieces */
    pieces: number;

    /** Difficulty setting */
    difficulty?: string;
}
