'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TimelineTextOverlayState } from './types';

import { StreamingText } from '@/components/StreamingText';

type TimelineTextOverlayPalette = {
  gold: string;
  goldLight: string;
  parchment: string;
};

interface TimelineTextOverlayProps {
  overlay: TimelineTextOverlayState;
  onClose: () => void;
  palette: TimelineTextOverlayPalette;
  currentTime?: number;
  duration?: number;
  isPlaying?: boolean;
};

// --- Main Component ---

export default function TimelineTextOverlay({
  overlay,
  onClose,
  palette,
  currentTime = 0,
  duration = 0,
  isPlaying = false
}: TimelineTextOverlayProps) {
  const imageUrls = useMemo(() => {
    if (!overlay?.imageUrls) return [];
    const urls = overlay.imageUrls;
    return Array.isArray(urls) ? urls.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
  }, [overlay?.imageUrls]);

  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setExpandedUrl(null), 0);
    return () => clearTimeout(timer);
  }, [overlay]);

  useEffect(() => {
    if (!expandedUrl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedUrl(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expandedUrl]);

  if (!overlay) return null;

  // Extract transcription if available (assuming it might be passed in overlay even if not typed yet)
  const transcription = (overlay as any).transcription;
  const hasTranscription = !!transcription;


  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: '70px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 5200,
          width: 'min(520px, calc(100vw - 32px))',
          padding: '18px 22px', // Increased padding for better reading
          background: 'linear-gradient(135deg, rgba(26, 21, 16, 0.98) 0%, rgba(44, 36, 28, 0.98) 100%)', // Slightly more opaque
          border: `2px solid ${palette.gold}`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.55), inset 0 1px 0 rgba(201, 169, 97, 0.2)',
          color: palette.parchment,
          pointerEvents: 'auto',
          borderRadius: '4px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontFamily: "'Cinzel', serif",
                fontSize: '13px',
                fontWeight: 800,
                letterSpacing: '1.2px',
                textTransform: 'uppercase',
                color: palette.goldLight,
                marginBottom: '8px'
              }}
            >
              {overlay.title}
            </div>

            {hasTranscription ? (
              /* Use shared StreamingText for synchronized audio transcription */
              <div style={{ maxHeight: '60vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <StreamingText
                  transcription={transcription}
                  currentTime={currentTime ?? 0}
                  audioDuration={duration}
                  isPlaying={isPlaying}
                  className="timeline-streaming-text"
                  showFutureWords={true}
                />
                <style>{`
                  /* Override StreamingText styles to match the vintage overlay theme */
                  .timeline-streaming-text {
                    background: transparent !important;
                    border: none !important;
                    box-shadow: none !important;
                    padding: 0 !important;
                    min-height: auto !important;
                  }
                  .timeline-streaming-text > div {
                    font-family: 'Crimson Text', Georgia, serif !important;
                    font-size: 18px !important;
                    line-height: 1.5 !important;
                    color: ${palette.parchment} !important;
                  }
                  .timeline-streaming-text span {
                    color: rgba(245, 230, 211, 0.5) !important; /* Future/standard words dimmed */
                    padding: 0 4px 0 0 !important;
                    margin: 0 !important;
                    border-radius: 0 !important;
                    display: inline !important;
                  }
                  /* Try to target current word specifically if possible.
                     StreamingText adds a specific class for current word.
                     We can try to match the style attribute or add a data attribute in StreamingText if needed.
                     For now, let's rely on the fact that StreamingText adds classes.
                     We can use attribute 'class' contains 'currentWord'.
                  */
                  .timeline-streaming-text span[class*="currentWord"] {
                    color: ${palette.gold} !important;
                    background: transparent !important;
                    box-shadow: none !important;
                    font-weight: bold !important;
                    transform: scale(1.05) !important;
                    text-shadow: 0 0 10px rgba(255, 215, 0, 0.3) !important;
                  }
                  .timeline-streaming-text span[class*="pastWord"] {
                     color: ${palette.parchment} !important;
                  }
                  .timeline-streaming-text span[class*="futureWord"] {
                     opacity: 0.3 !important;
                  }
                `}</style>
              </div>
            ) : (
              /* Fallback for simple text without transcription */
              <div
                style={{
                  fontFamily: "'Crimson Text', Georgia, serif",
                  fontSize: '18px',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}
              >
                {overlay.text}
              </div>
            )}

            {imageUrls.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                {imageUrls.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setExpandedUrl(url)}
                    style={{
                      padding: 0,
                      border: '1px solid rgba(201, 169, 97, 0.35)',
                      borderRadius: 8,
                      overflow: 'hidden',
                      background: 'rgba(0,0,0,0.25)',
                      cursor: 'pointer',
                      width: 120,
                      height: 90,
                    }}
                    aria-label="Expand image"
                    title="Click to expand"
                  >
                    <img
                      src={url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}
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
              lineHeight: '26px',
              flexShrink: 0
            }}
          >
            &times;
          </button>
        </div>
        {overlay.mode === 'seconds' && (
          <div
            style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: '1px dashed rgba(201, 169, 97, 0.55)',
              fontSize: '11px',
              color: 'rgba(245, 230, 211, 0.78)',
              fontStyle: 'italic',
              textAlign: 'center'
            }}
          >
            Closes automatically in {overlay.seconds}s
          </div>
        )}
      </div>

      {expandedUrl && (
        <div
          onClick={() => setExpandedUrl(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 5400,
            background: 'rgba(0,0,0,0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: 'min(980px, calc(100vw - 32px))',
              maxHeight: 'min(90vh, 720px)',
              borderRadius: 10,
              overflow: 'hidden',
              border: `2px solid ${palette.gold}`,
              background: 'rgba(0,0,0,0.6)',
              boxShadow: '0 14px 40px rgba(0,0,0,0.55)',
            }}
          >
            <img
              src={expandedUrl}
              alt=""
              style={{ display: 'block', maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain' }}
            />
            <button
              type="button"
              onClick={() => setExpandedUrl(null)}
              aria-label="Close image"
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'rgba(0,0,0,0.55)',
                border: `1px solid ${palette.gold}`,
                color: palette.gold,
                cursor: 'pointer',
                fontFamily: "'Cinzel', serif",
                fontSize: 18,
                lineHeight: '32px',
              }}
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </>
  );
}
