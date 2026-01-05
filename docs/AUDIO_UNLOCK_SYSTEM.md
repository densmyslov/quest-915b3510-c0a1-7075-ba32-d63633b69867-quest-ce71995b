# Audio Unlock System - Technical Documentation

## Overview

The Quest Map implements a comprehensive audio unlock system that provides **multiple user-friendly ways** to unlock audio playback while maintaining strict browser autoplay policy compliance.

**Key Features:**
- 🎯 Multiple unlock methods (mode selection, map interaction, GPS toggle, step buttons)
- 🔄 Centralized unlock logic with consistent behavior
- 🎨 Visual feedback via notifications
- 📱 Full iOS Safari and Android Chrome support

---

## Architecture

### Core Function: `unlockAudio()`

Location: [`src/components/QuestMap.tsx:307-356`](../src/components/QuestMap.tsx#L307-L356)

```typescript
const unlockAudio = useCallback(async (): Promise<boolean> => {
    if (audioUnlockedRef.current) {
        return true; // Already unlocked
    }

    try {
        // 1. AudioContext unlock (Web Audio API)
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            const ctx = new AudioContextClass();
            const buffer = ctx.createBuffer(1, 1, 22050);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(0);
        }

        // 2. HTML5 Audio element unlock - Multi-format fallback
        const silentFormats = [
            'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v////////////////////////////////////////////////////////////////MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMz/////////////////////////////////////////////////////////////////AAAAAExhdmM1OC4xMzQAAAAAAAAAAAAAAAAkAAAAAAAAA4T/88DE8AAAAGwAAAABpAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//MwxMsAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/zMEAAAA=',
            'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
            'data:audio/ogg;base64,T2dnUwACAAAAAAAAAABNb3ppbGxhAAAAAAAAAAAAAAAAAAAAAAAAQgAAAAAAAACHqmvJAwX/////Dwf////+//////////8VAAAAAAAAAAAA'
        ];

        let unlocked = false;
        let lastError = null;

        for (const src of silentFormats) {
            try {
                const silent = new Audio();
                silent.src = src;
                silent.volume = 0.01; // Very quiet (for unlock trigger only)
                await silent.play(); // MUST await
                await new Promise(resolve => setTimeout(resolve, 10));
                silent.pause();
                silent.currentTime = 0;
                unlocked = true;
                break;
            } catch (err) {
                lastError = err;
                // Try next format
            }
        }

	        if (!unlocked) {
	            throw lastError || new Error('All audio formats failed');
	        }

	        audioUnlockedRef.current = true;
	        return true;
	    } catch (e) {
	        audioUnlockedRef.current = false;
	        return false;
	    }
	}, []);
	```

### State Management

| State | Type | Purpose |
|-------|------|---------|
| `audioUnlockedRef.current` | `boolean` (ref) | Tracks unlock status without re-renders |
| `notification` | `string \| null` | Shows user feedback messages |

---

## Unlock Methods

### 1. Mode Selection (Recommended)

Selecting a mode is an explicit user gesture that unlocks audio on mobile:

- **Play mode**: real GPS proximity tracking
- **Steps mode**: simulated arrivals via step buttons (no GPS)

### 2. Map Interaction (Seamless)

**Purpose**: Unlock audio transparently as users naturally interact with the map

**Supported Interactions:**
- `click` - Tapping the map
- `touchstart` - Touch devices
- `dragstart` - Panning the map
- `zoomstart` - Pinch-to-zoom or zoom controls

**Implementation**: [`QuestMap.tsx:1024-1051`](../src/components/QuestMap.tsx#L1024-L1051)

```typescript
useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleFirstTouch = async () => {
        if (!audioUnlockedRef.current) {
            const success = await unlockAudio();
            if (success) {
                setNotification('Audio attivato!');
                setTimeout(() => setNotification(null), 2000);
            }
        }
    };

    // Attach to all interaction types
    map.on('click', handleFirstTouch);
    map.on('touchstart', handleFirstTouch);
    map.on('dragstart', handleFirstTouch);
    map.on('zoomstart', handleFirstTouch);

    return () => {
        map.off('click', handleFirstTouch);
        map.off('touchstart', handleFirstTouch);
        map.off('dragstart', handleFirstTouch);
        map.off('zoomstart', handleFirstTouch);
    };
}, [unlockAudio]);
```

**User Experience:**
```
User pans map → Audio unlocks invisibly → "Audio attivato!" notification
```

### 3. Play Mode: GPS Toggle Button

**Button**: "Attiva Bussola" (top-right corner)

**Implementation**: [`QuestMap.tsx:595-620`](../src/components/QuestMap.tsx#L595-L620)

```typescript
const toggleGPS = async () => {
    // Unlock audio on first interaction
    await unlockAudio();

    // Continue with GPS toggle logic
    if (gpsEnabled) {
        setGpsEnabled(false);
        return;
    }
    // ...request permissions and enable GPS
};
```

### 4. Steps Mode: Step Buttons

In Steps mode, the **Next/Prev step** buttons act as the user gesture to unlock audio, and also trigger simulated arrivals (which in turn trigger audio effects).

---

## Audio Playback Flow

### Successful Unlock → Playback

```
1. User interacts (mode/map/GPS/steps)
2. unlockAudio() called
3. AudioContext unlocked ✓
4. HTML5 Audio unlocked ✓
5. Silent unlock audio plays ✓
6. audioUnlockedRef.current = true
7. Pending triggers (if any) flush ✓
8. User enters trigger zone / simulates arrival
9. playEffectAudio() or playAudio() called (depending on the audio type)
10. Audio plays automatically ✓
```

Notes:
- `playEffectAudio()` is used for **sound-only audio effects** (no streaming text tray).
- `playAudio()` is used for **narration** (streaming text tray).

### Failed Unlock → Retry

```
1. User interacts
2. unlockAudio() called
3. Browser blocks (NotAllowedError)
4. audioUnlockedRef.current = false
5. App shows a notification prompting another gesture
6. User tries again (mode/map/GPS/steps)
```

---

## Error Handling

### In `unlockAudio()`

```typescript
try {
    await silent.play();
    audioUnlockedRef.current = true;
    return true;
} catch (e) {
    console.error('[QuestMap] ❌ Audio unlock failed:', e);
    audioUnlockedRef.current = false;
    return false;
}
```

### In `playAudio()`

```typescript
// Check before playing
if (!audioUnlockedRef.current) {
    console.warn('[QuestMap] Audio trigger queued - Interaction required first');
    pendingNarrationAudioRef.current = payload; // queue so it plays immediately after unlock
    setNotification('Tocca Play/Steps o Attiva Bussola (o interagisci con la mappa) per attivare l\'audio');
    return;
}

// Handle playback failure
audio.play()
    .catch(e => {
        if (e.name === 'NotAllowedError' || e.name === 'NotSupportedError') {
            setNotification('Audio bloccato: tocca Play/Steps, Attiva Bussola o la mappa per abilitare l\'audio');
            audioUnlockedRef.current = false; // Mark as locked
        }
    });
```

### In `playEffectAudio()`

Sound-only effects follow the same unlock/queue pattern, but use a separate queue (`pendingEffectAudioRef`) and do not show streaming text.

---

## Browser Compatibility

### Why Dual Unlock?

Different audio APIs on different platforms:

| Platform | Web Audio API | HTML5 Audio | Requires Interaction |
|----------|---------------|-------------|----------------------|
| iOS Safari | ✅ | ✅ | YES |
| Android Chrome | ✅ | ✅ | YES |
| Desktop Chrome | ✅ | ✅ | NO (with user gesture) |
| Desktop Firefox | ✅ | ✅ | NO (with user gesture) |

**Solution**: Unlock both APIs to ensure compatibility

```typescript
// Web Audio API
const ctx = new AudioContext();
ctx.resume(); // Unlock

// HTML5 Audio
const audio = new Audio();
await audio.play(); // Unlock
```

### Multi-Format Fallback System

**Challenge**: Different browsers support different audio codecs. Some browsers may fail to decode certain base64 audio formats.

**Solution**: Try multiple silent audio formats in priority order:

1. **MP3** (0.1s silent) - Best compatibility across browsers
2. **WAV** (minimal silent) - Alternative for browsers with MP3 issues
3. **OGG** (minimal silent) - Fallback for Firefox and other browsers

```typescript
const silentFormats = [
    'data:audio/mp3;base64,...',  // Try MP3 first
    'data:audio/wav;base64,...',  // Fallback to WAV
    'data:audio/ogg;base64,...'   // Last resort: OGG
];

for (const src of silentFormats) {
    try {
        const silent = new Audio();
        silent.src = src;
        silent.volume = 0.01; // Very quiet (unlock trigger only)
        await silent.play();
        unlocked = true;
        break; // Success - stop trying
    } catch (err) {
        // Try next format
    }
}
```

**Why Multi-Format?**
- Prevents `NotSupportedError: Failed to load because no supported source was found`
- Ensures unlock works across all browsers (Chrome, Safari, Firefox, Edge)
- MP3 has highest success rate, WAV/OGG provide fallback coverage

**Important**: The 0.01 volume is ONLY for the silent unlock trigger. Actual quest audio plays at full volume (1.0).

### iOS Safari Specifics

**Challenge**: iOS requires user gesture AND awaited play promise

**Solution**:
```typescript
// ❌ Wrong (fire and forget)
silent.play().catch(() => {});

// ✅ Correct (await)
await silent.play();
```

**Why?**: iOS only grants permission if play() is part of the call stack from a user gesture handler.

---

## Testing

### Console Tests

After unlock, verify in console:

```javascript
// Test 1: Check unlock state
console.log('Audio unlocked:', audioUnlockedRef?.current); // Should be true

// Test 2: Manual audio test
new Audio('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3').play();
// Should play without error
```

### Expected Console Output

**Successful Unlock (MP3 format):**
```
[QuestMap] Attempting audio unlock...
[QuestMap] AudioContext unlocked
[QuestMap] HTML5 Audio unlocked with format: data:audio/mp3;base64...
[QuestMap] ✅ Audio fully unlocked and ready
```

**Successful Unlock (with format fallback):**
```
[QuestMap] Attempting audio unlock...
[QuestMap] AudioContext unlocked
[QuestMap] Format failed, trying next: data:audio/mp3;base64... NotSupportedError
[QuestMap] HTML5 Audio unlocked with format: data:audio/wav;base64...
[QuestMap] ✅ Audio fully unlocked and ready
```

**Failed Unlock:**
```
[QuestMap] Attempting audio unlock...
[QuestMap] ❌ Audio unlock failed: NotAllowedError
```

**Proximity Trigger:**
```
[QuestMap] Entering zone for Casa della Stria
[QuestMap] Creating audio element for: https://cdn.example.com/witch-laugh.mp3
[QuestMap] Audio loaded successfully: Casa della Stria
[QuestMap] Audio playing: Casa della Stria
```

---

## Common Issues

### Issue 1: Audio Never Unlocks

**Symptoms**: "Audio attivato!" never appears; console shows `NotAllowedError`.

**Debug**:
```text
[QuestMap] ❌ Audio unlock failed: NotAllowedError
```

**Solutions**:
- Tap `Play mode` / `Steps mode` again (must be a real user gesture)
- Interact with the map (tap/drag/zoom) and retry
- In Play mode, tap `Attiva Bussola` (also a user gesture)

### Issue 2: Audio Plays Then Stops

**Symptoms**: Audio starts but immediately stops

**Cause**: GPS jitter triggers rapid zone exits (looped effects stop on exit)

**Debug**:
```javascript
[QuestMap] Entering zone for Kitchen
[QuestMap] Audio playing: Kitchen
[QuestMap] Exiting zone for Kitchen  // ← Too fast
```

**Solutions**:
- Increase `triggerRadius` (try 25-30m)
- Check GPS accuracy
- Walk slower through zone

### Issue 3: Format Decoding Error

**Symptoms**: Audio unlock fails with `NotSupportedError`

**Cause**: Browser cannot decode the audio format being tried

**Debug**:
```javascript
[QuestMap] ❌ Audio unlock failed: NotSupportedError: Failed to load because no supported source was found.
```

**Solution**: The multi-format fallback system handles this automatically. If you see this error:
- Check that all three formats (MP3, WAV, OGG) are defined in `silentFormats` array
- Verify base64 data is not corrupted
- Try a different browser to isolate browser-specific issues
- Check console for format fallback logs showing which formats were attempted

**Note**: This error should be rare with the multi-format system, as MP3 is widely supported.

### Issue 4: Multiple Unlocks

**Symptoms**: Unlock called multiple times

**Cause**: Multiple interaction handlers firing

**Debug**:
```javascript
[QuestMap] Attempting audio unlock...  // From map click
[QuestMap] ✅ Audio fully unlocked and ready
[QuestMap] Attempting audio unlock...  // From GPS toggle
[QuestMap] ✅ Audio fully unlocked and ready  // Early return
```

**Note**: This is **normal** - `unlockAudio()` has early return if already unlocked:
```typescript
if (audioUnlockedRef.current) {
    return true; // Already unlocked - no-op
}
```

**Also important**: A single tap can sometimes trigger **multiple handlers while still locked** (e.g., a UI button click plus a Leaflet map `click/touchstart`). `QuestMap` guards against this with an **in-flight unlock promise**, so only one unlock attempt runs at a time.

---

## Performance Considerations

### Why Use Ref Instead of State?

```typescript
// ❌ Using state causes re-renders
const [audioUnlocked, setAudioUnlocked] = useState(false);

// ✅ Using ref avoids re-renders
const audioUnlockedRef = useRef(false);
```

**Impact**:
- Refs don't trigger React re-renders
- Critical for performance during GPS tracking (updates every second)
- Map doesn't re-mount when unlock state changes

---

## Integration Guide

### Adding New Unlock Trigger

To add a new unlock trigger (e.g., custom button):

```typescript
// 1. Import or access unlockAudio
const unlockAudio = /* ... from component scope ... */;

// 2. Call on user interaction
const handleCustomButton = async () => {
    const success = await unlockAudio();
    if (success) {
        // Show success feedback
        setNotification('Audio attivato!');
        setTimeout(() => setNotification(null), 2000);
    } else {
        // Show error feedback
        setNotification('Impossibile attivare audio');
    }
};

// 3. Attach to button
<button onClick={handleCustomButton}>Unlock Audio</button>
```

### Checking Unlock State

```typescript
// Before playing audio
if (!audioUnlockedRef.current) {
    pendingAudioRef.current = payload;
    setNotification('Tocca Play/Steps o Attiva Bussola (o interagisci con la mappa) per attivare l\'audio');
    return;
}
```

---

## Related Files

- **Main Implementation**: [`src/components/QuestMap.tsx`](../src/components/QuestMap.tsx)
- **Proximity Tracker**: [`src/hooks/useProximityTracker.ts`](../src/hooks/useProximityTracker.ts)
- **Configuration Guide**: [`docs/AUDIO_EFFECTS.md`](./AUDIO_EFFECTS.md)
- **Troubleshooting**: [`docs/AUDIO_TRIGGER_FIX.md`](./AUDIO_TRIGGER_FIX.md)

---

**Last Updated**: 2025-12-19
**Version**: 2.1 (Multi-format fallback system)
**Status**: ✅ Production Ready
