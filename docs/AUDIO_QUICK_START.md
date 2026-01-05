# Audio Features - Quick Start Guide

## For Users

### How to Enable Audio

When you open the quest map, choose a mode from the top bar. **Selecting a mode unlocks audio** (mobile browsers require a user gesture).

You can enable audio by:

1. **Clicking `Play mode` or `Steps mode`** (recommended)
2. **Touching/panning/zooming the map** (automatic)
3. In **Play mode**, clicking **`Attiva Bussola`** (GPS button)

Once enabled:
- You'll see "Audio attivato!" notification
- Audio will play automatically when you approach quest objects

---

## For Developers

### Quick Implementation Checklist

#### 1. Add Audio to Quest Objects

```json
{
  "id": "church",
  "name": "Chiesa di San Vittore",
  "coordinates": "46.0154, 9.3456",
  "audio_effect": {
    "enabled": true,
    "name": "Church Bells",
    "media_url": "https://cdn.example.com/bells.mp3",
    "triggerRadius": 20
  }
}
```

#### 2. Test Audio Unlock

**Open browser console after clicking unlock:**
```
✅ Expected output:
[QuestMap] Attempting audio unlock...
[QuestMap] AudioContext unlocked
[QuestMap] HTML5 Audio unlocked with format: data:audio/mp3;base64...
[QuestMap] ✅ Audio fully unlocked and ready
```

**Alternative output (with format fallback):**
```
[QuestMap] Attempting audio unlock...
[QuestMap] AudioContext unlocked
[QuestMap] Format failed, trying next: data:audio/mp3;base64... NotSupportedError
[QuestMap] HTML5 Audio unlocked with format: data:audio/wav;base64...
[QuestMap] ✅ Audio fully unlocked and ready
```

#### 3. Test Proximity Trigger

**Walk near object (within triggerRadius), check console:**
```
✅ Expected output:
[QuestMap] Entering zone for Chiesa di San Vittore
[QuestMap] Creating audio element for: https://cdn.example.com/bells.mp3
[QuestMap] Audio loaded successfully: Chiesa di San Vittore
[QuestMap] Audio playing: Chiesa di San Vittore
```

---

## Common Issues

| Problem | Solution |
|---------|----------|
| Audio doesn't play | 1. Click `Play mode` / `Steps mode`<br>2. (Play mode) Enable GPS (`Attiva Bussola`)<br>3. Walk closer (check triggerRadius) |
| Audio plays then stops | Increase triggerRadius (GPS jitter causing zone exit) |
| "No audio URL found" | Add `audio_effect.media_url` to object in quest.json |
| NotSupportedError | Multi-format fallback handles this. Check console for format logs. |

---

## Key Files

| File | Purpose |
|------|---------|
| [`QuestMap.tsx:307-356`](../src/components/QuestMap.tsx#L307-L356) | `unlockAudio()` function |
| [`QuestMap.tsx`](../src/components/QuestMap.tsx) | Mode selection (Play/Steps) + unlock triggers |
| [`useProximityTracker.ts`](../src/hooks/useProximityTracker.ts) | Proximity detection hook |

---

## Configuration Examples

### Simple Audio (Legacy Format)
```json
{
  "audioUrl": "https://cdn.example.com/sound.mp3",
  "triggerRadius": 20
}
```

### Advanced Audio (Structured Format)
```json
{
  "audio_effect": {
    "enabled": true,
    "name": "Waterfall Ambience",
    "media_url": "https://cdn.example.com/waterfall.mp3",
    "triggerRadius": 30,
    "loop": true,
    "volume": 60
  }
}
```

### No Audio (Silent Object)
```json
{
  "id": "landmark",
  "name": "Monument"
  // No audio properties - works fine
}
```

---

## Testing Checklist

- [ ] Selecting `Play mode` / `Steps mode` unlocks audio ("Audio attivato!")
- [ ] Map interactions also unlock audio
- [ ] `Play mode` shows `Attiva Bussola` (`data-testid="gps-toggle"`) and starts real GPS tracking
- [ ] `Steps mode` hides the GPS button; `Next step` / `Prev step` simulate arrivals
- [ ] Proximity (Play) / simulated arrival (Steps) triggers `audio_effect` playback
- [ ] Multi-format silent unlock fallback works (MP3 → WAV/OGG)

---

## Further Reading

- **Complete Guide**: [AUDIO_EFFECTS.md](./AUDIO_EFFECTS.md)
- **Technical Details**: [AUDIO_UNLOCK_SYSTEM.md](./AUDIO_UNLOCK_SYSTEM.md)
- **Troubleshooting**: [AUDIO_TRIGGER_FIX.md](./AUDIO_TRIGGER_FIX.md)

---

**Quick Tip**: Always test on **actual mobile devices** (iOS Safari + Android Chrome), not just desktop browsers!
