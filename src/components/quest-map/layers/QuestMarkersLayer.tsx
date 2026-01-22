import { useEffect, useRef } from 'react';
import { Map as LeafletMap, LayerGroup, Marker, Circle, Icon, DivIcon } from 'leaflet';
import {
    COLORS,
    SPECIAL_OBJECT_ITINERARY_NUMBER,
    SPECIAL_OBJECT_MARKER_ICON,
    createVintageIcon,
    escapeHtml
} from '../components/MapStyles';
import { getValidCoordinates, normalizeObjectImages } from '../utils/mapUtils';

type QuestMarkersLayerProps = {
    map: LeafletMap | null;
    markersLayer: LayerGroup | null;
    data: any;
    visibleObjects: any[];
    safeRuntime: any;
    currentSessionId: string | null;
    stepsMode: boolean;
    itineraryEntries: any[];
    itineraryRange: { hasData: boolean };
    getItineraryNumber: (obj: any) => number | null;
    isStartObject: (obj: any) => boolean;
    distributionRef: React.MutableRefObject<any>;
    addOrUpdatePulsatingCircle: (params: any) => void;
    removeTimelinePulsatingCircle: (objectId: string) => void;
    getObjectPulseIds: () => string[];
    setPulsatingVisibility: (ids: Set<string> | null) => void;
};

