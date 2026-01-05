'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

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
  // MP3 silent (most compatible)
  'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v////////////////////////////////////////////////////////////////MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMz/////////////////////////////////////////////////////////////////AAAAAExhdmM1OC4xMzQAAAAAAAAAAAAAAAAkAAAAAAAAA4T/88DE8AAAAGwAAAABpAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//MwxMsAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/zMEAAAA=',
  // WAV silent (alternative)
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
  // OGG silent (Firefox)
  'data:audio/ogg;base64,T2dnUwACAAAAAAAAAABNb3ppbGxhAAAAAAAAAAAAAAAAAAAAAAAAQgAAAAAAAACHqmvJAwX/////Dwf////+//////////8VAAAAAAAAAAAA',
] as const;

async function sleepMs(ms: number) {
  await new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export function QuestAudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);
  const pendingRef = useRef<PlayBackgroundParams | null>(null);

  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [isBackgroundPlaying, setIsBackgroundPlaying] = useState(false);
  const [isBackgroundLocked, setIsBackgroundLocked] = useState(false);

  const stopBackgroundAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      setBackgroundUrl(null);
      setIsBackgroundPlaying(false);
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
  }, []);

  const playBackgroundAudio = useCallback(async (params: PlayBackgroundParams) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (
      params.continueIfAlreadyPlaying &&
      isBackgroundPlaying &&
      backgroundUrl &&
      backgroundUrl === params.url
    ) {
      return;
    }

    if (!unlockedRef.current) {
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
      audio.currentTime = 0;
      audio.load();

      setBackgroundUrl(params.url);
      await audio.play();
      setIsBackgroundPlaying(true);
      setIsBackgroundLocked(false);
    } catch (err: any) {
      console.warn('[QuestAudio] Background audio play failed:', err?.name, err?.message);
      if (err?.name === 'NotAllowedError') {
        unlockedRef.current = false;
        pendingRef.current = params;
        setIsBackgroundLocked(true);
      }
    }
  }, [backgroundUrl, isBackgroundPlaying]);

  const unlockBackgroundAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return false;
    if (unlockedRef.current) return true;

    try {
      // 1) AudioContext unlock (Web Audio API) - best effort
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          const buffer = ctx.createBuffer(1, 1, 22050);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start(0);
          // IMPORTANT: do not `await` here. If unlockBackgroundAudio() is triggered from a user gesture,
          // an await before `HTMLAudioElement.play()` can lose the activation and cause NotAllowedError.
          try {
            void ctx.close?.();
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }

      // 2) HTML5 Audio unlock (critical) - multi-format fallback
      let unlocked = false;
      let lastError: unknown = null;
      let unlockedSrc: string | null = null;

      for (const src of SILENT_AUDIO_SOURCES) {
        try {
          const silent = new Audio();
          silent.src = src;
          silent.loop = false;
          silent.volume = 0.01;

          await silent.play();
          await sleepMs(10);
          silent.pause();
          silent.currentTime = 0;
          unlocked = true;
          unlockedSrc = src;
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!unlocked) {
        throw lastError || new Error('All silent audio formats failed');
      }

      // Best-effort: also prime the provider's audio element instance (some browsers tie
      // autoplay permission to the specific HTMLAudioElement).
      if (unlockedSrc) {
        try {
          audio.pause();
          audio.currentTime = 0;
          audio.src = unlockedSrc;
          audio.loop = false;
          audio.volume = 0.01;
          audio.load();

          await audio.play();
          await sleepMs(10);
          audio.pause();
          audio.currentTime = 0;
          audio.removeAttribute('src');
          audio.load();
        } catch {
          // ignore
        }
      }

      unlockedRef.current = true;
      setIsBackgroundLocked(false);

      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        await playBackgroundAudio(pending);
      }

      return true;
    } catch (err) {
      console.warn('[QuestAudio] Background audio unlock failed:', err);
      setIsBackgroundLocked(true);
      return false;
    }
  }, [playBackgroundAudio]);

  const value = useMemo<QuestAudioContextValue>(
    () => ({
      isBackgroundLocked,
      backgroundUrl,
      isBackgroundPlaying,
      unlockBackgroundAudio,
      playBackgroundAudio,
      stopBackgroundAudio,
    }),
    [
      isBackgroundLocked,
      backgroundUrl,
      isBackgroundPlaying,
      unlockBackgroundAudio,
      playBackgroundAudio,
      stopBackgroundAudio,
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
      />
      {children}
    </QuestAudioContext.Provider>
  );
}
