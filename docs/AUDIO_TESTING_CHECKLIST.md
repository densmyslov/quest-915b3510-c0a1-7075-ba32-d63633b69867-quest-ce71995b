# Audio Testing Checklist

> Manual tests to run before each release

**Last Run**: ___________
**Tester**: ___________
**Build/Version**: ___________
**Branch**: ___________

---

## Quick Reference

- **Test Duration**: ~30 minutes
- **Devices Needed**: Desktop + iOS device + Android device
- **Prerequisites**: Quest with audio objects configured

---

## Desktop Testing

### Chrome (Latest)

#### Audio Unlock ✅

- [ ] Open quest map and select `Play mode` or `Steps mode`
- [ ] Console shows: `[QuestMap] ✅ Audio fully unlocked and ready`
- [ ] Notification shows: "Audio attivato!"
- [ ] Notification auto-dismisses after 2 seconds

#### Map Interaction Unlock ✅

- [ ] Map click unlocks audio
- [ ] Map drag unlocks audio
- [ ] Map zoom (scroll/buttons) unlocks audio
- [ ] Each shows unlock notification

#### Console Unlock Test ✅

After unlock, run in browser console:
```javascript
new Audio('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3').play()
```

Expected:
- [ ] Audio plays without error
- [ ] No `NotAllowedError` in console
- [ ] Promise resolves successfully

#### Proximity Trigger ✅

- [ ] Select `Play mode`
- [ ] Enable GPS (click "Attiva Bussola")
- [ ] Simulate location within trigger radius (use browser DevTools)
- [ ] Console shows: `[QuestMap] Entering zone for [ObjectName]`
- [ ] Console shows: `[QuestMap] Preparing audio element for: [URL]`
- [ ] Console shows: `[QuestMap] Audio playing: [ObjectName]`
- [ ] Audio plays automatically
- [ ] Simulate moving out of zone (change location in DevTools)
- [ ] Console shows: `[QuestMap] Exiting zone for [ObjectName]`
- [ ] (Looped effects) audio stops playing
- [ ] Simulate re-entering zone
- [ ] Audio plays again (re-trigger works)

#### Console Output Verification ✅

Expected console sequence:
```
[QuestMap] Attempting audio unlock...
[QuestMap] AudioContext unlocked
[QuestMap] HTML5 Audio unlocked with format: data:audio/mp3;base64...
[QuestMap] ✅ Audio fully unlocked and ready
```

Or with format fallback:
```
[QuestMap] Attempting audio unlock...
[QuestMap] AudioContext unlocked
[QuestMap] Format failed, trying next: data:audio/mp3;base64... NotSupportedError
[QuestMap] HTML5 Audio unlocked with format: data:audio/wav;base64...
[QuestMap] ✅ Audio fully unlocked and ready
```

---

### Firefox (Latest)

Repeat all Chrome tests:

- [ ] Mode selection unlocks audio
- [ ] Map interactions unlock audio
- [ ] Proximity triggers work correctly
- [ ] Console logs are correct
- [ ] No Firefox-specific errors

**Notes**: ___________________________________________

---

### Safari (Latest)

Repeat all Chrome tests:

- [ ] Mode selection unlocks audio
- [ ] Map interactions unlock audio
- [ ] Proximity triggers work correctly
- [ ] Console logs are correct
- [ ] No Safari-specific errors

**Notes**: ___________________________________________

---

## Mobile Testing

### iOS Safari (Real Device Required)

**Device**: ___________
**iOS Version**: ___________

#### Audio Unlock ✅

- [ ] Open quest map in Safari
- [ ] Tap `Play mode` or `Steps mode`
- [ ] "Audio attivato!" notification shows
- [ ] Test alternative: Tap "Attiva Bussola" (GPS button)
- [ ] Audio unlocks via GPS button
- [ ] Test alternative: Tap/drag map
- [ ] Audio unlocks via map interaction

#### Proximity Trigger (Real Location) ✅

**Important**: Use a real quest with configured audio objects

