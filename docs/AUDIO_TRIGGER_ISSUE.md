# Audio Trigger Issue Analysis

## Problem Statement

Audio fails to play when users approach objects with configured audio URLs in the QuestMap component, despite having an audio unlock mechanism and trigger logic in place.

## Current Implementation

### Audio Unlock Mechanism (Lines 387-410)

```typescript
const toggleGPS = async () => {
    // Unlock audio on first interaction using AudioContext (more robust)
    if (!audioUnlockedRef.current) {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass) {
                const ctx = new AudioContextClass();
                const buffer = ctx.createBuffer(1, 1, 22050);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.start(0);

                // Also try the HTML5 Audio element method as backup/complement
                const silent = new Audio();
                silent.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAGZGF0YQQAAAAAAA==';
                silent.play().catch(() => { });

                audioUnlockedRef.current = true;
                console.log('[QuestMap] Audio engine unlocked via AudioContext');
            }
        } catch (e) {
            console.warn('[QuestMap] Audio unlock failed:', e);
        }
    }
    // ... GPS enable logic
}
```

**Purpose**: Unlock audio playback by creating a silent AudioContext on user interaction (GPS button click).

### Audio Trigger Logic (Lines 486-520)

```typescript
// Audio Trigger Logic
const images = normalizeObjectImages(obj);
const allAudio = images.flatMap(img => img.audioUrls);
const directAudio = normalizeAudioUrls((obj as any).audioUrl || (obj as any).audio_url);
const audioToPlay = [...directAudio, ...allAudio][0];

if (audioToPlay) {
    try {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }

        // Check if unlocked
        if (!audioUnlockedRef.current) {
            console.warn('[QuestMap] Audio trigger ignored - Interaction required first');
            setNotification('Tocca la mappa per attivare l\'audio');
        } else {
            const audio = new Audio(audioToPlay);
            audioRef.current = audio;
            audio.play().catch(e => {
                console.warn('Audio play failed:', e);
                // If error is NotAllowedError, we still need user interaction
                if (e.name === 'NotAllowedError' || e.name === 'NotSupportedError') {
                    setNotification('Tocca per abilitare l\'audio');
                    audioUnlockedRef.current = false;
                }
            });
        }
    } catch (err) {
        console.error('Error triggering audio:', err);
    }
} else {
    console.log(`[QuestMap] No audio URL found for ${obj.name}`);
}
```

**Trigger**: When user enters object's `triggerRadius` zone (proximity check in lines 475-523).

## Root Causes

### 1. **Audio Data Source Issues**

The audio URL extraction tries multiple sources but may not match the actual backend data structure:

```typescript
const directAudio = normalizeAudioUrls(
    (obj as any).audioUrl ||     // Tries audioUrl
    (obj as any).audio_url       // Tries audio_url
);
```

**Problem**: The TypeScript interface `QuestObject` doesn't include `audioUrl` or `audio_url` at the object level - only within image objects.

**From `types/quest.ts`:**
```typescript
export interface QuestObject {
    id: string;
    name: string;
    // ... other fields
    images: Array<
        | string
        | {
              url: string;
              thumbnailUrl?: string;
              audioUrl?: string | null;    // ← Only here
              audioUrls?: string[];         // ← Only here
              title?: string;
          }
    >;
    // NO audioUrl or audio_url at object level
}
```

### 2. **Missing Object-Level Audio Support**

Based on the code at line 489, the component expects objects to have direct `audioUrl` or `audio_url` properties, but:

- **Type definition doesn't include them**
- **Backend may not be storing them at object level**
- **Only image-level audio is properly typed**

### 3. **Browser Autoplay Restrictions**

Even with AudioContext unlock, modern browsers have strict autoplay policies:

#### iOS Safari:
- ✅ AudioContext unlock via user gesture
- ❌ May still block Audio() playback without direct user interaction
- ❌ `play()` on proximity detection (no direct user action) often fails

#### Chrome/Android:
- ✅ AudioContext unlock usually works
- ⚠️ May block if audio is long or has no prior interaction with Audio element
- ⚠️ Autoplay Policy: https://developer.chrome.com/blog/autoplay/

#### Firefox:
- ✅ More permissive
- ⚠️ Still blocks high-frequency autoplay attempts

### 4. **Timing Issue with AudioContext vs Audio Element**

The unlock creates an AudioContext and plays silent audio, but:

```typescript
const ctx = new AudioContext();  // Web Audio API
// ... later ...
const audio = new Audio(url);     // HTML5 Audio API
```

**Problem**: These are **different APIs**. Unlocking AudioContext doesn't guarantee HTML5 Audio element playback will work.

### 5. **Notification Overwrites**

When audio fails, the notification is set:

```typescript
setNotification('Tocca per abilitare l\'audio');
```

But then immediately at line 522:

```typescript
setTimeout(() => setNotification(null), 4000);
```

This timeout was set for the "Hai raggiunto..." notification (line 479) and will clear the audio notification prematurely.

### 6. **No Persistent Audio Preloading**

Audio is created fresh on every trigger:

