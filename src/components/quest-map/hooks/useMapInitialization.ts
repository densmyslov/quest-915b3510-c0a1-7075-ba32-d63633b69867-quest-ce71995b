import { useEffect, useRef } from 'react';
import { Map as LeafletMap, TileLayer, LayerGroup } from 'leaflet';
import { OSM_TILE_URL, OSM_ATTRIBUTION, OSM_MAX_NATIVE_ZOOM, OSM_MAX_ZOOM } from '../components/MapAssets';
import { getValidCoordinates, isStartObject } from '../utils/mapUtils';

type UseMapInitializationProps = {
    mapContainerRef: React.RefObject<HTMLDivElement | null>;
    data: any;
    visibleObjects: any[];
    userLocation: [number, number] | null;
    startObjectIds: Set<string>;
    setMapUniqueId: React.Dispatch<React.SetStateAction<number>>;
    mapUniqueId: number;
    onCleanup: () => void;
};

export function useMapInitialization({
    mapContainerRef,
    data,
    visibleObjects,
    userLocation,
    startObjectIds,
    setMapUniqueId,
    mapUniqueId,
    onCleanup
}: UseMapInitializationProps) {
    const mapInstanceRef = useRef<LeafletMap | null>(null);
    const baseLayerRef = useRef<TileLayer | null>(null);
    const markersLayerRef = useRef<LayerGroup | null>(null);
    const initialZoomSet = useRef(false);
    const savedZoom = useRef<number | null>(null);
    const savedCenter = useRef<[number, number] | null>(null);

    // Map Initialization
    useEffect(() => {
        if (!mapContainerRef.current || !data) return;

        // ✅ reset per-init state
        initialZoomSet.current = false;

        // Clean up existing map instance if it exists
        if (mapInstanceRef.current) {
            try {
                savedZoom.current = mapInstanceRef.current.getZoom();
                const center = mapInstanceRef.current.getCenter();
                savedCenter.current = [center.lat, center.lng];
            } catch { }
            try {
                mapInstanceRef.current.remove();
            } catch (e) {
                console.warn('[useMapInitialization] Failed to remove existing map instance', e);
            }
            // Immediately set to null to prevent access during initialization
            mapInstanceRef.current = null;
        }

        // Small delay to ensure DOM is ready and prevent race conditions with timeline logic
        const initTimer = window.setTimeout(() => {
            if (!mapContainerRef.current) return;

            // Allow a bit more zoom for marker separation by scaling tiles beyond their native max.
            const maxZoom = OSM_MAX_ZOOM;

            const map = new LeafletMap(mapContainerRef.current, {
                zoomControl: false,
                maxZoom,
                zoomSnap: 0.5
            }).setView([0, 0], 2);

            const layer = new TileLayer(OSM_TILE_URL, {
                attribution: OSM_ATTRIBUTION,
                maxNativeZoom: OSM_MAX_NATIVE_ZOOM,
                maxZoom: OSM_MAX_ZOOM
            });
            layer.addTo(map);
            baseLayerRef.current = layer;

            mapInstanceRef.current = map;
            // ⚠️ IMPORTANT: internal setMapUniqueId removed to prevent infinite loop
            // setMapUniqueId(prev => prev + 1);
            markersLayerRef.current = new LayerGroup().addTo(map);

            map.invalidateSize();
        }, 0);

        return () => {
            window.clearTimeout(initTimer);
            onCleanup();

            initialZoomSet.current = false;

            if (mapInstanceRef.current) {
                try {
                    savedZoom.current = mapInstanceRef.current.getZoom();
                    const center = mapInstanceRef.current.getCenter();
                    savedCenter.current = [center.lat, center.lng];
                } catch {
                    // ignore
                }
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
            baseLayerRef.current = null;
            markersLayerRef.current = null;
        };
    }, [data, mapUniqueId]); // Minimal dependencies for init

    // Initial View Logic (separate effect or part of init)
    useEffect(() => {
        const map = mapInstanceRef.current;
        if (!map || initialZoomSet.current) return;

        // Ensure visible objects are loaded? They are passed in props.
        // We need to wait for map AND data.

        let center: [number, number] | null = null;
        let zoom = 2;

        if (savedCenter.current && savedZoom.current != null) {
            center = savedCenter.current;
            zoom = savedZoom.current;
        } else {
            // Find start object coordinates
            let startObjectCoords: [number, number] | null = null;
            if (startObjectIds.size > 0) {
                // Try to find one of the start objects in visibleObjects
                const startParams = visibleObjects.find(obj => startObjectIds.has(String(obj.id)));
                if (startParams) {
                    startObjectCoords = getValidCoordinates(startParams);
                }
            } else {
                // Determine a fallback start object? Logic was: startObjectIds derived in logic.
                // If logic provided startObjectIds, we trust it.
                // If not, we scan visible objects.
                const fallbackStart = visibleObjects.find(obj => isStartObject(obj));
                if (fallbackStart) {
                    startObjectCoords = getValidCoordinates(fallbackStart);
                }
            }

            if (startObjectCoords) {
                center = startObjectCoords;
                zoom = 17;
            } else if (userLocation) {
                center = userLocation;
                zoom = 17;
            } else if (visibleObjects.length > 0 && !!getValidCoordinates(visibleObjects[0])) {
                // Fallback to the first available object if we have no start object and no user location
                center = getValidCoordinates(visibleObjects[0]);
                zoom = 17;
            }
        }

        if (center) {
            map.setView(center, zoom, { animate: false });
            initialZoomSet.current = true;
        } else if (visibleObjects.length > 0) {
            // Unlikely to reach here if the above fallback works, but safe to keep bounds logic just in case
            // or we could just remove it if we trust the fallback.
            // Let's leave it but it might not be hit often.
        }

    }, [mapUniqueId, userLocation, visibleObjects, startObjectIds]);

    return {
        mapInstanceRef,
        baseLayerRef,
        markersLayerRef,
        savedZoom,
        savedCenter,
        initialZoomSet
    };
}
