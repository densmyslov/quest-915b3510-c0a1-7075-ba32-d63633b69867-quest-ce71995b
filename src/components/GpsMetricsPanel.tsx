'use client';

import { useEffect, useRef, useState } from 'react';

type GpsMetricsPanelProps = {
  gpsEnabled: boolean;
  userLocation: [number, number] | null;
  gpsAccuracy: number | null;
  nearestObjectDistance: number | null;
  nearestObjectRadius: number | null;
  nearestObjectName: string;
  isInZone: boolean;
};

const COLORS = {
  parchment: '#F5E6D3',
  parchmentDark: '#E8D4BC',
  gold: '#C9A961',
  sepia: '#704214',
  ink: '#2C1810',
  inkLight: '#4A3728',
  success: '#2d5a3d',
  successLight: '#a8e6a3'
};

export default function GpsMetricsPanel({
  gpsEnabled,
  userLocation,
  gpsAccuracy,
  nearestObjectDistance,
  nearestObjectRadius,
  nearestObjectName,
  isInZone
}: GpsMetricsPanelProps) {
  const [gpsPanelCollapsed, setGpsPanelCollapsed] = useState(false);
  const touchStartRef = useRef<{ y: number; x: number } | null>(null);



  if (!gpsEnabled || !userLocation) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: gpsPanelCollapsed ? '16px' : '100px',
        left: '16px',
        zIndex: 4000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '8px'
      }}
    >
      <button
        type="button"
        aria-label={gpsPanelCollapsed ? 'Mostra pannello bussola' : 'Nascondi pannello bussola'}
        onClick={() => setGpsPanelCollapsed((v) => !v)}
        style={{
          padding: '8px 12px',
          background: `linear-gradient(145deg, ${COLORS.parchment} 0%, ${COLORS.parchmentDark} 70%, #D4C4A8 100%)`,
          border: `2px solid ${COLORS.gold}`,
          boxShadow: '0 6px 24px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.7)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}
      >
        <div
          style={{
            width: '24px',
            height: '12px',
            display: 'grid',
            placeItems: 'center'
          }}
        >
          <div
            style={{
              width: '22px',
              height: '4px',
              borderRadius: '999px',
              background: 'rgba(112, 66, 20, 0.35)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)'
            }}
          />
        </div>
        <span
          style={{
            fontFamily: "'Cinzel', serif",
            fontSize: '11px',
            fontWeight: 600,
            color: COLORS.sepia,
            letterSpacing: '1px',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap'
          }}
        >
          Segnale Bussola
        </span>
        <span
          style={{
            marginLeft: '2px',
            fontFamily: "'Cinzel', serif",
            fontSize: '12px',
            fontWeight: 700,
            color: COLORS.sepia,
            opacity: 0.85
          }}
        >
          {gpsPanelCollapsed ? '▴' : '▾'}
        </span>
      </button>

      <div
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (!t) return;
          touchStartRef.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const start = touchStartRef.current;
          touchStartRef.current = null;
          if (!start || gpsPanelCollapsed) return;
          const t = e.changedTouches[0];
          if (!t) return;
          const dy = t.clientY - start.y;
          const dx = t.clientX - start.x;
          if (dy > 35 && Math.abs(dy) > Math.abs(dx) * 1.2) {
            setGpsPanelCollapsed(true);
          }
        }}
        style={{
          position: 'relative',
          padding: '14px 16px',
          background: `linear-gradient(145deg, ${COLORS.parchment} 0%, ${COLORS.parchmentDark} 50%, #D4C4A8 100%)`,
          border: `2px solid ${COLORS.gold}`,
          boxShadow: '0 6px 24px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.7)',
          minWidth: '185px',
          transform: gpsPanelCollapsed ? 'translateY(12px) scale(0.985)' : 'translateY(0) scale(1)',
          opacity: gpsPanelCollapsed ? 0 : 1,
          maxHeight: gpsPanelCollapsed ? 0 : 480,
          overflow: 'hidden',
          pointerEvents: gpsPanelCollapsed ? 'none' : 'auto',
          transition: 'transform 0.28s ease, opacity 0.22s ease, max-height 0.28s ease'
        }}
      >
        {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
          <div
            key={corner}
            style={{
              position: 'absolute',
              width: '16px',
              height: '16px',
              ...(corner[0] === 't' ? { top: '-1px' } : { bottom: '-1px' }),
              ...(corner[1] === 'l' ? { left: '-1px' } : { right: '-1px' }),
              borderTop: corner[0] === 't' ? `2px solid ${COLORS.sepia}` : 'none',
              borderBottom: corner[0] === 'b' ? `2px solid ${COLORS.sepia}` : 'none',
              borderLeft: corner[1] === 'l' ? `2px solid ${COLORS.sepia}` : 'none',
              borderRight: corner[1] === 'r' ? `2px solid ${COLORS.sepia}` : 'none'
            }}
          />
        ))}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            paddingBottom: '10px',
            marginBottom: '10px',
            borderBottom: `1px solid ${COLORS.gold}`
          }}
        >
          <div
            style={{
              width: '10px',
              height: '10px',
              background: gpsAccuracy && gpsAccuracy < 15 ? COLORS.success : COLORS.sepia,
              borderRadius: '50%',
              boxShadow: `0 0 8px ${gpsAccuracy && gpsAccuracy < 15 ? 'rgba(45,90,61,0.6)' : 'rgba(139,69,19,0.4)'
                }`
            }}
          />
          <span
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: '11px',
              fontWeight: 600,
              color: COLORS.sepia,
              letterSpacing: '1px',
              textTransform: 'uppercase'
            }}
          >
            Segnale Bussola
          </span>
        </div>

        <div style={{ fontSize: '12px', color: COLORS.inkLight }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontStyle: 'italic' }}>Precisione:</span>
            <span
              style={{
                fontFamily: "'Courier New', monospace",
                fontWeight: 600,
                color: gpsAccuracy && gpsAccuracy < 15 ? COLORS.success : COLORS.sepia
              }}
            >
              ±{gpsAccuracy ? Math.round(gpsAccuracy) : '—'} m
            </span>
          </div>

          {nearestObjectDistance !== null && (
            <>
              <div
                style={{
                  height: '1px',
                  background: `linear-gradient(90deg, transparent, ${COLORS.gold}, transparent)`,
                  margin: '10px 0'
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontStyle: 'italic' }}>Destinazione:</span>
                <span
                  style={{
                    fontWeight: 600,
                    color: COLORS.sepia,
                    fontSize: '11px',
                    maxWidth: '90px',
                    textAlign: 'right'
                  }}
                >
                  {nearestObjectName}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontStyle: 'italic' }}>Distanza:</span>
                <span style={{ fontFamily: "'Courier New', monospace", fontWeight: 600 }}>
                  {Math.round(nearestObjectDistance)} m
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontStyle: 'italic' }}>Raggio:</span>
                <span style={{ fontFamily: "'Courier New', monospace", color: COLORS.gold }}>
                  &lt; {nearestObjectRadius} m
                </span>
              </div>

              <div
                style={{
                  padding: '8px 12px',
                  textAlign: 'center',
                  background: isInZone
                    ? `linear-gradient(135deg, ${COLORS.success} 0%, #1e3d2a 100%)`
                    : `linear-gradient(135deg, ${COLORS.inkLight} 0%, ${COLORS.ink} 100%)`,
                  border: `1px solid ${isInZone ? '#4a9c5d' : COLORS.sepia}`,
                  color: isInZone ? COLORS.successLight : '#8B7355',
                  fontSize: '10px',
                  fontWeight: 600,
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                  boxShadow: isInZone ? '0 0 15px rgba(74, 156, 93, 0.3)' : 'none'
                }}
              >
                {isInZone ? '✦ DENTRO LA ZONA ✦' : '• FUORI ZONA •'}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
