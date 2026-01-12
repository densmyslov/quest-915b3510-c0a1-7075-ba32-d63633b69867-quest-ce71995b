'use client';

import 'leaflet/dist/leaflet.css';
import dynamic from 'next/dynamic';
import { useQuest } from '@/context/QuestContext';
import { useTeamSync } from '@/context/TeamSyncContext';
import { Map as LeafletMap, TileLayer, Marker, Icon, LayerGroup, Circle, DivIcon } from 'leaflet';
import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { getSoloTeamStartedAt, isSoloTeamSession } from '@/lib/soloTeam';
import { useDebugLog } from '@/context/DebugLogContext';
import { isQuestDebugEnabled } from '@/lib/debugFlags';
import { useProximityTracker, QuestStop } from '@/hooks/useProximityTracker';
import { formatLatLng, parseLatLng } from '@/utils/coordinates';
import QuestMapOverlay from '@/components/QuestMapOverlay';

import { useArrivalSimulation } from '@/hooks/useArrivalSimulation';
import { useQuestAudio } from '@/context/QuestAudioContext';
import { useObjectTimeline } from '@/components/object-timeline/useObjectTimeline';
import { usePulsatingCircles } from '@/components/object-timeline/usePulsatingCircles';

const PuzzleClientOverlay = dynamic(() => import('@/app/puzzle/[id]/PuzzleClient'), {
    ssr: false,
    loading: () => <div className="h-full w-full flex items-center justify-center bg-black text-white">Loading Puzzle...</div>
});


// ═══════════════════════════════════════════════════════════════════════════════
// IL GIURAMENTO DEI DUE BORGHI - Quest Map
// Esino Lario, 1926
// ═══════════════════════════════════════════════════════════════════════════════

// Vintage color palette
import {
    COLORS,
    SPECIAL_OBJECT_ITINERARY_NUMBER,
    SPECIAL_OBJECT_MARKER_ICON,
    createVintageIcon,
    escapeHtml
} from '@/components/map/MapStyles';

import {
    OSM_TILE_URL,
    OSM_ATTRIBUTION,
    OSM_MAX_NATIVE_ZOOM,
    OSM_MAX_ZOOM
} from '@/components/map/MapAssets';
import { CompassControl } from '@/components/map/CompassControl';
import { MapFrame } from '@/components/map/MapFrame';
import MapOverlays from '@/components/map/MapOverlays';
import { useMapAudio } from '@/hooks/useMapAudio';

const normalizeObjectImages = (obj: any): Array<{ url: string; thumbnailUrl?: string }> => {
    const rawImages = obj?.images ?? obj?.imageUrls ?? obj?.image_urls ?? [];
    const list = Array.isArray(rawImages) ? rawImages : [];

    return list
        .map((img: any) => {
            if (typeof img === 'string') {
                return { url: img };
            }

            if (!img || typeof img !== 'object') return null;

            const url = img.url || img.imageUrl || img.image_url || img.src || img.image || null;
            if (typeof url !== 'string' || !url.length) return null;

            const thumbnailUrl =
                img.thumbnailUrl || img.thumbnail_url || img.thumbUrl || img.thumb_url || undefined;
            return { url, thumbnailUrl };
        })
        .filter((img): img is { url: string; thumbnailUrl?: string } => !!img);
};

// Haversine formula for distance calculation
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const toNumber = (value: any, fallback: number): number => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

const normalizeEffect = (effect: any) => {
    const rawMaxRadius = toNumber(effect.effectRadius ?? effect.maxRadius, 50);
    const maxRadius = Math.max(2, rawMaxRadius);

    const rawMinRadius = toNumber(effect.minRadius, maxRadius * 0.6);
    const minRadius = Math.max(1, Math.min(rawMinRadius, maxRadius - 1));

    const startDistance = Math.max(1, toNumber(effect.startEffectDistance, maxRadius));
    const speed = toNumber(effect.speed, 50);

    return {
        minRadius,
        maxRadius,
        startDistance,
        speed,
        color: effect.color || COLORS.burgundy
    };
};

