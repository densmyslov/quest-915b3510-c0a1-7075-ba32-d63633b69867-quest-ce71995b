'use client';

import 'leaflet/dist/leaflet.css';
import { useRef, useMemo, useCallback, useEffect } from 'react';
import { useQuest } from '@/context/QuestContext';
import { useTeamSync } from '@/context/TeamSyncContext';
import { useDebugLog } from '@/context/DebugLogContext';
import { getSoloTeamStartedAt, isSoloTeamSession } from '@/lib/soloTeam';
import { isQuestDebugEnabled } from '@/lib/debugFlags';

import { MapFrame } from './components/MapFrame';
import { COLORS } from './components/MapStyles';
import { RuntimeDebugOverlay } from '@/components/RuntimeDebugOverlay';

import { useQuestMapState } from './hooks/useQuestMapState';
import { useMapInitialization } from './hooks/useMapInitialization';
import { useQuestTimelineLogic } from './hooks/useQuestTimelineLogic';
import { useQuestLocationLogic } from './hooks/useQuestLocationLogic';
import { useQuestMarkers } from './hooks/useQuestMarkers';
import { QuestMarkersLayer } from './layers/QuestMarkersLayer';
import { UserLocationLayer } from './layers/UserLocationLayer';
import { QuestUIOverlays } from './overlays/QuestUIOverlays';
import { getItineraryNumber, isStartObject, getValidCoordinates } from './utils/mapUtils';

const hiddenAudioStyle: React.CSSProperties = {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
    left: -9999,
    top: -9999,
};

