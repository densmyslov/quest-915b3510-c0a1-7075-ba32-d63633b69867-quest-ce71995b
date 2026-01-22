import { useMemo } from 'react';
import { formatLatLng } from '@/utils/coordinates';
import { QuestStop } from '@/hooks/useProximityTracker';
import { getValidCoordinates, getItineraryNumber, isStartObject } from '../utils/mapUtils';

type UseQuestMarkersProps = {
    data: any;
    safeRuntime: any;
    stepsMode: boolean;
};

export function useQuestMarkers({ data, safeRuntime, stepsMode }: UseQuestMarkersProps) {
    // 1. Objects By ID Map
    const objectsById = useMemo(() => {
        return new Map((data?.objects ?? []).map((obj: any) => [obj.id, obj]));
    }, [data]);

    // 2. Visible Object IDs (from Runtime)
    const visibleObjectIds = useMemo(() => {
        const ids = safeRuntime.snapshot?.me?.visibleObjectIds ?? [];
        return ids.map((id: any) => String(id));
    }, [safeRuntime.snapshot]);

    // 3. Start Object IDs
    const startObjectIds = useMemo<Set<string>>(() => {
        if (!data) return new Set<string>();
        const explicit = data.objects
            .filter((obj: any) => isStartObject(obj) && !!getValidCoordinates(obj))
            .map((obj: any) => obj.id)
            .filter((id: any): id is string => typeof id === 'string' && id.length > 0);
        return new Set(explicit);
    }, [data]);

    // 4. Visible Objects Calculation
    const objects = data?.objects;
    const completedObjects = safeRuntime.completedObjects;
    const runtimeSnapshot = safeRuntime.snapshot;

    const visibleObjects = useMemo<any[]>(() => {
        if (!objects) return [];

        // Sort objects by itinerary number
        const sortedObjects = [...objects].sort((a: any, b: any) => {
            const aNum = getItineraryNumber(a) ?? 0;
            const bNum = getItineraryNumber(b) ?? 0;
            return aNum - bNum;
        });

        const currentPlayerId = runtimeSnapshot?.me?.playerId ?? null;
        const currentObjectId =
            currentPlayerId ? (runtimeSnapshot?.players?.[currentPlayerId]?.currentObjectId ?? null) : null;

        if (stepsMode) {
            const completedIds = completedObjects ?? new Set<string>();
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
    }, [objects, visibleObjectIds, stepsMode, completedObjects, runtimeSnapshot]);

    // 5. Stops (for Proximity Tracker)
    const stops: QuestStop[] = useMemo<QuestStop[]>(() => {
        if (!visibleObjects) return [];
        return visibleObjects.map((obj: any) => {
            const coords = getValidCoordinates(obj);
            return {
                id: obj.id,
                name: obj.name,
                coordinates: coords ? formatLatLng(coords) : undefined,
                triggerRadius: obj.audio_effect?.triggerRadius || obj.triggerRadius || 20
            };
        });
    }, [visibleObjects]);

    return {
        objectsById: objectsById as Map<string, any>,
        visibleObjects,
        startObjectIds,
        stops
    };
}
