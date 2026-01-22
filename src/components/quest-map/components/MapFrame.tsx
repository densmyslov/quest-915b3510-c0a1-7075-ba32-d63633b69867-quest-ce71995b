import { COLORS, MAP_TITLE, MAP_TITLE_STYLE } from './MapStyles';

export const MapFrame = () => {
    return (
        <>
            {/* Top Title */}
            <div className="map-title-top" style={MAP_TITLE_STYLE} aria-hidden="true">{MAP_TITLE}</div>

            {/* Map Border Frame */}
            <div style={{
                position: 'absolute',
                inset: 0,
                border: `3px solid ${COLORS.gold}`,
                boxShadow: `inset 0 0 20px rgba(26, 21, 16, 0.5), inset 0 0 60px rgba(26, 21, 16, 0.3)`,
                pointerEvents: 'none',
                zIndex: 2500
            }} />

            {/* Decorative Art Deco Corners */}
            {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((pos) => (
                <div key={pos} style={{
                    position: 'absolute',
                    width: '70px',
                    height: '70px',
                    zIndex: 3000,
                    pointerEvents: 'none',
                    ...(pos.includes('top') ? { top: 0 } : { bottom: 0 }),
                    ...(pos.includes('left') ? { left: 0 } : { right: 0 }),
                    transform: `scale(${pos.includes('right') ? -1 : 1}, ${pos.includes('bottom') ? -1 : 1})`
                }}>
                    <svg viewBox="0 0 70 70" style={{ width: '100%', height: '100%' }}>
                        <defs>
                            <linearGradient id="cornerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor={COLORS.goldLight} />
                                <stop offset="50%" stopColor={COLORS.gold} />
                                <stop offset="100%" stopColor="#B8944F" />
                            </linearGradient>
                        </defs>
                        <path d="M0 70 L0 0 L70 0 L70 8 L8 8 L8 70 Z" fill="url(#cornerGrad)" filter="drop-shadow(2px 2px 3px rgba(0,0,0,0.4))" />
                        <path d="M0 60 L0 0 L60 0 L60 5 L5 5 L5 60 Z" fill="none" stroke={COLORS.sepia} strokeWidth="1" opacity="0.6" />
                        <circle cx="12" cy="12" r="3" fill={COLORS.burgundy} stroke={COLORS.gold} strokeWidth="1" />
                    </svg>
                </div>
            ))}

            {/* Vignette Overlay for dramatic contrast */}
            <div style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 2000,
                background: 'radial-gradient(circle at 50% 50%, transparent 40%, rgba(26, 21, 16, 0.4) 100%)'
            }} />

            {/* Bottom Quest Title */}
            <div
                className="map-title-bottom-container"
                style={{
                    padding: '6px 20px',
                    background: 'rgba(26, 21, 16, 0.9)',
                    border: `1px solid ${COLORS.gold}`,
                    boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                    pointerEvents: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                }}
            >
                <img
                    src="https://imagedelivery.net/PLjImLTp3_--j_ey0SPDBA/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20251218-105300-ec332c78.png/public"
                    alt="Dossier"
                    style={{
                        height: '24px',
                        width: 'auto',
                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
                    }}
                />
                <span style={{
                    fontFamily: "'Cinzel', serif",
                    fontSize: '10px',
                    color: COLORS.gold,
                    letterSpacing: '2px',
                    textTransform: 'uppercase',
                    textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                }}>
                    Il Giuramento dei Due Borghi
                </span>
            </div>
        </>
    );
};
