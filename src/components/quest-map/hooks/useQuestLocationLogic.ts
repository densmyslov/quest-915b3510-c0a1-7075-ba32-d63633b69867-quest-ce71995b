import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useProximityTracker, QuestStop } from '@/hooks/useProximityTracker';
import { formatLatLng } from '@/utils/coordinates';
import { useQuestAudio } from '@/context/QuestAudioContext';
import { getValidCoordinates, getItineraryNumber, isStartObject } from '../utils/mapUtils';

type UseQuestLocationLogicProps = {
    data: any;
    visibleObjects: any[];
    objectsById: Map<string, any>;
    safeRuntime: any;
    currentSessionId: string | null;
    isPlayMode: boolean;
    gpsEnabled: boolean;
    setGpsEnabled: (enabled: boolean) => void;
    currentItineraryStep: number;
    setCurrentItineraryStep: React.Dispatch<React.SetStateAction<number>>;
    handleObjectArrival: (obj: any, distance: number, loop?: boolean) => void;
    simulateArrivalWithPosition: (obj: any) => Promise<void>;
    stopAudio: () => void;
    unlockAudio: () => Promise<boolean>;
    flushPendingAudio: () => void;
    activeEffectRef: React.MutableRefObject<any>;
    activeAudio: any;
    stopEffectAudio: () => void;
    stepsMode: boolean;
    teamSync: any;
    setNotification: (msg: string | null) => void;
};

