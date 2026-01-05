import { useState, useEffect, useRef, useCallback } from 'react';

export interface QuestStop {
    id: string;
    name: string;
    coordinates?: string; // "lat, lng"
    triggerRadius?: number; // meters
}

export interface ProximityStatus {
    stopId: string;
    stopName: string;
    distance: number;
    isInZone: boolean;
}

export interface ProximityTrackerOptions {
    stops: QuestStop[];
    enableHighAccuracy?: boolean;
    maximumAge?: number;
    timeout?: number;
    debounceMs?: number;
    oneTimeOnly?: boolean;
    onEnterZone?: (data: { stop: QuestStop; distance: number; position: GeolocationCoordinates; timestamp: number }) => void;
    onExitZone?: (data: { stop: QuestStop; distance: number; position: GeolocationCoordinates; timestamp: number }) => void;
    onError?: (error: GeolocationPositionError) => void;
}

const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000; // Earth's radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) *
        Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

export const useProximityTracker = ({
    stops,
    enableHighAccuracy = true,
    maximumAge = 5000,
    timeout = 10000,
    debounceMs = 1000,
    oneTimeOnly = true,
    onEnterZone,
    onExitZone,
    onError
}: ProximityTrackerOptions) => {
    const [isTracking, setIsTracking] = useState(false);
    const [position, setPosition] = useState<GeolocationCoordinates | null>(null);
    const [proximities, setProximities] = useState<ProximityStatus[]>([]);
    const [currentStop, setCurrentStop] = useState<QuestStop | null>(null);
    const [error, setError] = useState<string | null>(null);

    const watchId = useRef<number | null>(null);
    const activeZones = useRef<Set<string>>(new Set());
    const triggeredStops = useRef<Set<string>>(new Set());
    const lastTriggerTime = useRef<Map<string, number>>(new Map());

    const stopsRef = useRef(stops);
    const onEnterZoneRef = useRef(onEnterZone);
    const onExitZoneRef = useRef(onExitZone);
    const onErrorRef = useRef(onError);
    const debounceMsRef = useRef(debounceMs);
    const oneTimeOnlyRef = useRef(oneTimeOnly);

    useEffect(() => {
        stopsRef.current = stops;
    }, [stops]);

    useEffect(() => {
        onEnterZoneRef.current = onEnterZone;
    }, [onEnterZone]);

    useEffect(() => {
        onExitZoneRef.current = onExitZone;
    }, [onExitZone]);

    useEffect(() => {
        onErrorRef.current = onError;
    }, [onError]);

    useEffect(() => {
        debounceMsRef.current = debounceMs;
    }, [debounceMs]);

    useEffect(() => {
        oneTimeOnlyRef.current = oneTimeOnly;
    }, [oneTimeOnly]);

    const handlePositionUpdate = useCallback((pos: GeolocationPosition) => {
        setPosition(pos.coords);
        setError(null);

        const newProximities: ProximityStatus[] = [];
        let nearestStop: QuestStop | null = null;
        let minDistance = Infinity;

        const currentStops = stopsRef.current;
        const currentDebounceMs = debounceMsRef.current;
        const currentOneTimeOnly = oneTimeOnlyRef.current;
        const currentOnEnterZone = onEnterZoneRef.current;
        const currentOnExitZone = onExitZoneRef.current;

        currentStops.forEach(stop => {
            if (!stop.coordinates) return;

            const [latStr, lngStr] = stop.coordinates.split(',').map(s => s.trim());
            const lat = parseFloat(latStr);
            const lng = parseFloat(lngStr);

            if (isNaN(lat) || isNaN(lng)) return;

            const distance = calculateDistance(pos.coords.latitude, pos.coords.longitude, lat, lng);
            const radius = stop.triggerRadius || 20; // Default 20m
            const isInZone = distance <= radius;

            newProximities.push({
                stopId: stop.id,
                stopName: stop.name,
                distance,
                isInZone
            });

            // Zone Entry Logic
            if (isInZone) {
                if (!activeZones.current.has(stop.id)) {
                    // Entered Zone
                    activeZones.current.add(stop.id);

                    const now = Date.now();
                    const lastTrigger = lastTriggerTime.current.get(stop.id) || 0;
                    const isDebounced = (now - lastTrigger) < currentDebounceMs;
                    const alreadyTriggered = triggeredStops.current.has(stop.id);

	                    if ((!alreadyTriggered || !currentOneTimeOnly) && !isDebounced) {
	                        triggeredStops.current.add(stop.id);
	                        lastTriggerTime.current.set(stop.id, now);

	                        if (currentOnEnterZone) {
	                            try {
	                                currentOnEnterZone({
	                                    stop,
	                                    distance,
	                                    position: pos.coords,
	                                    timestamp: now
	                                });
	                            } catch (err) {
	                                console.warn('[useProximityTracker] onEnterZone callback failed:', err);
	                            }
	                        }
	                    }
	                }

                // Track nearest active stop
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestStop = stop;
                }
            } else {
                // Zone Exit Logic
	                if (activeZones.current.has(stop.id)) {
	                    activeZones.current.delete(stop.id);
	                    if (currentOnExitZone) {
	                        try {
	                            currentOnExitZone({
	                                stop,
	                                distance,
	                                position: pos.coords,
	                                timestamp: Date.now()
	                            });
	                        } catch (err) {
	                            console.warn('[useProximityTracker] onExitZone callback failed:', err);
	                        }
	                    }
	                }
	            }
	        });

        setProximities(newProximities);
        setCurrentStop(nearestStop);
    }, []);

    const handleError = useCallback((err: GeolocationPositionError) => {
        let msg = 'Unknown error';
        switch (err.code) {
            case 1: msg = 'Permission denied'; break;
            case 2: msg = 'Position unavailable'; break;
            case 3: msg = 'Timeout'; break;
        }
        setError(msg);
        onErrorRef.current?.(err);
    }, []);

    const startTracking = useCallback(() => {
        if (!navigator.geolocation) {
            setError('Geolocation not supported');
            return;
        }

        if (watchId.current !== null) return;

        // Reset zone state so (re)starting tracking while already inside a zone
        // can still trigger an enter event (and avoid stale exit events later).
        activeZones.current.clear();
        triggeredStops.current.clear();
        lastTriggerTime.current.clear();

        setIsTracking(true);
        try {
            watchId.current = navigator.geolocation.watchPosition(
                handlePositionUpdate,
                handleError,
                { enableHighAccuracy, maximumAge, timeout }
            );
        } catch (err) {
            console.error('[useProximityTracker] Failed to start geolocation watch:', err);
            setIsTracking(false);
            watchId.current = null;
            setError(err instanceof Error ? err.message : 'Failed to start geolocation watch');
            onErrorRef.current?.({
                code: 2,
                message: err instanceof Error ? err.message : String(err),
                PERMISSION_DENIED: 1,
                POSITION_UNAVAILABLE: 2,
                TIMEOUT: 3
            } as GeolocationPositionError);
        }
    }, [enableHighAccuracy, maximumAge, timeout, handlePositionUpdate, handleError]);

    const stopTracking = useCallback(() => {
        if (watchId.current !== null) {
            navigator.geolocation.clearWatch(watchId.current);
            watchId.current = null;
        }
        setIsTracking(false);
        activeZones.current.clear();
    }, []);

    const resetProgress = useCallback(() => {
        triggeredStops.current.clear();
        lastTriggerTime.current.clear();
        activeZones.current.clear();
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (watchId.current !== null) {
                navigator.geolocation.clearWatch(watchId.current);
            }
        };
    }, []);

    return {
        isTracking,
        position,
        proximities,
        currentStop,
        error,
        startTracking,
        stopTracking,
        resetProgress
    };
};
