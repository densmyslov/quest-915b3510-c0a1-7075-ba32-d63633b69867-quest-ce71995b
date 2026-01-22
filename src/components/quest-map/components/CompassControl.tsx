import { useState, useRef, useEffect, useCallback } from 'react';
import { COLORS } from './MapStyles';

interface CompassControlProps {
    gpsEnabled: boolean;
    onToggle: () => void;
    heading: number | null;
}

export const CompassControl = ({ gpsEnabled, onToggle, heading }: CompassControlProps) => {
    const [gpsToggleCollapsed, setGpsToggleCollapsed] = useState(false);
    const gpsToggleCollapseTimeoutRef = useRef<number | null>(null);

    const clearGpsToggleCollapseTimeout = useCallback(() => {
        if (gpsToggleCollapseTimeoutRef.current !== null) {
            window.clearTimeout(gpsToggleCollapseTimeoutRef.current);
            gpsToggleCollapseTimeoutRef.current = null;
        }
    }, []);

    const scheduleGpsToggleAutoCollapse = useCallback(() => {
        clearGpsToggleCollapseTimeout();
        gpsToggleCollapseTimeoutRef.current = window.setTimeout(() => {
            setGpsToggleCollapsed(true);
        }, 3000);
    }, [clearGpsToggleCollapseTimeout]);

    const expandGpsToggle = useCallback(() => {
        setGpsToggleCollapsed(false);
        scheduleGpsToggleAutoCollapse();
    }, [scheduleGpsToggleAutoCollapse]);

    useEffect(() => {
        if (!gpsEnabled) {
            setTimeout(() => setGpsToggleCollapsed(false), 0);
            clearGpsToggleCollapseTimeout();
            return;
        }

        setTimeout(() => setGpsToggleCollapsed(false), 0);
        scheduleGpsToggleAutoCollapse();

        return () => {
            clearGpsToggleCollapseTimeout();
        };
    }, [gpsEnabled, scheduleGpsToggleAutoCollapse, clearGpsToggleCollapseTimeout]);

    const handleToggle = (event: React.MouseEvent | React.TouchEvent) => {
        event.preventDefault();
        event.stopPropagation();

        if (gpsEnabled && gpsToggleCollapsed) {
            expandGpsToggle();
            return;
        }
        onToggle();
    };

    return (
        <>
            {/* Control Buttons (GPS Toggle) */}
            <div style={{
                position: 'absolute',
                top: '60px',
                right: '16px',
                zIndex: 4000,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
            }}>
                <button
                    data-testid="gps-toggle"
                    onClick={handleToggle}
                    onTouchStart={(e) => e.stopPropagation()}
                    aria-label={
                        gpsEnabled
                            ? (gpsToggleCollapsed ? 'Espandi controllo bussola' : 'Disattiva bussola')
                            : 'Attiva bussola'
                    }
                    style={{
                        padding: gpsEnabled && gpsToggleCollapsed ? '12px 12px' : '12px 18px',
                        background: gpsEnabled
                            ? `linear-gradient(135deg, ${COLORS.burgundy} 0%, ${COLORS.burgundyDark} 100%)`
                            : `linear-gradient(135deg, ${COLORS.parchment} 0%, ${COLORS.parchmentDark} 100%)`,
                        border: `2px solid ${COLORS.gold}`,
                        color: gpsEnabled ? COLORS.gold : COLORS.sepia,
                        fontFamily: "'Cinzel', serif",
                        fontSize: '11px',
                        fontWeight: 600,
                        letterSpacing: '1px',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: gpsEnabled && gpsToggleCollapsed ? '0' : '8px',
                        boxShadow: gpsEnabled
                            ? '0 6px 24px rgba(114, 47, 55, 0.5), inset 0 1px 0 rgba(255,255,255,0.1)'
                            : '0 6px 24px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.5)',
                        transition: 'all 0.28s ease',
                        textShadow: gpsEnabled ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
                        overflow: 'hidden',
                        maxWidth: gpsEnabled && gpsToggleCollapsed ? '44px' : '220px'
                    }}
                >
                    <span style={{ fontSize: '14px', width: '16px', textAlign: 'center' }}>
                        {gpsEnabled ? '◉' : '◎'}
                    </span>
                    <span style={{
                        whiteSpace: 'nowrap',
                        opacity: gpsEnabled && gpsToggleCollapsed ? 0 : 1,
                        maxWidth: gpsEnabled && gpsToggleCollapsed ? '0px' : '220px',
                        transition: 'opacity 0.18s ease, max-width 0.28s ease',
                        overflow: 'hidden'
                    }}>
                        {gpsEnabled ? 'Bussola Attiva' : 'Attiva Bussola'}
                    </span>
                </button>
            </div>

            {/* Vintage Compass Rose */}
            <div
                data-testid="compass-rose"
                style={{
                    position: 'absolute',
                    bottom: '100px',
                    right: '16px',
                    zIndex: 4000,
                    width: '100px',
                    height: '100px',
                    pointerEvents: 'none',
                    transition: 'transform 0.3s ease-out',
                    transform: heading !== null ? `rotate(${-heading}deg)` : 'none',
                    animation: gpsEnabled ? 'compassGlow 3s ease-in-out infinite' : 'none'
                }}
            >
                <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
                    <defs>
                        <linearGradient id="compassGold" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={COLORS.goldLight} />
                            <stop offset="50%" stopColor={COLORS.gold} />
                            <stop offset="100%" stopColor="#B8944F" />
                        </linearGradient>
                        <linearGradient id="compassDark" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={COLORS.inkLight} />
                            <stop offset="100%" stopColor={COLORS.ink} />
                        </linearGradient>
                        <radialGradient id="compassBg" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="rgba(26, 21, 16, 0.85)" />
                            <stop offset="70%" stopColor="rgba(26, 21, 16, 0.9)" />
                            <stop offset="100%" stopColor="rgba(26, 21, 16, 0.95)" />
                        </radialGradient>
                    </defs>

                    {/* Background circle for contrast */}
                    <circle cx="50" cy="50" r="48" fill="url(#compassBg)" stroke={COLORS.gold} strokeWidth="1" />

                    {/* Outer rings */}
                    <circle cx="50" cy="50" r="46" fill="none" stroke="url(#compassGold)" strokeWidth="2.5" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.4))" />
                    <circle cx="50" cy="50" r="42" fill="none" stroke="url(#compassGold)" strokeWidth="1" opacity="0.5" />

                    {/* Tick marks */}
                    {[...Array(36)].map((_, i) => (
                        <line
                            key={i}
                            x1="50"
                            y1={i % 3 === 0 ? "6" : "9"}
                            x2="50"
                            y2={i % 3 === 0 ? "13" : "11"}
                            stroke={COLORS.gold}
                            strokeWidth={i % 3 === 0 ? "1.5" : "0.8"}
                            transform={`rotate(${i * 10} 50 50)`}
                            opacity={i % 3 === 0 ? 1 : 0.4}
                        />
                    ))}

                    {/* Cardinal points */}
                    <polygon points="50,16 54,50 50,36 46,50" fill={COLORS.burgundy} stroke={COLORS.gold} strokeWidth="0.5" />
                    <polygon points="50,84 46,50 50,64 54,50" fill="url(#compassDark)" stroke={COLORS.gold} strokeWidth="0.5" />
                    <polygon points="84,50 50,46 64,50 50,54" fill="url(#compassDark)" stroke={COLORS.gold} strokeWidth="0.5" />
                    <polygon points="16,50 50,54 36,50 50,46" fill="url(#compassDark)" stroke={COLORS.gold} strokeWidth="0.5" />

                    {/* Center */}
                    <circle cx="50" cy="50" r="7" fill="url(#compassGold)" stroke={COLORS.sepia} strokeWidth="1" />
                    <circle cx="50" cy="50" r="3.5" fill={COLORS.burgundy} stroke={COLORS.gold} strokeWidth="0.5" />
                    <circle cx="50" cy="50" r="1.5" fill={COLORS.gold} />

                    {/* Labels */}
                    <text x="50" y="26" textAnchor="middle" fill={COLORS.burgundy} fontSize="11" fontWeight="bold" fontFamily="'Cinzel', serif">N</text>
                    <text x="74" y="53" textAnchor="middle" fill={COLORS.gold} fontSize="9" fontWeight="bold" fontFamily="'Cinzel', serif">E</text>
                    <text x="50" y="80" textAnchor="middle" fill={COLORS.gold} fontSize="9" fontWeight="bold" fontFamily="'Cinzel', serif">S</text>
                    <text x="26" y="53" textAnchor="middle" fill={COLORS.gold} fontSize="9" fontWeight="bold" fontFamily="'Cinzel', serif">O</text>
                </svg>
            </div>
        </>
    );
};
