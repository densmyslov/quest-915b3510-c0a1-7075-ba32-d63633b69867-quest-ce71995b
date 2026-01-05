# Audio Effects Configuration

This document describes how to configure audio effects for quest objects using the `quest.json` file.

## Overview

Audio effects in quest-app-template are proximity-triggered - when a player approaches a quest object within a specified radius, audio automatically plays. The system supports both a modern structured format and legacy formats for backward compatibility.

## Narration vs Audio Effects

There are two distinct audio behaviors in the app:

- **Audio effect (sound-only)**: configured via `audio_effect` and auto-played on proximity/arrival. It plays **without** the streaming text tray.
- **Narration (with streaming text)**: configured via an object `mediaTimeline` item of type `streaming_text_audio`. It plays **with** the streaming text tray.

If you want “audio + streaming text”, use `mediaTimeline` → `streaming_text_audio` (not `audio_effect`).

## Configuration Formats

### Structured Format (Recommended)

The structured format provides full control over audio effects with additional options:

```json
{
  "id": "casa-stria",
  "name": "Casa della Stria",
  "coordinates": "46.0123, 9.3456",
  "audio_effect": {
    "enabled": true,
    "trigger": "proximity",
    "name": "Witch Laugh",
    "media_url": "https://cdn.example.com/witch-laugh.mp3",
    "triggerRadius": 25,
    "loop": false,
    "volume": 80
  }
}
```

**AudioEffect Properties:**

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `enabled` | boolean | Yes | - | Master toggle for the effect |
| `trigger` | string | No | "proximity" | Trigger type (currently only "proximity" is supported) |
| `name` | string | Yes | - | Descriptive name for the effect |
| `media_url` | string | Yes | - | Full URL to the audio file (MP3, WAV, OGG, etc.) |
| `triggerRadius` | number | Yes | - | Distance in meters at which the audio triggers |
| `loop` | boolean | No | false | Whether to loop the audio |
| `volume` | number | No | 100 | Volume level (0-100) |

### Legacy Format (Still Supported)

The simple legacy format using a direct `audioUrl` field:

```json
{
  "id": "casa-stria",
  "name": "Casa della Stria",
  "coordinates": "46.0123, 9.3456",
  "audioUrl": "https://cdn.example.com/witch-laugh.mp3",
  "triggerRadius": 25
}
```

**Note:** `audio_url` (with underscore) is also supported as an alternative to `audioUrl`.

### Image-Linked Audio Format

Audio can also be attached to specific images within an object:

```json
{
  "id": "statue",
  "name": "Ancient Statue",
  "coordinates": "46.0123, 9.3456",
  "images": [
    {
      "url": "https://cdn.example.com/statue.jpg",
      "thumbnailUrl": "https://cdn.example.com/statue-thumb.jpg",
      "audioUrl": "https://cdn.example.com/narration.mp3"
    },
    {
      "url": "https://cdn.example.com/statue-2.jpg",
      "audioUrls": [
        "https://cdn.example.com/narration-2.mp3",
        "https://cdn.example.com/ambient.mp3"
      ]
    }
  ],
  "triggerRadius": 20
}
```

## Audio URL Resolution Priority

When multiple audio sources are configured, **only proximity-triggered audio effects** are resolved/auto-played:

1. **Structured audio_effect** - If `audio_effect.enabled` is true and `media_url` is set

Legacy `audioUrl` / `audio_url` and image-linked audio are not triggered on approach.

Narration is not resolved from `audio_effect`; it is driven by the object `mediaTimeline`.

## Trigger Radius Guidelines

Choose an appropriate trigger radius based on your environment:

| Environment | Recommended Radius | Notes |
|-------------|-------------------|-------|
| Dense urban areas | 10-15m | Multiple objects nearby, smaller zones prevent overlap |
| Standard outdoor | 15-20m | **Default** - Good for most outdoor locations |
| Large open areas | 25-30m | Parks, plazas, large buildings |
| Special cases | 50-100m | Landmarks visible from distance |

**GPS Accuracy Considerations:**
- Mobile GPS typically has 5-20m accuracy
- Trigger radius should be at least 15m for reliable detection
- In areas with poor GPS (urban canyons, forests), increase radius

## How It Works

### Audio Unlock Mechanism

Modern mobile browsers block autoplay to prevent unwanted audio. The quest-app-template provides **multiple ways** to unlock audio for maximum user convenience:

#### Unlock Methods

