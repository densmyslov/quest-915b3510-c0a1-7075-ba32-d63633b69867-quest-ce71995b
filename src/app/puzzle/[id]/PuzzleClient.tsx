'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useQuest } from '@/context/QuestContext';
import { useTeamSync } from '@/context/TeamSyncContext';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getSoloTeamStartedAt, isSoloTeamSession } from '@/lib/soloTeam';
import { CongratulationsPopup } from '@/components/CongratulationsPopup';

const PuzzleRenderer = dynamic(() => import('@/components/puzzles/PuzzleRenderer').then(mod => mod.PuzzleRenderer), {
    ssr: false,
    loading: () => <div className="h-screen w-full flex items-center justify-center bg-gray-900 text-white">Loading Puzzle...</div>
});

interface PuzzleClientProps {
    puzzleId: string;
    objectId?: string;
    onClose?: () => void;
}

type PuzzleType =
    | 'fabric_custom'
    | 'jigsaw_custom'
    | 'jigsaw'
    | 'witch_knot'
    | 'witch_knot_simple'
    | 'spot_diff_ai'
    | 'musical_code_fountain';

export default function PuzzleClient(props: PuzzleClientProps) {
    const { puzzleId } = props;
    const { data, runtime } = useQuest();
    const teamSync = useTeamSync();
    const router = useRouter();
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const userId = '915b3510-c0a1-7075-ba32-d63633b69867';
    const objectId = props.objectId || searchParams.get('objectId');
    const resolvedPuzzleId = React.useMemo(() => {
        if (puzzleId) return puzzleId;
        if (!pathname) return null;
        const parts = pathname.split('/').filter(Boolean);
        const idx = parts.indexOf('puzzle');
        if (idx >= 0 && parts[idx + 1]) {
            return decodeURIComponent(parts[idx + 1]);
        }
        const last = parts[parts.length - 1];
        if (!last || last === 'puzzle') return null;
        return decodeURIComponent(last);
    }, [puzzleId, pathname]);

    // State for congratulations popup
    const [congratsPoints, setCongratsPoints] = React.useState<number | null>(null);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const autoCloseTimerRef = React.useRef<number | null>(null);

    // Get session and team context for pattern distribution
    const sessionId =
        teamSync.session?.sessionId ??
        (typeof window !== 'undefined' ? sessionStorage.getItem('quest_sessionId') : null);

    const isTeamMode = !!teamSync.teamCode && !!teamSync.session;
    const soloTeam = isTeamMode && isSoloTeamSession();
    const startedAtIso = isTeamMode
        ? (soloTeam ? getSoloTeamStartedAt() ?? undefined : teamSync.team?.startedAt)
        : undefined;

    // Get all team member session IDs for knot distribution
    const teamMemberIds = isTeamMode && teamSync.team?.members
        ? teamSync.team.members.map(m => m.sessionId)
        : undefined;

    const markPuzzleCompletedLocally = React.useCallback((id: string | null) => {
        if (!id || typeof window === 'undefined') return;
        try {
            const key = 'quest_completed_puzzles';
            const raw = sessionStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : [];
            const list = Array.isArray(parsed) ? parsed : [];
            if (!list.includes(id)) {
                list.push(id);
                sessionStorage.setItem(key, JSON.stringify(list));
            }
        } catch {
            // Ignore storage issues
        }
    }, []);

    const currentPuzzleType = React.useMemo(() => {
        const currentPuzzle = data?.puzzles?.find(p => p.id === resolvedPuzzleId);
        return currentPuzzle?.interaction_data?.type || (currentPuzzle as any)?.type || null;
    }, [data?.puzzles, resolvedPuzzleId]);

    React.useEffect(() => {
        if (!teamSync.teamCode || !teamSync.session) {
            teamSync.setOnScoreUpdate(null);
            return;
        }

        teamSync.setOnScoreUpdate((points) => {
            const isTeamSyncPuzzle = currentPuzzleType === 'witch_knot_simple';
            const isTeamModeForPopup = !!teamSync.teamCode && !!objectId;

            if (isTeamSyncPuzzle && isTeamModeForPopup) return;
            setCongratsPoints(points);
        });

        return () => teamSync.setOnScoreUpdate(null);
    }, [teamSync.setOnScoreUpdate, teamSync.teamCode, teamSync.session, currentPuzzleType, objectId]);

    // Initialize quest session on mount
    React.useEffect(() => {
        const initSession = async () => {
            if (!sessionId || !data?.quest?.id) return;

            try {
                // Start quest session if not already started
                // Use Lambda Endpoint: /runtime/session/start
                const baseUrl = process.env.NEXT_PUBLIC_RUNTIME_API_URL || '';
                await fetch(`${baseUrl}/runtime/session/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId,
                        questId: data.quest.id,
                        teamCode: teamSync.teamCode || undefined,
                        playerId: sessionId, // Assuming solo/same mode
                        playerName: typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('quest_playerName') || 'Player' : 'Player',
                        questVersion: 'v1',
                        eventId: `start:${sessionId}`,
                        dedupeKey: `start:${sessionId}`
                    })
                });
            } catch (error) {
                console.error('Failed to initialize quest session:', error);
            }
        };

        initSession();
    }, [sessionId, data?.quest?.id, teamSync.teamCode]);

    React.useEffect(() => {
        if (!data) {
            console.warn('[PuzzleClient] Quest data missing', { puzzleId, resolvedPuzzleId });
            return;
        }

        const puzzles = data.puzzles ?? [];
        const sampleIds = puzzles.slice(0, 10).map(p => p.id);
        console.log('[PuzzleClient] Quest puzzles snapshot', {
            puzzleId,
            resolvedPuzzleId,
            count: puzzles.length,
            sampleIds
        });
    }, [data, puzzleId, resolvedPuzzleId]);

    const handleBack = React.useCallback(() => {
        if (props.onClose) {
            props.onClose();
        } else {
            router.push('/');
        }
    }, [props.onClose, router]);

    // --- HOISTED STATE & LOGIC ---

    // Safe access to puzzle derivation
    const puzzle = React.useMemo(() =>
        data?.puzzles?.find(p => p.id === resolvedPuzzleId) ?? null
        , [data, resolvedPuzzleId]);

    const inlineData = React.useMemo(() =>
        puzzle?.data || puzzle?.interaction_data?.puzzle_data || null
        , [puzzle]);

    // Always declare hooks unconditionally
    const [puzzleData, setPuzzleData] = React.useState<any>(inlineData);
    // Loading is true if we have a puzzle but no inline data yet (need to fetch)
    // If no puzzle, we aren't loading (we are erroring/returning early in render)
    const [loading, setLoading] = React.useState(!!puzzle && !inlineData);
    const [error, setError] = React.useState<string | null>(null);

    // Sync local state when inlineData becomes available (e.g. after data loads)
    React.useEffect(() => {
        if (inlineData) {
            setPuzzleData(inlineData);
            setLoading(false);
        } else if (puzzle) {
            // New puzzle loaded but no inline data, reset to loading if needed
            // But we have a specific fetch effect below
        }
    }, [inlineData, puzzle]);


    React.useEffect(() => {
        if (!puzzle || inlineData) return;

        // If we have a puzzle but no inline data, try fetching
        const loadData = async () => {
            try {
                // Check for interaction_data with URL
                const dataUrl = puzzle.interaction_data?.puzzle_data_url;
                if (!dataUrl) {
                    throw new Error("No puzzle data found");
                }

                console.log('[PuzzleClient] Fetching puzzle data', {
                    puzzleId: resolvedPuzzleId,
                    dataUrl
                });

                const res = await fetch(dataUrl);
                if (!res.ok) throw new Error("Failed to fetch puzzle data");

                const json = await res.json();
                setPuzzleData(json);
            } catch (err) {
                console.error("Error loading puzzle:", err);
                setError(err instanceof Error ? err.message : "Failed to load puzzle");
            } finally {
                setLoading(false);
            }
        };

        setLoading(true);
        loadData();
    }, [puzzle, resolvedPuzzleId, inlineData]);

    const rawType = puzzle?.interaction_data?.type || (puzzle as any)?.type;
    const puzzleType: PuzzleType =
        rawType === 'jigsaw_custom' ? 'jigsaw_custom' :
            rawType === 'jigsaw' ? 'jigsaw' :
                rawType === 'witch_knot' ? 'witch_knot' :
                    rawType === 'witch_knot_simple' ? 'witch_knot_simple' :
                        rawType === 'spot_diff_ai' ? 'spot_diff_ai' :
                            rawType === 'musical_code_fountain' ? 'musical_code_fountain' :
                                'fabric_custom';

    // Handler for complete
    const handlePuzzleComplete = React.useCallback(async () => {
        if (isSubmitting || !sessionId || !runtime || !puzzle) return;

        // Extract points from puzzle data (fallback to 100 if not specified)
        const points = (puzzle as any).points || puzzleData?.points || 100;

        setIsSubmitting(true);

        try {
            await runtime.submitPuzzleSuccess({
                puzzleId: resolvedPuzzleId!, // safe because puzzle exists
                objectId: objectId || undefined,
                points
            });

            markPuzzleCompletedLocally(resolvedPuzzleId);
            setCongratsPoints(points);
        } catch (error) {
            console.error('Error completing puzzle:', error);
            markPuzzleCompletedLocally(resolvedPuzzleId);
            setCongratsPoints(points);
        } finally {
            setIsSubmitting(false);
        }
    }, [isSubmitting, sessionId, runtime, resolvedPuzzleId, objectId, puzzle, puzzleData, markPuzzleCompletedLocally]);

    const handleClosePopup = React.useCallback(() => {
        if (autoCloseTimerRef.current) {
            window.clearTimeout(autoCloseTimerRef.current);
            autoCloseTimerRef.current = null;
        }
        setCongratsPoints(null);

        if (props.onClose) {
            props.onClose();
        } else {
            router.push('/map');
        }
    }, [router, props.onClose]);

    React.useEffect(() => {
        if (congratsPoints === null) return;
        autoCloseTimerRef.current = window.setTimeout(() => {
            handleClosePopup();
        }, 2000);
        return () => {
            if (autoCloseTimerRef.current) {
                window.clearTimeout(autoCloseTimerRef.current);
                autoCloseTimerRef.current = null;
            }
        };
    }, [congratsPoints, handleClosePopup]);

    // --- RENDER PHASE (Conditional Logic) ---

    if (!data) return null;

    if (!resolvedPuzzleId) {
        return (
            <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-900 text-white">
                <h1 className="text-2xl mb-4">Puzzle ID Missing</h1>
                <button
                    onClick={handleBack}
                    className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-500"
                >
                    Back to Map
                </button>
            </div>
        );
    }

    if (!puzzle) {
        // Only warn if we have data but no puzzle found
        if (data.puzzles?.length) {
            console.warn('[PuzzleClient] Puzzle not found in quest data', {
                puzzleId,
                resolvedPuzzleId,
                puzzlesCount: data.puzzles?.length ?? 0,
                sampleIds: (data.puzzles ?? []).slice(0, 10).map(p => p.id)
            });
        }

        return (
            <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-900 text-white">
                <h1 className="text-2xl mb-4">Puzzle Not Found</h1>
                <button
                    onClick={handleBack}
                    className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-500"
                >
                    Back to Map
                </button>
            </div>
        );
    }

    if (loading) {
        return <div className="h-screen w-full flex items-center justify-center bg-gray-900 text-white">Loading Puzzle Data...</div>;
    }

    if (error || !puzzleData) {
        return (
            <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-900 text-white">
                <h1 className="text-2xl mb-4">Error Loading Puzzle</h1>
                <p className="mb-4 text-red-400">{error || "Data missing"}</p>
                <button
                    onClick={handleBack}
                    className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-500"
                >
                    Back to Map
                </button>
            </div>
        );
    }

    return (
        <div className="w-full h-screen">
            <PuzzleRenderer
                type={puzzleType}
                puzzleId={resolvedPuzzleId}
                userId={userId}
                initialData={puzzleData}
                sessionId={sessionId || undefined}
                teamCode={teamSync.teamCode || undefined}
                startedAt={startedAtIso}
                teamMemberIds={teamMemberIds}
                stopId={objectId || undefined}
                onComplete={handlePuzzleComplete}
                onClose={handleBack}
            />
            {congratsPoints !== null && (
                <CongratulationsPopup
                    points={congratsPoints}
                    onClose={handleClosePopup}
                />
            )}
        </div>
    );
}
