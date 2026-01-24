import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useMapAudio } from '@/hooks/useMapAudio';
import { useObjectTimeline } from '@/components/object-timeline/useObjectTimeline';
import { useArrivalSimulation } from '@/hooks/useArrivalSimulation';
import { usePulsatingCircles } from '@/components/object-timeline/usePulsatingCircles';
import { useQuestAudio } from '@/context/QuestAudioContext';
import { normalizeMediaTimeline } from '@/lib/mediaTimeline';
import { makeTimelineItemNodeId, sanitizeIdPart } from '@/runtime-core/compileQuest';
import { getValidCoordinates, calculateDistance, normalizeEffect, isStartObject } from '../utils/mapUtils';

type UseQuestTimelineLogicProps = {
    data: any;
    safeRuntime: any;
    currentSessionId: string | null;
    stepsMode: boolean;
    mapMode: string | null;
    modeConfirmed: boolean;
    objectsById: Map<string, any>;
    visibleObjects: any[];
    getItineraryNumber: (obj: any) => number | null;
    currentItineraryStep: number;
    mapInstanceRef: React.MutableRefObject<any>;
    userLocationRef: React.MutableRefObject<[number, number] | null>;
    setNotification: (msg: string | null) => void;
    timelineGateRef: React.MutableRefObject<{ gestureBlessed: boolean; unlocking: boolean }>;
    onStartObjectArrived?: () => boolean;
};

