'use client';

import { Circle, type Map as LeafletMap } from 'leaflet';
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
  const animationIntervalRef = useRef<number | null>(null);
  const animationIntervalMsRef = useRef<number | null>(null);

  const restartTickRef = useRef<() => void>(() => { });

  const restartPulsatingInterval = useCallback(() => {
    const circles = pulsatingCirclesRef.current;
    const speeds = Array.from(circles.values()).map((c) => c.effect.speed ?? 100);
    const nextMs = speeds.length ? Math.max(16, Math.min(...speeds)) : null;

    if (nextMs === null) {
      if (animationIntervalRef.current) {
        window.clearInterval(animationIntervalRef.current);
        animationIntervalRef.current = null;
      }
      animationIntervalMsRef.current = null;
      return;
    }

    if (animationIntervalRef.current && animationIntervalMsRef.current === nextMs) {
      return;
    }

    if (animationIntervalRef.current) {
      window.clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }

    animationIntervalMsRef.current = nextMs;
    animationIntervalRef.current = window.setInterval(() => {
      const now = Date.now();
      const userLoc = userLocationRef.current;

      const toRemove: string[] = [];

      pulsatingCirclesRef.current.forEach((circleData, objId) => {
        if (circleData.expiresAt && now >= circleData.expiresAt) {
          toRemove.push(objId);
          return;
        }

        const { circle, growing, currentRadius, effect, center } = circleData;

        // Calculate proximity for dynamic effects.
        let proximity = 0;
        if (userLoc) {
          const [objLat, objLng] = center;
          const [userLat, userLng] = userLoc;
          const distance = calculateDistance(userLat, userLng, objLat, objLng);
          const proximityDistance = effect.startDistance || effect.maxRadius;
          proximity = Math.max(0, Math.min(1, 1 - distance / proximityDistance));
        }

        // Adjust animation speed and opacity based on proximity.
        const step = 2 * (1 + proximity * 2); // Up to 3x faster near center.
        const targetOpacity = 0.3 + 0.4 * proximity;
        circle.setStyle({ fillOpacity: targetOpacity, opacity: targetOpacity });

        // Update radius (grow/shrink).
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
        pulsatingCirclesRef.current.set(objId, {
          ...circleData,
          growing: newGrowing,
          currentRadius: newRadius
        });
      });

      if (toRemove.length) {
        toRemove.forEach((objId) => {
          const entry = pulsatingCirclesRef.current.get(objId);
          if (entry) {
            entry?.circle?.remove?.();
            pulsatingCirclesRef.current.delete(objId);
          }
        });
        restartTickRef.current();
      }
    }, nextMs);
  }, [calculateDistance, userLocationRef]);

  useEffect(() => {
    restartTickRef.current = restartPulsatingInterval;
  }, [restartPulsatingInterval]);

  const addOrUpdatePulsatingCircle = useCallback(
    (params: AddOrUpdateParams) => {
      const map = mapRef.current;
      if (!map) return;

      const existing = pulsatingCirclesRef.current.get(params.objectId);
      const expiresAt = params.durationMs && params.durationMs > 0 ? Date.now() + params.durationMs : null;

      if (existing) {
        // Avoid overriding a design-time pulsating effect with a timeline one unless it's also from timeline.
        if (existing.source === 'object' && params.source === 'timeline') {
          return;
        }

        existing.circle.setStyle({ color: params.effect.color, fillColor: params.effect.color });
        existing.circle.setRadius(params.effect.minRadius);
        pulsatingCirclesRef.current.set(params.objectId, {
          ...existing,
          center: params.center,
          effect: params.effect,
          source: params.source,
          expiresAt
        });
        if (!map.hasLayer(existing.circle)) existing.circle.addTo(map);
        restartPulsatingInterval();
        return;
      }

      const circle = new Circle(params.center, {
        color: params.effect.color,
        fillColor: params.effect.color,
        fillOpacity: 0.3,
        radius: params.effect.minRadius,
        weight: 2
      }).addTo(map);

      pulsatingCirclesRef.current.set(params.objectId, {
        circle,
        growing: true,
        currentRadius: params.effect.minRadius,
        center: params.center,
        effect: params.effect,
        source: params.source,
        expiresAt
      });

      restartPulsatingInterval();
    },
    [mapRef, restartPulsatingInterval]
  );

  const removeTimelinePulsatingCircle = useCallback(
    (objectId: string) => {
      const entry = pulsatingCirclesRef.current.get(objectId);
      if (!entry) return;
      if (entry.source !== 'timeline') return;
      entry?.circle?.remove?.();
      pulsatingCirclesRef.current.delete(objectId);
      restartPulsatingInterval();
    },
    [restartPulsatingInterval]
  );

  const clearPulsatingCircles = useCallback(() => {
    if (animationIntervalRef.current) {
      window.clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }
    animationIntervalMsRef.current = null;
    pulsatingCirclesRef.current.forEach(({ circle }) => circle?.remove?.());
    pulsatingCirclesRef.current.clear();
  }, []);

  const syncObjectPulsatingCircles = useCallback(
    (
      objects: QuestObject[],
      getValidCoordinates: (obj: QuestObject) => [number, number] | null,
      normalizeEffect: (effect: any) => PulsatingCircleEffect
    ) => {
      clearPulsatingCircles();

      const objectsWithEffect = objects.filter((obj: any) => obj.pulsating_effect?.enabled);

      if (!objectsWithEffect.length) return;

      objectsWithEffect.forEach((obj) => {
        const coords = getValidCoordinates(obj);
        if (!coords) return;

        const effect = normalizeEffect((obj as any).pulsating_effect);
        addOrUpdatePulsatingCircle({
          objectId: obj.id,
          center: coords,
          effect,
          source: 'object'
        });
      });
    },
    [addOrUpdatePulsatingCircle, clearPulsatingCircles]
  );

  const setPulsatingVisibility = useCallback(
    (visibleIds: Set<string> | null) => {
      const map = mapRef.current;
      if (!map) return;

      pulsatingCirclesRef.current.forEach(({ circle }, objId) => {
        const shouldShow = !visibleIds || visibleIds.has(objId);
        if (shouldShow) {
          if (!map.hasLayer(circle)) circle.addTo(map);
        } else if (map.hasLayer(circle)) {
          circle?.remove?.();
        }
      });
    },
    [mapRef]
  );

  return {
    addOrUpdatePulsatingCircle,
    removeTimelinePulsatingCircle,
    clearPulsatingCircles,
    syncObjectPulsatingCircles,
    setPulsatingVisibility
  };
}
