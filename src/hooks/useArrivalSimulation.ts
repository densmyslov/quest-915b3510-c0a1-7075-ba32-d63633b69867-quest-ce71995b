import { useCallback } from 'react';
import type { QuestObject } from '@/types/quest';
import { parseLatLng } from '@/utils/coordinates';

interface ArrivalSimulationOptions {
    sessionId: string | null;
    completedObjects: Set<string>;
    visibleObjects: QuestObject[];
    getItineraryNumber: (obj: QuestObject) => number | null;
    showNotification: (message: string) => void;
    playEffectAudio: (params: {
        url: string;
        objectName: string;
        objectId: string;
        loop?: boolean;
        volume?: number;
    }) => void;
    onArrived?: (obj: QuestObject, params: { distance: number; isSimulated: boolean }) => void | Promise<void>;
}

export function useArrivalSimulation(options: ArrivalSimulationOptions) {
    const {
        sessionId,
        completedObjects,
        visibleObjects,
        getItineraryNumber,
        showNotification,
        playEffectAudio,
        onArrived
    } = options;

    const handleObjectArrival = useCallback(async (
        obj: QuestObject,
        distance: number,
        isSimulated: boolean = false
    ) => {
        // Determine if this is the current object to complete
        const isCompleted = completedObjects.has(obj.id);

        let isCurrent = false;
        if (!isCompleted) {
            let highestCompleted = -1;
            visibleObjects.forEach(o => {
                if (completedObjects.has(o.id)) {
                    const num = getItineraryNumber(o) ?? 0;
                    if (num > highestCompleted) highestCompleted = num;
                }
            });

            const objNumber = getItineraryNumber(obj) ?? 0;
            isCurrent = objNumber === highestCompleted + 1;
        }

        // Show notification
        let message = '';
        if (isCompleted) {
            message = `Hai raggiunto ${obj.name} (già completato)`;
        } else if (isCurrent) {
            message = `🎯 Sei arrivato a ${obj.name}! Completa gli enigmi.`;
        } else {
            message = `Hai raggiunto ${obj.name}`;
        }

        if (isSimulated) {
            message = `[SIMULATED] ${message}`;
        }

        showNotification(message);



        // Trigger proximity audio effects only (sound-only, no transcript tray).
        const effect = obj.audio_effect;
        const legacyMediaUrl = (effect as unknown as { mediaUrl?: unknown } | null | undefined)?.mediaUrl;
        const mediaUrl = effect?.media_url ?? (typeof legacyMediaUrl === 'string' ? legacyMediaUrl : null);
        if (effect?.enabled && mediaUrl) {
            playEffectAudio({
                url: mediaUrl,
                objectName: obj.name,
                objectId: obj.id,
                loop: effect.loop,
                volume: effect.volume
            });
        }

        try {
            await onArrived?.(obj, { distance, isSimulated });
        } catch (err) {
            console.warn('[ArrivalSimulation] onArrived callback failed:', err);
        }
    }, [completedObjects, visibleObjects, getItineraryNumber, showNotification, playEffectAudio, onArrived]);

    const simulateArrivalWithPosition = useCallback(async (
        obj: QuestObject
    ) => {
        // Simulate GPS position update
        const coords = parseLatLng(obj.coordinates);
        if (coords && sessionId) {
            const [lat, lng] = coords;

            try {
                await fetch('/api/quest/update-position', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId,
                        position: {
                            coords: {
                                latitude: lat,
                                longitude: lng,
                                accuracy: 0  // Perfect accuracy for simulated position
                            },
                            timestamp: Date.now()
                        }
                    })
                });
            } catch (err) {
                console.warn('[ArrivalSimulation] Failed to update position:', err);
            }
        }

        // Simulate arrival
        await handleObjectArrival(obj, 0, true);
    }, [sessionId, handleObjectArrival]);

    return {
        handleObjectArrival,
        simulateArrivalWithPosition
    };
}