const hiddenAudioStyle: React.CSSProperties = {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
    left: -9999,
    top: -9999,
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function QuestMap() {
    const { data } = useQuest();
    const teamSync = useTeamSync();
    const questAudio = useQuestAudio();
    const { addLog } = useDebugLog();
    const [gpsEnabled, setGpsEnabled] = useState(false);
    // const [nearestObjectDistance, setNearestObjectDistance] = useState<number | null>(null);
    // const [nearestObjectRadius, setNearestObjectRadius] = useState<number | null>(null);
    // const [nearestObjectName, setNearestObjectName] = useState<string>('');
    const [mapMode, setMapMode] = useState<'play' | 'steps' | null>(null);
    const [modeConfirmed, setModeConfirmed] = useState(false);
    const [currentItineraryStep, setCurrentItineraryStep] = useState(0);
    const [puzzleCloseConfirmation, setPuzzleCloseConfirmation] = useState(false);
    const stepsMode = mapMode === 'steps';
    const isPlayMode = mapMode === 'play';

    useEffect(() => {
        console.log('[QuestMap] MOUNTED');
        // Never carry a "blessed gesture" across mounts; Safari permissions are per-pageview.
        timelineGateRef.current.gestureBlessed = false;
        setModeConfirmed(false);
        return () => console.log('[QuestMap] UNMOUNTED');
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            if (mapMode === 'play' || mapMode === 'steps') {
                sessionStorage.setItem('quest_map_mode', mapMode);
            } else {
                sessionStorage.removeItem('quest_map_mode');
            }
        } catch {
            // ignore storage errors
        }
    }, [mapMode]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            sessionStorage.setItem('quest_gps_enabled', gpsEnabled ? '1' : '0');
        } catch {
            // ignore storage errors
        }
    }, [gpsEnabled]);

    // Get session ID for quest progress tracking
    const fallbackSessionId = typeof window !== 'undefined' ? sessionStorage.getItem('quest_sessionId') : null;
    const currentSessionId = teamSync.session?.sessionId ?? fallbackSessionId ?? null;

    // Use global runtime from context
    const { runtime } = useQuest();

    // Create a safe runtime fallback to allow hooks to run unconditionally
    const safeRuntime = runtime || {
        snapshot: null,
        completedObjects: new Set(),
        completedPuzzles: new Set(),
        scoreByPlayerId: new Map(),
        arriveAtObject: async () => { },
        completeNode: async () => { },
        definition: null,
        submitPuzzleSuccess: async () => { }
    } as any;

    // Helper functions (must be defined before useMemos that use them)
    const getValidCoordinates = (obj: any): [number, number] | null => {
        return parseLatLng(obj?.coordinates);
    };

    const getItineraryNumber = (obj: any): number | null => {
        const raw =
            obj?.itineraryNumber ??
            obj?.number ??
            obj?.itinerary_number ??
            obj?.itinerary ??
            obj?.['Itinerary number'] ??
            obj?.['Itinerary Number'];
        const num = Number(raw);
        return Number.isFinite(num) ? num : null;
    };

    const isStartObject = (obj: any): boolean => {
        return !!(obj?.isStart ?? obj?.is_start);
    };

    // Calculate total points available in the quest
    const totalPointsAvailable = useMemo(() => {
        if (!data?.objects) return 0;
        return data.objects.reduce((sum, obj) => sum + (obj.points || 0), 0);
    }, [data]);

    // Stabilize visibleObjectIds to prevent unnecessary re-renders
    const visibleObjectIds = useMemo(() => {
        return safeRuntime.snapshot?.me.visibleObjectIds ?? [];
    }, [safeRuntime.snapshot]);

    // Sliding window visibility filtering (runtime)
    const visibleObjects = useMemo(() => {
        if (!data?.objects) return [];

        // Sort objects by itinerary number
        const sortedObjects = [...data.objects].sort((a, b) => {
            const aNum = getItineraryNumber(a) ?? 0;
            const bNum = getItineraryNumber(b) ?? 0;
            return aNum - bNum;
        });

        // In steps mode: show all objects that are either completed OR the current active object
        if (stepsMode) {
            const completedIds = safeRuntime.completedObjects ?? new Set<string>();
            const currentObjectId = safeRuntime.snapshot?.me?.currentObjectId;

            // Always show completed objects
            // AND show the current object (even if not completed)
            return sortedObjects.filter(obj =>
                completedIds.has(obj.id) || obj.id === currentObjectId
            );
        }

        const visibleIds = new Set(visibleObjectIds);
        if (visibleIds.size === 0) {
            // Until runtime session is started, fall back to showing all (dev-friendly).
            return sortedObjects;
        }

        return sortedObjects.filter((obj) => visibleIds.has(obj.id));
    }, [data?.objects, visibleObjectIds, stepsMode, safeRuntime.completedObjects, safeRuntime.snapshot?.me?.currentObjectId]);

    // Calculate current player/team score
    const currentScore = useMemo(() => {
        // Prefer runtime score when available.
        const playerScore = currentSessionId ? safeRuntime.scoreByPlayerId.get(currentSessionId) : null;
        if (typeof playerScore === 'number') return playerScore;

        // Team mode fallback: sum all team members' totalPoints (legacy team-scoring WS).
        if (teamSync.team?.members && teamSync.team.members.length > 0) {
            return teamSync.team.members.reduce((sum, member) => sum + (member.totalPoints || 0), 0);
        }

        return data?.quest?.votesFor || 0;
    }, [currentSessionId, safeRuntime.scoreByPlayerId, teamSync.team?.members, data?.quest?.votesFor]);

    const [notification, setNotification] = useState<string | null>(null);

    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<LeafletMap | null>(null);
    const baseLayerRef = useRef<TileLayer | null>(null);
    const markersLayerRef = useRef<LayerGroup | null>(null);
    const objectMarkersRef = useRef<Map<string, Marker>>(new Map());
    const objectTriggerCirclesRef = useRef<Map<string, Circle[]>>(new Map());
    const userMarkerRef = useRef<Marker | null>(null);
    const headingRef = useRef<number | null>(null);
    const lastHeadingUpdateRef = useRef<number>(0);
    const lastHeadingValueRef = useRef<number | null>(null);

    const [heading, setHeading] = useState<number | null>(null);

    // Zoom state tracking
    const initialZoomSet = useRef(false);
    const savedZoom = useRef<number | null>(null);
    const savedCenter = useRef<[number, number] | null>(null);

    const userLocationRef = useRef<[number, number] | null>(null);

    // Audio/Timeline Gesture Gate (Safari Fix)
    const timelineGateRef = useRef({
        gestureBlessed: false,
        unlocking: false,
    });

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

    const distributionRef = useRef<{
        sessionId: string | null;
        isTeamMode: boolean;
        soloTeam: boolean;
        teamCode: string | null;
        startedAtIso?: string;
        members: Array<{ sessionId: string; joinedAt: string }>;
    }>({ sessionId: null, isTeamMode: false, soloTeam: false, teamCode: null, members: [] });

    useEffect(() => {
        const fallbackSessionId = sessionStorage.getItem('quest_sessionId');
        const sessionId = teamSync.session?.sessionId ?? fallbackSessionId ?? null;
        const isTeamMode = !!teamSync.teamCode && !!teamSync.session;
        const soloTeam = isTeamMode && isSoloTeamSession();
        const startedAtIso = soloTeam ? getSoloTeamStartedAt() ?? undefined : teamSync.team?.startedAt;
        distributionRef.current = {
            sessionId,
            isTeamMode,
            soloTeam,
            teamCode: teamSync.teamCode,
            startedAtIso,
            members: soloTeam
                ? startedAtIso && sessionId
                    ? [{ sessionId, joinedAt: startedAtIso }]
                    : []
                : (teamSync.team?.members ?? []).map((m) => ({ sessionId: m.sessionId, joinedAt: m.joinedAt })),
        };
    }, [teamSync.session?.sessionId, teamSync.teamCode, teamSync.team?.startedAt, teamSync.team?.members]); // eslint-disable-line react-hooks/exhaustive-deps



    const {
        state: audioState,
        controls: audioControls,
        refs: audioRefs,
        handlers: audioHandlers
    } = useMapAudio({ onNotification: setNotification });

    const { activeAudio, isPlaying: audioIsPlaying, currentTime: audioCurrentTime, duration: audioDuration, isPanelCollapsed: audioPanelCollapsed } = audioState;
    const { unlockAudio, playAudio, playAudioBlocking, stopAudio, playEffectAudio, playEffectAudioBlocking, stopEffectAudio, waitForAudioPanelClose, flushPendingAudio } = audioControls;
    const { audioRef, effectAudioRef, audioUnlockedRef, activeEffectRef, stopAudioRef } = audioRefs;

    // Memoize audio panel collapse callback to prevent re-renders
    const handleToggleAudioPanelCollapsed = useCallback(() => {
        audioState.setPanelCollapsed(prev => !prev);
    }, [audioState.setPanelCollapsed]);

    const audioPanelProps = useMemo(() => ({
        title: activeAudio?.name ?? '',
        audioUrl: activeAudio?.url ?? '',
        transcription: activeAudio?.transcription ?? null,
        mode: activeAudio?.mode ?? 'audio',
        currentTime: audioCurrentTime,
        duration: audioDuration,
        isPlaying: audioIsPlaying,
        isCollapsed: audioPanelCollapsed,
        onToggleCollapsed: handleToggleAudioPanelCollapsed,
        onClose: stopAudio,
        audioRef: audioRef,
        onTimeUpdate: audioHandlers.onTimeUpdate,
        onPlay: audioHandlers.onPlay,
        onPause: audioHandlers.onPause,
        onEnded: audioHandlers.onEnded,
        onLoadedMetadata: audioHandlers.onLoadedMetadata,
        onError: audioHandlers.onError
    }), [
        activeAudio?.name,
        activeAudio?.url,
        activeAudio?.transcription,
        activeAudio?.mode,
        audioCurrentTime,
        audioDuration,
        audioIsPlaying,
        audioPanelCollapsed,
        handleToggleAudioPanelCollapsed,
        stopAudio,
        audioRef,
        audioHandlers.onTimeUpdate,
        audioHandlers.onPlay,
        audioHandlers.onPause,
        audioHandlers.onEnded,
        audioHandlers.onLoadedMetadata,
        audioHandlers.onError
    ]);




    // Convert quest objects to proximity tracker stops
    // Only track visible objects for arrival triggers
    const stops: QuestStop[] = useMemo(() => {
        if (!visibleObjects) return [];
        return visibleObjects.map((obj) => {
            const coords = parseLatLng(obj.coordinates);
            return {
                id: obj.id,
                name: obj.name,
                coordinates: coords ? formatLatLng(coords) : undefined,
                triggerRadius: obj.audio_effect?.triggerRadius || obj.triggerRadius || 20
            };
        });
    }, [visibleObjects]);

    const objects = useMemo(() => data?.objects || [], [data]);

    useEffect(() => {
        console.log('[QuestMap Debug] Objects updated:', {
            count: objects.length,
            ids: objects.map(o => o.id).join(','),
            dataExists: !!data,
            timestamp: new Date().toISOString()
        });
    }, [objects, data]);
    const objectsById = useMemo(() => {
        return new Map((data?.objects ?? []).map((obj) => [obj.id, obj]));
    }, [data]);
    const puzzlePointsById = useMemo(() => {
        const map = new Map<string, number>();
        (data?.puzzles ?? []).forEach((puzzle) => {
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
    const puzzlesById = useMemo(() => {
        return new Map((data?.puzzles ?? []).map((p) => [p.id, p]));
    }, [data]);
    const getPuzzlePoints = useCallback((puzzleId: string) => {
        return puzzlePointsById.get(puzzleId) ?? 100;
    }, [puzzlePointsById]);
    const hasPuzzle = useCallback((puzzleId: string) => {
        return puzzlesById.has(puzzleId);
    }, [puzzlesById]);

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
        completeTimelinePuzzle
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
        getPuzzlePoints
    });

    useEffect(() => {
        if (!isQuestDebugEnabled()) return;
        if (timelinePuzzleOverlay) {
            addLog('info', '[QuestMap] timelinePuzzleOverlay OPEN', {
                puzzleId: timelinePuzzleOverlay.puzzleId,
                objectId: timelinePuzzleOverlay.objectId,
                mapMode
            });
        } else {
            addLog('info', '[QuestMap] timelinePuzzleOverlay CLOSED', { mapMode });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timelinePuzzleOverlay, mapMode]);

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

    // Auto-resume timeline for current object when returning to map
    // Ref to track if we should reset the timeline when the next object is loaded (for prevStep)
    const forceResetNextObjectRef = useRef(false);

    // Track the last object we "resumed" to avoid fighting with the timeline runner
    const lastResumedObjectRef = useRef<string | null>(null);
    const lastCompletedPuzzlesCountRef = useRef(safeRuntime.completedPuzzles?.size || 0);
    const lastLocationSyncRef = useRef<number>(0);

    // Reset resume tracking when puzzles are completed (allows timeline to continue after puzzle)
    useEffect(() => {
        const currentCount = safeRuntime.completedPuzzles?.size || 0;
        if (currentCount > lastCompletedPuzzlesCountRef.current) {
            // A puzzle was just completed, reset the resume tracker to allow timeline continuation
            console.log('[QuestMap] Puzzle completed, resetting timeline resume tracker', {
                previousCount: lastCompletedPuzzlesCountRef.current,
                currentCount,
                lastResumedObject: lastResumedObjectRef.current
            });
            lastResumedObjectRef.current = null;
            lastCompletedPuzzlesCountRef.current = currentCount;
        }
    }, [safeRuntime.completedPuzzles]);

    // Extract currentObjectId for stable dependency
    const currentObjectId = safeRuntime.snapshot?.players?.[currentSessionId || '']?.currentObjectId;

    // Memoize completion status to prevent unnecessary useEffect re-runs
    const isCurrentObjectCompleted = useMemo(
        () => !!currentObjectId && (safeRuntime.completedObjects?.has(currentObjectId) || false),
        [currentObjectId, safeRuntime.completedObjects]
    );

    // Stable ref for runObjectTimeline to avoid re-running effect when timeline functions change
    const runObjectTimelineRef = useRef(runObjectTimeline);
    useEffect(() => {
        runObjectTimelineRef.current = runObjectTimeline;
    }, [runObjectTimeline]);

    const selectMapMode = useCallback(async (mode: 'play' | 'steps') => {
        console.log('[QuestMap] selectMapMode start', { mode });

        // 1. Mark as user gesture blessed immediately
        timelineGateRef.current.gestureBlessed = true;
        setModeConfirmed(true);

        // 2. Perform unlock sequence within the gesture handler
        if (!timelineGateRef.current.unlocking) {
            timelineGateRef.current.unlocking = true;
            try {
                // Ensure audio context and elements are unlocked now
                const foregroundUnlocked = await unlockAudio();
                console.log('[QuestMap] Foreground audio unlocked (in gesture):', {
                    foregroundUnlocked,
                    audioUnlockedRef: audioUnlockedRef.current,
                });

                if (foregroundUnlocked) {
                    setNotification('Audio attivato!');
                    setTimeout(() => setNotification(null), 2000);
                    flushPendingAudio();
                }

                // Unlock background audio too (fire and forget)
                void questAudio.unlockBackgroundAudio();

                // Start/join runtime only after the audio unlock attempt, to avoid any chance of interfering
                // with Safari's user-gesture audio permission chain.
                try {
                    // RESET SESSION IF ENTERING STEPS MODE
                    if (mode === 'steps') {
                        console.log('[QuestMap] Steps mode selected: Resetting session...');
                        void runtime?.startOrJoin?.({ reset: true });
                    } else {
                        void runtime?.startOrJoin?.();
                    }
                } catch {
                    // ignore
                }

                // SAFARI FIX: Trigger the first timeline execution HERE, inside the gesture
                // This ensures the first audio play() happens within a user interaction chain
                const currentObj = objectsById.get(currentObjectId || '');
                if (currentObj && !isCurrentObjectCompleted) {
                    console.log('[QuestMap] Triggering immediate timeline execution in gesture', {
                        objectId: currentObj.id,
                    });

                    // Update resume tracker so the useEffect doesn't double-play
                    lastResumedObjectRef.current = currentObj.id;

                    // Execute immediately
                    void runObjectTimelineRef.current(currentObj);
                }
            } catch (err) {
                console.error('[QuestMap] Audio unlock failed during gesture:', err);
            } finally {
                timelineGateRef.current.unlocking = false;
            }
        }

        // 3. Set mode (this would normally trigger the effect, but we handled it above)
        setMapMode(mode);

        if (mode === 'steps') {
            setGpsEnabled(false);
            setCurrentItineraryStep(0);
        }

        if (typeof window !== 'undefined') {
            try {
                sessionStorage.setItem('quest_map_mode', mode);
                if (mode !== 'play') {
                    sessionStorage.setItem('quest_gps_enabled', '0');
                }
            } catch {
                // ignore storage errors
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flushPendingAudio, questAudio, runtime?.startOrJoin, unlockAudio, currentObjectId, isCurrentObjectCompleted, objectsById]);

    useEffect(() => {
        console.log('[QuestMap] Timeline resume useEffect triggered', {
            hasSessionId: !!currentSessionId,
            hasSnapshot: !!safeRuntime.snapshot,
            currentObjectId,
            isCurrentObjectCompleted,
            lastResumedObject: lastResumedObjectRef.current
        });

        if (!currentSessionId || !currentObjectId) {
            console.log('[QuestMap] Resume effect: Missing session/object', { currentSessionId, currentObjectId });
            return;
        }

        // Ensure user has explicitly confirmed a mode in this pageview.
        if (!modeConfirmed || !mapMode) {
            console.log('[QuestMap] Resume effect: Mode not confirmed (waiting for interaction)', { mapMode, modeConfirmed });
            return;
        }

        // SAFARI FIX: Gate execution until the user gesture has "blessed" the interaction
        // and the unlock sequence has finished.
        console.log('[QuestMap] Resume effect gate check:', {
            mapMode,
            gestureBlessed: timelineGateRef.current.gestureBlessed,
            unlocking: timelineGateRef.current.unlocking,
            audioUnlocked: audioUnlockedRef.current
        });

        if (!timelineGateRef.current.gestureBlessed) {
            console.log('[QuestMap] Resume effect: Waiting for gesture (gestureBlessed=false)');
            return;
        }
        if (timelineGateRef.current.unlocking) {
            console.log('[QuestMap] Resume effect: Waiting for audio unlock (unlocking=true)');
            return;
        }

        // Wait for definition to be loaded so completedPuzzles is populated correctly
        // (Avoids race condition where we resume before knowing which puzzles are done)
        if (!safeRuntime.definition) {
            console.log('[QuestMap] Resume effect: No runtime definition');
            return;
        }

        // Don't resume if we already resumed this object
        if (lastResumedObjectRef.current === currentObjectId) {
            console.log('[QuestMap] Resume effect: Already resumed this object', { currentObjectId });
            return;
        }

        const currentObj = objectsById.get(currentObjectId);
        if (!currentObj) {
            console.log('[QuestMap] Resume effect: Object not found', { currentObjectId });
            return;
        }

        // Don't restart if object is already completed
        if (isCurrentObjectCompleted) {
            console.log('[QuestMap] Resume effect: Object completed', { currentObjectId });
            return;
        }

        // Mark this object as resumed to prevent re-triggering
        lastResumedObjectRef.current = currentObjectId;

        console.log('[QuestMap] Resume effect: Resuming timeline for object', {
            objectId: currentObjectId,
            reset: forceResetNextObjectRef.current
        });

        void runObjectTimelineRef.current(currentObj, { reset: forceResetNextObjectRef.current });
        forceResetNextObjectRef.current = false;
    }, [currentSessionId, currentObjectId, isCurrentObjectCompleted, objectsById, safeRuntime.definition, mapMode, modeConfirmed]);

    // Sync Timeline Panel with Steps Navigation
    useEffect(() => {
        if (!stepsMode || !data?.objects) return;

        // Find the object corresponding to the current itinerary step
        const targetObj = data.objects.find(obj => {
            const num = getItineraryNumber(obj);
            // Handle start object (itinerary 0) vs regular objects:
            // If getItineraryNumber returns 0, it might be the start object.
            // The stepper uses 0-based index or explicit numbers?
            // "stepIndex={currentItineraryStep}" in Overlay suggests it matches the itinerary number directly.
            return num === currentItineraryStep;
        });

        if (targetObj) {
            console.log('[QuestMap] Steps Sync: Running timeline for object', {
                step: currentItineraryStep,
                objectId: targetObj.id
            });
            // Execute timeline for the viewed object (without resetting progress or blocking)
            void runObjectTimelineRef.current(targetObj);
        }
    }, [stepsMode, currentItineraryStep, data?.objects, runObjectTimelineRef]);

    const handleEnterZone = useCallback(
        ({ stop, distance }: { stop: QuestStop; distance: number }) => {
            if (!isPlayMode) return;
            const obj = objectsById.get(stop.id);
            if (!obj) return;

            // Check if object has already been arrived at (from runtime snapshot)
            const objectState = safeRuntime.snapshot?.objects?.[obj.id];
            if (objectState?.arrivedAt) {
                console.log('[QuestMap] Skipping arrival trigger for already-arrived object', {
                    objectId: obj.id,
                    arrivedAt: objectState.arrivedAt
                });
                return;
            }

            handleObjectArrival(obj, distance, false);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [objectsById, handleObjectArrival, safeRuntime.snapshot]
    );

    const handleExitZone = useCallback(
        ({ stop }: { stop: QuestStop }) => {
            // Only stop looped effects when leaving their zone; one-shots should be allowed to finish.
            const activeEffect = activeEffectRef.current;
            if (activeEffect && activeEffect.objectId === stop.id && activeEffect.loop) {
                stopEffectAudio();
            }

            if (activeAudio && activeAudio.objectId === stop.id && activeAudio.loop) {
                stopAudio();
            }
        },
        [activeAudio, stopAudio, stopEffectAudio, activeEffectRef]
    );

    const handleGpsError = useCallback((error: GeolocationPositionError) => {
        setGpsEnabled(false);
        alert('Impossibile ottenere la posizione: ' + error.message);
    }, []);

    // Proximity tracker for arrivals (single GPS watcher)
    const {
        startTracking,
        stopTracking,
        position: trackerPosition
    } = useProximityTracker({
        stops,
        onEnterZone: handleEnterZone,
        onExitZone: handleExitZone,
        onError: handleGpsError,
        debounceMs: 1000,
        oneTimeOnly: false, // Allow re-triggers
        enableHighAccuracy: true
    });

    const userLocation = useMemo<[number, number] | null>(() => {
        if (!isPlayMode) return null;
        if (!gpsEnabled) return null;
        if (!trackerPosition) return null;
        const lat = trackerPosition.latitude;
        const lng = trackerPosition.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return [lat, lng];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gpsEnabled, isPlayMode, trackerPosition?.latitude, trackerPosition?.longitude]);

    useEffect(() => {
        userLocationRef.current = userLocation;
    }, [userLocation]);

    // Throttle / Configurable Location Updates
    useEffect(() => {
        if (!isPlayMode || !gpsEnabled || !userLocation) return;
        if (!data?.policies?.teamTravelMode) return;

        const mode = data.policies.teamTravelMode;
        if (mode !== 'independent') return;

        const now = Date.now();
        if (now - lastLocationSyncRef.current < 5000) return;

        lastLocationSyncRef.current = now;
        const [lat, lng] = userLocation;

        if (teamSync.updatePlayerState && trackerPosition) {
            teamSync.updatePlayerState({
                position: {
                    lat,
                    lng,
                    accuracy: trackerPosition.accuracy || 0,
                    timestamp: new Date().toISOString()
                }
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userLocation, isPlayMode, gpsEnabled, data?.policies?.teamTravelMode, teamSync]);

    // GPS and Compass Effect
    useEffect(() => {
        if (!isPlayMode || !gpsEnabled) {
            setHeading(null);
            lastHeadingUpdateRef.current = 0;
            lastHeadingValueRef.current = null;
            lastLocationSyncRef.current = 0;
            stopTracking();
            return;
        }

        // Start proximity tracking
        startTracking();

        const handleOrientation = (event: DeviceOrientationEvent) => {
            let compass: number | null = null;
            const webkitHeading = (event as any).webkitCompassHeading;
            if (typeof webkitHeading === 'number' && Number.isFinite(webkitHeading)) {
                compass = webkitHeading;
            } else if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
                compass = 360 - event.alpha;
            }
            if (compass !== null && Number.isFinite(compass)) {
                headingRef.current = compass;
                const now = performance.now();
                const lastUpdate = lastHeadingUpdateRef.current;
                const lastValue = lastHeadingValueRef.current;
                const elapsed = now - lastUpdate;

                const MIN_INTERVAL_MS = 100;
                const MIN_DELTA_DEG = 1;

                const delta =
                    lastValue === null
                        ? Infinity
                        : Math.abs((((compass - lastValue + 540) % 360) - 180));

                if (elapsed < MIN_INTERVAL_MS) return;
                if (delta < MIN_DELTA_DEG) return;

                lastHeadingUpdateRef.current = now;
                lastHeadingValueRef.current = compass;
                setHeading(compass);
            }
        };

        window.addEventListener('deviceorientation', handleOrientation);

        return () => {
            window.removeEventListener('deviceorientation', handleOrientation);
            stopTracking();
        };
    }, [gpsEnabled, isPlayMode, startTracking, stopTracking]);

    const toggleGPS = async () => {
        if (!isPlayMode) return;
        if (gpsEnabled) {
            setGpsEnabled(false);
            return;
        }

        // Best-effort audio unlock (do not block GPS enable on iOS/WebKit).
        void (async () => {
            try {
                const success = await unlockAudio();
                if (success) flushPendingAudio();
                await questAudio.unlockBackgroundAudio();
            } catch {
            }
        })();

        // Enable GPS immediately; request compass permission in the background if needed.
        setGpsEnabled(true);

        const DeviceOrientationEventClass = (window as any).DeviceOrientationEvent as
            | { requestPermission?: () => Promise<'granted' | 'denied'> }
            | undefined;

        if (DeviceOrientationEventClass && typeof DeviceOrientationEventClass.requestPermission === 'function') {
            void DeviceOrientationEventClass.requestPermission().catch(() => {
            });
        }
    };



    const startObjectIds = useMemo(() => {
        if (!data) return new Set<string>();

        const explicit = data.objects
            .filter((obj) => isStartObject(obj) && !!getValidCoordinates(obj))
            .map((obj) => obj.id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0);

        if (explicit.length) return new Set(explicit);

        // Fallback: if no explicit start flag exists, pick the first object numbered 0.
        const zeroCandidate = data.objects
            .map((obj, idx) => ({ obj, idx, num: getItineraryNumber(obj) }))
            .filter(({ obj, num }) => num === 0 && !!getValidCoordinates(obj))
            .sort((a, b) => a.idx - b.idx)[0]?.obj?.id;

        return zeroCandidate ? new Set([zeroCandidate]) : new Set<string>();
    }, [data]);

    const itineraryEntries = useMemo(() => {
        if (!data) return [];
        const entries = data.objects
            .map((obj, idx) => ({
                obj,
                idx,
                num: getItineraryNumber(obj),
                isStart: startObjectIds.has(obj.id)
            }))
            .filter(({ obj, num, isStart }) => {
                if (num === null || !Number.isFinite(num)) return false;
                if (!getValidCoordinates(obj)) return false;
                // Ignore objects with number 0 unless they are the Start object.
                if (num === 0 && !isStart) return false;
                return true;
            });

        entries.sort((a, b) => {
            const aNum = a.num ?? Number.POSITIVE_INFINITY;
            const bNum = b.num ?? Number.POSITIVE_INFINITY;
            if (aNum !== bNum) return aNum - bNum;
            return a.idx - b.idx;
        });

        return entries.map((entry) => ({ id: entry.obj.id, num: entry.num as number }));
    }, [data, startObjectIds]);

    const itineraryRange = useMemo(() => {
        if (!itineraryEntries.length) {
            return { start: 0, end: 0, hasData: false };
        }
        const nums = itineraryEntries.map((e) => e.num);
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const start = startObjectIds.size ? 0 : (nums.includes(0) ? 0 : min);
        return { start, end: max, hasData: true };
    }, [itineraryEntries, startObjectIds.size]);

    const simulateStepArrival = useCallback(async (stepNumber: number) => {
        if (!stepsMode) return;
        const targetEntry = itineraryEntries.find(entry => entry.num === stepNumber);
        if (!targetEntry) return;

        const targetObject = objectsById.get(targetEntry.id);
        if (!targetObject) return;

        stopAudio();
        const success = await unlockAudio();
        if (success) {
            flushPendingAudio();
            await questAudio.unlockBackgroundAudio();
        }
        await simulateArrivalWithPosition(targetObject);
    }, [itineraryEntries, objectsById, simulateArrivalWithPosition, stepsMode, stopAudio, unlockAudio, flushPendingAudio, questAudio]);

    const nextStep = useCallback(() => {
        const nextStepNumber = Math.min(currentItineraryStep + 1, itineraryRange.end);
        void simulateStepArrival(nextStepNumber);
        setCurrentItineraryStep((prev) => Math.min(prev + 1, itineraryRange.end));
    }, [currentItineraryStep, itineraryRange.end, simulateStepArrival]);

    const prevStep = useCallback(() => {
        const prevStepNumber = Math.max(itineraryRange.start, currentItineraryStep - 1);
        void simulateStepArrival(prevStepNumber);
        setCurrentItineraryStep((prev) => Math.max(itineraryRange.start, prev - 1));

        // Signal the resume effect to reset the timeline for this object
        forceResetNextObjectRef.current = true;
    }, [currentItineraryStep, itineraryRange.start, simulateStepArrival]);

    useEffect(() => {
        if (!stepsMode) return;
        if (!itineraryRange.hasData) return;
        setCurrentItineraryStep((prev) => {
            if (prev < itineraryRange.start) return itineraryRange.start;
            if (prev > itineraryRange.end) return itineraryRange.end;
            return prev;
        });
    }, [stepsMode, itineraryRange.hasData, itineraryRange.start, itineraryRange.end]);

    // Calculate nearest object distance (for UI display only - triggering handled by useProximityTracker)
    // Only consider visible objects
    useEffect(() => {
        if (!userLocation || !visibleObjects) return;

        const [userLat, userLng] = userLocation;
        let closestDist = Infinity;

        visibleObjects.forEach(obj => {
            const coords = getValidCoordinates(obj);
            if (!coords) return;

            const [objLat, objLng] = coords;
            const distance = calculateDistance(userLat, userLng, objLat, objLng);
            // const radius = obj.audio_effect?.triggerRadius || obj.triggerRadius || 20;

            if (distance < closestDist) {
                closestDist = distance;
                // closestRadius = radius;
                // closestName = obj.name;
            }
        });

        // setNearestObjectDistance(closestDist === Infinity ? null : closestDist);
        // setNearestObjectRadius(closestRadius);
        // setNearestObjectName(closestName);
    }, [userLocation, visibleObjects]);

    // Map Initialization
    useEffect(() => {
        if (!mapContainerRef.current || !data || mapInstanceRef.current) return;

        // Allow a bit more zoom for marker separation by scaling tiles beyond their native max.
        const maxZoom = OSM_MAX_ZOOM;

        const map = new LeafletMap(mapContainerRef.current, {
            zoomControl: false,
            maxZoom,
            zoomSnap: 0.5
        }).setView([0, 0], 2);
        const canHover = typeof window !== 'undefined' && window.matchMedia('(hover:hover) and (pointer:fine)').matches;

        const layer = new TileLayer(OSM_TILE_URL, {
            attribution: OSM_ATTRIBUTION,
            maxNativeZoom: OSM_MAX_NATIVE_ZOOM,
            maxZoom: OSM_MAX_ZOOM
        });
        layer.addTo(map);
        baseLayerRef.current = layer;

        mapInstanceRef.current = map;
        markersLayerRef.current = new LayerGroup().addTo(map);
        objectMarkersRef.current.clear();
        objectTriggerCirclesRef.current.clear();

        let startObjectCoords: [number, number] | null = null;
        // Use visibleObjects instead of all objects for sliding window visibility
        visibleObjects.forEach(obj => {
            const coords = getValidCoordinates(obj);
            if (coords) {
                const [lat, lng] = coords;
                const isMain = (obj as any).isMain !== false;
                const itineraryNumRaw = getItineraryNumber(obj);
                const start = isStartObject(obj);
                const itineraryNum = itineraryNumRaw === 0 && !start ? null : itineraryNumRaw;

                // Capture start object coordinates for centering
                if (start && !startObjectCoords) {
                    startObjectCoords = [lat, lng];
                }
                const isSpecialObject =
                    itineraryNumRaw === SPECIAL_OBJECT_ITINERARY_NUMBER || String(obj?.id ?? '') === String(SPECIAL_OBJECT_ITINERARY_NUMBER);

                // Determine object status for visual indicators (runtime)
                const isCompleted = safeRuntime.completedObjects?.has(obj.id) || false;
                // Use safeRuntime snapshot source of truth primarily
                const contextCurrentOId = currentSessionId ? safeRuntime.snapshot?.players?.[currentSessionId]?.currentObjectId ?? null : null;
                const isCurrent = !!contextCurrentOId && contextCurrentOId === obj.id;

                // Explicit status derivation (Past, Current, Future)
                // Note: 'future' objects are typically filtered out of visibleObjects in stepsMode anyway,
                // but we define the logic here for completeness/styling.
                let status: 'past' | 'current' | 'future' = 'future';
                if (isCompleted) {
                    status = 'past';
                } else if (isCurrent) {
                    status = 'current';
                }

                // Choose marker icon based on status
                let markerIcon: Icon | DivIcon;
                if (isSpecialObject) {
                    markerIcon = SPECIAL_OBJECT_MARKER_ICON;
                } else if (status === 'current') {
                    // Current object: active marker with pulsating effect
                    markerIcon = createVintageIcon(isMain ? 'active' : 'activeSecondary', itineraryNum);
                } else if (status === 'past') {
                    // Completed object: gray/secondary marker
                    markerIcon = createVintageIcon('locationSecondary', itineraryNum);
                } else {
                    // Default/Future: regular marker (though likely not visible in stepsMode)
                    markerIcon = createVintageIcon(isMain ? 'location' : 'locationSecondary', itineraryNum);
                }

                const marker = new Marker([lat, lng], {
                    icon: markerIcon,
                    title: `Lat: ${lat}, Lon: ${lng}`,
                    alt: obj.name || 'Object',
                    zIndexOffset: isSpecialObject ? 1000 : isCurrent ? 500 : 0
                });

                const images = normalizeObjectImages(obj);

                marker.bindPopup(
                    () => {
                        const ctx = distributionRef.current;
                        const gateMessage =
                            ctx.isTeamMode && !ctx.startedAtIso
                                ? `<div style="margin:8px 0 10px 0;font-size:12px;color:${COLORS.inkLight};font-style:italic;">Waiting for the team founder to start…</div>`
                                : '';

                        return `
	                            <div style="font-family:'Crimson Text',Georgia,serif;color:${COLORS.ink};padding:4px;min-width:160px;">
                                <h3 style="font-family:'Cinzel',serif;font-size:15px;font-weight:600;color:${COLORS.sepia};margin:0 0 8px 0;border-bottom:1px solid ${COLORS.gold};padding-bottom:6px;">${escapeHtml(obj.name)}</h3>
                                <p style="font-size:13px;line-height:1.4;margin:0 0 10px 0;font-style:italic;">${escapeHtml(obj.description || 'Un luogo misterioso ti attende...')}</p>
                                ${itineraryNum !== null ? `
                                    <div style="font-size:12px;color:${COLORS.inkLight};margin-bottom:10px;">
                                        <strong style="font-family:'Cinzel',serif;letter-spacing:1px;">Itinerary Number:</strong>
                                        <span style="font-family:'Courier New',monospace;margin-left:6px;">${itineraryNum}</span>
                                    </div>
                                ` : ''}
	                                ${gateMessage}
	                                <a href="/object/${escapeHtml(obj.id)}" style="display:inline-block;margin-left:8px;background:linear-gradient(135deg,${COLORS.inkLight} 0%,${COLORS.ink} 100%);color:${COLORS.parchment};padding:8px 14px;text-decoration:none;font-family:'Cinzel',serif;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;border:1px solid ${COLORS.gold};">Dettagli</a>
	                                ${images.length ? `
	                                    <div class="object-media">
	                                        <div class="object-media-title">MEDIA</div>
	                                        <div class="object-media-grid">
	                                            ${images
                                    .slice(0, 6)
                                    .map((img) => {
                                        const href = escapeHtml(img.url);
                                        const src = escapeHtml(img.thumbnailUrl || img.url);
                                        return `
                                                        <div class="object-media-item">
                                                            <a href="${href}" target="_blank" rel="noopener noreferrer" class="object-media-link">
                                                                <img src="${src}" alt="Object image" loading="lazy" class="object-media-img" />
                                                            </a>
                                                        </div>
                                                    `;
                                    })
                                    .join('')}
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    },
                    { className: 'vintage-popup' }
                );
                if (canHover) {
                    const tooltipText = typeof obj.name === 'string' && obj.name.length ? obj.name : 'Object';
                    marker.bindTooltip(escapeHtml(tooltipText), {
                        direction: 'top',
                        offset: [0, -12],
                        opacity: 0.95,
                        className: 'quest-object-tooltip'
                    });
                    marker.on('mouseover', () => marker.openTooltip());
                    marker.on('mouseout', () => marker.closeTooltip());
                }
                markersLayerRef.current?.addLayer(marker);
                objectMarkersRef.current.set(obj.id, marker);

                // Mystical trigger zone circle - more visible
                if ((obj as any).triggerRadius) {
                    const outerCircle = new Circle([lat, lng], {
                        radius: (obj as any).triggerRadius,
                        color: '#FFD700',
                        fillColor: COLORS.gold,
                        fillOpacity: 0.15,
                        weight: 2.5,
                        dashArray: '6, 6'
                    });
                    outerCircle.addTo(map);

                    // Inner glow ring
                    const innerCircle = new Circle([lat, lng], {
                        radius: (obj as any).triggerRadius * 0.6,
                        color: COLORS.burgundy,
                        fillColor: COLORS.burgundy,
                        fillOpacity: 0.08,
                        weight: 1,
                        dashArray: '3, 3'
                    });
                    innerCircle.addTo(map);

                    objectTriggerCirclesRef.current.set(obj.id, [outerCircle, innerCircle]);
                }
            }
        });

        // Set fixed zoom level 16 centered on start object or user location
        // Only set initial zoom once - don't reset when switching modes
        map.invalidateSize();

        if (!initialZoomSet.current) {
            const centerPoint = startObjectCoords || userLocation || [0, 0];
            map.setView(centerPoint, 16, { animate: false });
            savedZoom.current = 16;
            savedCenter.current = centerPoint;
            initialZoomSet.current = true;
        } else if (savedZoom.current !== null && savedCenter.current !== null) {
            // Restore saved zoom and center when map is recreated (e.g., mode switch)
            map.setView(savedCenter.current, savedZoom.current, { animate: false });
        }

        syncObjectPulsatingCircles(data.objects, getValidCoordinates, normalizeEffect);

        const markers = objectMarkersRef.current;
        const triggerCircles = objectTriggerCirclesRef.current;
        const mapInstance = mapInstanceRef.current;

        return () => {
            clearPulsatingCircles();
            markers.clear();
            triggerCircles.forEach((circles) => circles?.forEach((c) => c?.remove && c.remove()));
            triggerCircles.clear();
            if (mapInstance) {
                // Save current zoom and center before destroying map
                try {
                    savedZoom.current = mapInstance.getZoom();
                    const center = mapInstance.getCenter();
                    savedCenter.current = [center.lat, center.lng];
                } catch {
                    // Ignore errors when getting zoom/center
                }
                mapInstance.remove();
                mapInstanceRef.current = null;
            }
            baseLayerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clearPulsatingCircles, data, mapContainerRef, syncObjectPulsatingCircles, visibleObjects]);

    // Map interaction audio unlock effect
    useEffect(() => {
        const map = mapInstanceRef.current;
        if (!map) return;

        const handleFirstTouch = async () => {
            if (!audioUnlockedRef.current) {
                const success = await unlockAudio();
                if (success) {
                    setNotification('Audio attivato!');
                    setTimeout(() => setNotification(null), 2000);
                    flushPendingAudio();
                }
            }
        };

        // Unlock on ANY map interaction
        map.on('click', handleFirstTouch);
        map.on('touchstart', handleFirstTouch);
        map.on('dragstart', handleFirstTouch);
        map.on('zoomstart', handleFirstTouch);

        return () => {
            map.off('click', handleFirstTouch);
            map.off('touchstart', handleFirstTouch);
            map.off('dragstart', handleFirstTouch);
            map.off('zoomstart', handleFirstTouch);
        };
    }, [unlockAudio, flushPendingAudio, audioUnlockedRef]);

    useEffect(() => {
        const map = mapInstanceRef.current;
        const markersLayer = markersLayerRef.current;
        if (!map || !markersLayer || !data) return;

        if (!stepsMode) {
            // Hard reset to guarantee all object markers are visible.
            markersLayer.clearLayers();
            objectMarkersRef.current.forEach((marker) => markersLayer.addLayer(marker));

            objectTriggerCirclesRef.current.forEach((circles) => {
                circles.forEach((circle) => {
                    if (!map.hasLayer(circle)) circle.addTo(map);
                });
            });
            setPulsatingVisibility(null);

            return;
        }

        if (!itineraryRange.hasData) {
            // No itinerary numbers configured; show everything in visibleObjects.
            markersLayer.clearLayers();
            objectMarkersRef.current.forEach((marker) => markersLayer.addLayer(marker));
            setPulsatingVisibility(null);
            return;
        }

        // In the new logic, visibleObjects already filters out "Future" objects.
        // So we just need to ensure all markers in objectMarkersRef (which corresponds to visibleObjects)
        // are added to the layer. The stepper logic (currentItineraryStep) is less relevant for visibility
        // now that it's driven by completion status, but we keep the logic compatible.

        // Simply show ALL markers that have been created (since they are only the valid ones)
        markersLayer.clearLayers();
        objectMarkersRef.current.forEach((marker, objId) => {
            markersLayer.addLayer(marker);
        });

        // Ensure triggers are consistent
        objectTriggerCirclesRef.current.forEach((circles, objId) => {
            circles.forEach((circle) => {
                if (!map.hasLayer(circle)) circle.addTo(map);
            });
        });

        // Pass null to imply "Show all current markers" for pulsating logic
        setPulsatingVisibility(null);
    }, [data, stepsMode, currentItineraryStep, itineraryEntries, itineraryRange.hasData, setPulsatingVisibility, startObjectIds]);

    // Update User Marker
    useEffect(() => {
        if (!mapInstanceRef.current || !userLocation) return;

        const [lat, lng] = userLocation;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return;
        }

        try {
            if (!userMarkerRef.current) {
                userMarkerRef.current = new Marker([lat, lng], {
                    icon: createVintageIcon('player')
                }).addTo(mapInstanceRef.current).bindPopup(`
	                    <div style="font-family:'Cinzel',serif;color:${COLORS.sepia};text-align:center;padding:4px;">
	                        <strong>Tu sei qui</strong><br/>
	                        <span style="font-family:'Crimson Text',serif;font-style:italic;font-size:12px;">Viaggiatore nel tempo</span>
	                    </div>
	                `);
            } else {
                userMarkerRef.current.setLatLng([lat, lng]);
            }
        } catch {
        }
    }, [userLocation]);

    // Loading State
    if (!data || !runtime) {
        return (
            <div style={{
                position: 'fixed',
                inset: 0,
                background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a15 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '24px'
            }}>
                <div style={{
                    width: '60px',
                    height: '60px',
                    border: `3px solid transparent`,
                    borderTopColor: COLORS.gold,
                    borderRightColor: COLORS.gold,
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                }}></div>
                <p style={{
                    fontFamily: "'Cinzel', serif",
                    color: COLORS.gold,
                    fontSize: '16px',
                    letterSpacing: '2px'
                }}>Aprendo il portale temporale...</p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    // const isInZone = nearestObjectDistance !== null && nearestObjectDistance < (nearestObjectRadius || 20);

    // Use dynamic player/team score instead of static votesFor
    const votesFor = currentScore;
    const votesAgainst = Math.max(0, totalPointsAvailable - votesFor);

    return (
        <>
            {/* Global Styles */}
            <style>{`
		                @keyframes questPulse {
		                    0% { transform: translate(-50%, -50%) scale(0.8); opacity: 1; }
		                    100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
		                }

	                @keyframes telegramSlide {
	                    0% { transform: translateX(-50%) translateY(-100%); opacity: 0; }
	                    15% { transform: translateX(-50%) translateY(0); opacity: 1; }
                    85% { transform: translateX(-50%) translateY(0); opacity: 1; }
                    100% { transform: translateX(-50%) translateY(-100%); opacity: 0; }
                }

                @keyframes compassGlow {
                    0%, 100% { filter: drop-shadow(0 0 8px rgba(201, 169, 97, 0.4)); }
                    50% { filter: drop-shadow(0 0 16px rgba(201, 169, 97, 0.7)); }
                }

		                .quest-map-container .leaflet-tile-pane {
		                    filter: none;
		                }

	                .quest-map-container .leaflet-container {
	                    background: #f2f2f2;
	                }

	                    img.leaflet-marker-icon.quest-special-marker {
	                        object-fit: contain;
	                        background-color: transparent !important;
	                        background: transparent !important;
	                        border: none !important;
	                        box-shadow: none !important;
	                        filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.35));
	                    }

                    .quest-object-tooltip {
                        background: linear-gradient(135deg, rgba(26, 21, 16, 0.92) 0%, rgba(44, 36, 28, 0.92) 100%);
                        border: 1px solid ${COLORS.gold};
                        border-radius: 6px;
                        color: ${COLORS.parchment};
                        font-family: 'Cinzel', serif;
                        font-size: 11px;
                        font-weight: 600;
                        letter-spacing: 1px;
                        padding: 4px 8px;
                        text-transform: uppercase;
                        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
                    }

                    .quest-object-tooltip.leaflet-tooltip-top:before {
                        border-top-color: ${COLORS.gold};
                    }

                .vintage-popup .leaflet-popup-content-wrapper {
                    background: linear-gradient(135deg, ${COLORS.parchment} 0%, ${COLORS.parchmentDark} 100%);
                    border: 2px solid ${COLORS.gold};
                    border-radius: 2px;
                    box-shadow: 0 4px 20px rgba(44, 24, 16, 0.3);
                }

                .vintage-popup .leaflet-popup-tip {
                    background: ${COLORS.parchmentDark};
                    border-left: 1px solid ${COLORS.gold};
                    border-bottom: 1px solid ${COLORS.gold};
                }

	                .vintage-popup .leaflet-popup-close-button {
	                    color: ${COLORS.sepia} !important;
	                }

	                .vintage-popup .object-media {
	                    margin-top: 10px;
	                    padding-top: 8px;
	                    border-top: 1px solid ${COLORS.gold};
	                }

	                .vintage-popup .object-media-title {
	                    font-family: 'Cinzel', serif;
	                    font-size: 11px;
	                    font-weight: 700;
	                    letter-spacing: 0.14em;
	                    color: ${COLORS.sepia};
	                    margin-bottom: 8px;
	                    text-transform: uppercase;
	                }

	                .vintage-popup .object-media-grid {
	                    display: grid;
	                    grid-template-columns: repeat(2, minmax(0, 1fr));
	                    gap: 10px;
	                }

	                .vintage-popup .object-media-item {
	                    display: flex;
	                    flex-direction: column;
	                    gap: 6px;
	                }

	                .vintage-popup .object-media-link {
	                    display: block;
	                    border: 1px solid ${COLORS.gold};
	                    background: ${COLORS.parchmentDark};
	                    padding: 3px;
	                    box-shadow: 0 3px 10px rgba(44, 24, 16, 0.2);
	                    text-decoration: none;
	                }

	                .vintage-popup .object-media-img {
	                    width: 100%;
	                    height: 90px;
	                    object-fit: cover;
	                    display: block;
	                    filter: sepia(0.18) contrast(1.08) brightness(0.98);
	                }

	                .vintage-popup .object-media-audio {
	                    width: 100%;
	                }
	            `}</style>

            <div className="quest-map-container" style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                fontFamily: "'Crimson Text', Georgia, serif"
            }}>
                <MapFrame />

                {/* Map Container */}
                <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />

                {/* Debug logging removed to reduce console spam */}

                <QuestMapOverlay
                    mode={mapMode}
                    stepIndex={currentItineraryStep}
                    stepTotal={itineraryRange.end}
                    onSelectMode={selectMapMode}
                    onNextStep={nextStep}
                    onPrevStep={prevStep}
                    totalPoints={totalPointsAvailable}
                    votesFor={votesFor}
                    votesAgainst={votesAgainst}
                    timelinePanel={(() => {
                        if (!stepsTimelinePanel) return undefined;
                        // Find the expected object for the current step to prevent stale timeline data
                        const expectedObj = data?.objects?.find(obj => {
                            const num = getItineraryNumber(obj);
                            return num === currentItineraryStep;
                        });
                        // Only show timeline panel if it matches the current step's object
                        if (expectedObj && stepsTimelinePanel.objectId === expectedObj.id) {
                            return stepsTimelinePanel;
                        }
                        return undefined;
                    })()}
                    audioPanel={audioPanelProps}
                />

                {/* Vignette Overlay for dramatic contrast */}
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    zIndex: 2000,
                    background: `
                        radial-gradient(ellipse at center, transparent 40%, rgba(26, 21, 16, 0.3) 80%, rgba(26, 21, 16, 0.6) 100%),
                        linear-gradient(to bottom, rgba(26, 21, 16, 0.2) 0%, transparent 15%, transparent 85%, rgba(26, 21, 16, 0.25) 100%)
                    `
                }} />

                {/* Telegram-style Notification */}
                {notification && (
                    <div style={{
                        position: 'absolute',
                        top: '70px',
                        left: '50%',
                        zIndex: 5000,
                        padding: '14px 24px',
                        background: `linear-gradient(135deg, ${COLORS.parchment} 0%, ${COLORS.parchmentDark} 100%)`,
                        border: `2px solid ${COLORS.gold}`,
                        boxShadow: '0 8px 32px rgba(44, 24, 16, 0.3), inset 0 1px 0 rgba(255,255,255,0.5)',
                        maxWidth: '300px',
                        animation: 'telegramSlide 4s ease-in-out forwards'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                width: '8px',
                                height: '8px',
                                background: COLORS.burgundy,
                                borderRadius: '50%',
                                boxShadow: `0 0 8px rgba(114, 47, 55, 0.6)`
                            }}></div>
                            <span style={{
                                fontFamily: "'Cinzel', serif",
                                color: COLORS.sepia,
                                fontSize: '13px',
                                fontWeight: 600,
                                letterSpacing: '0.5px'
                            }}>
                                {notification}
                            </span>
                        </div>
                        <div style={{
                            marginTop: '10px',
                            paddingTop: '10px',
                            borderTop: `1px dashed ${COLORS.gold}`,
                            fontSize: '10px',
                            color: '#8B7355',
                            fontStyle: 'italic',
                            textAlign: 'center'
                        }}>
                            — Messaggio dal Portale —
                        </div>
                    </div>
                )}

                <MapOverlays
                    timelineActionOverlay={timelineActionOverlay}
                    completeTimelineAction={completeTimelineAction}
                    cancelTimelineAction={cancelTimelineAction}

                    timelineTextOverlay={timelineTextOverlay}
                    closeTimelineText={closeTimelineText}

                    timelineVideoOverlay={timelineVideoOverlay}
                    closeTimelineVideo={closeTimelineVideo}

                    timelineChatOverlay={timelineChatOverlay}
                    closeTimelineChat={closeTimelineChat}

                    audioCurrentTime={audioCurrentTime}
                    audioDuration={audioDuration}
                    audioIsPlaying={audioIsPlaying}
                />

                {timelinePuzzleOverlay ? (
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 9000,
                            background: '#000',
                        }}
                        role="dialog"
                        aria-label="Puzzle"
                        data-testid="timeline-puzzle-overlay"
                    >
                        <button
                            type="button"
                            onClick={() => {
                                if (stepsMode) {
                                    setPuzzleCloseConfirmation(true);
                                } else {
                                    closeTimelinePuzzle();
                                }
                            }}
                            aria-label="Close puzzle"
                            style={{
                                position: 'absolute',
                                top: 12,
                                right: 12,
                                zIndex: 9100,
                                width: 44,
                                height: 44,
                                borderRadius: 9999,
                                border: '1px solid rgba(255,255,255,0.3)',
                                background: 'rgba(0,0,0,0.55)',
                                color: '#fff',
                                fontSize: 24,
                                lineHeight: '44px',
                                textAlign: 'center',
                                cursor: 'pointer'
                            }}
                        >
                            ×
                        </button>
                        <PuzzleClientOverlay
                            puzzleId={timelinePuzzleOverlay.puzzleId}
                            objectId={timelinePuzzleOverlay.objectId}
                            onClose={closeTimelinePuzzle}
                        />

                        {puzzleCloseConfirmation && (
                            <div style={{
                                position: 'absolute',
                                inset: 0,
                                zIndex: 9500,
                                background: 'rgba(0,0,0,0.85)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <div style={{
                                    width: '90%',
                                    maxWidth: '320px',
                                    padding: '24px',
                                    background: `linear-gradient(135deg, ${COLORS.parchment} 0%, ${COLORS.parchmentDark} 100%)`,
                                    border: `2px solid ${COLORS.gold}`,
                                    borderRadius: '2px',
                                    boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
                                    textAlign: 'center',
                                    color: COLORS.ink
                                }}>
                                    <h3 style={{
                                        fontFamily: "'Cinzel', serif",
                                        color: COLORS.sepia,
                                        fontSize: '18px',
                                        marginBottom: '16px',
                                        fontWeight: 700
                                    }}>Saltare il Puzzle?</h3>
                                    <p style={{
                                        fontFamily: "'Crimson Text', serif",
                                        fontSize: '16px',
                                        marginBottom: '24px',
                                        lineHeight: '1.4'
                                    }}>
                                        Se confermi, il puzzle verrà segnato come completato e potrai proseguire.
                                    </p>
                                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                                        <button
                                            onClick={() => setPuzzleCloseConfirmation(false)}
                                            style={{
                                                padding: '10px 20px',
                                                background: 'transparent',
                                                border: `1px solid ${COLORS.sepia}`,
                                                color: COLORS.sepia,
                                                fontFamily: "'Cinzel', serif",
                                                fontWeight: 600,
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Annulla
                                        </button>
                                        <button
                                            onClick={async () => {
                                                setPuzzleCloseConfirmation(false);
                                                await completeTimelinePuzzle();
                                            }}
                                            style={{
                                                padding: '10px 20px',
                                                background: `linear-gradient(135deg, ${COLORS.gold} 0%, #b8860b 100%)`,
                                                border: 'none',
                                                color: '#fff',
                                                fontFamily: "'Cinzel', serif",
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                boxShadow: '0 4px 10px rgba(0,0,0,0.2)'
                                            }}
                                        >
                                            Conferma
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ) : null}

                {isPlayMode && (
                    <>
                        <CompassControl
                            gpsEnabled={gpsEnabled}
                            onToggle={toggleGPS}
                            heading={heading}
                        />
                    </>
                )}
                <audio ref={audioRef} {...audioHandlers} preload="auto" playsInline style={hiddenAudioStyle} />
                <audio ref={effectAudioRef} preload="auto" playsInline style={hiddenAudioStyle} />
            </div>
        </>
    );
}
