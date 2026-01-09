import { useState, useEffect, useCallback, useRef } from 'react';
import type {
    QuestProgress,
    QuestSessionState,
    RuntimeSnapshot
} from '@/types/quest';

interface QueuedAction {
    type: 'complete_object' | 'complete_puzzle' | 'collect_document' | 'convert_villager';
    payload: any;
    timestamp: string;
    retryCount: number;
}

interface UseQuestProgressOptions {
    sessionId: string | null;
    autoSync?: boolean;
    syncIntervalMs?: number;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * Maps the Lambda RuntimeSnapshot to the frontend QuestSessionState
 */
function mapSnapshotToSession(snapshot: RuntimeSnapshot): QuestSessionState {
    const completedObjects = Object.values(snapshot.objects)
        .filter(o => o.completedAt) // Use completedAt for completion
        .map(o => o.objectId);

    const completedPuzzles = Object.values(snapshot.nodes)
        .filter(n => n.nodeId.startsWith('puzzle') && n.status === 'completed') // Heuristic for puzzles
        .map(n => n.nodeId);

    return {
        sessionId: snapshot.sessionId,
        questId: snapshot.questId,
        teamCode: undefined, // runtime snapshot doesn't always carry team code yet
        startedAt: snapshot.serverTime, // Approximate
        score: snapshot.me.score,
        completedObjects,
        completedPuzzles,
        documentFragments: 0, // Not yet in backend
        villagersConverted: 0, // Not yet in backend
        lastUpdatedAt: snapshot.serverTime,
        version: snapshot.version
    };
}

export function useQuestProgress({
    sessionId,
    // autoSync = true,
    // syncIntervalMs = 5000 // Sync faster with real backend (5s)
}: UseQuestProgressOptions): QuestProgress {
    // Local state (optimistic)
    const [score, setScore] = useState(0);
    const [completedObjects, setCompletedObjects] = useState<Set<string>>(new Set());
    const [completedPuzzles, setCompletedPuzzles] = useState<Set<string>>(new Set());
    // const [documentFragments, setDocumentFragments] = useState(0);
    // const [villagersConverted, setVillagersConverted] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Queue for offline actions
    const [actionQueue, setActionQueue] = useState<QueuedAction[]>([]);
    const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

    // Ref to track if quest has been started
    const questStartedRef = useRef(false);
    // const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Process queued actions
    const processQueue = useCallback(async () => {
        if (!isOnline || actionQueue.length === 0) return;

        const queue = [...actionQueue];
        const failedActions: QueuedAction[] = [];

        for (const action of queue) {
            try {
                let res;
                let data;

                switch (action.type) {
                    case 'complete_object':
                        // Endpoint: POST /runtime/object/arrive
                        res = await fetch(`${API_BASE_URL}/runtime/object/arrive`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                sessionId,
                                objectId: action.payload.objectId,
                                timestamp: action.timestamp,
                                dedupeKey: `arrive:${sessionId}:${action.payload.objectId}`
                            })
                        });
                        break;

                    // TODO: Implement puzzle/document/villager endpoints in backend if needed.
                    // For now, we only have object/arrive fully working.
                }

                if (res && !res.ok) {
                    throw new Error(`API error: ${res.status}`);
                }

                if (res) {
                    data = await res.json();
                    if (data.success && data.snapshot) {
                        const session = mapSnapshotToSession(data.snapshot);
                        setScore(session.score);
                        setCompletedObjects(new Set(session.completedObjects));
                    }
                }

            } catch (err) {
                console.error('Failed to process queued action:', err);
                if (action.retryCount < 3) {
                    failedActions.push({
                        ...action,
                        retryCount: action.retryCount + 1
                    });
                }
            }
        }