- [ ] Enable GPS location services (Settings → Safari → Location)
- [ ] Tap "Attiva Bussola" to enable GPS tracking
- [ ] Walk to real location with quest object
- [ ] Verify distance shown in GPS panel
- [ ] Audio plays automatically when within trigger radius
- [ ] Notification shown: "Hai raggiunto [ObjectName]"
- [ ] Walk away from object
- [ ] Audio stops when outside trigger radius
- [ ] Walk back to object
- [ ] Audio plays again (re-trigger confirmed)

#### Safari Web Inspector (Mac Required) ✅

Connect device to Mac, enable Web Inspector:

1. iPhone: Settings → Safari → Advanced → Web Inspector (ON)
2. Mac: Safari → Develop → [Your iPhone] → [Page]

Console logs to verify:
```
[QuestMap] Attempting audio unlock...
[QuestMap] AudioContext unlocked
[QuestMap] HTML5 Audio unlocked with format: data:audio/___
[QuestMap] ✅ Audio fully unlocked and ready
[QuestMap] Entering zone for [Object]
[QuestMap] Audio playing: [Object]
```

- [ ] Console shows correct unlock sequence
- [ ] No `NotAllowedError` errors
- [ ] No `NotSupportedError` errors (or shows format fallback)
- [ ] Proximity logs show correct object names
- [ ] Distance values are reasonable

#### Performance ✅

- [ ] Battery usage < 5% per hour with GPS on
- [ ] App remains responsive during audio playback
- [ ] No UI freezing or lag
- [ ] Map interactions smooth
- [ ] Audio plays without stuttering

**Battery Test**:
- Starting battery: ___________%
- After 1 hour: ___________%
- Drain: ___________%

---

### Android Chrome (Real Device Required)

**Device**: ___________
**Android Version**: ___________
**Chrome Version**: ___________

Repeat all iOS Safari tests:

- [ ] Mode selection unlocks audio
- [ ] GPS button unlocks audio
- [ ] Map interactions unlock audio
- [ ] Proximity triggers work on real location
- [ ] Audio plays within trigger radius
- [ ] (Looped effects) audio stops when leaving zone
- [ ] Re-entry triggers audio again
- [ ] Battery usage acceptable (< 5% per hour)
- [ ] Performance smooth

#### Chrome DevTools Remote Debugging ✅

Connect via USB, enable Developer Options:

1. Android: Settings → About → Tap "Build number" 7 times
2. Settings → Developer Options → USB Debugging (ON)
3. Connect to PC via USB
4. Chrome: chrome://inspect → Devices

Console verification:
- [ ] Unlock logs correct
- [ ] Proximity logs show
- [ ] No errors in console
- [ ] Format fallback works if needed

**Notes**: ___________________________________________

---

## Edge Cases Testing

### GPS Accuracy Edge Cases

#### Standard Trigger Radius (20m)

- [ ] GPS accuracy shown in UI (check "Precisione" value)
- [ ] Trigger radius = 20m works reliably
- [ ] Audio triggers at expected distance
- [ ] No premature triggering

#### Poor GPS Environment

Test in urban canyon, indoors, or poor GPS area:

- [ ] GPS accuracy > 20m shown
- [ ] Increase trigger radius to 30m in quest config
- [ ] Audio still triggers reliably
- [ ] No false negatives

**GPS Accuracy Reading**: ___________ meters

---

### Rapid Zone Entry/Exit

- [ ] Walk into zone quickly
- [ ] Walk out of zone immediately (< 2 seconds)
- [ ] Walk back into zone quickly
- [ ] Audio plays smoothly without errors
- [ ] Console shows NO error: `"interrupted by a call to pause()"`
- [ ] Debounce prevents multiple triggers (1 second)

**✅ Pass** / **❌ Fail**

**Notes**: ___________________________________________

---

### Multiple Objects

**Setup**: Two or more objects within 100m of each other

