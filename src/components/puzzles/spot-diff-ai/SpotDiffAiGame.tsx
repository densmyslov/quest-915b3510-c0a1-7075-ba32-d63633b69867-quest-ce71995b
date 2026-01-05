'use client';

import React, { useMemo } from 'react';
import SpotDifferenceGame from '../spot-difference/SpotDifferenceGame';

type SavedShapeCoords = {
    id: string;
    points: { rx: number; ry: number }[];
};

type SpotDiffAiPuzzleData = {
    puzzleId: string;
    originalImageUrl: string;
    diffImageUrl?: string;
    boardImageUrl?: string;
    boardImageDataUrl?: string;
    pieces?: Array<{
        id: string;
        vertices?: Array<{ x: number; y: number }>;
    }>;
    imageDimensions?: { width: number; height: number };
    regions?: Array<{
        id: string;
        points: { x: number; y: number }[];
        centerX: number;
        centerY: number;
    }>;
    spotDiffAi?: {
        savedCoords?: SavedShapeCoords[];
    };
};

interface SpotDiffAiGameProps {
    puzzleData: SpotDiffAiPuzzleData;
    onComplete?: () => void;
}

function buildRegionsFromSavedCoords(
    savedCoords: SavedShapeCoords[] | undefined,
    dimensions: { width: number; height: number }
) {
    if (!Array.isArray(savedCoords)) return [];
    return savedCoords
        .filter(shape => Array.isArray(shape.points) && shape.points.length >= 3)
        .map(shape => {
            const points = shape.points.map(p => ({
                x: p.rx * dimensions.width,
                y: p.ry * dimensions.height,
                rx: p.rx,
                ry: p.ry
            }));
            const center = points.reduce(
                (acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }),
                { x: 0, y: 0 }
            );
            return {
                id: shape.id,
                points,
                centerX: center.x,
                centerY: center.y
            };
        });
}

export default function SpotDiffAiGame({ puzzleData, onComplete }: SpotDiffAiGameProps) {
    const adaptedPuzzleData = useMemo(() => {
        const imageDimensions = puzzleData.imageDimensions || { width: 1, height: 1 };
        const savedCoords = puzzleData.spotDiffAi?.savedCoords;
        const regions =
            (Array.isArray(puzzleData.regions) && puzzleData.regions.length > 0)
                ? puzzleData.regions
                : buildRegionsFromSavedCoords(savedCoords, imageDimensions);

        return {
            puzzleId: puzzleData.puzzleId,
            originalImageUrl: puzzleData.originalImageUrl,
            diffImageUrl: puzzleData.diffImageUrl || puzzleData.boardImageUrl || puzzleData.boardImageDataUrl,
            boardImageUrl: puzzleData.boardImageUrl,
            boardImageDataUrl: puzzleData.boardImageDataUrl,
            regions,
            pieces: puzzleData.pieces || [],
            imageDimensions
        };
    }, [puzzleData]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <SpotDifferenceGame puzzleData={adaptedPuzzleData as any} onComplete={onComplete} />;
}
