'use client';

import 'leaflet/dist/leaflet.css';
import { useRef, useMemo, useCallback, useEffect } from 'react';
import { useQuest } from '@/context/QuestContext';
import { useTeamSync } from '@/context/TeamSyncContext';
import { useDebugLog } from '@/context/DebugLogContext';
import { getSoloTeamStartedAt, isSoloTeamSession } from '@/lib/soloTeam';
import { isQuestDebugEnabled } from '@/lib/debugFlags';

import { MapFrame } from '@/components/map/MapFrame';
import { COLORS } from '@/components/map/MapStyles';
import { RuntimeDebugOverlay } from '@/components/RuntimeDebugOverlay';

import { useQuestMapState } from './hooks/useQuestMapState';
import { useMapInitialization } from './hooks/useMapInitialization';
import { useQuestTimelineLogic } from './hooks/useQuestTimelineLogic';
import { useQuestLocationLogic } from './hooks/useQuestLocationLogic';
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

    // --- Data ---
    const objectsById = useMemo(() => {
        return new Map((data?.objects ?? []).map((obj: any) => [obj.id, obj]));
    }, [data]);

    const visibleObjectIds = useMemo(() => {
        const ids = safeRuntime.snapshot?.me?.visibleObjectIds ?? [];
        return ids.map((id: any) => String(id));
    }, [safeRuntime.snapshot]);

    const visibleObjects = useMemo(() => {
        if (!data?.objects) return [];
        // Sort objects by itinerary number
        const sortedObjects = [...data.objects].sort((a: any, b: any) => {
            const aNum = getItineraryNumber(a) ?? 0;
            const bNum = getItineraryNumber(b) ?? 0;
            return aNum - bNum;
        });

        const currentPlayerId = safeRuntime.snapshot?.me?.playerId ?? null;
        const currentObjectId =
            currentPlayerId ? (safeRuntime.snapshot?.players?.[currentPlayerId]?.currentObjectId ?? null) : null;

        if (stepsMode) {
            const completedIds = safeRuntime.completedObjects ?? new Set<string>();
            return sortedObjects.filter((obj: any) =>
                completedIds.has(obj.id) || (!!currentObjectId && obj.id === currentObjectId)
            );
        }

        // In Play mode, only show objects that are explicitly visible in the runtime snapshot
        const visibleIds = new Set(visibleObjectIds);
        const filtered = sortedObjects.filter((obj: any) => visibleIds.has(String(obj.id)));

        // Backward-compatible fallback: if the runtime doesn't provide visibility yet,
        // at least show the start object (or first object) so markers don't fully disappear.
        if (filtered.length === 0) {
            const fallbackStart = sortedObjects.find((obj: any) => isStartObject(obj)) ?? sortedObjects[0];
            return fallbackStart ? [fallbackStart] : [];
        }

        return filtered;
    }, [data?.objects, visibleObjectIds, stepsMode, safeRuntime.completedObjects, safeRuntime.snapshot]);

    // --- Initialization ---
    const startObjectIds = useMemo(() => {
        if (!data) return new Set<string>();
        const explicit = data.objects
            .filter((obj: any) => isStartObject(obj) && !!getValidCoordinates(obj))
            .map((obj: any) => obj.id)
            .filter((id: any): id is string => typeof id === 'string' && id.length > 0);
        return new Set(explicit);
    }, [data]);

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

    const locationLogic = useQuestLocationLogic({
        data,
        visibleObjects,
        objectsById,
        safeRuntime,
        currentSessionId,
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
        setNotification
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

                const currentObjectId = safeRuntime.snapshot?.players?.[currentSessionId || '']?.currentObjectId;
                const currentObj = objectsById.get(currentObjectId || '');
                const isCurrentObjectCompleted = !!currentObjectId && (safeRuntime.completedObjects?.has(currentObjectId) || false);

                if (currentObj && !isCurrentObjectCompleted) {
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
    }, [timelineLogic, safeRuntime, currentSessionId, objectsById, runtime, setMapMode, setGpsEnabled, setCurrentItineraryStep, setNotification, setModeConfirmed]);


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
