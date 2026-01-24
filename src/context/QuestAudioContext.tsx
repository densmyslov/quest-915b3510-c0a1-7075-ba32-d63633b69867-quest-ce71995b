'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type PlayBackgroundParams = {
  url: string;
  loop?: boolean;
  volume?: number;
  continueIfAlreadyPlaying?: boolean;
};

type QuestAudioContextValue = {
  isBackgroundLocked: boolean;
  backgroundUrl: string | null;
  isBackgroundPlaying: boolean;
  unlockBackgroundAudio: () => Promise<boolean>;
  playBackgroundAudio: (params: PlayBackgroundParams) => Promise<void>;
  stopBackgroundAudio: () => void;
  duration: number;
  currentTime: number;
};

const QuestAudioContext = createContext<QuestAudioContextValue | null>(null);

export function useQuestAudio() {
  const ctx = useContext(QuestAudioContext);
  if (!ctx) {
    throw new Error('useQuestAudio must be used within QuestAudioProvider');
  }
  return ctx;
}

const SILENT_AUDIO_SOURCES = [
  // Hosted silence file (Avoids CSP issues with data: URIs in Prod)
  '/audio/silence.mp3',
  // MP3 silent (most compatible)
  'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v////////////////////////////////////////////////////////////////MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMz/////////////////////////////////////////////////////////////////AAAAAExhdmM1OC4xMzQAAAAAAAAAAAAAAAAkAAAAAAAAA4T/88DE8AAAAGwAAAABpAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//MwxMsAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/zMEAAAA=',
  // WAV silent (alternative)
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
  // OGG silent (Firefox)
  'data:audio/ogg;base64,T2dnUwACAAAAAAAAAABNb3ppbGxhAAAAAAAAAAAAAAAAAAAAAAAAQgAAAAAAAACHqmvJAwX/////Dwf////+//////////8VAAAAAAAAAAAA',
] as const;

