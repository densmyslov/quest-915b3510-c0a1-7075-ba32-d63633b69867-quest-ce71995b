# Map Effects Documentation

## Overview

The map effects system provides visual enhancements for the interactive quest map, including pulsating circles around markers, compass animations, notifications, and GPS-based proximity tracking. This document covers all visual effects implemented in the map component.

## Table of Contents

1. [Architecture](#architecture)
2. [Object Visibility](#object-visibility)
3. [Pulsating Circle Effects](#pulsating-circle-effects)
4. [Marker Visual Effects](#marker-visual-effects)
5. [Compass Rose Animations](#compass-rose-animations)
6. [Notification System](#notification-system)
7. [GPS Proximity Tracking](#gps-proximity-tracking)
8. [Map Styling Effects](#map-styling-effects)
9. [Configuration](#configuration)
10. [API Reference](#api-reference)

---

## Architecture

### Key Files

- **[src/components/QuestMap.tsx](../quest-app-template/src/components/QuestMap.tsx)** - Main map component with all visual effects
- **[src/app/map-effects/page.tsx](../quest-app-template/src/app/map-effects/page.tsx)** - Settings page for configuring pulsating effects
- **[src/types/quest.ts](../quest-app-template/src/types/quest.ts)** - TypeScript interfaces for effect configurations

### Component Structure

```
QuestMap
├── Map Container (Leaflet)
├── Visual Effects Layer
│   ├── Pulsating Circles
│   ├── Trigger Zone Circles
│   └── Vignette Overlay
├── UI Elements
│   ├── GPS Metrics Panel
│   ├── Compass Rose
│   ├── Notification Banner
│   └── Control Buttons
└── Decorative Elements
    ├── Art Deco Corners
    ├── Title Banners
    └── Border Frame
```

---

## Object Visibility

### Sliding Window Filter

The quest map implements a sliding window visibility system that controls which objects are displayed on the map. This prevents overwhelming users with too many markers and focuses their attention on relevant objectives.

### Visibility Rules

Located in [QuestMap.tsx:342-391](../quest-app-template/src/components/QuestMap.tsx#L342-L391), the `visibleObjects` filter applies the following rules:

1. **Objects with `number = 0` are hidden** - Objects with itinerary number 0 will not be displayed on the map
2. **Objects without numbers are hidden** - Objects with `null` or undefined itinerary numbers are excluded
3. **Start objects are always visible** - Objects marked as start points remain visible
4. **Current objective is visible** - The next uncompleted objective (highest completed + 1) is shown
5. **Previous completed object is visible** - The last completed objective remains visible for context

### Implementation

```typescript
const visibleObjects = useMemo(() => {
    if (!data?.objects) return [];

    const sortedObjects = [...data.objects].sort((a, b) => {
        const aNum = getItineraryNumber(a) ?? 0;
        const bNum = getItineraryNumber(b) ?? 0;
        return aNum - bNum;
    });

    if (stepsMode) {
        return sortedObjects; // Show all in steps mode
    }

    const visible = sortedObjects.filter(obj => {
        const num = getItineraryNumber(obj);
        if (num === null || num === 0) return false; // Hide objects with no number or number = 0

        if (isStartObject(obj)) return true; // Always show start

        // Show previous completed and current objective
        if (num === highestCompleted && questProgress.completedObjects.has(obj.id)) {
            return true;
        }
        if (num === highestCompleted + 1) {
            return true;
        }

        return false;
    });

    return visible;
}, [data?.objects, questProgress.completedObjects, stepsMode]);
```

### Steps Mode Override

In steps mode, the visibility filter is bypassed and all objects are shown. This allows users to manually navigate through the quest objectives in any order.

### Use Cases for `number = 0`

Setting an object's itinerary `number` to `0` is useful for:

- **Hidden markers** - Objects that exist in the data but shouldn't appear on the map
- **Special events** - Conditional objectives that are revealed through other mechanisms
- **Debug/testing objects** - Development markers that should be excluded from production
- **Non-sequential objectives** - Objects that don't fit the linear progression model

### Example Configuration

```json
{
  "id": "hidden-easter-egg",
  "name": "Secret Location",
  "number": 0,
  "coordinates": { "lat": 45.333, "lng": 14.406 },
  "description": "This object will not be displayed on the map"
}
```

---

## Pulsating Circle Effects

### Description

Animated concentric circles that pulse outward from active markers, creating a glowing effect to draw attention to triggered locations.

### Implementation

Located in [QuestMap.tsx:613-616](../quest-app-template/src/components/QuestMap.tsx#L613-L616):

```css
@keyframes questPulse {
    0% { transform: translate(-50%, -50%) scale(0.8); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
}
```

Applied to active markers in [QuestMap.tsx:72](../quest-app-template/src/components/QuestMap.tsx#L72):

```typescript
${type === 'active' || type === 'activeSecondary' ?
  `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
   width:50px;height:50px;border:2px solid #FFD700;border-radius:50%;
   animation:questPulse 2s ease-out infinite;pointer-events:none;"></div>`
  : ''}
```

### Configuration

The pulsating effect can be configured per object through the `PulsatingEffect` interface:

```typescript
interface PulsatingEffect {
    enabled: boolean;
    color: string;
    effectType?: string;          // 'pulsating_circles'
    effectRadius?: number;         // Radius in meters
    startEffectDistance?: number;  // Distance to start effect
    speed?: number;                // Animation speed in ms
    minRadius?: number;            // Legacy support
    maxRadius?: number;            // Legacy support
}
```

### Settings Page

Users can configure pulsating effects through [map-effects/page.tsx](../quest-app-template/src/app/map-effects/page.tsx):

- **Enable/Disable Toggle** - Turn effect on/off
- **Color Picker** - Choose pulse color (hex)
- **Min Radius Slider** - 20-100m range
- **Max Radius Slider** - 30-150m range
- **Speed Slider** - 50-300ms animation duration

Settings are persisted in `localStorage` as `map_effects_settings` and trigger a `map_effects_updated` custom event.

---

## Marker Visual Effects

### Marker Types

Five marker variants with distinct visual styles:

1. **Location** - Standard object marker (brown with golden border)
2. **Location Secondary** - Secondary object marker (darker brown)
3. **Player** - User's current position (blue with golden border)
4. **Active** - Triggered location (burgundy with golden glow)
5. **Active Secondary** - Triggered secondary location

### Visual Features

Implemented in [QuestMap.tsx:33-66](../quest-app-template/src/components/QuestMap.tsx#L33-L66):

- **SVG Pin Shape** - Custom teardrop-shaped pins
- **Gradient Fills** - `linearGradient` with three color stops
- **Drop Shadows** - `feDropShadow` filters with dual layers:
  - Black shadow for depth (3px blur)
  - Colored glow for mystical effect (1px blur)
- **Compass Rose Center** - Decorative crosshair and circles
- **Border Strokes** - Golden borders (2.5px width)

### Example Marker Configuration

```typescript
const configs = {
    active: {
        bg: '#722F37',        // Burgundy
        border: '#FFD700',     // Gold
        inner: '#5a252c',      // Dark burgundy
        glow: 'rgba(255, 215, 0, 0.8)' // Golden glow
    }
}
```

---

## Compass Rose Animations

### Compass Glow Effect

Located in [QuestMap.tsx:625-628](../quest-app-template/src/components/QuestMap.tsx#L625-L628):

```css
@keyframes compassGlow {
    0%, 100% { filter: drop-shadow(0 0 8px rgba(201, 169, 97, 0.4)); }
    50% { filter: drop-shadow(0 0 16px rgba(201, 169, 97, 0.7)); }
}
```

Applied when GPS is enabled in [QuestMap.tsx:999-1010](../quest-app-template/src/components/QuestMap.tsx#L999-L1010):

```typescript
<div style={{
    animation: gpsEnabled ? 'compassGlow 3s ease-in-out infinite' : 'none',
    transform: heading !== null ? `rotate(${-heading}deg)` : 'none',
    transition: 'transform 0.3s ease-out'
}}>
```

### Features

- **Dynamic Rotation** - Syncs with device orientation
- **Smooth Transitions** - 0.3s ease-out animation
- **Glow Animation** - 3s breathing effect when active
- **Cardinal Points** - N (burgundy), E/S/O (gold)
- **Tick Marks** - 36 marks (10° intervals)

### Device Orientation Integration

Compass heading is captured from device sensors in [QuestMap.tsx:307-318](../quest-app-template/src/components/QuestMap.tsx#L307-L318):

```typescript
const handleOrientation = (event: DeviceOrientationEvent) => {
    let compass: number | null = null;
    if ((event as any).webkitCompassHeading !== undefined) {
        compass = (event as any).webkitCompassHeading;  // iOS
    } else if (event.alpha !== null) {
        compass = 360 - event.alpha;  // Android
    }
    if (compass !== null) {
        setHeading(compass);
    }
};
```

---

## Notification System

### Telegram-Style Notifications

Slide-in banner that appears when users enter trigger zones.

Animation defined in [QuestMap.tsx:618-623](../quest-app-template/src/components/QuestMap.tsx#L618-L623):

```css
@keyframes telegramSlide {
    0% { transform: translateX(-50%) translateY(-100%); opacity: 0; }
    15% { transform: translateX(-50%) translateY(0); opacity: 1; }
    85% { transform: translateX(-50%) translateY(0); opacity: 1; }
    100% { transform: translateX(-50%) translateY(-100%); opacity: 0; }
}
```

### Notification UI

Located in [QuestMap.tsx:793-836](../quest-app-template/src/components/QuestMap.tsx#L793-L836):

```typescript
{notification && (
    <div style={{
        animation: 'telegramSlide 4s ease-in-out forwards',
        background: `linear-gradient(135deg, ${COLORS.parchment} 0%,
                     ${COLORS.parchmentDark} 100%)`,
        border: `2px solid ${COLORS.gold}`
    }}>
        <span>{notification}</span>
    </div>
)}
```

### Trigger Logic

Notifications fire when user enters an object's trigger radius in [QuestMap.tsx:390-399](../quest-app-template/src/components/QuestMap.tsx#L390-L399):

```typescript
if (distance < radius) {
    if (!triggeredObjects.has(obj.id)) {
        setNotification(`Hai raggiunto ${obj.name}`);
        setTriggeredObjects(prev => {
            const next = new Set(prev);
            next.add(obj.id);
            return next;
        });
        setTimeout(() => setNotification(null), 4000);
    }
}
```

## Audio Triggers

When a player crosses an object’s trigger radius, `QuestMap` assembles `audioToPlay` from the first URL it can resolve (see [QuestMap.tsx:472-488](../quest-app-template/src/components/QuestMap.tsx#L472-L488)). The scan covers two sources:

1. `obj.audioUrl` / `obj.audio_url` (normalized via `normalizeAudioUrls`).
2. Images returned by `normalizeObjectImages`, which in turn looks at `images`, `image_audio_urls`, `audioByImageUrl`, `image.audioUrl/audio.audioUrls`, etc.

The resulting `audioToPlay` is `const audioToPlay = [...directAudio, ...allAudio][0];`; no pulsating effect metadata is consulted. To make the Rijeka quest’s Kitchen trigger play the `Witch laugh` media (`20251217-073210-ad0aa0f2.wav`), store that clip on one of those fields so the existing trigger logic can find it automatically. For example:

```json
{
  "id": "kitchen-ritual",
  "name": "Kitchen",
  "coordinates": { "lat": 45.333, "lng": 14.406 },
  "triggerRadius": 5,
  "audioUrl": "https://media.quest-platform.com/audio/20251217-073210-ad0aa0f2.wav",
  "images": [
    {
      "url": "https://media.quest-platform.com/images/kitchen.jpg",
      "audioUrls": [
        "https://media.quest-platform.com/audio/20251217-073210-ad0aa0f2.wav"
      ]
    }
  ]
}
```

If you prefer inline controls, the popup also renders `<audio>` elements for each `images[].audioUrls` entry ([QuestMap.tsx:619-639](../quest-app-template/src/components/QuestMap.tsx#L619-L639)). Keeping the clip on `audioUrl/audioUrls` avoids touching the effect pipeline and lets the trigger pause, reset, and `play()` the clip as soon as the radius check succeeds.

---

## GPS Proximity Tracking

### Distance Calculation

Uses Haversine formula for accurate geodesic distance in [QuestMap.tsx:144-154](../quest-app-template/src/components/QuestMap.tsx#L144-L154):

```typescript
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};
```

### GPS Metrics Panel

Real-time display of location data in [QuestMap.tsx:838-954](../quest-app-template/src/components/QuestMap.tsx#L838-L954):

**Displayed Metrics:**
- GPS accuracy (±X meters)
- Nearest object name
- Distance to nearest object
- Trigger radius threshold
- Zone status (IN/OUT)

**Visual Indicators:**
- Green status light when accuracy < 15m
- Zone indicator with gradient background
- Color changes based on zone entry

### Trigger Zones

Visual circles rendered around objects in [QuestMap.tsx:514-534](../quest-app-template/src/components/QuestMap.tsx#L514-L534):

```typescript
// Outer dashed circle
new Circle([lat, lng], {
    radius: triggerRadius,
    color: '#FFD700',
    fillColor: COLORS.gold,
    fillOpacity: 0.15,
    weight: 2.5,
    dashArray: '6, 6'
}).addTo(map);

// Inner glow ring
new Circle([lat, lng], {
    radius: triggerRadius * 0.6,
    color: COLORS.burgundy,
    fillColor: COLORS.burgundy,
    fillOpacity: 0.08,
    weight: 1,
    dashArray: '3, 3'
}).addTo(map);
```

---

## Map Styling Effects

### Sepia Filter

Vintage aesthetic applied to map tiles in [QuestMap.tsx:630-632](../quest-app-template/src/components/QuestMap.tsx#L630-L632):

```css
.quest-map-container .leaflet-tile-pane {
    filter: sepia(0.15) saturate(1.1) brightness(0.95) contrast(1.15);
}
```

### Vignette Overlay

Dramatic edge darkening in [QuestMap.tsx:780-790](../quest-app-template/src/components/QuestMap.tsx#L780-L790):

```typescript
<div style={{
    background: `
        radial-gradient(ellipse at center,
            transparent 40%,
            rgba(26, 21, 16, 0.3) 80%,
            rgba(26, 21, 16, 0.6) 100%),
        linear-gradient(to bottom,
            rgba(26, 21, 16, 0.2) 0%,
            transparent 15%,
            transparent 85%,
            rgba(26, 21, 16, 0.25) 100%)
    `
}} />
```

### Art Deco Corners

Decorative corner ornaments in [QuestMap.tsx:723-747](../quest-app-template/src/components/QuestMap.tsx#L723-L747):

```typescript
['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((pos) => (
    <div key={pos} style={{
        width: '70px', height: '70px',
        transform: `scale(${pos.includes('right') ? -1 : 1},
                    ${pos.includes('bottom') ? -1 : 1})`
    }}>
        <svg viewBox="0 0 70 70">
            <path d="M0 70 L0 0 L70 0..." fill="url(#cornerGrad)" />
            <circle cx="12" cy="12" r="3" fill={COLORS.burgundy} />
        </svg>
    </div>
))
```

### Border Frame

Golden frame overlay in [QuestMap.tsx:712-720](../quest-app-template/src/components/QuestMap.tsx#L712-L720):

```typescript
<div style={{
    position: 'absolute',
    inset: 0,
    border: `3px solid ${COLORS.gold}`,
    boxShadow: `inset 0 0 20px rgba(26, 21, 16, 0.5),
                inset 0 0 60px rgba(26, 21, 16, 0.3)`,
    pointerEvents: 'none',
    zIndex: 2500
}} />
```

---

## Configuration

### Color Palette

Defined in [QuestMap.tsx:17-30](../quest-app-template/src/components/QuestMap.tsx#L17-L30):

```typescript
const COLORS = {
    parchment: '#F5E6D3',
    parchmentDark: '#E8D4BC',
    sepia: '#704214',
    gold: '#C9A961',
    goldLight: '#D4B978',
    burgundy: '#722F37',
    burgundyDark: '#5a252c',
    ink: '#2C1810',
    inkLight: '#4A3728',
    success: '#2d5a3d',
    successLight: '#a8e6a3',
    player: '#1a3a52'
};
```

### Effect Normalization

Effect parameters are normalized from legacy and current formats in [QuestMap.tsx:161-177](../quest-app-template/src/components/QuestMap.tsx#L161-L177):

```typescript
const normalizeEffect = (effect: any) => {
    const minRadius = toNumber(effect.startEffectDistance ?? effect.minRadius, 20);
    const maxRadius = (() => {
        if (effect.effectRadius != null) {
            const radius = toNumber(effect.effectRadius, 0);
            return radius > 0 ? minRadius + radius : minRadius + 50;
        }
        return toNumber(effect.maxRadius, minRadius + 50);
    })();
    const speed = toNumber(effect.speed, 50);
    return {
        minRadius: Math.max(1, minRadius),
        maxRadius: Math.max(minRadius + 1, maxRadius),
        speed,
        color: effect.color || COLORS.burgundy
    };
};
```

### LocalStorage Schema

Settings saved by [map-effects/page.tsx](../quest-app-template/src/app/map-effects/page.tsx):

```typescript
interface MapEffectsSettings {
    pulsatingEnabled: boolean;
    pulsatingColor: string;
    pulsatingMinRadius: number;    // 20-100m
    pulsatingMaxRadius: number;    // 30-150m
    pulsatingSpeed: number;        // 50-300ms
}
```

Stored at key: `map_effects_settings`

---

## API Reference

### QuestMap Component

**Props:** None (uses context providers)

**Hooks:**
- `useQuest()` - Quest data context
- `useTeamSync()` - Team synchronization

**State:**
- `userLocation: [number, number] | null` - GPS coordinates
- `gpsEnabled: boolean` - GPS tracking status
- `gpsAccuracy: number | null` - GPS precision in meters
- `heading: number | null` - Device compass heading
- `triggeredObjects: Set<string>` - IDs of entered zones
- `notification: string | null` - Current notification text
- `nearestObjectDistance: number | null` - Distance to closest object
- `nearestObjectRadius: number | null` - Trigger radius of closest object

### Custom Events

**map_effects_updated**
- Dispatched when settings change in map-effects page
- No payload
- Listeners should reload settings from localStorage

### Helper Functions

**calculateDistance(lat1, lon1, lat2, lon2): number**
- Returns distance in meters between two coordinates

**getValidCoordinates(obj): [number, number] | null**
- Extracts and validates coordinates from object
- Handles both string ("lat,lng") and object formats

**normalizeEffect(effect): NormalizedEffect**
- Converts legacy and current effect formats to consistent shape

**createVintageIcon(type): DivIcon**
- Generates Leaflet marker with SVG and optional pulse effect

---

## Performance Considerations

### Optimization Strategies

1. **CSS Animations** - Hardware-accelerated transforms instead of JS
2. **Event Throttling** - GPS updates use native `watchPosition` throttling
3. **Memoization** - Marker creation cached by Leaflet
4. **Layer Groups** - Efficient batch rendering of markers

### Z-Index Layers

```
5000 - Notifications
4000 - Controls, GPS Panel, Compass
3000 - Bottom Title, Art Deco Corners
2500 - Border Frame
2000 - Vignette Overlay
1000 - Map Markers (Leaflet default)
```

---

## Browser Compatibility

### Required APIs

- **Geolocation API** - GPS tracking
- **DeviceOrientationEvent** - Compass heading
  - iOS: `webkitCompassHeading`
  - Android: `alpha` property
- **CSS Animations** - All visual effects
- **LocalStorage** - Settings persistence

### Permission Requirements

**iOS:**
- `DeviceOrientationEvent.requestPermission()` must be called
- User must grant motion/orientation access

**Android:**
- Automatic orientation access
- Location permission for GPS

---

## Troubleshooting

### Common Issues

**Compass not rotating:**
- Check device orientation permissions
- Ensure GPS is enabled in UI
- Verify device has magnetometer sensor

**Pulsating effects not visible:**
- Check `pulsating_effect.enabled` on object
- Verify settings in `/map-effects` page
- Ensure object is in "active" state (within trigger zone)

**GPS inaccuracy:**
- Check GPS panel for accuracy < 15m (green indicator)
- Move to open area away from buildings
- Wait for GPS fix (can take 30-60 seconds)

**Notifications not appearing:**
- Verify `triggerRadius` set on object
- Check user is within trigger zone
- Notification auto-dismisses after 4 seconds

---

## Future Enhancements

### Planned Features

- [ ] Multiple effect types (ripple, sparkle, beacon)
- [ ] Per-object effect customization in UI
- [ ] Animation easing curve editor
- [ ] Effect preview in settings page
- [ ] Audio feedback on zone entry
- [ ] Vibration API integration
- [ ] Custom marker shapes/icons
- [ ] Trail effect for player movement

### API Extensions

```typescript
// Future effect types
interface Effect {
    type: 'pulsating' | 'ripple' | 'beacon' | 'sparkle';
    duration: number;
    easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
    intensity: number;  // 0-100
    particles?: ParticleConfig;
}
```

---

## License

Part of Quest App Template - See main repository for license details.

---

## Contributing

When adding new effects:

1. Define animation in `<style>` block of QuestMap.tsx
2. Add configuration interface to `types/quest.ts`
3. Create settings UI in `map-effects/page.tsx`
4. Update this documentation
5. Add visual examples to `/docs/examples/`

For questions, open an issue in the repository.
