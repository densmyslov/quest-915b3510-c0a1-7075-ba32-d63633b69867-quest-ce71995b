'use client';

import { Circle, LayerGroup, type Map as LeafletMap } from 'leaflet';
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { QuestObject } from '@/types/quest';
import type { PulsatingCircleEffect, PulsatingCircleSource } from './types';

type CircleData = {
  circle: Circle;
  growing: boolean;
  currentRadius: number;
  center: [number, number];
  effect: PulsatingCircleEffect;
  source: PulsatingCircleSource;
  expiresAt: number | null;
};

type UsePulsatingCirclesParams = {
  mapRef: MutableRefObject<LeafletMap | null>;
  userLocationRef: MutableRefObject<[number, number] | null>;
  calculateDistance: (lat1: number, lon1: number, lat2: number, lon2: number) => number;
};

type AddOrUpdateParams = {
  objectId: string;
  center: [number, number];
  effect: PulsatingCircleEffect;
  source: PulsatingCircleSource;
  durationMs?: number;
};

export function usePulsatingCircles({
  mapRef,
  userLocationRef,
  calculateDistance
}: UsePulsatingCirclesParams) {
  const pulsatingCirclesRef = useRef<Map<string, CircleData>>(new Map());
  const rafIdRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const tickRef = useRef<(timestamp: number) => void>(() => {});

  // Dedicated layer for pulses (vectors live in overlay pane)
  const pulseLayerRef = useRef<LayerGroup | null>(null);

  // If unmounted, clean up leaflet layers + RAF
  useEffect(() => {
    return () => {
      pulsatingCirclesRef.current.forEach(({ circle }) => circle.remove());
      pulsatingCirclesRef.current.clear();

      if (pulseLayerRef.current) {
        pulseLayerRef.current.clearLayers();
        pulseLayerRef.current.remove();
        pulseLayerRef.current = null;
      }

      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const ensurePulseLayer = useCallback((): LayerGroup | null => {
    const map = mapRef.current;
    if (!map) return null;

    if (!pulseLayerRef.current) {
      pulseLayerRef.current = new LayerGroup();
      pulseLayerRef.current.addTo(map);
    } else if (!map.hasLayer(pulseLayerRef.current)) {
      pulseLayerRef.current.addTo(map);
    }

    return pulseLayerRef.current;
  }, [mapRef]);

  const tick = useCallback(
    (timestamp: number) => {
      // ~30fps throttle (good enough and cheaper than 60fps)
      if (timestamp - lastTickRef.current < 33) {
        rafIdRef.current = requestAnimationFrame((ts) => tickRef.current(ts));
        return;
      }
      lastTickRef.current = timestamp;

      const now = Date.now();
      const userLoc = userLocationRef.current;
      const toRemove: string[] = [];

      pulsatingCirclesRef.current.forEach((circleData, objId) => {
        if (circleData.expiresAt && now >= circleData.expiresAt) {
          toRemove.push(objId);
          return;
        }

        const { circle, growing, currentRadius, effect, center } = circleData;

        // proximity-driven intensity
        let proximity = 0;
        if (userLoc) {
          const [objLat, objLng] = center;
          const [userLat, userLng] = userLoc;
          const distance = calculateDistance(userLat, userLng, objLat, objLng);
          const proximityDistance = effect.startDistance || effect.maxRadius;
          proximity = Math.max(0, Math.min(1, 1 - distance / proximityDistance));
        }

        const step = 2 * (1 + proximity * 2); // 1x..3x
        const targetOpacity = 0.3 + 0.4 * proximity;

        circle.setStyle({ fillOpacity: targetOpacity, opacity: targetOpacity });

        let newRadius = currentRadius;
        let newGrowing = growing;

        if (growing) {
          newRadius += step;
          if (newRadius >= effect.maxRadius) {
            newGrowing = false;
            newRadius = effect.maxRadius;
          }
        } else {
          newRadius -= step;
          if (newRadius <= effect.minRadius) {
            newGrowing = true;
            newRadius = effect.minRadius;
          }
        }

        circle.setRadius(newRadius);

        circleData.growing = newGrowing;
        circleData.currentRadius = newRadius;
      });

      if (toRemove.length) {
        toRemove.forEach((objId) => {
          const entry = pulsatingCirclesRef.current.get(objId);
          if (!entry) return;
          entry.circle.remove(); // removes from any layer group
          pulsatingCirclesRef.current.delete(objId);
        });
      }

      if (pulsatingCirclesRef.current.size > 0) {
        rafIdRef.current = requestAnimationFrame((ts) => tickRef.current(ts));
      } else {
        rafIdRef.current = null;
      }
    },
    [calculateDistance, userLocationRef]
  );

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const startAnimation = useCallback(() => {
    if (!rafIdRef.current) {
      lastTickRef.current = performance.now();
      rafIdRef.current = requestAnimationFrame((ts) => tickRef.current(ts));
    }
  }, []);

  const addOrUpdatePulsatingCircle = useCallback(
    (params: AddOrUpdateParams) => {
      const layer = ensurePulseLayer();
      if (!layer) return;

      const expiresAt =
        params.durationMs && params.durationMs > 0 ? Date.now() + params.durationMs : null;

      const existing = pulsatingCirclesRef.current.get(params.objectId);

      if (existing) {
        // Prevent timeline pulse from overwriting an object-defined pulse
        if (existing.source === 'object' && params.source === 'timeline') return;

        if (params.source === 'timeline') {
          // retrigger should "pop" from min radius
          existing.growing = true;
          existing.currentRadius = params.effect.minRadius;
          existing.circle.setRadius(params.effect.minRadius);
          existing.circle.setStyle({
            fillOpacity: 0.3,
            opacity: 0.3
          });
        }

        existing.circle.setStyle({ color: params.effect.color, fillColor: params.effect.color });
        existing.circle.setLatLng(params.center);

        existing.center = params.center;
        existing.effect = params.effect;
        existing.source = params.source;
        existing.expiresAt = expiresAt;

        if (!layer.hasLayer(existing.circle)) layer.addLayer(existing.circle);

        startAnimation();
        return;
      }

      const circle = new Circle(params.center, {
        color: params.effect.color,
        fillColor: params.effect.color,
        fillOpacity: 0.3,
        opacity: 0.3,
        radius: params.effect.minRadius,
        weight: 2
      });

      layer.addLayer(circle);

      pulsatingCirclesRef.current.set(params.objectId, {
        circle,
        growing: true,
        currentRadius: params.effect.minRadius,
        center: params.center,
        effect: params.effect,
        source: params.source,
        expiresAt
      });

      startAnimation();
    },
    [ensurePulseLayer, startAnimation]
  );

  const removeTimelinePulsatingCircle = useCallback((objectId: string) => {
    const entry = pulsatingCirclesRef.current.get(objectId);
    if (!entry) return;
    if (entry.source !== 'timeline') return;

    entry.circle.remove();
    pulsatingCirclesRef.current.delete(objectId);
  }, []);

  const clearPulsatingCircles = useCallback(() => {
    pulsatingCirclesRef.current.forEach(({ circle }) => circle.remove());
    pulsatingCirclesRef.current.clear();

    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const syncObjectPulsatingCircles = useCallback(
    (
      objects: QuestObject[],
      getValidCoordinates: (obj: QuestObject) => [number, number] | null,
      normalizeEffect: (effect: any) => PulsatingCircleEffect
    ) => {
      const layer = ensurePulseLayer();
      if (!layer) return;

      // Remove ONLY object-sourced circles; keep timeline pulses alive
      for (const [objId, entry] of pulsatingCirclesRef.current.entries()) {
        if (entry.source === 'object') {
          entry.circle.remove();
          pulsatingCirclesRef.current.delete(objId);
        }
      }

      const objectsWithEffect = objects.filter((obj: any) => obj.pulsating_effect?.enabled);
      if (!objectsWithEffect.length) return;

      objectsWithEffect.forEach((obj: any) => {
        const coords = getValidCoordinates(obj);
        if (!coords) return;

        const effect = normalizeEffect(obj.pulsating_effect);

        const key = String(obj.id);
        const existing = pulsatingCirclesRef.current.get(key);

        if (existing) {
          if (existing.source === 'timeline') {
            existing.circle.remove();
            pulsatingCirclesRef.current.delete(key);
          } else {
            return;
          }
        }

        const circle = new Circle(coords, {
          color: effect.color,
          fillColor: effect.color,
          fillOpacity: 0.3,
          opacity: 0.3,
          radius: effect.minRadius,
          weight: 2
        });

        layer.addLayer(circle);

        pulsatingCirclesRef.current.set(key, {
          circle,
          growing: true,
          currentRadius: effect.minRadius,
          center: coords,
          effect,
          source: 'object',
          expiresAt: null
        });
      });

      if (pulsatingCirclesRef.current.size > 0) startAnimation();
    },
    [ensurePulseLayer, startAnimation]
  );

  const getObjectPulseIds = useCallback(() => {
    const ids: string[] = [];
    pulsatingCirclesRef.current.forEach((entry, id) => {
      if (entry.source === 'object') ids.push(id);
    });
    return ids;
  }, []);

  /**
   * Visibility semantics (IMPORTANT):
   * - visibleIds === null => HIDE ALL pulses
   * - visibleIds is a Set => show only those ids
   */
  const setPulsatingVisibility = useCallback(
    (visibleIds: Set<string> | null) => {
      const layer = ensurePulseLayer();
      if (!layer) return;

      pulsatingCirclesRef.current.forEach(({ circle }, objId) => {
        const shouldShow = visibleIds !== null && visibleIds.has(objId);
        if (shouldShow) {
          if (!layer.hasLayer(circle)) layer.addLayer(circle);
        } else {
          if (layer.hasLayer(circle)) layer.removeLayer(circle);
        }
      });
    },
    [ensurePulseLayer]
  );

  return {
    addOrUpdatePulsatingCircle,
    removeTimelinePulsatingCircle,
    clearPulsatingCircles,
    syncObjectPulsatingCircles,
    getObjectPulseIds,
    setPulsatingVisibility
  };
}
