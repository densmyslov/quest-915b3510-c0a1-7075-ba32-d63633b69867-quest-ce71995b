'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useQuest } from '@/context/QuestContext';
import { useTeamSync } from '@/context/TeamSyncContext';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getSoloTeamStartedAt, isSoloTeamSession } from '@/lib/soloTeam';
import { CongratulationsPopup } from '@/components/CongratulationsPopup';
import { useTeamWebSocket } from '@/lib/useTeamWebSocket';

const PuzzleRenderer = dynamic(() => import('@/components/puzzles/PuzzleRenderer').then(mod => mod.PuzzleRenderer), {
    ssr: false,
    loading: () => <div className="h-screen w-full flex items-center justify-center bg-gray-900 text-white">Loading Puzzle...</div>
});

interface PuzzleClientProps {
    puzzleId: string;
    objectId?: string;
    onClose?: () => void;
}

type PuzzleType = 'fabric_custom' | 'jigsaw_custom' | 'jigsaw' | 'witch_knot' | 'witch_knot_simple' | 'spot_diff_ai';

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

    // Set up WebSocket listener for score updates (team mode)
    useTeamWebSocket(teamSync.teamCode, teamSync.session, {
        onScoreUpdate: (points) => {
            // Show congratulations popup when player earns points
            setCongratsPoints(points);
        },
    });

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

    const puzzle = data.puzzles.find(p => p.id === resolvedPuzzleId);

    if (!puzzle) {
        console.warn('[PuzzleClient] Puzzle not found in quest data', {
            puzzleId,
            resolvedPuzzleId,
            puzzlesCount: data.puzzles?.length ?? 0,
            sampleIds: (data.puzzles ?? []).slice(0, 10).map(p => p.id)
        });
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

    const inlineData = puzzle.data || puzzle.interaction_data?.puzzle_data;
    const [puzzleData, setPuzzleData] = React.useState<any>(inlineData);
    const [loading, setLoading] = React.useState(!inlineData);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (inlineData) return;

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

        loadData();
    }, [puzzle, resolvedPuzzleId]);

    const rawType = puzzle.interaction_data?.type || (puzzle as any).type;
    const puzzleType: PuzzleType =
        rawType === 'jigsaw_custom' ? 'jigsaw_custom' :
            rawType === 'jigsaw' ? 'jigsaw' :
                rawType === 'witch_knot' ? 'witch_knot' :
                    rawType === 'witch_knot_simple' ? 'witch_knot_simple' :
                        rawType === 'spot_diff_ai' ? 'spot_diff_ai' :
                            'fabric_custom';

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

    // Handler for puzzle completion
    const handlePuzzleComplete = React.useCallback(async () => {
        if (isSubmitting || !sessionId || !runtime) return;

        // Extract points from puzzle data (fallback to 100 if not specified)
        const points = (puzzle as any).points || puzzleData?.points || 100;

        setIsSubmitting(true);

        try {
            // Use the runtime context's submitPuzzleSuccess method
            // This calls the server API AND updates the local snapshot cache with the server response
            // ensuring the timeline can detect the completed puzzle when returning to the map
            await runtime.submitPuzzleSuccess({
                puzzleId: resolvedPuzzleId,
                objectId: objectId || undefined,
                points
            });

            // Show congratulations popup with points earned
            markPuzzleCompletedLocally(resolvedPuzzleId);
            setCongratsPoints(points);
        } catch (error) {
            console.error('Error completing puzzle:', error);
            // Still show popup even if server call fails (optimistic UI)
            markPuzzleCompletedLocally(resolvedPuzzleId);
            setCongratsPoints(points);
        } finally {
            setIsSubmitting(false);
        }
    }, [isSubmitting, sessionId, runtime, resolvedPuzzleId, objectId, puzzle, puzzleData, markPuzzleCompletedLocally]);

    // Handler for closing congratulations popup and returning to map
    // The timeline runner will detect the completed puzzle via useObjectTimeline.ts:656-666
    // and automatically continue with next items based on runtime state
    const handleClosePopup = React.useCallback(() => {
        if (autoCloseTimerRef.current) {
            window.clearTimeout(autoCloseTimerRef.current);
            autoCloseTimerRef.current = null;
        }
        setCongratsPoints(null);

        // Navigate to map - the timeline will resume automatically if there are more items,
        // or the object will show as complete if this was the last item
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
                onComplete={handlePuzzleComplete}
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
