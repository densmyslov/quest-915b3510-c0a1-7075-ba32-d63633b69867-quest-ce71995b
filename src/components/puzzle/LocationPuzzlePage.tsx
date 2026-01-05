'use client';

import { useQuest } from '@/context/QuestContext';
import Navigation from '@/components/Navigation';
import { usePuzzleGame } from './usePuzzleGame';
import { useRef } from 'react';
import { GeolocationTracker } from '@/components/GeolocationTracker';
import { PuzzlePiece } from './puzzle-types';

interface LocationPuzzlePageProps {
    puzzleId?: string;
}

export function LocationPuzzlePage({ puzzleId }: LocationPuzzlePageProps) {
    const { data, updateProgress, progress } = useQuest();

    // Find the correct puzzle from data
    const puzzleData = data?.puzzles.find(p => p.id === puzzleId || (!puzzleId && data.puzzles.length > 0));

    // Transform API pieces to PuzzlePiece state
    const initialPieces: PuzzlePiece[] = (puzzleData?.pieces || []).map(p => ({
        ...p,
        // It is unlocked if it's in our collected list OR if it's set to unlocked by default
        unlocked: p.unlocked || (progress?.collectedPieces || []).includes(p.id),
        placed: (progress?.placedPieces || []).includes(p.id),
        placedFromStart: (progress?.placedPieces || []).includes(p.id) // Helper to init placed state
    }));

    const {
        pieces,
        scale,
        setScale,
        translate,
        setTranslate,
        containerRef,
        handleBoardTouchStart,
        handleBoardTouchEnd,
        handlePieceTouchStart,
        handlePieceTouchMove,
        handlePieceTouchEnd,
        isComplete
    } = usePuzzleGame({
        initialPieces: initialPieces.length > 0 ? initialPieces : [],
        onPiecePlace: (pieceId) => {
            updateProgress({
                placedPieces: [...(progress?.placedPieces || []), pieceId]
            });
        },
        onPuzzleComplete: () => {
            if (puzzleData) {
                updateProgress({
                    completedPuzzles: [...(progress?.completedPuzzles || []), puzzleData.id]
                });
                alert("Congratulations! You've restored the mosaic!");
            }
        }
    });

    const boardRef = useRef<HTMLDivElement>(null);

    if (!data || !puzzleData) {
        return <div className="flex h-screen items-center justify-center">Loading or Puzzle Not Found...</div>;
    }

    return (
        <main className="flex min-h-screen flex-col bg-gray-50 dark:bg-zinc-950">
            {/* Geolocation Tracker running in background to unlock pieces */}
            <GeolocationTracker />

            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <header className="p-4 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800">
                    <h1 className="text-xl font-bold">{data.quest.name}</h1>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        {pieces.filter(p => p.placed).length} / {pieces.length} restored
                    </p>
                </header>

                {/* Game Board Container */}
                <div
                    ref={containerRef}
                    className="flex-1 relative overflow-hidden touch-none"
                    onTouchStart={handleBoardTouchStart}
                    onTouchEnd={handleBoardTouchEnd}
                >
                    {/* Zoom controls */}
                    <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
                        <button
                            onClick={() => setScale(prev => Math.min(3, prev + 0.2))}
                            className="w-10 h-10 bg-white dark:bg-zinc-800 rounded-lg shadow-lg flex items-center justify-center text-xl font-bold"
                        >
                            +
                        </button>
                        <button
                            onClick={() => setScale(prev => Math.max(0.5, prev - 0.2))}
                            className="w-10 h-10 bg-white dark:bg-zinc-800 rounded-lg shadow-lg flex items-center justify-center text-xl font-bold"
                        >
                            −
                        </button>
                        <button
                            onClick={() => {
                                setScale(1);
                                setTranslate({ x: 0, y: 0 });
                            }}
                            className="w-10 h-10 bg-white dark:bg-zinc-800 rounded-lg shadow-lg flex items-center justify-center text-xs"
                        >
                            Reset
                        </button>
                    </div>

                    {/* Board with pieces */}
                    <div
                        ref={boardRef}
                        className="absolute inset-0 origin-top-left transition-transform"
                        style={{
                            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
                        }}
                    >
                        {/* Background board image */}
                        <div className="relative w-full h-full">
                            {puzzleData.boardImage && (
                                <img
                                    src={puzzleData.boardImage}
                                    alt="Puzzle board"
                                    className="w-full h-full object-contain pointer-events-none select-none"
                                    draggable={false}
                                />
                            )}

                            {/* Placed pieces on board */}
                            {pieces
                                .filter(piece => piece.currentX !== undefined && piece.currentY !== undefined)
                                .map(piece => (
                                    <div
                                        key={`placed-${piece.id}`}
                                        className={`absolute pointer-events-none ${piece.placed ? 'opacity-100' : 'opacity-70'
                                            }`}
                                        style={{
                                            left: piece.currentX,
                                            top: piece.currentY,
                                            width: 80,
                                            height: 80,
                                        }}
                                    >
                                        <img
                                            src={piece.image}
                                            alt={`Piece ${piece.id}`}
                                            className="w-full h-full object-contain select-none"
                                            draggable={false}
                                        />
                                    </div>
                                ))}
                        </div>
                    </div>
                </div>

                {/* Piece Tray at bottom */}
                <div
                    className="h-36 bg-zinc-900 border-t border-zinc-800 flex items-center gap-4 px-4 overflow-x-auto py-2"
                    onTouchMove={handlePieceTouchMove}
                    onTouchEnd={handlePieceTouchEnd}
                >
                    {/* Show LOCKED pieces too, but grayed out */}
                    {pieces
                        .filter(piece => !piece.placed && piece.currentX === undefined)
                        .map(piece => {
                            const isLocked = !piece.unlocked;
                            return (
                                <div
                                    key={piece.id}
                                    className={`flex-shrink-0 w-24 h-24 relative ${isLocked ? 'opacity-50 grayscale' : 'cursor-move touch-none'}`}
                                    onTouchStart={!isLocked ? (e) => handlePieceTouchStart(e, piece.id) : undefined}
                                >
                                    <img
                                        src={piece.image}
                                        alt={`Piece ${piece.id}`}
                                        className="w-full h-full object-contain select-none pointer-events-none"
                                        draggable={false}
                                    />
                                    {isLocked && (
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="text-2xl">🔒</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                    {isComplete && (
                        <div className="text-center py-4 w-full">
                            <p className="text-green-400 font-bold text-lg">
                                🎉 Mosaic Restored!
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <Navigation />
        </main>
    );
}