export function useQuestTimelineLogic({
    data,
    safeRuntime,
    currentSessionId,
    stepsMode,
    mapMode,
    modeConfirmed,
    objectsById,
    visibleObjects,
    getItineraryNumber,
    currentItineraryStep,
    mapInstanceRef,
    userLocationRef,
    setNotification,
    timelineGateRef,
    onStartObjectArrived
}: UseQuestTimelineLogicProps) {
    const questAudio = useQuestAudio();
    const lastResumedObjectRef = useRef<string | null>(null);
    const lastCompletedPuzzlesCountRef = useRef(safeRuntime.completedPuzzles?.size || 0);
    const forceResetNextObjectRef = useRef(false);

    // Audio
    const {
        state: audioState,
        controls: audioControls,
        refs: audioRefs,
        handlers: audioHandlers
    } = useMapAudio({ onNotification: setNotification });

    const { activeAudio, isPlaying: audioIsPlaying, currentTime: audioCurrentTime, duration: audioDuration, isPanelCollapsed: audioPanelCollapsed } = audioState;
    const { unlockAudio, playAudio, playAudioBlocking, stopAudio, playEffectAudio, playEffectAudioBlocking, stopEffectAudio, waitForAudioPanelClose, flushPendingAudio } = audioControls;
    const { stopAudioRef, audioUnlockedRef } = audioRefs;

    // Pulsating Circles
    const {
        addOrUpdatePulsatingCircle,
        removeTimelinePulsatingCircle,
        clearPulsatingCircles,
        syncObjectPulsatingCircles,
        getObjectPulseIds,
        setPulsatingVisibility
    } = usePulsatingCircles({
        mapRef: mapInstanceRef,
        userLocationRef,
        calculateDistance
    });

    // Puzzles
    const puzzlesById = useMemo(() => {
        return new Map((data?.puzzles ?? []).map((p: any) => [p.id, p]));
    }, [data]);

    const puzzlePointsById = useMemo(() => {
        const map = new Map<string, number>();
        (data?.puzzles ?? []).forEach((puzzle: any) => {
            const rawPoints =
                (puzzle as any).points ??
                (puzzle as any).data?.points ??
                (puzzle as any).interaction_data?.points ??
                (puzzle as any).interaction_data?.puzzle_data?.points ??
                (puzzle as any).puzzle_data?.points;
            const points = Number(rawPoints);
            if (Number.isFinite(points)) {
                map.set(puzzle.id, points);
            }
        });
        return map;
    }, [data]);

    const getPuzzlePoints = useCallback((puzzleId: string) => {
        return puzzlePointsById.get(puzzleId) ?? 100;
    }, [puzzlePointsById]);

    const hasPuzzle = useCallback((puzzleId: string) => {
        return puzzlesById.has(puzzleId);
    }, [puzzlesById]);

    // Timeline
    const {
        runObjectTimeline,
        stepsTimelinePanel,
        timelineActionOverlay,
        completeTimelineAction,
        cancelTimelineAction,
        timelineArOverlay,
        completeTimelineAr,
        cancelTimelineAr,
        timelineTextOverlay,
        closeTimelineText,
        timelineVideoOverlay,
        closeTimelineVideo,
        timelineChatOverlay,
        closeTimelineChat,
        timelinePuzzleOverlay,
        closeTimelinePuzzle,
        completeTimelinePuzzle,
        timelineDocumentOverlay,
        closeTimelineDocument
    } = useObjectTimeline({
        currentSessionId,
        stepsMode,
        questRuntime: safeRuntime,
        objectsById,
        hasPuzzle,
        playAudio,
        playAudioBlocking,
        playEffectAudio,
        playEffectAudioBlocking,
        stopAudio,
        stopEffectAudio,
        waitForAudioPanelClose,
        stopAudioRef,
        questAudio,
        addOrUpdatePulsatingCircle,
        removeTimelinePulsatingCircle,
        getValidCoordinates,
        normalizeEffect,
        getPuzzlePoints,
        timelineNodes: safeRuntime.definition?.timelineNodes
    });

    // Resume Logic
    const currentPlayerId = safeRuntime.snapshot?.me?.playerId ?? null;
    const currentObjectId = currentPlayerId
        ? (safeRuntime.snapshot?.players?.[currentPlayerId]?.currentObjectId ?? null)
        : null;
    const hasArrivedAtCurrentObject = useMemo(() => {
        if (!currentObjectId) return false;
        return !!safeRuntime.snapshot?.objects?.[currentObjectId]?.arrivedAt;
    }, [currentObjectId, safeRuntime.snapshot?.objects]);
    const isCurrentObjectCompleted = useMemo(
        () => !!currentObjectId && (safeRuntime.completedObjects?.has(currentObjectId) || false),
        [currentObjectId, safeRuntime.completedObjects]
    );

    const runObjectTimelineRef = useRef(runObjectTimeline);
    useEffect(() => {
        runObjectTimelineRef.current = runObjectTimeline;
    }, [runObjectTimeline]);

    const timelineStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (timelineStartTimeoutRef.current) clearTimeout(timelineStartTimeoutRef.current);
        };
    }, []);

    // Resume timeline useEffect
    useEffect(() => {
        if (!currentSessionId || !currentPlayerId || !currentObjectId) return;
        if (!modeConfirmed || !mapMode) return;
        if (!timelineGateRef.current.gestureBlessed || timelineGateRef.current.unlocking) return;

        console.log('[Timeline] Resume check', {
            mapMode,
            hasArrived: hasArrivedAtCurrentObject,
            currentObjectId,
            lastResumed: lastResumedObjectRef.current,
            isCompleted: isCurrentObjectCompleted
        });

        // Play mode: only autoplay timeline after GPS arrival (OBJECT_ARRIVE).
        // Steps mode intentionally bypasses GPS gating.
        if (mapMode === 'play' && !hasArrivedAtCurrentObject) return;

        // Don't strictly require definition - timelineNodes is optional and will use fallback reconstruction
        // This matches the behavior of Steps mode which works without this check
        if (lastResumedObjectRef.current === currentObjectId) return;

        const currentObj = objectsById.get(currentObjectId);
        if (!currentObj) return;
        if (isCurrentObjectCompleted) return;

        const isStart = currentObj.id === data?.start?.objectId;

        // In play mode, start objects should wait for MissionBrief to be dismissed first.
        // The timeline will be triggered from handleMissionBriefExit instead.
        if (isStart) {
            const missionBriefWillShow = onStartObjectArrived?.() ?? false;

            if (missionBriefWillShow) {
                return;
            }

            // If we are in play mode and it's a start object, but MissionBrief WON'T show (already shown),
            // implies we should run. But specifically for 'play' mode logic was to wait.
            // If already shown, we proceed to run below.
            if (mapMode === 'play') {
                // Existing logic was to return if start object in play mode.
                // But if MissionBrief already shown, we SHOULD run?
                // Original code returned unconditionally.
                // Let's assume if MissionBrief is already shown, we CAN run content if we want.
                // However, original logic said: "waiting for MissionBrief to be dismissed first".
                // If it's already dismissed (shown=true), then we can run?
                // Actually, let's keep it safe: if onStartObjectArrived says "false" (already shown),
                // then we proceed.
            }
        }

        console.log('[Timeline] Running object timeline in Play mode', {
            objectId: currentObjectId,
            hasDefinition: !!safeRuntime.definition,
            hasTimelineNodes: !!safeRuntime.definition?.timelineNodes
        });

        lastResumedObjectRef.current = currentObjectId;

        const shouldReset = forceResetNextObjectRef.current;
        forceResetNextObjectRef.current = false;

        void runObjectTimelineRef.current(currentObj, { reset: shouldReset });

    }, [currentSessionId, currentPlayerId, currentObjectId, hasArrivedAtCurrentObject, isCurrentObjectCompleted, objectsById, safeRuntime.definition, mapMode, modeConfirmed, timelineGateRef]);

    // Cleanup resume ref when puzzle completed
    useEffect(() => {
        const currentCount = safeRuntime.completedPuzzles?.size || 0;
        if (currentCount > lastCompletedPuzzlesCountRef.current) {
            lastResumedObjectRef.current = null;
            lastCompletedPuzzlesCountRef.current = currentCount;
        }
    }, [safeRuntime.completedPuzzles]);

    // Reset resume ref when currentObjectId changes (object completed and moved to next)
    const prevCurrentObjectIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (currentObjectId !== prevCurrentObjectIdRef.current) {
            console.log('[Timeline] currentObjectId changed, resetting lastResumedObjectRef', {
                from: prevCurrentObjectIdRef.current,
                to: currentObjectId
            });
            lastResumedObjectRef.current = null;
            prevCurrentObjectIdRef.current = currentObjectId;
            // Also clear any pending start for the previous object
            if (timelineStartTimeoutRef.current) {
                clearTimeout(timelineStartTimeoutRef.current);
                timelineStartTimeoutRef.current = null;
            }
        }
    }, [currentObjectId]);

    // Arrival Simulation
    const { handleObjectArrival, simulateArrivalWithPosition } = useArrivalSimulation({
        sessionId: currentSessionId,
        completedObjects: safeRuntime.completedObjects,
        visibleObjects,
        getItineraryNumber,
        showNotification: (message) => {
            setNotification(message);
            setTimeout(() => setNotification(null), message.includes('completato') ? 4000 : 5000);
        },
        playEffectAudio,
        onArrived: async (obj) => {
            if (!mapMode) return;

            // In Play mode, only "arrive" (unlock timeline) for the CURRENT runtime object.
            // Otherwise approaching future/side objects would set `arrivedAt` early and break
            // GPS-gated progression when the runtime later advances `currentObjectId`.
            if (mapMode === 'play' && currentObjectId && obj.id !== currentObjectId) {
                return;
            }

            try {
                await safeRuntime.arriveAtObject(obj.id);
            } catch (err) {
                console.warn('[Timeline] arriveAtObject failed', { objectId: obj.id, err });
                return;
            }

            // Timeline autoplay is handled by the resume effect (Play mode gated by `arrivedAt`).
            // Steps mode can still start immediately for simulated arrivals.
            if (mapMode === 'steps') {
                void runObjectTimelineRef.current(obj, { reset: true });
            } else if (isStartObject(obj)) {
                console.log('[Timeline] Start object arrival detected', { objectId: obj.id, mapMode });
                // Trigger MissionBrief modal for start object arrival in play mode
                // If callback returns true, MissionBrief will be shown and timeline will be started later
                const willShowMissionBrief = onStartObjectArrived?.() ?? false;
                console.log('[Timeline] willShowMissionBrief:', willShowMissionBrief);

                // Only auto-complete if MissionBrief won't be shown
                if (!willShowMissionBrief) {
                    // For start objects, we want to complete them immediately upon arrival
                    // so the user doesn't have to interact with the timeline if it's just a "Go here" start.
                    const endNodeId = `tl_${sanitizeIdPart(obj.id)}__end`;
                    console.log('[Timeline] Auto-completing start object', { objectId: obj.id, endNodeId });
                    void safeRuntime.completeNode(endNodeId).then(async () => {
                        // Force refresh to update visibility of next objects
                        await safeRuntime.refresh();
                    });
                }
            }
        }
    });

    // Steps Sync
    useEffect(() => {
        if (!stepsMode || !data?.objects) return;
        const targetObj = data.objects.find((obj: any) => {
            const num = getItineraryNumber(obj);
            return num === currentItineraryStep;
        });

        if (targetObj) {
            void runObjectTimelineRef.current(targetObj);
        }
    }, [stepsMode, currentItineraryStep, data?.objects, getItineraryNumber, runObjectTimelineRef]);

    // Collected Documents
    // eslint-disable-next-line react-hooks/preserve-manual-memoization
    const collectedDocuments = useMemo(() => {
        if (!data?.objects || !safeRuntime.snapshot) return [];
        const docs: any[] = [];
        data.objects.forEach((obj: any) => {
            const timeline = normalizeMediaTimeline(obj);
            if (!timeline) return;
            timeline.items.forEach((item: any) => {
                if (item.type !== 'document') return;
                const nodeId = makeTimelineItemNodeId(obj.id, item.key);
                const node = safeRuntime.snapshot!.nodes[nodeId];
                if (node?.status === 'completed') {
                    const docMediaUrl = (item as any).media_url ?? (item as any).mediaUrl;
                    docs.push({
                        id: item.key,
                        title: (item as any).title ?? 'Documento',
                        thumbnailUrl: docMediaUrl,
                        imageUrl: docMediaUrl,
                        body: (item as any).text
                    });
                }
            });
        });
        return docs;
    }, [data?.objects, safeRuntime.snapshot]);

    return {
        audioState,
        audioControls,
        audioRefs,
        audioHandlers,

        timelineState: {
            stepsTimelinePanel,
            timelineActionOverlay,
            timelineArOverlay,
            timelineTextOverlay,
            timelineVideoOverlay,
            timelineChatOverlay,
            timelinePuzzleOverlay,
            timelineDocumentOverlay,
            collectedDocuments
        },
        timelineHandlers: {
            completeTimelineAction,
            cancelTimelineAction,
            completeTimelineAr,
            cancelTimelineAr,
            closeTimelineText,
            closeTimelineVideo,
            closeTimelineChat,
            closeTimelinePuzzle,
            completeTimelinePuzzle,
            closeTimelineDocument,
            runObjectTimeline
        },

        arrival: {
            handleObjectArrival,
            simulateArrivalWithPosition
        },

        pulsating: {
            addOrUpdatePulsatingCircle,
            removeTimelinePulsatingCircle,
            clearPulsatingCircles,
            syncObjectPulsatingCircles,
            getObjectPulseIds,
            setPulsatingVisibility
        },

        runObjectTimelineRef,
        forceResetNextObjectRef,
        lastResumedObjectRef,
        audioUnlockedRef
    };
}
