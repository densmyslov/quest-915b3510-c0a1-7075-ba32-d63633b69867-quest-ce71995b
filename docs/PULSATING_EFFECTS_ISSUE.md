# Pulsating Effects Issue Analysis

## Problem Statement

Pulsating effects configured on objects (via `pulsating_effect` property) are **not being rendered** in the quest-app-template map component, even though:
1. Objects have `pulsating_effect` configuration in the backend
2. The settings page exists at `/map-effects`
3. The quest-platform shows these effects correctly

## Root Cause

The `QuestMap.tsx` component in **quest-app-template** is missing the pulsating circle rendering logic that exists in **quest-platform**.

### Current Implementation Gap

**What quest-app-template HAS:**
- Pulsating animation on marker icons (CSS animation on triggered objects)
- Trigger zone circles (static dashed circles showing GPS trigger zones)
- Settings page for configuring effects (`/map-effects`)

**What quest-app-template LACKS:**
- Actual pulsating circle rendering based on `obj.pulsating_effect`
- Animation loop for growing/shrinking circles
- Proximity-based opacity adjustment
- Dynamic circle management

## Comparison

### Quest Platform (WORKING)

Location: [quest-platform/frontend/components/MapsTab.tsx:318-410](../../quest-platform/frontend/components/MapsTab.tsx#L318-L410)

**Implementation:**
```typescript
// 1. Filter objects with enabled effects
const objectsWithEffect = questObjects.filter(obj => obj.pulsating_effect?.enabled);

// 2. Create Leaflet circles for each object
objectsWithEffect.forEach(obj => {
    const config = obj.pulsating_effect!;
    const circle = new Circle([obj.lat, obj.lon], {
        color: config.color,
        fillColor: config.color,
        fillOpacity: 0.3,
        radius: minRadius,
        weight: 2
    }).addTo(map);

    circles.set(obj.id, { circle, growing: true, currentRadius: minRadius });
});

// 3. Animate circles with setInterval
animationIntervalRef.current = setInterval(() => {
    circles.forEach((data, objId) => {
        // Calculate proximity-based speed and opacity
        const proximity = Math.max(0, Math.min(1, 1 - (distance / maxRadius)));
        const step = 2 * (1 + proximity * 2);
        const targetOpacity = 0.3 + (0.4 * proximity);

        // Grow/shrink radius
        if (growing) {
            newRadius += step;
            if (newRadius >= maxRadius) newGrowing = false;
        } else {
            newRadius -= step;
            if (newRadius <= minRadius) newGrowing = true;
        }

        circle.setRadius(newRadius);
        circle.setStyle({ fillOpacity: targetOpacity });
    });
}, commonSpeed);
```

**Features:**
- ✅ Reads `pulsating_effect` from objects
- ✅ Creates Leaflet Circle instances
- ✅ Animates radius growth/shrink
- ✅ Proximity-based opacity (brighter when user is near)
- ✅ Proximity-based speed (faster when user is near)
- ✅ Cleanup on unmount/data change

### Quest App Template (NOT WORKING)

Location: [quest-app-template/src/components/QuestMap.tsx:600-618](../src/components/QuestMap.tsx#L600-L618)

**Current Code:**
```typescript
// Only renders STATIC trigger zone circles
if ((obj as any).triggerRadius) {
    new Circle([lat, lng], {
        radius: (obj as any).triggerRadius,
        color: '#FFD700',
        fillColor: COLORS.gold,
        fillOpacity: 0.15,
        weight: 2.5,
        dashArray: '6, 6'
    }).addTo(map);

    // Inner glow ring
    new Circle([lat, lng], {
        radius: (obj as any).triggerRadius * 0.6,
        color: COLORS.burgundy,
        fillColor: COLORS.burgundy,
        fillOpacity: 0.08,
        weight: 1,
        dashArray: '3, 3'
    }).addTo(map);
}
```

**Issues:**
- ❌ Does NOT check for `obj.pulsating_effect?.enabled`
- ❌ Does NOT use `pulsating_effect.color`
- ❌ Does NOT animate circles (static only)
- ❌ Does NOT adjust opacity based on proximity
- ❌ Only renders trigger zones, not pulsating effects

## Data Structure

Objects in the backend have this structure:

```typescript
interface QuestObject {
    id: string;
    name: string;
    coordinates: { lat: number; lng: number } | string;
    triggerRadius?: number;  // GPS trigger zone (separate from effects)
    pulsating_effect?: {
        enabled: boolean;
        color: string;
        effectType?: string;           // 'pulsating_circles'
        effectRadius?: number;          // New format (50-200m)
        startEffectDistance?: number;   // New format (50-500m)
        speed?: number;                 // Animation speed (50-500ms)
        minRadius?: number;             // Legacy format
        maxRadius?: number;             // Legacy format
    };
}
```

## Why It's Not Working

1. **Missing Circle Creation Logic**
   - `QuestMap.tsx` never reads `obj.pulsating_effect`
   - Only creates static trigger zone circles based on `triggerRadius`

2. **Missing Animation Loop**
   - No `setInterval` or animation frame loop
   - No state tracking for circle growth direction
   - No refs for storing circle instances

3. **Missing Proximity Logic**
   - Proximity checking only used for notifications
   - Not connected to any visual effects on circles

4. **Confusion Between Concepts**
   - **Trigger zones** (GPS activation radius) vs **Pulsating effects** (visual circles)
   - These are separate features that happen to both use circles

## User Impact

Users who configure pulsating effects on objects (via quest-platform admin panel or `/object/[id]` edit page) will:
- See the effects in quest-platform preview ✅
- NOT see the effects in the actual quest app ❌
- See trigger zone circles instead (wrong color, no animation)
- Think the feature is broken

## Solution Required

Port the pulsating circle implementation from `quest-platform/frontend/components/MapsTab.tsx` to `quest-app-template/src/components/QuestMap.tsx`.

### Implementation Checklist

- [ ] Add refs for circle management
  - `const pulsatingCirclesRef = useRef<Map<string, CircleData>>(new Map())`
  - `const animationIntervalRef = useRef<number | null>(null)`

- [ ] Add circle creation logic in map initialization
  - Filter objects with `pulsating_effect?.enabled`
  - Create Leaflet Circle instances with proper config
  - Store in ref Map with metadata (growing, currentRadius)

- [ ] Add animation loop
  - Use `setInterval` with speed from config
  - Update radius (grow/shrink between min/max)
  - Calculate proximity-based opacity and speed
  - Use `circle.setRadius()` and `circle.setStyle()`

- [ ] Add cleanup logic
  - Clear interval on unmount
  - Remove circles when objects change
  - Handle `pulsating_effect.enabled` toggle

- [ ] Keep trigger zones separate
  - Trigger zones should remain static dashed circles
  - Pulsating effects should be solid animated circles
  - Both can coexist on the same object

- [ ] Handle legacy format
  - Support both `minRadius/maxRadius` and `startEffectDistance/effectRadius`
  - Use `normalizeEffect()` helper (already exists in QuestMap.tsx:161)

### Code Structure

```typescript
// At component level
const pulsatingCirclesRef = useRef<Map<string, {
    circle: Circle;
    growing: boolean;
    currentRadius: number;
}>>(new Map());
const animationIntervalRef = useRef<number | null>(null);

// In map initialization useEffect (after markers are created)
useEffect(() => {
    if (!mapInstanceRef.current || !data) return;

    // Clear existing circles
    pulsatingCirclesRef.current.forEach(({ circle }) => circle.remove());
    pulsatingCirclesRef.current.clear();

    // Create pulsating circles
    data.objects
        .filter(obj => obj.pulsating_effect?.enabled)
        .forEach(obj => {
            const coords = getValidCoordinates(obj);
            if (!coords) return;

            const effect = normalizeEffect(obj.pulsating_effect);
            const circle = new Circle(coords, {
                color: effect.color,
                fillColor: effect.color,
                fillOpacity: 0.3,
                radius: effect.minRadius,
                weight: 2
            }).addTo(mapInstanceRef.current!);

            pulsatingCirclesRef.current.set(obj.id, {
                circle,
                growing: true,
                currentRadius: effect.minRadius
            });
        });

    // Start animation
    if (pulsatingCirclesRef.current.size > 0) {
        animationIntervalRef.current = window.setInterval(() => {
            pulsatingCirclesRef.current.forEach((data, objId) => {
                const obj = data.objects.find(o => o.id === objId);
                if (!obj?.pulsating_effect?.enabled) return;

                const effect = normalizeEffect(obj.pulsating_effect);
                // ... animation logic
            });
        }, 100);
    }

    return () => {
        if (animationIntervalRef.current) {
            clearInterval(animationIntervalRef.current);
        }
        pulsatingCirclesRef.current.forEach(({ circle }) => circle.remove());
        pulsatingCirclesRef.current.clear();
    };
}, [data, mapInstanceRef.current]);
```

## Settings Page Integration

The settings page at `/map-effects` currently saves to `localStorage` but has no effect because:
1. QuestMap.tsx doesn't listen to the `map_effects_updated` event
2. The settings apply globally, not per-object
3. Per-object settings from `pulsating_effect` should take precedence

**Recommendation:** Clarify the settings page purpose:
- Option A: Remove it (use per-object settings only)
- Option B: Make it a global default for new objects
- Option C: Use it as an override toggle (enable/disable all effects at once)

## Testing Checklist

After implementation:

- [ ] Create test object with `pulsating_effect.enabled = true`
- [ ] Verify circle appears with correct color
- [ ] Verify circle animates (grows/shrinks)
- [ ] Move GPS location near object
- [ ] Verify circle opacity increases when near
- [ ] Verify circle animates faster when near
- [ ] Move GPS location away
- [ ] Verify circle fades back to baseline
- [ ] Disable effect on object
- [ ] Verify circle disappears
- [ ] Check console for errors
- [ ] Test with multiple objects with different colors
- [ ] Test with legacy `minRadius/maxRadius` format
- [ ] Test with new `startEffectDistance/effectRadius` format

## Related Files

**Need Changes:**
- `quest-app-template/src/components/QuestMap.tsx` - Add pulsating circle rendering

**Reference Implementation:**
- `quest-platform/frontend/components/MapsTab.tsx:310-420` - Working implementation

**Already Working:**
- `quest-app-template/src/app/map-effects/page.tsx` - Settings UI (may need clarification)
- `quest-app-template/src/types/quest.ts` - Type definitions (correct)
- `quest-platform/backend/src/tools/user-object-manager/lambda_handler.py:520-533` - Backend storage (working)

## Priority

**HIGH** - This is a visible feature that users can configure but doesn't work in the app.

## Estimated Effort

~2-3 hours to port and test the implementation.

---

## Additional Notes

### Why Trigger Zones and Pulsating Effects Are Different

| Feature | Purpose | Appearance | Behavior |
|---------|---------|------------|----------|
| **Trigger Zones** | GPS activation radius | Static dashed circles | Fixed size, appears on all objects with `triggerRadius` |
| **Pulsating Effects** | Visual attraction/guide | Animated solid circles | Growing/shrinking, only on objects with `pulsating_effect.enabled` |

Both can exist on the same object:
- Trigger zone shows where to stand to activate
- Pulsating effect shows visual interest/importance

### Performance Considerations

- Animation interval runs at 100ms (10 FPS)
- Proximity calculation uses Haversine formula (already implemented)
- Should be fine for ~10-20 objects with effects
- For >50 objects, consider throttling or visibility culling

---

**Last Updated:** 2025-12-16
**Status:** Analysis Complete - Implementation Needed