1. **🎮 Mode Selection (Recommended)**
   - Tap **`Play mode`** (real GPS) or **`Steps mode`** (simulated arrivals)
   - Selecting a mode also unlocks audio (required by iOS/Android autoplay policies)

2. **🗺️ Map Interaction (Automatic)**
   - Audio unlocks automatically on **any** map interaction:
     - Tapping the map
     - Dragging/panning the map
     - Zooming in/out
     - Clicking on markers
   - Seamless experience - no explicit button needed
   - Shows "Audio attivato!" notification on success

3. **🧭 Play Mode: GPS Toggle Button**
   - In **Play mode**, tapping "Attiva Bussola" unlocks audio and starts GPS tracking

4. **👣 Steps Mode: Step Buttons**
   - In **Steps mode**, tapping "Next step" / "Prev step" also unlocks audio (and triggers simulated arrivals)

#### Technical Implementation

- **Centralized Function**: `unlockAudio()` handles all unlock logic
- **Dual Unlock**: Both AudioContext (Web Audio API) and HTML5 Audio are unlocked
- **Multi-Format Fallback**: Tries MP3, WAV, and OGG formats for maximum browser compatibility
- **Queued Triggers**: If an audio trigger happens while locked, it is queued and will play after the next successful unlock gesture
- **Error Handling**: If unlock fails, retry by tapping Play/Steps, the map, or the GPS toggle
- **iOS & Android Support**: Works on both Safari and Chrome mobile browsers
- **Silent Unlock Audio**: Uses 0.01 volume for unlock trigger (actual quest audio plays at full volume)

### Proximity Detection

The app uses GPS-based proximity detection:

1. **GPS Tracking**: High-accuracy GPS monitoring when enabled
2. **Haversine Formula**: Calculates distance between user and objects
3. **Zone Entry**: When distance < triggerRadius, audio plays automatically
4. **Zone Exit**: When distance > triggerRadius, looped audio effects stop (one-shots are allowed to finish)
5. **Re-triggers**: Audio plays again when re-entering the zone

### Implementation Details

- **Hook**: Uses `useProximityTracker` custom React hook
- **Debouncing**: 1-second debounce prevents GPS jitter issues
- **Re-triggerable**: Players can re-trigger audio by leaving and re-entering zones
- **State Management**: Uses refs to prevent re-renders during playback
- **Error Handling**: Graceful fallback if audio fails to load or play

## Examples

### Example 1: Simple Audio Effect

```json
{
  "id": "church-bell",
  "name": "Chiesa di San Vittore",
  "coordinates": "46.0154, 9.3456",
  "audioUrl": "https://cdn.example.com/church-bell.mp3",
  "triggerRadius": 20
}
```

### Example 2: Looping Ambient Sound

```json
{
  "id": "waterfall",
  "name": "Cascata del Cenghen",
  "coordinates": "46.0132, 9.3402",
  "audio_effect": {
    "enabled": true,
    "name": "Waterfall Ambience",
    "media_url": "https://cdn.example.com/waterfall-loop.mp3",
    "triggerRadius": 30,
    "loop": true,
    "volume": 60
  }
}
```

### Example 3: Narration (Streaming Text Tray)

```json
{
  "id": "viewpoint",
  "name": "Punto Panoramico",
  "coordinates": "46.0198, 9.3512",
  "mediaTimeline": {
    "version": 1,
    "items": [
      {
        "type": "streaming_text_audio",
        "order": 1,
        "media_url": "https://cdn.example.com/viewpoint-narration.mp3",
        "blocking": true,
        "displayMode": "seconds",
        "displaySeconds": 5
      }
    ]
  }
}
```

Optional: you can also add a sound-only proximity effect in parallel via `audio_effect`.

### Example 4: No Audio (Object Without Sound)

```json
{
  "id": "landmark",
  "name": "Monument",
  "coordinates": "46.0165, 9.3478",
  "description": "Silent landmark with visual content only"
}
```

The system handles objects without audio gracefully - no errors occur.

## Migration from Legacy to Structured Format

To migrate from the legacy `audioUrl` format to the new structured `audio_effect`:

**Before (Legacy):**
```json
{
  "audioUrl": "https://cdn.example.com/sound.mp3",
  "triggerRadius": 20
}
```

**After (Structured):**
```json
{
  "audio_effect": {
    "enabled": true,
    "name": "Sound Effect Name",
    "media_url": "https://cdn.example.com/sound.mp3",
    "triggerRadius": 20
  }
}
```

