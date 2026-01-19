import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useMapAudio } from '@/hooks/useMapAudio';
import { useObjectTimeline } from '@/components/object-timeline/useObjectTimeline';
import { useArrivalSimulation } from '@/hooks/useArrivalSimulation';
import { usePulsatingCircles } from '@/components/object-timeline/usePulsatingCircles';
import { useQuestAudio } from '@/context/QuestAudioContext';
import { normalizeMediaTimeline } from '@/lib/mediaTimeline';
import { makeTimelineItemNodeId } from '@/runtime-core/compileQuest';
import { getValidCoordinates, calculateDistance, normalizeEffect } from '../utils/mapUtils';

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
    timelineGateRef
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
    const currentObjectId = safeRuntime.snapshot?.players?.[currentSessionId || '']?.currentObjectId;
    const isCurrentObjectCompleted = useMemo(
        () => !!currentObjectId && (safeRuntime.completedObjects?.has(currentObjectId) || false),
        [currentObjectId, safeRuntime.completedObjects]
    );

    const runObjectTimelineRef = useRef(runObjectTimeline);
    useEffect(() => {
        runObjectTimelineRef.current = runObjectTimeline;
    }, [runObjectTimeline]);

    // Resume timeline useEffect
    useEffect(() => {
        if (!currentSessionId || !currentObjectId) return;
        if (!modeConfirmed || !mapMode) return;
        if (!timelineGateRef.current.gestureBlessed || timelineGateRef.current.unlocking) return;

        // Don't strictly require definition - timelineNodes is optional and will use fallback reconstruction
        // This matches the behavior of Steps mode which works without this check
        if (lastResumedObjectRef.current === currentObjectId) return;

        const currentObj = objectsById.get(currentObjectId);
        if (!currentObj) return;
        if (isCurrentObjectCompleted) return;

        console.log('[Timeline] Running object timeline in Play mode', {
            objectId: currentObjectId,
            hasDefinition: !!safeRuntime.definition,
            hasTimelineNodes: !!safeRuntime.definition?.timelineNodes
        });

        lastResumedObjectRef.current = currentObjectId;
        void runObjectTimelineRef.current(currentObj, { reset: forceResetNextObjectRef.current });
        forceResetNextObjectRef.current = false;
    }, [currentSessionId, currentObjectId, isCurrentObjectCompleted, objectsById, safeRuntime.definition, mapMode, modeConfirmed, timelineGateRef]);

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
        onArrived: (obj) => {
            if (!mapMode) return;
            void safeRuntime.arriveAtObject(obj.id);
            void runObjectTimeline(obj);
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
                    docs.push({
                        id: item.key,
                        title: (item as any).title ?? 'Documento',
                        thumbnailUrl: (item as any).media_url ?? (item as any).mediaUrl,
                        text: (item as any).text
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
            setPulsatingVisibility
        },

        runObjectTimelineRef,
        forceResetNextObjectRef,
        lastResumedObjectRef,
        audioUnlockedRef
    };
}
