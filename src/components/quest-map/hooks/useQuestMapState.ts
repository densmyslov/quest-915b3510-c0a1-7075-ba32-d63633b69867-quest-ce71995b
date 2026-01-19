import { useState, useEffect } from 'react';

export function useQuestMapState() {
    const [gpsEnabled, setGpsEnabled] = useState(false);
    const [mapMode, setMapMode] = useState<'play' | 'steps' | null>(null);
    const [modeConfirmed, setModeConfirmed] = useState(false);
    const [mapUniqueId, setMapUniqueId] = useState(0);
    const [currentItineraryStep, setCurrentItineraryStep] = useState(0);
    const [puzzleCloseConfirmation, setPuzzleCloseConfirmation] = useState(false);
    const [notification, setNotification] = useState<string | null>(null);

    // Sync mapMode with sessionStorage
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

    // Sync gpsEnabled with sessionStorage
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            sessionStorage.setItem('quest_gps_enabled', gpsEnabled ? '1' : '0');
        } catch {
            // ignore storage errors
        }
    }, [gpsEnabled]);

    return {
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
    };
}
