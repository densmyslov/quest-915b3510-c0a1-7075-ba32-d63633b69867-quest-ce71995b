# Audio System Architecture & Safari Compliance

*Comprehensive documentation for the Quest App audio system, including the "Gesture Gate" architecture for Safari support.*

## 1. Overview

The Quest App audio system is designed to trigger location-based audio (narration and effects) while strictly adhering to modern browser autoplay policies, particularly on iOS Safari.

The system manages two types of audio:
*   **Narration (Timeline)**: Voiceovers synchronized with streaming text overlays.
*   **Audio Effects (Proximity)**: Sound-only effects (e.g., ambient loops, spot sounds) triggered by GPS proximity.

## 2. The Safari Challenge & "Gesture Gate"

Safari (and increasingly Chrome) requires a **direct, synchronous user gesture** to unlock audio contexts and play media. "Fire and forget" play calls, or calls inside asynchronous `useEffect` hooks, are often blocked.

The application implements a **Gesture Gate** architecture to solve this.

### The "Gesture Gate" Pattern

**Problem**: React state updates are asynchronous. If a user clicks "Play Mode", the state updates, a `useEffect` runs, and *then* we try to play audio. Safari sees this as "detached" from the click and blocks it.

**Solution**: The `QuestMap` component uses a `timelineGateRef` to force the *first* audio interaction to happen **synchronously** within the event handler.

**Implementation Details (`QuestMap.tsx`):**
1.  **Touch/Click Event**: User clicks "Play" or "Steps".
2.  **Synchronous Unlock**:
    *   `timelineGateRef.current.gestureBlessed = true`
    *   `unlockAudio()` is called immediately.
3.  **Immediate Execution**:
    *   The code seeks the current object and calls `runObjectTimeline` *inside the event handler* (not waiting for an effect).
    *   This ensures the `audio.play()` call is directly on the call stack of the user click.

```typescript
// QuestMap.tsx
const selectMapMode = useCallback(async (mode) => {
    // 1. Bless the gesture
    timelineGateRef.current.gestureBlessed = true;

    // 2. Unlock Audio Contexts immediately
    await unlockAudio();

    // 3. Trigger Timeline IMMEDIATELY (Safari Fix)
    // Do not wait for state update or useEffect
    if (currentObj && !isCompleted) {
       runObjectTimelineRef.current(currentObj);
    }

    // 4. Update State (for UI)
    setMapMode(mode);
}, ...);
```

## 3. Audio Unlock System

The system uses a "Dual Unlock" strategy to ensure compatibility across all environments (iOS, Android, Desktop).

### Unlock Logic (`useMapAudio.ts`)

The `unlockAudio()` function performs two critical tasks:
1.  **Resume AudioContext**: Unlocks the Web Audio API.
2.  **Prime HTML5 Audio**: Plays a silent track on the `<audio>` element.

**Critical Safari Fixes:**
*   **Hosted Silence File**: Uses a real file (`/audio/silence.mp3` or `.m4a`) instead of a base64 string. Safari often fails to decode base64 blobs on the first interaction.
*   **Element Specificity**: Permissions are element-bound. We explicitly unlock both the `audioRef` (narration) and `effectAudioRef` (effects).
*   **Error Handling**: Catches `AbortError` (common on Safari) and retries on the next interaction.

### Triggers
Audio is unlocked transparently on:
1.  **Mode Selection**: Clicking "Play" or "Steps".
2.  **Map Interaction**: Tapping, panning, or zooming the map (via Leaflet event hooks).
3.  **GPS Toggle**: Clicking "Attiva Bussola".

## 4. Background Audio System (`QuestAudioContext.tsx`)

The app uses a global background audio system for continuous music/ambience that persists across page navigation.

### Safari Background Audio Strategy

Safari requires special handling for background audio due to aggressive optimization. The system implements a two-phase unlock approach:

**Phase 1: Silent Audio Priming (Safari only)**
1. Detect Safari browser via user agent
2. Play hosted silence file (`/audio/silence.mp3`) at 50% volume
3. Wait 100ms for Safari to unlock the audio context
4. Switch to actual background music