export function useQuestLocationLogic({
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
    handleObjectArrival,
    simulateArrivalWithPosition,
    stopAudio,
    unlockAudio,
    flushPendingAudio,
    activeEffectRef,
    activeAudio,
    stopEffectAudio,
    stepsMode,
    teamSync,
    setNotification
}: UseQuestLocationLogicProps) {
    const questAudio = useQuestAudio();
    const [heading, setHeading] = useState<number | null>(null);
    const userLocationRef = useRef<[number, number] | null>(null);
    const gpsEnabledItemsRef = useRef<Set<string>>(new Set());
    const lastLocationSyncRef = useRef<number>(0);
    const lastHeadingUpdateRef = useRef<number>(0);
    const lastHeadingValueRef = useRef<number | null>(null);
    const headingRef = useRef<number | null>(null);

    // Derived Data
    const startObjectIds = useMemo(() => {
        if (!data) return new Set<string>();

        const explicit = data.objects
            .filter((obj: any) => isStartObject(obj) && !!getValidCoordinates(obj))
            .map((obj: any) => obj.id)
            .filter((id: any): id is string => typeof id === 'string' && id.length > 0);

        if (explicit.length) return new Set(explicit);

        // Fallback
        const zeroCandidate = data.objects
            .map((obj: any, idx: number) => ({ obj, idx, num: getItineraryNumber(obj) }))
            .filter(({ obj, num }: any) => num === 0 && !!getValidCoordinates(obj))
            .sort((a: any, b: any) => a.idx - b.idx)[0]?.obj?.id;

        return zeroCandidate ? new Set([zeroCandidate]) : new Set<string>();
    }, [data]);

    const itineraryEntries = useMemo(() => {
        if (!data) return [];
        const entries = data.objects
            .map((obj: any, idx: number) => ({
                obj,
                idx,
                num: getItineraryNumber(obj),
                isStart: startObjectIds.has(obj.id)
            }))
            .filter(({ obj, num, isStart }: any) => {
                if (num === null || !Number.isFinite(num)) return false;
                if (!getValidCoordinates(obj)) return false;
                if (num === 0 && !isStart) return false;
                return true;
            });

        entries.sort((a: any, b: any) => {
            const aNum = a.num ?? Number.POSITIVE_INFINITY;
            const bNum = b.num ?? Number.POSITIVE_INFINITY;
            if (aNum !== bNum) return aNum - bNum;
            return a.idx - b.idx;
        });

        return entries.map((entry: any) => ({ id: entry.obj.id, num: entry.num as number }));
    }, [data, startObjectIds]);

    const itineraryRange = useMemo(() => {
        if (!itineraryEntries.length) {
            return { start: 0, end: 0, hasData: false };
        }
        const nums = itineraryEntries.map((e: { num: number }) => e.num);
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const start = startObjectIds.size ? 0 : (nums.includes(0) ? 0 : min);
        return { start, end: max, hasData: true };
    }, [itineraryEntries, startObjectIds.size]);


    // Handlers
    const handleEnterZone = useCallback(
        ({ stop, distance }: { stop: QuestStop; distance: number }) => {
            if (!isPlayMode) return;
            const obj = objectsById.get(stop.id);
            if (!obj) return;

            // Check if object has already been arrived at (from runtime snapshot)
            const objectState = safeRuntime.snapshot?.objects?.[obj.id];
            if (objectState?.arrivedAt) {
                return;
            }

            handleObjectArrival(obj, distance);
        },
        [isPlayMode, objectsById, safeRuntime.snapshot, handleObjectArrival]
    );

    const handleExitZone = useCallback(
        ({ stop }: { stop: QuestStop }) => {
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
        // alert('Impossibile ottenere la posizione: ' + error.message);
        setNotification('GPS Error: ' + error.message);
    }, [setGpsEnabled, setNotification]);


    const stops: QuestStop[] = useMemo(() => {
        if (!visibleObjects) return [];
        return visibleObjects.map((obj) => {
            const coords = getValidCoordinates(obj);
            return {
                id: obj.id,
                name: obj.name,
                coordinates: coords ? formatLatLng(coords) : undefined,
                triggerRadius: obj.audio_effect?.triggerRadius || obj.triggerRadius || 20
            };
        });
    }, [visibleObjects]);

    // Proximity Tracker
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
        oneTimeOnly: false,
        enableHighAccuracy: true
    });

    // User Location
    const userLocation = useMemo<[number, number] | null>(() => {
        if (!isPlayMode) return null;
        if (!gpsEnabled) return null;
        if (!trackerPosition) return null;
        const lat = trackerPosition.latitude;
        const lng = trackerPosition.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return [lat, lng];
    }, [gpsEnabled, isPlayMode, trackerPosition]);

    useEffect(() => {
        userLocationRef.current = userLocation;
    }, [userLocation]);


    // Sync Location to Team
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
    }, [userLocation, isPlayMode, gpsEnabled, data?.policies?.teamTravelMode, teamSync, trackerPosition]);


    // Compass
    useEffect(() => {
        if (!isPlayMode || !gpsEnabled) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setHeading(null);
            lastHeadingUpdateRef.current = 0;
            lastHeadingValueRef.current = null;
            lastLocationSyncRef.current = 0;
            stopTracking();
            return;
        }

        startTracking();

        const handleOrientation = (event: DeviceOrientationEvent) => {
            // ... copy compass logic ...
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
                const delta = lastValue === null ? Infinity : Math.abs((((compass - lastValue + 540) % 360) - 180));

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

        void (async () => {
            try {
                const success = await unlockAudio();
                if (success) flushPendingAudio();
                await questAudio.unlockBackgroundAudio();
            } catch {
            }
        })();

        setGpsEnabled(true);

        const DeviceOrientationEventClass = (window as any).DeviceOrientationEvent as any;
        if (DeviceOrientationEventClass && typeof DeviceOrientationEventClass.requestPermission === 'function') {
            void DeviceOrientationEventClass.requestPermission().catch(() => { });
        }
    };

    // Stepper
    const simulateStepArrival = useCallback(async (stepNumber: number) => {
        if (!stepsMode) return;
        const targetEntry = itineraryEntries.find((entry: { id: string; num: number }) => entry.num === stepNumber);
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
    }, [currentItineraryStep, itineraryRange.end, simulateStepArrival, setCurrentItineraryStep]);

    const prevStep = useCallback(() => {
        const prevStepNumber = Math.max(itineraryRange.start, currentItineraryStep - 1);
        void simulateStepArrival(prevStepNumber);
        setCurrentItineraryStep((prev) => Math.max(itineraryRange.start, prev - 1));
    }, [currentItineraryStep, itineraryRange.start, simulateStepArrival, setCurrentItineraryStep]);

    // Sync Step (Effect)
    useEffect(() => {
        if (!stepsMode) return;
        if (!itineraryRange.hasData) return;
        setCurrentItineraryStep((prev) => {
            if (prev < itineraryRange.start) return itineraryRange.start;
            if (prev > itineraryRange.end) return itineraryRange.end;
            return prev;
        });
    }, [stepsMode, itineraryRange.hasData, itineraryRange.start, itineraryRange.end, setCurrentItineraryStep]);

    return {
        userLocation,
        heading,
        toggleGPS,
        itineraryEntries,
        itineraryRange,
        startObjectIds,
        nextStep,
        prevStep,
        getItineraryNumber,
        isStartObject,
        stops
    };
}