        setActionQueue(failedActions);
    }, [isOnline, actionQueue, sessionId]);

    // Queue an action for retry
    const queueAction = useCallback((type: QueuedAction['type'], payload: any) => {
        const action: QueuedAction = {
            type,
            payload,
            timestamp: new Date().toISOString(),
            retryCount: 0
        };
        setActionQueue(prev => [...prev, action]);
    }, []);

    // Monitor online/offline status
    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            processQueue(); // Process queued actions when back online
        };
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [processQueue]);

    // Start quest
    const startQuest = useCallback(async (questId: string, teamCode?: string) => {
        if (!sessionId) {
            setError('No session ID available');
            return;
        }

        if (questStartedRef.current) {
            console.warn('Quest already started locally');
            // But we might want to refresh state from backend?
        }

        setIsLoading(true);
        setError(null);

        try {
            console.log('[useQuestProgress] Starting quest via Lambda:', `${API_BASE_URL}/runtime/session/start`);

            // Endpoint: POST /runtime/session/start
            const res = await fetch(`${API_BASE_URL}/runtime/session/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    questId,
                    teamCode,
                    playerId: sessionId, // Assuming solo/same mode for now
                    playerName: typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('quest_playerName') || 'Player' : 'Player',
                    questVersion: 'v1',
                    eventId: `start:${sessionId}`,
                    dedupeKey: `start:${sessionId}`
                })
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(`Start failed (${res.status}): ${text}`);
            }

            const data = await res.json();

            if (data.success && data.snapshot) {
                const session = mapSnapshotToSession(data.snapshot);
                setScore(session.score);
                setCompletedObjects(new Set(session.completedObjects));
                setCompletedPuzzles(new Set(session.completedPuzzles));
                // setDocumentFragments(session.documentFragments);
                // setVillagersConverted(session.villagersConverted);
                questStartedRef.current = true;
                setError(null);
            } else {
                setError('Failed to start quest (invalid response)');
            }
        } catch (err) {
            console.error('Failed to start quest:', err);
            setError(err instanceof Error ? err.message : 'Failed to start quest');
        } finally {
            setIsLoading(false);
        }
    }, [sessionId]);

    // Complete object
    const completeObject = useCallback(async (objectId: string, points: number = 0) => {
        if (!sessionId) return;

        // Optimistic update
        setCompletedObjects(prev => new Set([...prev, objectId]));
        // Note: Score update is skipped optimistically to rely on backend rule, or we can guess.
        // setScore(prev => prev + points);

        if (!isOnline) {
            queueAction('complete_object', { objectId, points });
            return;
        }

        try {
            // Endpoint: POST /runtime/object/arrive
            const res = await fetch(`${API_BASE_URL}/runtime/object/arrive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    objectId,
                    // event fields
                    playerId: sessionId,
                    timestamp: new Date().toISOString(),
                    eventId: `arrive:${sessionId}:${objectId}:${Date.now()}`,
                    dedupeKey: `arrive:${sessionId}:${objectId}`
                })
            });

            if (!res.ok) {
                throw new Error(`Object arrival failed (${res.status})`);
            }

            const data = await res.json();

            if (data.success && data.snapshot) {
                // Sync with server response
                const session = mapSnapshotToSession(data.snapshot);
                setScore(session.score);
                setCompletedObjects(new Set(session.completedObjects));
            } else {
                // Revert optimistic update on failure?
                // For now, let's keep it simple.
                setError(data.error || 'Failed to complete object');
                queueAction('complete_object', { objectId, points });
            }
        } catch (err) {
            console.error('Failed to complete object:', err);
            // Queue for retry
            queueAction('complete_object', { objectId, points });
        }
    }, [sessionId, isOnline, queueAction]);

    // Complete puzzle (Stub)
    const completePuzzle = useCallback(async (/* puzzleId, points */) => {
        // Not yet implemented in backend
        console.warn('Pipeline for puzzle completion not fully implemented in Lambda hook yet');
    }, []);

    // Collect document fragment (Stub)
    const collectDocument = useCallback(async () => {
        // Not yet implemented
    }, []);

    // Convert villager (Stub)
    const convertVillager = useCallback(async () => {
        // Not yet implemented
    }, []);

    // Refresh from server (Stub)
    const refresh = useCallback(async () => {
        // Re-call start to sync?
        // or just ignore for now
    }, []);

    // Auto-sync with server
    useEffect(() => {
        // Disabled polling for now until GET endpoint exists.
    }, []);

    // Process queue when coming back online
    useEffect(() => {
        if (isOnline && actionQueue.length > 0) {
            processQueue();
        }
    }, [isOnline, actionQueue.length, processQueue]);

    return {
        score,
        completedObjects,
        completedPuzzles,
        documentFragments: 0,
        villagersConverted: 0,
        isLoading,
        error,
        startQuest,
        completeObject,
        completePuzzle,
        collectDocument,
        convertVillager,
        refresh
    };
}