```typescript
const audio = new Audio(audioToPlay);
audio.play();
```

**Issue**: No preloading, caching, or warming up of Audio elements during unlock phase.

## Debugging Steps

### Check Console Logs

Look for these messages:

1. **On GPS button click:**
   ```
   [QuestMap] Audio engine unlocked via AudioContext
   ```
   ✅ If present: Unlock succeeded
   ❌ If missing: Unlock failed (check browser support)

2. **On zone entry:**
   ```
   [QuestMap] Audio trigger ignored - Interaction required first
   ```
   ❌ Means `audioUnlockedRef.current` is false

3. **On audio play attempt:**
   ```
   Audio play failed: NotAllowedError: play() failed...
   ```
   ❌ Browser blocked playback despite unlock

4. **No audio URL:**
   ```
   [QuestMap] No audio URL found for {objectName}
   ```
   ❌ Audio data not present on object

### Inspect Object Data

Check what the actual object structure looks like:

```javascript
// In browser console after entering zone:
console.log(data.objects.find(o => o.id === 'YOUR_OBJECT_ID'));
```

Look for:
- `obj.audioUrl` or `obj.audio_url` (direct property)
- `obj.images[*].audioUrl` (within images)
- `obj.images[*].audioUrls` (array within images)

### Test Audio Unlock

In browser console after clicking GPS button:

```javascript
const testAudio = new Audio('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
testAudio.play().then(() => {
    console.log('✅ Audio unlocked successfully');
}).catch(e => {
    console.error('❌ Audio still blocked:', e);
});
```

## Solutions

### Solution 1: Add Object-Level Audio to TypeScript Interface

**File:** `src/types/quest.ts`

```typescript
export interface QuestObject {
    id: string;
    name: string;
    description: string;
    isMain?: boolean;
    coordinates: {
        lat: number;
        lng: number;
    } | string;
    images: Array<...>;
    status: string;
    createdAt: string;
    unlocksPuzzleId?: string;
    pulsating_effect?: PulsatingEffect;
    triggerRadius?: number;

    // ADD THESE:
    audioUrl?: string | null;        // Single audio URL
    audio_url?: string | null;       // Snake_case variant (backend compatibility)
    audioUrls?: string[];            // Multiple audio URLs
}
```

### Solution 2: Fix Audio Unlock to Include HTML5 Audio

**File:** `src/components/QuestMap.tsx` (line 387)

```typescript
const toggleGPS = async () => {
    // Unlock BOTH AudioContext AND HTML5 Audio
    if (!audioUnlockedRef.current) {
        try {
            // 1. AudioContext unlock
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass) {
                const ctx = new AudioContextClass();
                const buffer = ctx.createBuffer(1, 1, 22050);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.start(0);
            }

            // 2. HTML5 Audio unlock with preload
            const silent = new Audio();
            silent.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAGZGF0YQQAAAAAAA==';
            await silent.play();  // IMPORTANT: await the promise

            // 3. Preload actual audio if available
            const firstObjectWithAudio = data?.objects.find(obj => {
                const images = normalizeObjectImages(obj);
                const allAudio = images.flatMap(img => img.audioUrls);
                const directAudio = normalizeAudioUrls((obj as any).audioUrl || (obj as any).audio_url);
                return [...directAudio, ...allAudio].length > 0;
            });

            if (firstObjectWithAudio) {
                const images = normalizeObjectImages(firstObjectWithAudio);
                const allAudio = images.flatMap(img => img.audioUrls);
                const directAudio = normalizeAudioUrls((firstObjectWithAudio as any).audioUrl);
                const firstAudio = [...directAudio, ...allAudio][0];

                if (firstAudio) {
                    const preloadAudio = new Audio(firstAudio);
                    preloadAudio.preload = 'auto';
                    preloadAudio.volume = 0;
                    await preloadAudio.play();
                    preloadAudio.pause();
                    console.log('[QuestMap] Audio preloaded:', firstAudio);
                }
            }

            audioUnlockedRef.current = true;
            console.log('[QuestMap] Audio engine fully unlocked');
        } catch (e) {
            console.warn('[QuestMap] Audio unlock failed:', e);
            // Don't set audioUnlockedRef to true if unlock failed
        }
    }

    // ... rest of GPS enable logic
}
```

### Solution 3: Fix Notification Timing Conflict

**File:** `src/components/QuestMap.tsx` (line 479)

