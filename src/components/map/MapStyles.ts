import { DivIcon, Icon } from 'leaflet';
import type { CSSProperties } from 'react';

/**
 * Keep these values EXACTLY as they are today to avoid visual diffs.
 */

export const COLORS = {
    parchment: '#F5E6D3',
    parchmentDark: '#E8D4BC',
    sepia: '#704214',
    gold: '#C9A961',
    goldLight: '#D4B978',
    burgundy: '#722F37',
    burgundyDark: '#5a252c',
    ink: '#2C1810',
    inkLight: '#4A3728',
    success: '#2d5a3d',
    successLight: '#a8e6a3',
    player: '#1a3a52'
};

export const MAP_TITLE = 'Esino Lario · 1926';

export const MAP_TITLE_STYLE: CSSProperties = {
    position: 'absolute',
    top: '12px',
    left: '50%',
    transform: 'translate(-50%, 0)',
    zIndex: 5500,
    padding: '10px 28px',
    background: 'linear-gradient(135deg, rgba(26, 21, 16, 0.95) 0%, rgba(44, 36, 28, 0.95) 100%)',
    border: `2px solid ${COLORS.gold}`,
    boxShadow: '0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(201, 169, 97, 0.2)',
    pointerEvents: 'none',
    fontFamily: "'Cinzel', serif",
    fontSize: '14px',
    fontWeight: 700,
    color: COLORS.gold,
    letterSpacing: '4px',
    textTransform: 'uppercase',
    margin: 0,
    whiteSpace: 'nowrap',
    textShadow: '0 2px 4px rgba(0,0,0,0.3)'
};

export const SPECIAL_OBJECT_ITINERARY_NUMBER = 7;
const SPECIAL_OBJECT_MARKER_URL = 'https://imagedelivery.net/PLjImLTp3_--j_ey0SPDBA/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20251224-174159-fcec77b2.gif/public';
const SPECIAL_OBJECT_MARKER_NATURAL_WIDTH = 800;
const SPECIAL_OBJECT_MARKER_NATURAL_HEIGHT = 532;
const SPECIAL_OBJECT_MARKER_MAX_PX = 56;
const SPECIAL_OBJECT_MARKER_SCALE = Math.min(
    SPECIAL_OBJECT_MARKER_MAX_PX / SPECIAL_OBJECT_MARKER_NATURAL_WIDTH,
    SPECIAL_OBJECT_MARKER_MAX_PX / SPECIAL_OBJECT_MARKER_NATURAL_HEIGHT
);
const SPECIAL_OBJECT_MARKER_WIDTH_PX = Math.max(1, Math.round(SPECIAL_OBJECT_MARKER_NATURAL_WIDTH * SPECIAL_OBJECT_MARKER_SCALE));
const SPECIAL_OBJECT_MARKER_HEIGHT_PX = Math.max(1, Math.round(SPECIAL_OBJECT_MARKER_NATURAL_HEIGHT * SPECIAL_OBJECT_MARKER_SCALE));

export const SPECIAL_OBJECT_MARKER_ICON = new Icon({
    iconUrl: SPECIAL_OBJECT_MARKER_URL,
    iconSize: [SPECIAL_OBJECT_MARKER_WIDTH_PX, SPECIAL_OBJECT_MARKER_HEIGHT_PX],
    iconAnchor: [SPECIAL_OBJECT_MARKER_WIDTH_PX / 2, SPECIAL_OBJECT_MARKER_HEIGHT_PX],
    popupAnchor: [0, -SPECIAL_OBJECT_MARKER_HEIGHT_PX],
    className: 'quest-special-marker'
});

/**
 * Escape helper used by popups/HTML strings.
 */
export function escapeHtml(value: unknown) {
    const str = String(value ?? '');
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * If you currently generate marker SVG strings somewhere,
 * move the generator here as-is.
 */
export const createMarkerSVG = (type: 'location' | 'locationSecondary' | 'player' | 'active' | 'activeSecondary'): string => {
    const configs = {
        location: { bg: '#8B4513', border: '#D4A574', inner: '#6B3410', glow: 'rgba(212, 165, 116, 0.6)' },
        locationSecondary: { bg: '#5B3A1B', border: '#C9A961', inner: '#3F2712', glow: 'rgba(201, 169, 97, 0.55)' },
        player: { bg: COLORS.player, border: COLORS.gold, inner: '#0f2a3d', glow: 'rgba(201, 169, 97, 0.7)' },
        active: { bg: COLORS.burgundy, border: '#FFD700', inner: COLORS.burgundyDark, glow: 'rgba(255, 215, 0, 0.8)' },
        activeSecondary: { bg: '#3D2B1F', border: '#FFD700', inner: '#2C1E15', glow: 'rgba(255, 215, 0, 0.75)' }
    };
    const c = configs[type];

    return `
        <svg viewBox="0 0 36 48" width="36" height="48" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="pin-${type}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${c.border}"/>
                    <stop offset="50%" stop-color="${c.bg}"/>
                    <stop offset="100%" stop-color="${c.border}"/>
                </linearGradient>
                <filter id="shadow-${type}" x="-50%" y="-30%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity="0.5"/>
                    <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="${c.glow}" flood-opacity="0.8"/>
                </filter>
            </defs>
            <path d="M18 0 C8 0 0 8 0 18 C0 28 18 48 18 48 C18 48 36 28 36 18 C36 8 28 0 18 0"
                  fill="url(#pin-${type})" stroke="${c.border}" stroke-width="2.5" filter="url(#shadow-${type})"/>
            <circle cx="18" cy="16" r="10" fill="${c.inner}" stroke="${c.border}" stroke-width="1.5"/>
            <line x1="18" y1="8" x2="18" y2="12" stroke="${c.border}" stroke-width="1.5"/>
            <line x1="18" y1="20" x2="18" y2="24" stroke="${c.border}" stroke-width="1.5"/>
            <line x1="10" y1="16" x2="14" y2="16" stroke="${c.border}" stroke-width="1.5"/>
            <line x1="22" y1="16" x2="26" y2="16" stroke="${c.border}" stroke-width="1.5"/>
            <circle cx="18" cy="16" r="3" fill="${c.border}"/>
        </svg>
    `;
};

/**
 * Icon factory. Keep EXACT Leaflet options, sizes, anchors, classNames.
 */
export const createVintageIcon = (
    type: 'location' | 'locationSecondary' | 'player' | 'active' | 'activeSecondary',
    label?: string | number | null
) => {
    const labelText = label === null || label === undefined ? '' : String(label);
    const labelFontSizePx = labelText.length <= 2 ? 11 : labelText.length === 3 ? 10 : 9;
    const labelHtml = labelText
        ? `<div style="position:absolute;top:16px;left:18px;transform:translate(-50%,-50%);font-family:'Cinzel',serif;font-weight:700;font-size:${labelFontSizePx}px;letter-spacing:0.5px;color:${COLORS.goldLight};text-shadow:0 1px 2px rgba(0,0,0,0.75);pointer-events:none;user-select:none;">${escapeHtml(labelText)}</div>`
        : '';

    return new DivIcon({
        className: '',
        html: `<div style="position:relative;width:36px;height:48px;">${createMarkerSVG(type)}${labelHtml}${type === 'active' || type === 'activeSecondary' ? `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:50px;height:50px;border:2px solid #FFD700;border-radius:50%;animation:questPulse 2s ease-out infinite;pointer-events:none;"></div>` : ''
            }</div>`,
        iconSize: [36, 48],
        iconAnchor: [18, 48],
        popupAnchor: [0, -48]
    });
};