- [ ] Start near Object A
- [ ] Audio A plays
- [ ] Move to Object B (leave A's radius)
- [ ] (Looped effects) Audio A stops
- [ ] Audio B plays
- [ ] Correct audio plays for each object
- [ ] No audio overlap/mixing
- [ ] No interference between objects

**Objects Tested**: ___________________________________________

---

### Network Issues

#### Slow Connection

Set browser to simulate 3G:
- Chrome DevTools → Network → Throttling → Slow 3G

Tests:
- [ ] Audio file loads within 5 seconds
- [ ] Loading state shown (if implemented)
- [ ] No timeout errors
- [ ] Graceful retry on failure

#### Offline → Online

- [ ] Enable airplane mode
- [ ] Try to trigger audio
- [ ] Appropriate error shown
- [ ] Disable airplane mode
- [ ] Audio loads and plays correctly

---

### Browser Lifecycle

#### Page Refresh

- [ ] Audio playing
- [ ] Refresh page (Cmd+R / F5)
- [ ] Audio state resets
- [ ] Can unlock again via `Play mode` / `Steps mode`
- [ ] No errors in console

#### Background → Foreground

Mobile only:
- [ ] Audio playing
- [ ] Switch to different app
- [ ] Return to browser
- [ ] Audio state handled correctly
- [ ] GPS tracking resumes if needed

---

### Invalid/Missing Audio

#### Invalid Audio URL (404)

**Setup**: Object with `audioUrl: "https://example.com/404.mp3"`

- [ ] Approach object
- [ ] Console shows: `[QuestMap] Audio ERROR for [Object]: Failed to load because no supported source was found`
- [ ] Notification shown to user (optional)
- [ ] App doesn't crash or hang
- [ ] Other objects still work

#### Missing Audio URL

**Setup**: Object without any audio properties

- [ ] Approach object
- [ ] No error in console
- [ ] No audio plays (expected behavior)
- [ ] No crash or warnings
- [ ] Object still shows on map
- [ ] Other functionality works

---

### Audio Format Testing

#### Structured Format (audio_effect)

**Setup**: Object with `audio_effect` configuration

```json
{
  "audio_effect": {
    "enabled": true,
    "name": "Test",
    "media_url": "https://example.com/audio.mp3",
    "triggerRadius": 20
  }
}
```

- [ ] Audio plays from `media_url`
- [ ] Trigger radius respected
- [ ] Console shows correct URL

#### Legacy Format (audioUrl)

**Setup**: Object with `audioUrl` field

```json
{
  "audioUrl": "https://example.com/audio.mp3",
  "triggerRadius": 20
}
```

- [ ] Audio plays from `audioUrl`
- [ ] Works identically to structured format

#### Underscore Format (audio_url)

**Setup**: Object with `audio_url` field

```json
{
  "audio_url": "https://example.com/audio.mp3",
  "triggerRadius": 20
}
```

- [ ] Audio plays from `audio_url`
- [ ] Fallback works correctly

#### Image Audio

**Setup**: Object with audio in images array

```json
{
  "images": [
    {
      "audioUrl": "https://example.com/audio.mp3"
    }
  ],
  "triggerRadius": 20
}
```

- [ ] Audio plays from image `audioUrl`
- [ ] Last resort fallback works

#### Disabled Audio Effect

**Setup**: Object with `enabled: false`

```json
{
  "audio_effect": {
    "enabled": false,
    "media_url": "https://example.com/should-not-play.mp3"
  },
  "audioUrl": "https://example.com/fallback.mp3"
}
```

- [ ] Does NOT play `media_url` (disabled)
- [ ] Plays `audioUrl` (fallback)
- [ ] Priority logic works correctly

---

## Performance Testing

### Memory Leaks (Chrome DevTools)

1. Open Performance Monitor: DevTools → More Tools → Performance Monitor
2. Let app run for 5 minutes with GPS enabled
3. Trigger audio multiple times (enter/exit zones)
4. Monitor memory usage

Checks:
- [ ] Memory usage < 100MB total
- [ ] No continuous memory growth over time
- [ ] Memory stable after 5 minutes
- [ ] Garbage collection working

**Initial Memory**: ___________ MB
**After 5 minutes**: ___________ MB
**Memory Growth**: ___________ MB

---

### Audio Loading Performance

- [ ] Audio files load within 3 seconds
- [ ] No blocking of UI during load
- [ ] Smooth playback start (no delay)
- [ ] Network tab shows efficient loading

**Average Load Time**: ___________ seconds

---

### UI Responsiveness

During audio playback:
- [ ] Map interactions remain smooth (pan, zoom)
- [ ] No lag when entering zones
- [ ] Button clicks responsive
- [ ] Animations smooth (60 FPS)
- [ ] No jank or stuttering

---

## Accessibility Testing

### Screen Readers

**iOS VoiceOver**:
- [ ] Enable VoiceOver (Settings → Accessibility)
- [ ] Mode buttons have clear labels
- [ ] Mode selection announced
- [ ] Notification announced to screen reader
- [ ] GPS toggle announced

**Android TalkBack**:
- [ ] Enable TalkBack (Settings → Accessibility)
- [ ] Same tests as iOS VoiceOver

---

### Keyboard Navigation (Desktop)

- [ ] Tab to `Play mode` / `Steps mode`
- [ ] Focus visible (outline shown)
- [ ] Enter or Space activates mode selection
- [ ] Tab to GPS toggle
- [ ] Keyboard controls work for all interactive elements

---

## Regression Testing

### Recent Fixes Verification

#### Multi-Format Fallback (v2.1)

Test that format fallback works:

Mock test in console:
```javascript
// Override Audio to fail MP3
const OriginalAudio = window.Audio;
window.Audio = function(src) {
  const audio = new OriginalAudio(src);
  const originalPlay = audio.play;
  audio.play = function() {
    if (src.includes('audio/mp3')) {
      return Promise.reject(new Error('NotSupportedError'));
    }
    return originalPlay.call(this);
  };
  return audio;
};
```

Then unlock audio:
- [ ] Console shows: `Format failed, trying next`
- [ ] WAV format attempted
- [ ] Unlock succeeds with fallback

---

#### Race Condition Fix (v2.0)

**Issue**: "interrupted by a call to pause()" error

Test:
- [ ] Enter zone (audio starts)
- [ ] Exit zone immediately (< 0.5 seconds)
- [ ] Re-enter zone
- [ ] Console shows NO error about "interrupted"
- [ ] Audio plays cleanly

**✅ Pass** / **❌ Fail**

---

#### Exit Zone Cleanup (v2.0)

**Issue**: Audio didn't stop when leaving zone

Test:
- [ ] Enter zone
- [ ] Audio plays
- [ ] Exit zone
- [ ] Console shows: `[QuestMap] Audio stopped for [ObjectName]`
- [ ] Audio actually stops (verify audibly)
- [ ] `audioRef.current` is null (check in DevTools)

**✅ Pass** / **❌ Fail**

---

## Cross-Browser Matrix

| Browser | Desktop | iOS | Android | Status | Notes |
|---------|---------|-----|---------|--------|-------|
| Chrome | ☐ | N/A | ☐ | | |
| Firefox | ☐ | N/A | N/A | | |
| Safari | ☐ | ☐ | N/A | | |
| Edge | ☐ | N/A | N/A | | (Optional) |

---

## Test Summary

### Results

**Total Tests**: _________
**Passed**: _________
**Failed**: _________
**Skipped**: _________

**Pass Rate**: _________%

---

### Issues Found

| # | Issue | Severity | Browser/Device | Status |
|---|-------|----------|----------------|--------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

**Severity**: 🔴 Critical / 🟡 Major / 🟢 Minor

---

### Release Decision

**All critical tests passing**: ☐ Yes ☐ No

**All major issues resolved**: ☐ Yes ☐ No

**Performance acceptable**: ☐ Yes ☐ No

**Accessibility verified**: ☐ Yes ☐ No

**Ready for Production Release**: ☐ **YES** ☐ **NO**

**If NO, blockers**:
___________________________________________
___________________________________________
___________________________________________

---

### Sign-Off

**Tested by**: ___________________________________________

**Date**: ___________________________________________

**Time spent**: ___________ minutes

**Signature**: ___________________________________________

---

## Notes

Use this space for additional observations, edge cases discovered, or suggestions for improvement:

___________________________________________
___________________________________________
___________________________________________
___________________________________________
___________________________________________
___________________________________________

---

**Checklist Version**: 1.0
**Last Updated**: 2025-12-19
**Next Review Date**: ___________