```typescript
if (!triggeredObjects.has(obj.id)) {
    setNotification(`Hai raggiunto ${obj.name}`);
    setTriggeredObjects(prev => {
        const next = new Set(prev);
        next.add(obj.id);
        return next;
    });

    // Audio Trigger Logic
    const images = normalizeObjectImages(obj);
    const allAudio = images.flatMap(img => img.audioUrls);
    const directAudio = normalizeAudioUrls((obj as any).audioUrl || (obj as any).audio_url);
    const audioToPlay = [...directAudio, ...allAudio][0];

    if (audioToPlay) {
        try {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }

            if (!audioUnlockedRef.current) {
                console.warn('[QuestMap] Audio trigger ignored - Interaction required first');
                setNotification('Tocca il pulsante bussola per attivare l\'audio');
                // Don't clear this notification automatically
                return; // Exit early
            } else {
                const audio = new Audio(audioToPlay);
                audioRef.current = audio;
                audio.play().catch(e => {
                    console.warn('Audio play failed:', e);
                    if (e.name === 'NotAllowedError' || e.name === 'NotSupportedError') {
                        setNotification('Tocca il pulsante bussola per abilitare l\'audio');
                        audioUnlockedRef.current = false;
                        return; // Exit early, don't auto-clear
                    }
                });
                console.log('[QuestMap] Playing audio:', audioToPlay);
            }
        } catch (err) {
            console.error('Error triggering audio:', err);
        }
    } else {
        console.log(`[QuestMap] No audio URL found for ${obj.name}`);
    }

    // Only clear "Hai raggiunto" notification
    setTimeout(() => {
        setNotification(prev => {
            // Only clear if it's still the "reached" message
            if (prev === `Hai raggiunto ${obj.name}`) {
                return null;
            }
            return prev;
        });
    }, 4000);
}
```

### Solution 4: Add Audio Pool for Better Preloading

**File:** `src/components/QuestMap.tsx` (add ref)

```typescript
const audioPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map());
```

**Then modify toggle GPS:**

```typescript
// After unlock, preload all audio
if (data?.objects) {
    data.objects.forEach(obj => {
        const images = normalizeObjectImages(obj);
        const allAudio = images.flatMap(img => img.audioUrls);
        const directAudio = normalizeAudioUrls((obj as any).audioUrl || (obj as any).audio_url);
        const audioUrls = [...directAudio, ...allAudio];

        audioUrls.forEach(url => {
            if (!audioPoolRef.current.has(url)) {
                const audio = new Audio(url);
                audio.preload = 'auto';
                audioPoolRef.current.set(url, audio);
            }
        });
    });
}
```

**Then modify trigger:**

```typescript
// Use pooled audio instead of creating new
const audio = audioPoolRef.current.get(audioToPlay);
if (audio) {
    audio.currentTime = 0;
    audio.play().catch(e => {
        console.warn('Audio play failed:', e);
    });
} else {
    // Fallback if not in pool
    const newAudio = new Audio(audioToPlay);
    audioRef.current = newAudio;
    newAudio.play().catch(e => console.warn('Audio play failed:', e));
}
```

### Solution 5: Add User Gesture Fallback

For iOS/Safari, add a manual play button:

```typescript
const [showAudioPrompt, setShowAudioPrompt] = useState(false);

// In trigger logic, if play fails:
if (e.name === 'NotAllowedError') {
    setShowAudioPrompt(true);
}

// In JSX, render:
{showAudioPrompt && (
    <button
        onClick={() => {
            const audio = new Audio(audioToPlay);
            audio.play().then(() => {
                setShowAudioPrompt(false);
                audioUnlockedRef.current = true;
            });
        }}
        style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 9999,
            padding: '20px',
            background: COLORS.burgundy,
            color: COLORS.gold,
            border: `2px solid ${COLORS.gold}`,
            cursor: 'pointer'
        }}
    >
        🔊 Tocca per Ascoltare
    </button>
)}
```

## Testing Checklist

- [ ] Add `console.log` for object audio data on zone entry
- [ ] Verify `audioUnlockedRef.current` is true after GPS click
- [ ] Check browser console for "NotAllowedError"
- [ ] Test on iOS Safari specifically (most restrictive)
- [ ] Test on Android Chrome
- [ ] Verify audio URL is correct (try opening in browser)
- [ ] Check network tab for audio file loading
- [ ] Test with shorter audio files (< 5 seconds)
- [ ] Try with different audio formats (mp3, ogg, wav)

## Backend Data Verification

Check if objects in backend have audio stored correctly:

```bash
# Example: Check object structure in DynamoDB
aws dynamodb get-item \
  --table-name quest-objects \
  --key '{"id": {"S": "YOUR_OBJECT_ID"}}'
```

Expected structure should include:
```json
{
  "id": "obj123",
  "name": "Location Name",
  "audioUrl": "https://example.com/audio.mp3",  // ← Check this
  "images": [
    {
      "url": "https://example.com/image.jpg",
      "audioUrls": ["https://example.com/image-audio.mp3"]  // ← Or this
    }
  ]
}
```

## Recommended Implementation Order

1. **First**: Add console logging to see actual data structure
2. **Second**: Fix TypeScript interface if needed
3. **Third**: Improve audio unlock with await and preload
4. **Fourth**: Fix notification timing
5. **Fifth**: Add audio pool if needed
6. **Sixth**: Add manual play button fallback for iOS

## Related Files

- `src/components/QuestMap.tsx` - Main implementation
- `src/types/quest.ts` - Type definitions
- Backend: Object storage (DynamoDB or similar)

---

**Status**: Analysis Complete - Implementation Needed
**Priority**: HIGH - Core feature not working
**Estimated Effort**: 2-4 hours
**Last Updated**: 2025-12-16