export default function QuestMap() {
    const { data } = useQuest();
    const teamSync = useTeamSync();
    const { addLog } = useDebugLog();
    const mapContainerRef = useRef<HTMLDivElement>(null);

    // Global Runtime Fallback
    const { runtime } = useQuest();
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

    const fallbackSessionId = typeof window !== 'undefined' ? sessionStorage.getItem('quest_sessionId') : null;
    const currentSessionId = teamSync.session?.sessionId ?? fallbackSessionId ?? null;

    // --- State ---
    const {
        gpsEnabled,
        setGpsEnabled,
        mapMode,
        setMapMode,
        modeConfirmed,
        setModeConfirmed,
        mapUniqueId,
        setMapUniqueId,
        currentItineraryStep,
        setCurrentItineraryStep,
        puzzleCloseConfirmation,
        setPuzzleCloseConfirmation,
        notification,
        setNotification
    } = useQuestMapState();

    const timelineGateRef = useRef({
        gestureBlessed: false,
        unlocking: false,
    });

    const isPlayMode = mapMode === 'play';
    const stepsMode = mapMode === 'steps';

    // --- Refactoring: Use Quest Markers Hook ---
    const {
        objectsById,
        visibleObjects,
        startObjectIds,
        stops
    } = useQuestMarkers({
        data,
        safeRuntime,
        stepsMode
    }); // Returns { visibleObjects: any[], startObjectIds: Set<string>, stops: QuestStop[], objectsById: Map<string, any> }

    const visibleObjectIds = useMemo(() => {
        return visibleObjects.map(obj => String(obj.id));
    }, [visibleObjects]);

    // We need userLocation for initialization if start objects are missing,
    // but userLocation comes from Logic which depends on hooks.
    // However, map initialization happens once.
    // We can use a ref or state for user location that updates.
    const userLocationRef = useRef<[number, number] | null>(null);

    const mapInit = useMapInitialization({
        mapContainerRef: mapContainerRef,
        data,
        visibleObjects,
        userLocation: userLocationRef.current, // Initial render loc
        startObjectIds,
        setMapUniqueId,
        mapUniqueId,
        onCleanup: () => { }
    });

    const timelineLogic = useQuestTimelineLogic({
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
        mapInstanceRef: mapInit.mapInstanceRef,
        userLocationRef,
        setNotification,
        timelineGateRef
    });

    useEffect(() => {
        // Show object-defined pulses only for currently visible objects
        const visibleIds = new Set(visibleObjects.map(o => String(o?.id)));
        const objPulseIds = timelineLogic.pulsating.getObjectPulseIds
            ? timelineLogic.pulsating.getObjectPulseIds()
            : [];
        const shouldShow = new Set(objPulseIds.filter(id => visibleIds.has(id)));
        timelineLogic.pulsating.setPulsatingVisibility(shouldShow);
    }, [visibleObjects, timelineLogic.pulsating]);

    const locationLogic = useQuestLocationLogic({
        data,
        objectsById,
        safeRuntime,
        isPlayMode,
        gpsEnabled,
        setGpsEnabled,
        currentItineraryStep,
        setCurrentItineraryStep,
        handleObjectArrival: timelineLogic.arrival.handleObjectArrival,
        simulateArrivalWithPosition: timelineLogic.arrival.simulateArrivalWithPosition,
        stopAudio: timelineLogic.audioControls.stopAudio,
        unlockAudio: timelineLogic.audioControls.unlockAudio,
        flushPendingAudio: timelineLogic.audioControls.flushPendingAudio,
        activeEffectRef: timelineLogic.audioRefs.activeEffectRef,
        activeAudio: timelineLogic.audioState.activeAudio,
        stopEffectAudio: timelineLogic.audioControls.stopEffectAudio,
        stepsMode,
        teamSync,
        setNotification,
        // Pass stops from useQuestMarkers hook
        stops
    });

    // Sync user location ref for other components to access the latest
    useEffect(() => {
        userLocationRef.current = locationLogic.userLocation;
    }, [locationLogic.userLocation]);


    // --- Map Mode Selection ---
    const selectMapMode = useCallback(async (mode: 'play' | 'steps') => {
        console.log('[QuestMap] selectMapMode start', { mode });

        timelineGateRef.current.gestureBlessed = true;
        setModeConfirmed(true);

        // --- NEW: Force Zoom 17 & Center ---
        const map = mapInit.mapInstanceRef.current;
        if (map) {
            let targetCenter: [number, number] | null = null;

            if (mode === 'steps') {
                // In Steps Mode, we reset to step 0. Find that object.
                // We use 'data.objects' directly or 'objectsById'.
                const stepZeroObj = data?.objects?.find((obj: any) => getItineraryNumber(obj) === 0);
                if (stepZeroObj) {
                    targetCenter = getValidCoordinates(stepZeroObj);
                } else {
                    // Fallback to any start object
                    const startObj = data?.objects?.find((obj: any) => isStartObject(obj));
                    if (startObj) {
                        targetCenter = getValidCoordinates(startObj);
                    }
                }
            } else {
                // Play Mode
                // 1. Try User Location (if we have it cached from a previous session or instant fix)
                if (userLocationRef.current) {
                    targetCenter = userLocationRef.current;
                } else {
                    // 2. Try Current Object from Runtime
                    const currentPlayerId = safeRuntime.snapshot?.me?.playerId ?? null;
                    const currentObjectId = currentPlayerId
                        ? (safeRuntime.snapshot?.players?.[currentPlayerId]?.currentObjectId ?? null)
                        : null;
                    if (currentObjectId) {
                        const obj = objectsById.get(currentObjectId);
                        if (obj) targetCenter = getValidCoordinates(obj);
                    }

                    // 3. Fallback to Start Object
                    if (!targetCenter) {
                        const startObj = data?.objects?.find((obj: any) => isStartObject(obj));
                        if (startObj) targetCenter = getValidCoordinates(startObj);
                    }
                }
            }

            if (targetCenter) {
                console.log('[QuestMap] Setting view to zoom 17', { mode, targetCenter });
                map.setView(targetCenter, 17, { animate: true });
            }
        }
        // -----------------------------------

        if (!timelineGateRef.current.unlocking) {
            timelineGateRef.current.unlocking = true;
            try {
                const foregroundUnlocked = await timelineLogic.audioControls.unlockAudio();
                if (foregroundUnlocked) {
                    setNotification('Audio attivato!');
                    setTimeout(() => setNotification(null), 2000);
                    timelineLogic.audioControls.flushPendingAudio();
                }

                // void questAudio.unlockBackgroundAudio();

                try {
                    if (mode === 'steps') {
                        void runtime?.startOrJoin?.({ reset: true });
                    } else {
                        void runtime?.startOrJoin?.();
                    }
                } catch { }

                const currentPlayerId = safeRuntime.snapshot?.me?.playerId ?? null;
                const currentObjectId = currentPlayerId
                    ? (safeRuntime.snapshot?.players?.[currentPlayerId]?.currentObjectId ?? null)
                    : null;
                const currentObj = objectsById.get(currentObjectId || '');
                const isCurrentObjectCompleted = !!currentObjectId && (safeRuntime.completedObjects?.has(currentObjectId) || false);
                const hasArrivedAtCurrentObject = !!(currentObjectId && safeRuntime.snapshot?.objects?.[currentObjectId]?.arrivedAt);

                // In Play mode, only start the timeline after GPS arrival (OBJECT_ARRIVE).
                // Steps mode intentionally bypasses this.
                if (currentObj && !isCurrentObjectCompleted && (mode === 'steps' || hasArrivedAtCurrentObject)) {
                    timelineLogic.lastResumedObjectRef.current = currentObj.id;
                    void timelineLogic.timelineHandlers.runObjectTimeline(currentObj);
                }
            } catch (err) {
                console.error('[QuestMap] Audio unlock failed during gesture:', err);
            } finally {
                timelineGateRef.current.unlocking = false;
            }
        }
        setMapMode(mode);
        if (mode === 'steps') {
            setGpsEnabled(false);
            setCurrentItineraryStep(0);
        }
    }, [timelineLogic, safeRuntime, currentSessionId, objectsById, runtime, setMapMode, setGpsEnabled, setCurrentItineraryStep, setNotification, setModeConfirmed, data, mapInit.mapInstanceRef]);


    // Distribution Ref for Popups
    const distributionRef = useRef({
        sessionId: null,
        isTeamMode: false,
        soloTeam: false,
        teamCode: null,
        startedAtIso: undefined,
        members: []
    } as any);

    useEffect(() => {
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
            members: [],
        };
    }, [teamSync, fallbackSessionId]);

    // Derived Scores
    const totalPointsAvailable = useMemo(() => {
        if (!data?.objects) return 0;
        return data.objects.reduce((sum: number, obj: any) => sum + (obj.points || 0), 0);
    }, [data]);

    const currentScore = useMemo(() => {
        const playerScore = currentSessionId ? safeRuntime.scoreByPlayerId.get(currentSessionId) : null;
        if (typeof playerScore === 'number') return playerScore;
        if (teamSync.team?.members && teamSync.team.members.length > 0) {
            return teamSync.team.members.reduce((sum: number, member: any) => sum + (member.totalPoints || 0), 0);
        }
        return data?.quest?.votesFor || 0;
    }, [currentSessionId, safeRuntime.scoreByPlayerId, teamSync.team?.members, data?.quest?.votesFor]);

    const votesFor = currentScore;
    const votesAgainst = Math.max(0, totalPointsAvailable - votesFor);

    // Audio Panel Props
    const handleToggleAudioPanelCollapsed = useCallback(() => {
        timelineLogic.audioState.setPanelCollapsed((prev: boolean) => !prev);
    }, [timelineLogic.audioState]);

    const audioPanelProps = useMemo(() => ({
        title: timelineLogic.audioState.activeAudio?.name ?? '',
        audioUrl: timelineLogic.audioState.activeAudio?.url ?? '',
        transcription: timelineLogic.audioState.activeAudio?.transcription ?? null,
        mode: timelineLogic.audioState.activeAudio?.mode ?? 'audio',
        currentTime: timelineLogic.audioState.currentTime,
        duration: timelineLogic.audioState.duration,
        isPlaying: timelineLogic.audioState.isPlaying,
        isCollapsed: timelineLogic.audioState.isPanelCollapsed,
        onToggleCollapsed: handleToggleAudioPanelCollapsed,
        onClose: timelineLogic.audioControls.stopAudio,
        audioRef: timelineLogic.audioRefs.audioRef,
        ...timelineLogic.audioHandlers
    }), [timelineLogic.audioState, timelineLogic.audioControls, timelineLogic.audioRefs, timelineLogic.audioHandlers, handleToggleAudioPanelCollapsed]);

    // Map Interaction Unlock
    useEffect(() => {
        const map = mapInit.mapInstanceRef.current;
        if (!map) return;
        const handleFirstTouch = async () => {
            if (!timelineLogic.audioUnlockedRef.current) {
                const success = await timelineLogic.audioControls.unlockAudio();
                if (success) {
                    setNotification('Audio attivato!');
                    setTimeout(() => setNotification(null), 2000);
                    timelineLogic.audioControls.flushPendingAudio();
                }
            }
        };
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
    }, [mapInit.mapInstanceRef.current, timelineLogic.audioControls, timelineLogic.audioUnlockedRef, mapUniqueId, setNotification]);


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

    return (
        <div className="quest-map-container" style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            fontFamily: "'Crimson Text', Georgia, serif"
        }}>
            <MapFrame />
            <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />

            <QuestMarkersLayer
                map={mapInit.mapInstanceRef.current}
                markersLayer={mapInit.markersLayerRef.current}
                data={data}
                visibleObjects={visibleObjects}
                safeRuntime={safeRuntime}
                currentSessionId={currentSessionId}
                stepsMode={stepsMode}
                itineraryEntries={locationLogic.itineraryEntries}
                itineraryRange={locationLogic.itineraryRange}
                getItineraryNumber={getItineraryNumber}
                isStartObject={isStartObject}
                distributionRef={distributionRef}
                addOrUpdatePulsatingCircle={timelineLogic.pulsating.addOrUpdatePulsatingCircle}
                removeTimelinePulsatingCircle={timelineLogic.pulsating.removeTimelinePulsatingCircle}
                getObjectPulseIds={timelineLogic.pulsating.getObjectPulseIds}
                setPulsatingVisibility={timelineLogic.pulsating.setPulsatingVisibility}
            />

            <UserLocationLayer
                map={mapInit.mapInstanceRef.current}
                userLocation={locationLogic.userLocation}
            />

            <QuestUIOverlays
                mapMode={mapMode}
                currentItineraryStep={currentItineraryStep}
                itineraryRange={locationLogic.itineraryRange}
                selectMapMode={selectMapMode}
                nextStep={locationLogic.nextStep}
                prevStep={locationLogic.prevStep}
                totalPointsAvailable={totalPointsAvailable}
                votesFor={votesFor}
                votesAgainst={votesAgainst}
                stepsTimelinePanel={timelineLogic.timelineState.stepsTimelinePanel}
                data={data}
                getItineraryNumber={getItineraryNumber}
                audioPanelProps={audioPanelProps}
                collectedDocuments={timelineLogic.timelineState.collectedDocuments}
                notification={notification}
                timelineState={timelineLogic.timelineState}
                timelineHandlers={timelineLogic.timelineHandlers}
                audioState={timelineLogic.audioState}
                audioControls={timelineLogic.audioControls}
                puzzleCloseConfirmation={puzzleCloseConfirmation}
                setPuzzleCloseConfirmation={setPuzzleCloseConfirmation}
                gpsEnabled={gpsEnabled}
                toggleGPS={locationLogic.toggleGPS}
                heading={locationLogic.heading}
                isPlayMode={isPlayMode}
                stepsMode={stepsMode}
            />

            <audio ref={timelineLogic.audioRefs.audioRef} {...timelineLogic.audioHandlers} preload="auto" playsInline style={hiddenAudioStyle} />
            <audio ref={timelineLogic.audioRefs.effectAudioRef} preload="auto" playsInline style={hiddenAudioStyle} />

            <RuntimeDebugOverlay />
        </div>
    );
}
