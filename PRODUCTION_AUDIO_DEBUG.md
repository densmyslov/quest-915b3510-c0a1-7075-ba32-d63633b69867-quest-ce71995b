# Production Audio Debugging Guide

## Issue
Audio (`STREAMING_AUDIO_URL` in [page.tsx](src/app/page.tsx#L15-L16)) doesn't play in production on **both** Chrome and Safari, but works fine in dev.

## Quick Diagnosis Steps

### 1. Open Production Site with Browser Console

**Chrome**: F12 or Cmd+Option+I (Mac)
**Safari**: Enable Develop menu first (Safari > Settings > Advanced > Show Develop menu), then Cmd+Option+I

### 2. Go Through Registration Flow

Watch the console for these key log patterns:

#### ✅ Expected SUCCESS Flow:
```
[page.tsx] handleRegistrationComplete - attempting audio unlock on user gesture
[page.tsx] Audio Context explicitly unlocked
[QuestAudio] 🔓 Attempting silent audio unlock with: /audio/silence.mp3...
[QuestAudio] ✅ Silent play SUCCESS!
[QuestAudio] 🎉 Audio context UNLOCKED successfully!
[QuestAudio] 🔊 Executing pending audio after unlock
[QuestAudio] 🔊 playBackgroundAudio called
[QuestAudio] 🎵 Attempting to play background audio...
[QuestAudio] Metadata loaded, duration: 271.074 (or similar)
[QuestAudio] ✅ Background audio play SUCCESS!
```

#### ❌ Common FAILURE Patterns:

**Pattern 1: Locked (No User Gesture)**
```
[QuestAudio] 🔒 LOCKED - queuing params. User needs to interact first!
```
→ **Cause**: Unlock not being called from user gesture
→ **Fix**: Ensure `unlockBackgroundAudio()` is called inside click handler

**Pattern 2: Gesture Timeout**
```
[QuestAudio] ⚠️ unlockBackgroundAudio blocked: no recent user gesture
```
→ **Cause**: Too much time elapsed between click and unlock attempt
→ **Fix**: Call unlock immediately in handler, not after async operations

**Pattern 3: Silent Audio Fails**
```
[QuestAudio] ⚠️ Silent src failed: /audio/silence.mp3
[QuestAudio] ❌ ALL silent audio formats failed - unlock failed!
```
→ **Cause**: `/audio/silence.mp3` not accessible or MIME type wrong
→ **Fix**: Check if file exists in production build

**Pattern 4: CORS/Network Error**
```
[QuestAudio] ❌ Audio load ERROR:
  errorCode: 2
  errorMessage: "MEDIA_ERR_NETWORK"
  networkState: 3
```
→ **Cause**: R2 URL blocked by CORS or network issue
→ **Fix**: Check R2 bucket CORS settings

**Pattern 5: Format Not Supported**
```
[QuestAudio] ❌ NotSupportedError - audio format not supported or CORS/network issue
```
→ **Cause**: MP3 not supported OR CORS blocking
→ **Fix**: Check browser console Network tab for failed requests

**Pattern 6: Playback Blocked**
```
[QuestAudio] 🔒 NotAllowedError - user gesture required, queuing for unlock
```
→ **Cause**: Play called without proper unlock
→ **Fix**: Unlock flow broken

### 3. Check Network Tab

**Chrome/Safari DevTools > Network tab**

1. Filter by: `20260107-144449-cb354a4c.mp3` (your audio file)
2. Check:
   - ✅ **Status Code**: Should be `200 OK`
   - ❌ **Status Code**: `403 Forbidden` = CORS issue
   - ❌ **Status Code**: `404 Not Found` = URL wrong
   - ❌ **Failed** or **Blocked** = Network/CORS issue

3. Click on the request, check **Response Headers**:
   ```
   Access-Control-Allow-Origin: * (or your domain)
   Content-Type: audio/mpeg
   ```

### 4. Check Audio Element State

In console, after registration, run:
```javascript
// Find the background audio element
const audio = document.querySelector('audio');
console.log({
  src: audio.src,
  paused: audio.paused,
  duration: audio.duration,
  readyState: audio.readyState,
  networkState: audio.networkState,
  error: audio.error
});
```

**Interpret Results:**
- `readyState: 4` (HAVE_ENOUGH_DATA) = ✅ Good
- `readyState: 0-1` = ❌ Not loaded
- `networkState: 3` (NETWORK_NO_SOURCE) = ❌ Network error
- `error: null` = ✅ No errors
- `error.code: 2` = ❌ Network error
- `error.code: 4` = ❌ Format not supported
- `duration: 0` = ❌ Metadata not loaded

## Common Production Issues

### Issue A: `/audio/silence.mp3` Missing in Production

**Symptoms:**
```
[QuestAudio] ❌ ALL silent audio formats failed
```

**Check:**
```bash
# Local
ls -la public/audio/silence.mp3

# Production - open in browser:
https://your-prod-domain.pages.dev/audio/silence.mp3
```

**Fix:**
Ensure `public/audio/` directory is included in build.

### Issue B: R2 URL Blocked by CORS

**Symptoms:**
```
[QuestAudio] ❌ Audio load ERROR
  errorCode: 2
  errorMessage: "MEDIA_ERR_NETWORK"
```

**Network Tab Shows:**
```
Access to audio at 'https://pub-877...r2.dev/...' from origin 'https://your-site.pages.dev'
has been blocked by CORS policy
```

**Fix:**
Configure R2 bucket CORS:
```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
]
```

### Issue C: Cloudflare Pages Build Strips Audio

**Symptoms:**
```
GET /audio/silence.mp3 404 Not Found
```

**Check `next.config.ts`:**
```typescript
const nextConfig: NextConfig = {
  output: undefined, // Not 'export'
  images: {
    unoptimized: true,
  },
  // ...
};
```

**Build Command:**
```bash
"build": "if [ \"$CF_PAGES\" = \"1\" ] && [ -z \"$NEXT_ON_PAGES\" ]; then npm run pages:build; else next build; fi"
```

### Issue D: Content Security Policy (CSP) Blocking Media

**Symptoms:**
```
Refused to load media from 'https://pub-877...r2.dev' because it violates the following
Content Security Policy directive: "media-src 'self'"
```

**Check Response Headers in Network Tab:**
```
Content-Security-Policy: default-src 'self'; media-src 'self' https://pub-877...r2.dev
```

**Fix:**
Add to Cloudflare Pages settings or `_headers` file:
```
/*
  Content-Security-Policy: default-src 'self'; media-src 'self' https://pub-877f23628132452cb9b12cf3cf618c69.r2.dev
```

## Next Steps

1. **Deploy the enhanced logging** (already done in this commit)
2. **Go through registration in production**
3. **Copy ALL console logs** and share them
4. **Check Network tab** for the audio request status
5. **Run the audio element state check** in console

Once we see the actual error patterns, we can identify the specific production issue.

## Quick Test Script

Run this in prod console after going through registration:

```javascript
// Quick Audio Diagnostic
const audio = document.querySelector('audio');
if (!audio) {
  console.error('❌ No audio element found!');
} else {
  console.log('🔍 Audio Element Diagnostic:', {
    src: audio.src,
    srcDomain: new URL(audio.src).hostname,
    paused: audio.paused,
    muted: audio.muted,
    volume: audio.volume,
    duration: audio.duration,
    readyState: audio.readyState,
    networkState: audio.networkState,
    error: audio.error ? {
      code: audio.error.code,
      message: audio.error.message
    } : null
  });

  // Try to play manually
  audio.play().then(() => {
    console.log('✅ Manual play succeeded!');
  }).catch(err => {
    console.error('❌ Manual play failed:', err.name, err.message);
  });
}
```

## MediaError Codes Reference

| Code | Constant | Meaning |
|------|----------|---------|
| 1 | MEDIA_ERR_ABORTED | User aborted loading |
| 2 | MEDIA_ERR_NETWORK | Network error (CORS, 403, 404, timeout) |
| 3 | MEDIA_ERR_DECODE | Corrupted file or unsupported codec |
| 4 | MEDIA_ERR_SRC_NOT_SUPPORTED | Format/MIME type not supported |

## Files Changed

- [src/context/QuestAudioContext.tsx](src/context/QuestAudioContext.tsx) - Enhanced logging with emojis for easy scanning