**Phase 2: Metadata Loading**
1. Load the audio file and wait for `loadedmetadata` event
2. Ensure `audio.duration > 0` and `readyState >= 1` before playing
3. If metadata fails to load (duration=0), force reload the file
4. Play at 10% initial volume (Safari won't load files at very low volumes)

### Critical Safari Fixes

**Problem**: Safari reports audio as "playing" (`paused: false`) without actually loading the file (`duration: 0`).

**Solution**:
```typescript
// Check metadata before allowing volume updates
if (audio.duration === 0 || isNaN(audio.duration) || audio.readyState < 1) {
  console.warn('Audio not loaded, forcing reload');
  setIsBackgroundPlaying(false);
  setBackgroundUrl(null);
  audio.pause();
  audio.currentTime = 0;
  // Fall through to reload
}
```

**Implementation Details:**
```typescript
// Wait for metadata to load before playing
await new Promise<void>((resolve, reject) => {
  const onLoaded = () => {
    console.log('Metadata loaded, duration:', audio.duration);
    resolve();
  };

  if (audio.readyState >= 1) {
    resolve();
  } else {
    audio.addEventListener('loadedmetadata', onLoaded);
  }
});

await audio.play();
```

### Volume Management

- **Initial volume**: 10% (0.1) - High enough for Safari to load metadata
- **INTRO screen**: Ramps up to 50% (0.5)
- **Volume updates**: Only allowed when `duration > 0` to ensure file is loaded

### User Gesture Tracking

The system tracks user gestures (clicks, taps, keypresses) and enforces unlock within 1 second:

```typescript
const lastGestureAtRef = useRef(0);
const withinGestureWindow = Date.now() - lastGestureAtRef.current < 1000;
```

This prevents unlock attempts that would fail due to Safari's gesture requirements.

## 5. Battle-Tested Implementation Rules

These rules are critical for Safari compliance. Ignoring them *will* cause silent playback failures.

### 🚫 Rule 1: Never use `display: none`
Safari may silently abort playback if the audio element is fully removed from the layout.
**Solution**: Use off-screen positioning instead.
```css
position: absolute; width: 1px; height: 1px;
opacity: 0; pointer-events: none;
left: -9999px; top: -9999px;
```

### 🚫 Rule 2: Avoid aggressive `src` churn
Rapidly setting `src` or calling `load()` can cause `AbortError`.
**Solution**: Allow ~100-200ms between `play()` and any subsequent `removeAttribute('src')` or reset operations.

### 🚫 Rule 3: Unlocking is Element-Specific
Unlocking one `<audio>` element does not automatically unlock others.
**Solution**: You must explicitly call `play()` (even if silent) on *every* audio element you intend to use later.

### 🚫 Rule 4: Never start at volume 0 or very low volumes
Safari optimizes away audio loading when volume is too low (< 5%).
**Solution**: Start at minimum 10% volume (0.1), then ramp up to desired level.

### 🚫 Rule 5: Always wait for metadata to load
Safari may report "playing" without loading the file. Check `duration > 0` and `readyState >= 1`.
**Solution**: Listen for `loadedmetadata` event before calling `play()`.

## 6. Configuration (`quest.json`)

Objects can have audio configured in two formats.

### Structured Format (Recommended)
Allows full control over behavior.

```json
{
  "id": "landmark-1",
  "name": "Ancient Ruin",
  "coordinates": "46.0123, 9.3456",
  "audio_effect": {
    "enabled": true,
    "trigger": "proximity",
    "name": "Wind Ambient",
    "media_url": "https://cdn.example.com/wind.mp3",
    "triggerRadius": 25,
    "loop": true,
    "volume": 80
  }
}
```

### Legacy Format
Simple linear playback.

```json
{
  "id": "landmark-2",
  "audioUrl": "https://cdn.example.com/narration.mp3",
  "triggerRadius": 20
}
```

**Note**: `audioUrl` is mapped to an internal effect. However, for full timeline narration (with text), you should use the `mediaTimeline` property on the object, not just `audioUrl`.

## 7. Troubleshooting Guidelines

| Symptom | Probable Cause | Fix |
| :--- | :--- | :--- |
| **"Audio non disponibile"** | Network error or bad URL. | Check console network tab. Verify HTTPS. |
| **"Audio bloccato..."** | Browser denied autoplay. | Tap the map or toggle Play/Steps to re-trigger unlock. |
| **Audio plays then cuts out** | GPS jitter exiting zone. | Increase `triggerRadius` (min 20m recommended). |
| **No audio on iOS** | Silent switch active? | iOS often mutes web audio if the physical ringer switch is silent. |
| **Safari shows "playing" but no sound** | Audio metadata not loaded (`duration: 0`). | Force reload when `duration === 0` or `readyState < 1`. |
| **Background audio doesn't start** | Volume too low for Safari. | Start at minimum 10% volume, not 0-5%. |

## 8. Architecture & Code Map

*   **`QuestMap.tsx`**: Orchestrates state, GPS, and the "Gesture Gate".
*   **`useMapAudio.ts`**: Handles low-level audio element management, unlocking, and error recovery.
*   **`QuestAudioContext.tsx`**: Manages global background audio (music/ambience) that persists across page navigation.
*   **`useProximityTracker.ts`**: Monitors GPS position and fires `onEnterZone` / `onExitZone` events.

---

## 9. Safari Background Audio - Complete Flow

**Registration → INTRO Screen:**

1. User clicks registration submit (user gesture)
2. **Safari detected** → Play `/audio/silence.mp3` at 50% volume
3. Wait 100ms for audio context unlock
4. Load background music at 10% volume:
   - Set `audio.src` to music URL
   - Call `audio.load()`
   - Wait for `loadedmetadata` event (max 3s timeout)
   - Call `audio.play()`
5. Background music plays at 10% (audible but quiet)
6. User advances to INTRO screen
7. Volume ramps to 50% via volume update
8. If `duration === 0` detected during volume update:
   - Stop playback
   - Reset audio element
   - Reload entire file at 50% volume

**Non-Safari browsers:**
- Skip silence.mp3 step
- Load background music directly at 10% volume
- Otherwise same flow

---

**Commit Reference**: This architecture was largely solidified in commit `b10c5ef` and subsequent Safari-focused updates. Safari background audio solution finalized in commit `12c2a3c`.