**Note:** Both formats work simultaneously - no breaking changes required.

## Troubleshooting

### Audio Not Playing

**Problem**: Audio doesn't play when entering trigger zone

**Solutions**:
1. **Unlock audio first**
   - Tap **Play mode** or **Steps mode**
   - Or simply interact with the map (pan, zoom, or tap)
   - In **Play mode**, tap the **"Attiva Bussola"** GPS button
2. **Check for notification** - You should see "Audio attivato!" after unlocking
3. **Ensure GPS is enabled** - Proximity detection requires GPS tracking
4. **Verify URL** - Ensure `media_url` or `audioUrl` is accessible
5. **Test in browser console** - Look for error messages starting with `[QuestMap]`
6. **Check file format** - Use MP3 for maximum compatibility

### GPS Accuracy Issues

**Problem**: Audio triggers inconsistently or at wrong locations

**Solutions**:
1. **Increase trigger radius** - Try 25-30m in areas with poor GPS
2. **Check GPS accuracy** - Look at the "Precisione" reading in the GPS panel
3. **Wait for GPS lock** - Allow 10-30 seconds for accurate positioning
4. **Clear sky view** - GPS works best with clear view of sky

### Audio Keeps Re-triggering

**Problem**: Audio plays repeatedly without leaving zone

**Solutions**:
- This is expected behavior - the system allows re-triggers
- Audio stops when exiting the zone and plays again when re-entering
- The debounce (1 second) prevents rapid re-triggers from GPS jitter

### Format Decoding Error

**Problem**: Audio unlock fails with `NotSupportedError: Failed to load because no supported source was found`

**Solutions**:
- The multi-format fallback system (MP3 → WAV → OGG) handles this automatically
- Check browser console for format fallback messages
- Try a different browser to isolate browser-specific codec issues
- Verify you're using the latest version with multi-format support
- Most common cause: corrupted base64 data in the code

## Technical Reference

### TypeScript Interfaces

```typescript
export interface AudioEffect {
    enabled: boolean;
    trigger?: string;
    name: string;
    media_url: string;
    triggerRadius: number;
    loop?: boolean;
    volume?: number;
}

export interface QuestObject {
    id: string;
    name: string;
    coordinates: { lat: number; lng: number } | string;
    triggerRadius?: number;
    audioUrl?: string | null;
    audio_url?: string | null;
    audio_effect?: AudioEffect | null;
    // ... other properties
}
```

### Supported Audio Formats

- **MP3**: Best compatibility (recommended)
- **WAV**: High quality, larger file size
- **OGG**: Good compression, not supported on iOS
- **M4A/AAC**: Good for iOS, may not work on all Android browsers

### Browser Support

- **iOS Safari**: Requires audio unlock via user interaction ✓
- **Chrome Mobile (Android)**: Requires audio unlock via user interaction ✓
- **Desktop Chrome/Firefox**: Full support without unlock requirement ✓
- **Other browsers**: Should work but not extensively tested

## UI Elements

### Mode Selector

The map UI exposes two modes at the top:

- **Play mode**: real GPS proximity tracking (use **"Attiva Bussola"**)
- **Steps mode**: simulated arrivals via **Next/Prev step** (no GPS)

Selecting a mode is also a user gesture that unlocks audio on mobile, and you’ll see the "Audio attivato!" notification on success.

## Best Practices

1. **User Education**: Make it clear that the first tap (mode selection, map interaction, or GPS toggle) enables audio on mobile
2. **Host on CDN**: Use a reliable CDN (Cloudflare, AWS CloudFront) for audio files
3. **Compress audio**: Use compressed formats to reduce file size and loading time
4. **Test on device**: Always test on actual mobile devices, not just emulators
5. **Reasonable radius**: Don't make trigger zones too large (causes premature triggering)
6. **Descriptive names**: Use clear names for `audio_effect.name` for debugging
7. **Check logs**: Monitor console for `[QuestMap]` messages during development
8. **HTTPS required**: Audio URLs must use HTTPS for mobile compatibility
9. **Multiple unlock paths**: Users can unlock via mode selection, map interaction, or the GPS toggle

## Related Documentation

- [Proximity Detection Implementation](./PROXIMITY_DETECTION.md) (if exists in quest-platform docs)
- [Quest Data Structure](./QUEST_DATA_FORMAT.md)
- [GPS Configuration](./GPS_SETUP.md)

---

*Generated for quest-app-template audio proximity trigger system*
