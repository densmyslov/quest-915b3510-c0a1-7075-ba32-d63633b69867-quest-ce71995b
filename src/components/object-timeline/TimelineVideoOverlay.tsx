'use client';

import { useRef, useCallback, type SyntheticEvent } from 'react';
import type { TimelineVideoOverlayState } from './types';

type TimelineVideoOverlayPalette = {
  gold: string;
  goldLight: string;
  parchment: string;
};

type TimelineVideoOverlayProps = {
  overlay: TimelineVideoOverlayState | null;
  onClose: () => void;
  onEnded: () => void;
  onError: (event: SyntheticEvent<HTMLVideoElement>) => void;
  palette: TimelineVideoOverlayPalette;
};

export default function TimelineVideoOverlay({
  overlay,
  onClose,
  onEnded,
  onError,
  palette
}: TimelineVideoOverlayProps) {
  const playAttemptedRef = useRef(false);
  const currentUrlRef = useRef<string | null>(null);

  const attemptAutoplay = useCallback(async (video: HTMLVideoElement) => {
    if (!overlay?.autoPlay) return;
    if (playAttemptedRef.current && currentUrlRef.current === overlay.url) return;

    playAttemptedRef.current = true;
    currentUrlRef.current = overlay.url;

    try {
      await video.play();
    } catch {
      // Autoplay was blocked - retry with muted
      if (!video.muted) {
        video.muted = true;
        try {
          await video.play();
        } catch {
          // Still failed, user will need to click play
        }
      }
    }
  }, [overlay]);

  // Ref callback: called when video element mounts
  const videoRefCallback = useCallback((video: HTMLVideoElement | null) => {
    if (!video || !overlay?.autoPlay) return;

    // Reset play attempt tracker when URL changes
    if (currentUrlRef.current !== overlay.url) {
      playAttemptedRef.current = false;
    }

    // If video already has enough data, try to play immediately
    if (video.readyState >= 3) {
      void attemptAutoplay(video);
    }
  }, [overlay, attemptAutoplay]);

  const handleLoadedData = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    void attemptAutoplay(event.currentTarget);
  }, [attemptAutoplay]);

  if (!overlay) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '90px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 5200,
        width: 'min(720px, calc(100vw - 32px))',
        padding: '16px',
        background: 'linear-gradient(135deg, rgba(26, 21, 16, 0.95) 0%, rgba(44, 36, 28, 0.95) 100%)',
        border: `2px solid ${palette.gold}`,
        boxShadow: '0 10px 36px rgba(0,0,0,0.55), inset 0 1px 0 rgba(201, 169, 97, 0.2)',
        color: palette.parchment,
        pointerEvents: 'auto'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div
          style={{
            fontFamily: "'Cinzel', serif",
            fontSize: '11px',
            fontWeight: 800,
            letterSpacing: '1.2px',
            textTransform: 'uppercase',
            color: palette.goldLight
          }}
        >
          {overlay.title}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
          onTouchStart={(event) => event.stopPropagation()}
          aria-label="Close"
          style={{
            background: 'transparent',
            border: `1px solid ${palette.gold}`,
            color: palette.gold,
            width: 28,
            height: 28,
            borderRadius: 6,
            cursor: 'pointer',
            fontFamily: "'Cinzel', serif",
            fontSize: 16,
            lineHeight: '26px'
          }}
        >
          &times;
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        <video
          ref={videoRefCallback}
          src={overlay.url}
          controls
          playsInline
          preload="auto"
          muted={overlay.muted}
          loop={overlay.loop}
          poster={overlay.posterUrl}
          onLoadedData={handleLoadedData}
          onEnded={onEnded}
          onError={onError}
          style={{
            width: '100%',
            maxHeight: '50vh',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.8)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
          }}
        />
        <div
          style={{
            marginTop: 8,
            fontSize: '11px',
            color: 'rgba(245, 230, 211, 0.7)',
            fontStyle: 'italic',
            textAlign: 'center'
          }}
        >
          If playback is blocked, tap Play to start the video.
        </div>
      </div>
    </div>
  );
}