export function QuestMarkersLayer({
    map,
    markersLayer,
    data,
    visibleObjects,
    safeRuntime,
    currentSessionId,
    stepsMode, // eslint-disable-line @typescript-eslint/no-unused-vars
    itineraryRange, // eslint-disable-line @typescript-eslint/no-unused-vars
    getItineraryNumber,
    isStartObject,
    distributionRef,
    addOrUpdatePulsatingCircle,
    removeTimelinePulsatingCircle,
    getObjectPulseIds,
    setPulsatingVisibility
}: QuestMarkersLayerProps) {
    const objectMarkersRef = useRef<Map<string, Marker>>(new Map());
    const objectTriggerCirclesRef = useRef<Map<string, Circle[]>>(new Map());
    const objectIconTypesRef = useRef<Map<string, string>>(new Map());

    const prevMapRef = useRef<LeafletMap | null>(null);

    // Marker Creation Effect
    useEffect(() => {
        if (!map || !markersLayer || !data) return;

        // If map instance changed, clear refs
        if (prevMapRef.current !== map) {
            console.log('[QuestMarkersLayer] Map instance changed, clearing markers');
            objectMarkersRef.current.clear();
            objectTriggerCirclesRef.current.clear();
            objectIconTypesRef.current.clear();
            prevMapRef.current = map;
        }

        const currentMarkers = objectMarkersRef.current;
        const currentCircles = objectTriggerCirclesRef.current;
        const canHover = typeof window !== 'undefined' && window.matchMedia('(hover:hover) and (pointer:fine)').matches;

        const completed = safeRuntime.completedObjects;
        const completedCount = completed instanceof Set ? completed.size : Array.isArray(completed) ? completed.length : 0;

        console.log('[QuestMarkersLayer] Updating markers', {
            visibleObjectsCount: visibleObjects.length,
            visibleIds: visibleObjects.map(o => o.id),
            completedCount,
            currentSessionId
        });

        // Create markers for NEW objects (or update existing if needed, but here we assume creation)
        visibleObjects.forEach(obj => {
            const objectId = String(obj?.id);
            if (!objectId) return;
            const coords = getValidCoordinates(obj);
            if (!coords) return;

            const [lat, lng] = coords;
            const isMain = (obj as any).isMain !== false;
            const itineraryNumRaw = getItineraryNumber(obj);
            const start = isStartObject(obj);
            const itineraryNum = itineraryNumRaw === 0 && !start ? null : itineraryNumRaw;

            const isSpecialObject =
                itineraryNumRaw === SPECIAL_OBJECT_ITINERARY_NUMBER || objectId === String(SPECIAL_OBJECT_ITINERARY_NUMBER);

            // Determine object status
            const completed = safeRuntime.completedObjects;
            const isCompleted = completed instanceof Set
                ? completed.has(objectId)
                : Array.isArray(completed)
                    ? completed.includes(objectId)
                    : false;

            const currentPlayerId = safeRuntime.snapshot?.me?.playerId ?? null;
            const contextCurrentOId = currentPlayerId ? safeRuntime.snapshot?.players?.[currentPlayerId]?.currentObjectId ?? null : null;
            const isCurrent = !!contextCurrentOId && String(contextCurrentOId) === objectId;

            let status: 'past' | 'current' | 'future' = 'future';
            if (isCompleted) {
                status = 'past';
            } else if (isCurrent) {
                status = 'current';
            }

            // Choose marker icon
            let markerIcon: Icon | DivIcon;

            // Explicit isSpecial flag from object takes precedence,
            // OR legacy check based on itinerary number
            if (isSpecialObject || (obj as any).isSpecial) {
                markerIcon = SPECIAL_OBJECT_MARKER_ICON;
            } else if (status === 'current') {
                markerIcon = createVintageIcon(isMain ? 'active' : 'activeSecondary', itineraryNum);
            } else if (status === 'past') {
                markerIcon = createVintageIcon('locationSecondary', itineraryNum);
            } else {
                markerIcon = createVintageIcon(isMain ? 'location' : 'locationSecondary', itineraryNum);
            }

            // Cache key to detect changes
            const iconTypeKey = `${status}-${isMain}-${itineraryNum}`;
            const existingMarker = currentMarkers.get(objectId);
            const lastType = objectIconTypesRef.current.get(objectId);

            if (existingMarker) {
                // Update existing marker if icon changed
                if (lastType !== iconTypeKey) {
                    existingMarker.setIcon(markerIcon);
                    existingMarker.setZIndexOffset(isSpecialObject ? 1000 : isCurrent ? 500 : 0);
                    objectIconTypesRef.current.set(objectId, iconTypeKey);
                }
                return;
            }

            // Create new marker
            const marker = new Marker([lat, lng], {
                icon: markerIcon,
                title: `Lat: ${lat}, Lon: ${lng}`,
                alt: obj.name || 'Object',
                zIndexOffset: isSpecialObject ? 1000 : isCurrent ? 500 : 0
            });

            objectIconTypesRef.current.set(objectId, iconTypeKey);

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
                                    <a href="/object/${escapeHtml(objectId)}" style="display:inline-block;margin-left:8px;background:linear-gradient(135deg,${COLORS.inkLight} 0%,${COLORS.ink} 100%);color:${COLORS.parchment};padding:8px 14px;text-decoration:none;font-family:'Cinzel',serif;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;border:1px solid ${COLORS.gold};">Dettagli</a>
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

            currentMarkers.set(objectId, marker);

            // Mystical trigger zone circle
            if ((obj as any).triggerRadius) {
                const outerCircle = new Circle([lat, lng], {
                    radius: (obj as any).triggerRadius,
                    color: '#FFD700',
                    fillColor: COLORS.gold,
                    fillOpacity: 0.15,
                    weight: 2.5,
                    dashArray: '6, 6'
                });

                // Inner glow ring
                const innerCircle = new Circle([lat, lng], {
                    radius: (obj as any).triggerRadius * 0.6,
                    color: COLORS.burgundy,
                    fillColor: COLORS.burgundy,
                    fillOpacity: 0.08,
                    weight: 1,
                    dashArray: '3, 3'
                });

                currentCircles.set(objectId, [outerCircle, innerCircle]);
            }
        });

        // We do NOT clear markers here, because we want them to persist across re-renders
        // unless the map instance changes (handled above).
    }, [map, markersLayer, data, visibleObjects, safeRuntime, currentSessionId, getItineraryNumber, isStartObject, distributionRef]);

    // Track currentObjectId changes to trigger visual effects (Pulsing / Camera Pan)
    const prevCurrentObjectIdRef = useRef<string | null>(null);
    const pulseTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        const playerId = safeRuntime.snapshot?.me?.playerId ?? null;
        const currentObjectId = playerId
            ? String(safeRuntime.snapshot?.players?.[playerId]?.currentObjectId ?? '')
            : '';

        if (
            currentObjectId &&
            prevCurrentObjectIdRef.current &&
            currentObjectId !== prevCurrentObjectIdRef.current
        ) {
            // find coords from marker or fallback
            const existingMarker = objectMarkersRef.current.get(currentObjectId);
            let coords: [number, number] | null = null;

            if (existingMarker) {
                const ll = existingMarker.getLatLng();
                coords = [ll.lat, ll.lng];
            } else {
                const obj = data?.objects?.find((o: any) => String(o.id) === currentObjectId);
                if (obj) coords = getValidCoordinates(obj);
            }

            if (coords) {
                addOrUpdatePulsatingCircle({
                    objectId: currentObjectId,
                    center: coords,
                    effect: {
                        color: '#00FFFF',
                        minRadius: 10,
                        maxRadius: 30,
                        speed: 60,
                        startDistance: 100
                    },
                    source: 'timeline',
                    durationMs: 3000
                });

                // show only the new pulse
                setPulsatingVisibility(new Set([currentObjectId]));

                if (pulseTimeoutRef.current) window.clearTimeout(pulseTimeoutRef.current);
                pulseTimeoutRef.current = window.setTimeout(() => {
                    // remove only timeline pulse; leaves object pulses untouched
                    removeTimelinePulsatingCircle(currentObjectId);

                    // restore visibility to object-defined pulses (visible objects only)
                    const visibleIds = new Set(visibleObjects.map(o => String(o?.id)));
                    const objIds = getObjectPulseIds().filter(id => visibleIds.has(id));
                    setPulsatingVisibility(new Set(objIds));

                    pulseTimeoutRef.current = null;
                }, 3000);
            }
        }

        prevCurrentObjectIdRef.current = currentObjectId;
    }, [
        safeRuntime.snapshot,
        data?.objects,
        visibleObjects,
        addOrUpdatePulsatingCircle,
        removeTimelinePulsatingCircle,
        getObjectPulseIds,
        setPulsatingVisibility
    ]);

    // Cleanup timeout ONLY on unmount
    useEffect(() => {
        return () => {
            if (pulseTimeoutRef.current) window.clearTimeout(pulseTimeoutRef.current);
        };
    }, []);

    // Visibility Update Effect
    useEffect(() => {
        if (!map || !markersLayer) return;

        const visibleIds = new Set(visibleObjects.map(o => String(o?.id)));

        markersLayer.clearLayers();

        // add only visible markers
        for (const [id, marker] of objectMarkersRef.current.entries()) {
            if (visibleIds.has(id)) markersLayer.addLayer(marker);
        }

        // circles: same filtering AND remove hidden circles
        for (const [id, circles] of objectTriggerCirclesRef.current.entries()) {
            const shouldShow = visibleIds.has(id);
            circles.forEach(circle => {
                if (shouldShow) {
                    if (!markersLayer.hasLayer(circle)) markersLayer.addLayer(circle);
                } else {
                    if (markersLayer.hasLayer(circle)) markersLayer.removeLayer(circle);
                }
            });
        }

    }, [map, markersLayer, visibleObjects]);

    return null;
}
