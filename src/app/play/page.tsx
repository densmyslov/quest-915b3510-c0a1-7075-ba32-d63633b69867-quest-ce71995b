'use client';

import { useQuest } from '@/context/QuestContext';
import Navigation from '@/components/Navigation';
import PuzzleWrapper from './PuzzleWrapper';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { PuzzleData } from '@/types/puzzle';

type PuzzleType = 'fabric_custom' | 'witch_knot' | 'witch_knot_simple';

function PlayContent() {
    const searchParams = useSearchParams();
    const puzzleId = searchParams.get('id');
    const userId = '915b3510-c0a1-7075-ba32-d63633b69867';

    const { data } = useQuest();
    const [puzzleData, setPuzzleData] = useState<PuzzleData | Record<string, unknown> | null>(null);
    const [puzzleType, setPuzzleType] = useState<PuzzleType>('fabric_custom');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        console.log('🔍 useEffect running:', {
            puzzleId,
            hasData: !!data,
            hasPuzzles: !!data?.puzzles,
            puzzleCount: data?.puzzles?.length
        });

        setPuzzleData(null);
        setIsLoading(false);

        if (!puzzleId || !data?.puzzles) {
            console.log('⏹️ Early exit - missing puzzleId or puzzles');
            return;
        }

        const rawPuzzleData = data.puzzles.find(p => p.id === puzzleId);
        console.log('🔍 Found puzzle:', {
            found: !!rawPuzzleData,
            hasPieces: !!rawPuzzleData?.pieces,
            piecesLength: rawPuzzleData?.pieces?.length,
            hasInteractionData: !!(rawPuzzleData as any)?.interaction_data,
            puzzleDataUrl: (rawPuzzleData as any)?.interaction_data?.puzzle_data_url,
            puzzleType: (rawPuzzleData as any)?.interaction_data?.type || (rawPuzzleData as any)?.type
        });

        if (!rawPuzzleData) {
            console.log('⏹️ Puzzle not found in data.puzzles');
            return;
        }

        const rawType = (rawPuzzleData as any)?.interaction_data?.type || (rawPuzzleData as any)?.type;
        const resolvedType: PuzzleType =
            rawType === 'witch_knot' ? 'witch_knot' :
                rawType === 'witch_knot_simple' ? 'witch_knot_simple' :
                    'fabric_custom';
        setPuzzleType(resolvedType);

        const inlineData =
            (rawPuzzleData as any)?.data ||
            (rawPuzzleData as any)?.interaction_data?.puzzle_data;
        if (inlineData) {
            setPuzzleData(inlineData);
            return;
        }

        // Check if we already have pieces (embedded at build time)
        if (resolvedType === 'fabric_custom' && rawPuzzleData.pieces && rawPuzzleData.pieces.length > 0) {
            console.log('✅ Using embedded puzzle data');

            const pieces = rawPuzzleData.pieces.map((p: any) => ({
                ...p,
                imageDataUrl: p.image || p.imageDataUrl,
                correctPosition: p.correctPosition || { x: p.targetX, y: p.targetY },
                boundingRect: p.boundingRect || { left: 0, top: 0, width: 100, height: 100 } // Polyfill for legacy data
            }));

            // Build a complete PuzzleData object
            const completePuzzleData: PuzzleData = {
                puzzleId: rawPuzzleData.id,
                createdAt: (rawPuzzleData as any).createdAt || new Date().toISOString(),
                imageDimensions: (rawPuzzleData as any).imageDimensions || { width: 1024, height: 768 },
                totalPieces: pieces.length,
                pieces,
                originalImageUrl: (rawPuzzleData as any).photo_url || rawPuzzleData.boardImage || '',
                boardImageUrl: rawPuzzleData.boardImage || (rawPuzzleData as any).photo_url,
                boardImageDataUrl: (rawPuzzleData as any).boardImageDataUrl,
                isNormalized: (rawPuzzleData as any).isNormalized
            };

            setPuzzleData(completePuzzleData);
            return;
        }

        // No embedded data - fetch puzzle data from the data proxy worker
        const puzzleDataUrl = (rawPuzzleData as any).interaction_data?.puzzle_data_url;
        if (!puzzleDataUrl) {
            console.error('❌ No puzzle_data_url found');
            return;
        }

        const fetchPuzzleData = async () => {
            setIsLoading(true);
            try {
                // Use the dedicated quest-data-proxy worker
                // URL Structure: https://quest-data-proxy-dev.denslov.workers.dev/clients/...

                let path = puzzleDataUrl;
                // If it's a relative path (clients/...), prepend our new worker domain
                if (!path.startsWith('http')) {
                    const relativePath = path.replace(/^\/+/, '');
                    path = `https://quest-data-proxy-dev.denslov.workers.dev/${relativePath}`;
                } else if (path.includes('quest-image-manager')) {
                    // If it's using the old worker, switch to the new one and ensure correct path
                    // Old: .../image/clients/... -> New: .../clients/...
                    const relativePath = path.split('/clients/')[1];
                    path = `https://quest-data-proxy-dev.denslov.workers.dev/clients/${relativePath}`;
                }

                console.log('📦 Fetching puzzle data from Data Proxy:', path);

                const response = await fetch(path);
                if (!response.ok) throw new Error(`Failed to fetch puzzle data: ${response.status}`);

                const pData = await response.json();
                console.log('✅ Loaded puzzle:', { pieces: pData.pieces?.length });

                setPuzzleData(pData);
            } catch (error) {
                console.error('❌ Error loading puzzle:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchPuzzleData();
    }, [puzzleId, data?.puzzles]);

    // 1. Puzzle Mode
    if (puzzleId) {
        if (isLoading) {
            return (
                <div className="w-full h-screen bg-slate-900 flex items-center justify-center">
                    <div className="text-white">Loading puzzle...</div>
                </div>
            );
        }

        if (!puzzleData) {
            return (
                <div className="w-full h-screen bg-slate-900 flex items-center justify-center">
                    <div className="text-white">Waiting for puzzle data...</div>
                </div>
            );
        }

        return (
            <div className="w-full h-screen bg-slate-900">
                <PuzzleWrapper
                    type={puzzleType}
                    puzzleId={puzzleId}
                    userId={userId}
                    initialData={puzzleData}
                />
            </div>
        );
    }

    // 2. Dashboard Mode
    if (!data) return null;

    return (
        <main className="flex min-h-screen flex-col bg-gray-50 dark:bg-zinc-950 pb-16">
            <div className="p-6 max-w-5xl mx-auto w-full">
                <header className="mb-8 pt-8">
                    <h1 className="text-3xl font-bold mb-2">{data.quest.name}</h1>
                    <p className="text-gray-600 dark:text-gray-400">{data.quest.description || ''}</p>
                </header>

                <div className="grid gap-4">
                    <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-zinc-800">
                        <h2 className="text-xl font-semibold mb-4">Current Objective</h2>
                        <p className="text-gray-600 dark:text-gray-400">
                            Explore the map to find your first clue!
                        </p>
                    </div>

                    <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-zinc-800 opacity-50">
                        <h2 className="text-xl font-semibold mb-4">Locked</h2>
                        <p className="text-gray-600 dark:text-gray-400">
                            Complete the current objective to unlock more content.
                        </p>
                    </div>
                </div>
            </div>

            <Navigation />
        </main>
    );
}

export default function PlayPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <PlayContent />
        </Suspense>
    );
}