export function QuestAudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);
  const pendingRef = useRef<PlayBackgroundParams | null>(null);
  const unlockPromiseRef = useRef<Promise<boolean> | null>(null);

  // Track user gesture timestamps to enforce unlocking only within valid windows
  const lastGestureAtRef = useRef(0);
  useEffect(() => {
    const mark = (e: Event) => {
      lastGestureAtRef.current = Date.now();
      console.log('[QuestAudio] User gesture detected:', e.type);
    };
    window.addEventListener('pointerdown', mark, { capture: true });
    window.addEventListener('touchstart', mark, { capture: true });
    window.addEventListener('keydown', mark, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', mark, true as any);
      window.removeEventListener('touchstart', mark, true as any);
      window.removeEventListener('keydown', mark, true as any);
    };
  }, []);

  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [isBackgroundPlaying, setIsBackgroundPlaying] = useState(false);
  const [isBackgroundLocked, setIsBackgroundLocked] = useState(false);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const stopBackgroundAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      setBackgroundUrl(null);
      setIsBackgroundPlaying(false);
      setDuration(0);
      setCurrentTime(0);
      return;
    }

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    } catch (err) {
      console.warn('[QuestAudio] Failed to stop background audio:', err);
    }

    pendingRef.current = null;
    setBackgroundUrl(null);
    setIsBackgroundPlaying(false);
    setDuration(0);
    setCurrentTime(0);
  }, []);

  const playBackgroundAudio = useCallback(async (params: PlayBackgroundParams) => {
    const audio = audioRef.current;
    if (!audio) {
      console.error('[QuestAudio] ❌ playBackgroundAudio: audioRef.current is null!');
      return;
    }

    console.log('[QuestAudio] 🔊 playBackgroundAudio called', {
      url: params.url.substring(0, 50) + '...',
      fullUrl: params.url,
      volume: params.volume,
      loop: params.loop,
      continueIfAlreadyPlaying: params.continueIfAlreadyPlaying,
      currentlyPlaying: isBackgroundPlaying,
      currentBackgroundUrl: backgroundUrl ? backgroundUrl.substring(0, 50) + '...' : null,
      urlsMatch: backgroundUrl === params.url,
      unlocked: unlockedRef.current,
      audioState: {
        readyState: audio.readyState,
        networkState: audio.networkState,
        paused: audio.paused,
        volume: audio.volume,
        muted: audio.muted,
        src: audio.src ? audio.src.substring(0, 50) + '...' : 'EMPTY'
      }
    });

    if (
      params.continueIfAlreadyPlaying &&
      isBackgroundPlaying &&
      backgroundUrl &&
      backgroundUrl === params.url
    ) {
      console.log('[QuestAudio] Continuing existing playback, volume update only');
      console.log('[QuestAudio] Audio state check:', {
        duration: audio.duration,
        readyState: audio.readyState,
        paused: audio.paused,
        currentTime: audio.currentTime
      });

      // Check if audio metadata has loaded (duration > 0)
      if (audio.duration === 0 || isNaN(audio.duration) || audio.readyState < 1) {
        console.warn('[QuestAudio] Audio not properly loaded (duration=0 or metadata missing). Stopping and reloading.');
        // Stop the "fake" playback
        setIsBackgroundPlaying(false);
        setBackgroundUrl(null);
        audio.pause();
        audio.currentTime = 0;
        // Fall through to reload the audio properly
      } else {
        // Allow volume update if specified
        if (typeof params.volume === 'number') {
          const normalizedVolume = Math.min(1, Math.max(0, params.volume / 100));
          const beforeVolume = audio.volume;
          const beforeMuted = audio.muted;
          audio.volume = normalizedVolume;
          audio.muted = false; // Ensure not muted
          const afterVolume = audio.volume;
          const afterMuted = audio.muted;
          console.log('[QuestAudio] Volume update successful', {
            targetVolume: normalizedVolume,
            beforeVolume,
            afterVolume,
            beforeMuted,
            afterMuted,
            paused: audio.paused,
            currentTime: audio.currentTime,
            duration: audio.duration
          });
        }
        return;
      }
    }

    // If audio is already playing successfully, sync the unlock state
    if (isBackgroundPlaying && !unlockedRef.current) {
      console.log('[QuestAudio] Audio playing but unlockedRef out of sync, fixing state');
      unlockedRef.current = true;
      setIsBackgroundLocked(false);
    }

    if (!unlockedRef.current) {
      console.warn('[QuestAudio] 🔒 LOCKED - queuing params. User needs to interact first!', {
        url: params.url.substring(0, 50) + '...',
        pendingExists: !!pendingRef.current
      });
      pendingRef.current = params;
      setIsBackgroundLocked(true);
      return;
    }

    const normalizedVolume =
      typeof params.volume === 'number' ? Math.min(1, Math.max(0, params.volume / 100)) : 1;

    try {
      audio.src = params.url;
      audio.loop = !!params.loop;
      audio.volume = normalizedVolume;
      audio.muted = false; // Ensure not muted
      audio.currentTime = 0;
      audio.load();

      setBackgroundUrl(params.url);
      console.log('[QuestAudio] 🎵 Attempting to play background audio...', {
        url: params.url,
        volume: audio.volume,
        muted: audio.muted,
        readyState: audio.readyState,
        networkState: audio.networkState
      });

      // Wait for metadata to load (Safari needs this)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.warn('[QuestAudio] Metadata load timeout, proceeding anyway');
          resolve();
        }, 3000);

        const onLoaded = () => {
          clearTimeout(timeout);
          audio.removeEventListener('loadedmetadata', onLoaded);
          audio.removeEventListener('error', onError);
          console.log('[QuestAudio] Metadata loaded, duration:', audio.duration);
          setDuration(audio.duration || 0); // Update duration
          resolve();
        };

        const onError = (e: Event) => {
          clearTimeout(timeout);
          audio.removeEventListener('loadedmetadata', onLoaded);
          audio.removeEventListener('error', onError);
          const target = e.target as HTMLAudioElement;
          console.error('[QuestAudio] ❌ Audio load ERROR:', {
            event: e,
            errorCode: target?.error?.code,
            errorMessage: target?.error?.message,
            src: target?.src,
            networkState: target?.networkState,
            readyState: target?.readyState
          });
          reject(new Error(`Audio failed to load: ${target?.error?.message || 'Unknown error'}`));
        };

        if (audio.readyState >= 1) { // HAVE_METADATA
          console.log('[QuestAudio] Metadata already loaded');
          setDuration(audio.duration || 0);
          clearTimeout(timeout);
          resolve();
        } else {
          audio.addEventListener('loadedmetadata', onLoaded);
          audio.addEventListener('error', onError);
        }
      });

      await audio.play();

      // If we got here, playback started successfully
      console.log('[QuestAudio] ✅ Background audio play SUCCESS!', {
        volume: audio.volume,
        muted: audio.muted,
        paused: audio.paused,
        currentTime: audio.currentTime,
        duration: audio.duration,
        readyState: audio.readyState,
        networkState: audio.networkState,
        src: audio.src.substring(0, 100) + '...'
      });
      unlockedRef.current = true;
      setIsBackgroundPlaying(true);
      setIsBackgroundLocked(false);

      // Clear any pending since we just played successfully
      if (pendingRef.current === params) {
        console.log('[QuestAudio] Clearing pending params after successful play');
        pendingRef.current = null;
      }
    } catch (err: any) {
      console.error('[QuestAudio] ❌ Background audio play FAILED:', {
        errorName: err?.name,
        errorMessage: err?.message,
        fullError: err,
        audioState: {
          src: audio.src ? audio.src.substring(0, 100) + '...' : 'EMPTY',
          readyState: audio.readyState,
          networkState: audio.networkState,
          paused: audio.paused,
          muted: audio.muted,
          volume: audio.volume,
          duration: audio.duration,
          currentTime: audio.currentTime
        }
      });

      if (err?.name === 'NotAllowedError') {
        console.warn('[QuestAudio] 🔒 NotAllowedError - user gesture required, queuing for unlock');
        unlockedRef.current = false;
        pendingRef.current = params;
        setIsBackgroundLocked(true);
      } else if (err?.name === 'NotSupportedError') {
        console.error('[QuestAudio] ❌ NotSupportedError - audio format not supported or CORS/network issue');
      } else if (err?.name === 'AbortError') {
        console.error('[QuestAudio] ⚠️ AbortError - playback was aborted (rapid src changes?)');
      } else {
        console.error('[QuestAudio] ❌ Unknown error type:', err?.name);
      }
    }
  }, [backgroundUrl, isBackgroundPlaying]);

  const unlockBackgroundAudio = useCallback(() => {
    if (unlockedRef.current) {
      console.log('[QuestAudio] ✅ Already unlocked, skipping');
      return Promise.resolve(true);
    }

    // Enforce "unlock only from a user gesture"
    const timeSinceGesture = Date.now() - lastGestureAtRef.current;
    const withinGestureWindow = timeSinceGesture < 1000;
    if (!withinGestureWindow) {
      console.warn('[QuestAudio] ⚠️ unlockBackgroundAudio blocked: no recent user gesture', {
        timeSinceGesture,
        lastGesture: lastGestureAtRef.current,
        now: Date.now()
      });
      // Do NOT set isBackgroundLocked(true) here aggressively, just return false
      // so we don't poison state. Just ignore this attempt.
      return Promise.resolve(false);
    }
    console.log('[QuestAudio] 🔓 Within gesture window, proceeding with unlock', { timeSinceGesture });

    // If already unlocking, DO NOT skip. Return the in-flight promise.
    if (unlockPromiseRef.current) {
      console.log('[QuestAudio] unlockBackgroundAudio joining existing promise');
      return unlockPromiseRef.current;
    }

    console.log('[QuestAudio] unlockBackgroundAudio STARTING new attempt');
    console.log('[QuestAudio] unlockBackgroundAudio NEW promise');
    console.trace('[QuestAudio] unlock promise created from:');

    const p = (async () => {
      const audio = audioRef.current;
      if (!audio) return false;

      try {
        // (optional) AudioContext best-effort (keep this as it doesn't hurt if non-blocking)
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            const ctx = new AudioContextClass();
            const buffer = ctx.createBuffer(1, 1, 22050);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(0);
            try {
              // Do not wait for close
              void ctx.close?.();
            } catch { }
          }
        } catch { }

        // Critical: play on *audioRef.current* (the real element)
        for (const src of SILENT_AUDIO_SOURCES) {
          try {
            audio.pause();
            audio.currentTime = 0;
            audio.src = src;
            audio.loop = false;
            audio.volume = 0.01;
            audio.muted = false;
            audio.load();

            // IMPORTANT: no await before this when called from user gesture
            console.log('[QuestAudio] 🔓 Attempting silent audio unlock with:', src.substring(0, 50) + '...');
            await audio.play(); // must succeed under user gesture at least once
            console.log('[QuestAudio] ✅ Silent play SUCCESS!', {
              volume: audio.volume,
              muted: audio.muted,
              srcType: src.startsWith('/audio/') ? 'hosted file' : 'data URI'
            });

            audio.pause();
            audio.currentTime = 0;
            audio.removeAttribute('src');
            audio.load();

            unlockedRef.current = true;
            setIsBackgroundLocked(false);
            console.log('[QuestAudio] 🎉 Audio context UNLOCKED successfully!');

            const pending = pendingRef.current;
            if (pending) {
              console.log('[QuestAudio] 🔊 Executing pending audio after unlock', {
                url: pending.url.substring(0, 50) + '...',
                fullUrl: pending.url,
                volume: pending.volume,
                loop: pending.loop
              });
              pendingRef.current = null;
              await playBackgroundAudio(pending);
            } else {
              console.log('[QuestAudio] No pending audio to execute');
            }
            return true;
          } catch (e: any) {
            console.warn('[QuestAudio] ⚠️ Silent src failed:', {
              src: src.substring(0, 50) + '...',
              errorName: e?.name,
              errorMessage: e?.message
            });
            // try next format
          }
        }

        // none worked
        console.error('[QuestAudio] ❌ ALL silent audio formats failed - unlock failed!');
        unlockedRef.current = false;
        setIsBackgroundLocked(true);
        return false;
      } finally {
        // IMPORTANT: clear so a later TAP can retry if this attempt wasn’t gesture-backed
        unlockPromiseRef.current = null;
      }
    })();

    unlockPromiseRef.current = p;
    return p;
  }, [playBackgroundAudio]);

  const value = useMemo<QuestAudioContextValue>(
    () => ({
      isBackgroundLocked,
      backgroundUrl,
      isBackgroundPlaying,
      unlockBackgroundAudio,
      playBackgroundAudio,
      stopBackgroundAudio,
      duration,
      currentTime,
    }),
    [
      isBackgroundLocked,
      backgroundUrl,
      isBackgroundPlaying,
      unlockBackgroundAudio,
      playBackgroundAudio,
      stopBackgroundAudio,
      duration,
      currentTime,
    ],
  );

  return (
    <QuestAudioContext.Provider value={value}>
      {/* Keep the element mounted across routes so background audio can continue while puzzles are open */}
      <audio
        ref={audioRef}
        preload="none"
        playsInline
        style={{ position: 'fixed', left: -9999, top: -9999, width: 1, height: 1 }}
        onPlay={() => setIsBackgroundPlaying(true)}
        onPause={() => setIsBackgroundPlaying(false)}
        onEnded={() => setIsBackgroundPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
        onDurationChange={(e) => setDuration((e.target as HTMLAudioElement).duration || 0)}
      />
      {children}
    </QuestAudioContext.Provider>
  );
}
