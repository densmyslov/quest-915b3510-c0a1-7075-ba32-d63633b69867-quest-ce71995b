'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TimelineTextOverlayState } from './types';

type TimelineTextOverlayPalette = {
  gold: string;
  goldLight: string;
  parchment: string;
};

type TimelineTextOverlayProps = {
  overlay: TimelineTextOverlayState | null;
  onClose: () => void;
  palette: TimelineTextOverlayPalette;
};

export default function TimelineTextOverlay({
  overlay,
  onClose,
  palette
}: TimelineTextOverlayProps) {
  if (!overlay) return null;

  const imageUrls = useMemo(() => {
    const urls = overlay.imageUrls ?? [];
    return Array.isArray(urls) ? urls.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
  }, [overlay.imageUrls]);

  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);

  useEffect(() => {
    setExpandedUrl(null);
  }, [overlay]);

  useEffect(() => {
    if (!expandedUrl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedUrl(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expandedUrl]);

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
          padding: '14px 18px',
          background: 'linear-gradient(135deg, rgba(26, 21, 16, 0.95) 0%, rgba(44, 36, 28, 0.95) 100%)',
          border: `2px solid ${palette.gold}`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.55), inset 0 1px 0 rgba(201, 169, 97, 0.2)',
          color: palette.parchment,
          pointerEvents: 'auto'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
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
            <div
              style={{
                fontFamily: "'Crimson Text', Georgia, serif",
                fontSize: '14px',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {overlay.text}
            </div>

            {imageUrls.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
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
              lineHeight: '26px'
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
