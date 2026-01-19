import React from 'react';
import { midiToHsl } from '../../domain/colors';
import type { FountainMap } from './fountainMap';

type Stone = {
    stoneId: string;
    pitch: number;
    color?: string;
    label?: string;
};

const cssColorToHex = (() => {
    let ctx: CanvasRenderingContext2D | null = null;
    const ensure = () => {
        if (ctx) return ctx;
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        ctx = canvas.getContext('2d');
        return ctx;
    };
    return (color: string, fallbackHex = 0xffffff): number => {
        try {
            const c = (color || '').trim();
            if (!c) return fallbackHex;
            if (c.startsWith('#')) {
                const h = c.slice(1);
                const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h;
                const n = Number.parseInt(full, 16);
                if (Number.isFinite(n)) return n;
            }
            const context = ensure();
            if (!context) return fallbackHex;
            context.fillStyle = '#000';
            context.fillStyle = c;
            const computed = String(context.fillStyle).trim();
            if (computed.startsWith('#')) {
                const h = computed.slice(1);
                const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h;
                const n = Number.parseInt(full, 16);
                if (Number.isFinite(n)) return n;
            }
            const m = computed.match(/^rgba?\(\s*(\d+)\s*(?:,|\s)\s*(\d+)\s*(?:,|\s)\s*(\d+)/i);
            if (!m) return fallbackHex;
            const r = Math.max(0, Math.min(255, Number(m[1])));
            const g = Math.max(0, Math.min(255, Number(m[2])));
            const b = Math.max(0, Math.min(255, Number(m[3])));
            return (r << 16) | (g << 8) | b;
        } catch {
            return fallbackHex;
        }
    };
})();

async function loadPixiTextureWithFallback(PIXI: any, id: string, imageUrl: string, objectUrlMap: Map<string, string>) {
    try {
        return (await PIXI.Assets.load({ src: imageUrl, parser: 'loadTextures' })) as any;
    } catch (err) {
        console.warn('[MusicalCodeFountain] Assets.load failed, falling back to fetch:', imageUrl, err);
    }
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const prev = objectUrlMap.get(id);
    if (prev) URL.revokeObjectURL(prev);
    objectUrlMap.set(id, objectUrl);
    const texture = PIXI.Texture.from(objectUrl);
    texture.source.once('destroy', () => {
        const u = objectUrlMap.get(id);
        if (u) URL.revokeObjectURL(u);
        objectUrlMap.delete(id);
    });
    return texture;
}

export function FountainPixiOverlay(props: {
    imageUrl: string;
    map: FountainMap;
    viewBox: { x: number; y: number; w: number; h: number };
    stoneIdToStone: Map<string, Stone>;
    disabled: boolean;
    hintAlpha: number; // 0..1
    hintMode: 'always' | 'memory' | 'off';
    hintStrength?: 'normal' | 'strong';
    effectsEnabled: boolean;
    onPressStoneId: (stoneId: string) => void;
    activeRegionIds: string[];
    style?: React.CSSProperties;
}) {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const appRef = React.useRef<any>(null);
    const pixiRef = React.useRef<any>(null);
    const worldRef = React.useRef<any>(null);
    const regionsLayerRef = React.useRef<any>(null);
    const effectsLayerRef = React.useRef<any>(null);
    const textureSizeRef = React.useRef<{ w: number; h: number } | null>(null);
    const regionsRef = React.useRef<Array<{
        regionId: string;
        stoneId: string;
        pointsPx: Array<{ x: number; y: number }>;
        centroid: { x: number; y: number };
        color: number;
        g: any;
    }>>([]);
    const effectsRef = React.useRef<Array<{ g: any; startMs: number; durationMs: number; type: 'ripple' | 'particle'; x?: number; y?: number; vx?: number; vy?: number }>>([]);
    const objectUrlsRef = React.useRef<Map<string, string>>(new Map());
    const [aspectRatio, setAspectRatio] = React.useState<number>(16 / 9);
    const [pixiOk, setPixiOk] = React.useState(false);

    const hintAlphaRef = React.useRef(props.hintAlpha);
    const disabledRef = React.useRef(props.disabled);
    const effectsEnabledRef = React.useRef(props.effectsEnabled);
    const hintModeRef = React.useRef(props.hintMode);
    const hintStrengthRef = React.useRef(props.hintStrength);
    const onPressStoneIdRef = React.useRef(props.onPressStoneId);
    const activeRegionIdsRef = React.useRef(props.activeRegionIds);

    React.useEffect(() => { hintAlphaRef.current = props.hintAlpha; }, [props.hintAlpha]);
    React.useEffect(() => { disabledRef.current = props.disabled; }, [props.disabled]);
    React.useEffect(() => { effectsEnabledRef.current = props.effectsEnabled; }, [props.effectsEnabled]);
    React.useEffect(() => { hintModeRef.current = props.hintMode; }, [props.hintMode]);
    React.useEffect(() => { hintStrengthRef.current = props.hintStrength; }, [props.hintStrength]);
    React.useEffect(() => { onPressStoneIdRef.current = props.onPressStoneId; }, [props.onPressStoneId]);
    React.useEffect(() => { activeRegionIdsRef.current = props.activeRegionIds; }, [props.activeRegionIds]);

    const mapRef = React.useRef(props.map);
    const stoneIdToStoneRef = React.useRef(props.stoneIdToStone);
    const viewBoxRef = React.useRef(props.viewBox);

    const rebuildRegions = React.useCallback(() => {
        const PIXI = pixiRef.current;
        const regionsLayer = regionsLayerRef.current;
        const effectsLayer = effectsLayerRef.current;
        const tex = textureSizeRef.current;
        if (!PIXI || !regionsLayer || !effectsLayer || !tex) return;

        for (const r of regionsRef.current) {
            try {
                regionsLayer.removeChild(r.g);
                r.g.destroy();
            } catch { }
        }
        regionsRef.current = [];

        for (const eff of effectsRef.current) {
            try {
                effectsLayer.removeChild(eff.g);
                eff.g.destroy();
            } catch { }
        }
        effectsRef.current = [];

        const vb = viewBoxRef.current;
        const toPx = (p: { x: number; y: number }) => {
            const xn = (p.x - vb.x) / vb.w;
            const yn = (p.y - vb.y) / vb.h;
            return { x: xn * tex.w, y: yn * tex.h };
        };

        for (const r of mapRef.current.regions) {
            const stone = stoneIdToStoneRef.current.get(String(r.stoneId)) ?? null;
            const c = cssColorToHex(stone?.color ?? (stone ? midiToHsl(stone.pitch) : '#60a5fa'), 0x60a5fa);
            const pointsPx = (r.points || []).map(toPx);
            if (pointsPx.length < 3) continue;

            let cx = 0;
            let cy = 0;
            for (const p of pointsPx) { cx += p.x; cy += p.y; }
            cx /= pointsPx.length;
            cy /= pointsPx.length;

            const g = new PIXI.Graphics();
            g.eventMode = 'static';
            g.cursor = 'pointer';
            const flat = pointsPx.flatMap(p => [p.x, p.y]);
            g.hitArea = new PIXI.Polygon(flat);
            g.on('pointerdown', (e: any) => {
                e?.stopPropagation?.();
                if (disabledRef.current) return;
                onPressStoneIdRef.current(String(r.stoneId));

                if (!effectsEnabledRef.current) return;
                const now = performance.now();
                const ripple = new PIXI.Graphics();
                ripple.eventMode = 'none';
                effectsLayer.addChild(ripple);
                effectsRef.current.push({ g: ripple, startMs: now, durationMs: 520, type: 'ripple', x: cx, y: cy });

                for (let i = 0; i < 10; i++) {
                    const dot = new PIXI.Graphics();
                    dot.eventMode = 'none';
                    effectsLayer.addChild(dot);
                    const a = (Math.PI * 2 * i) / 10 + (Math.random() - 0.5) * 0.6;
                    const speed = (Math.min(tex.w, tex.h) * 0.0012) * (0.7 + Math.random() * 0.8);
                    effectsRef.current.push({ g: dot, startMs: now, durationMs: 420 + Math.random() * 180, type: 'particle', vx: Math.cos(a) * speed, vy: Math.sin(a) * speed });
                    (dot as any).__x = cx;
                    (dot as any).__y = cy;
                }
            });
            regionsLayer.addChild(g);

            regionsRef.current.push({
                regionId: r.regionId,
                stoneId: String(r.stoneId),
                pointsPx,
                centroid: { x: cx, y: cy },
                color: c,
                g,
            });
        }
    }, []);

    React.useEffect(() => {
        mapRef.current = props.map;
        rebuildRegions();
    }, [props.map, rebuildRegions]);

    React.useEffect(() => {
        stoneIdToStoneRef.current = props.stoneIdToStone;
        rebuildRegions();
    }, [props.stoneIdToStone, rebuildRegions]);

    React.useEffect(() => {
        viewBoxRef.current = props.viewBox;
        rebuildRegions();
    }, [props.viewBox, rebuildRegions]);

    React.useEffect(() => {
        let alive = true;
        const container = containerRef.current;
        if (!container) return;

        const doResize = () => {
            if (!alive) return;
            const app = appRef.current;
            const renderer = app?.renderer;
            const world = worldRef.current;
            const tex = textureSizeRef.current;
            if (!renderer || !world || !tex) return;
            const w = container.clientWidth || 1;
            const h = container.clientHeight || 1;
            renderer.resize(w, h);
            const scale = Math.min(w / tex.w, h / tex.h);
            world.scale.set(scale);
            world.position.set((w - tex.w * scale) / 2, (h - tex.h * scale) / 2);
        };

        const ro = new ResizeObserver(() => doResize());

        (async () => {
            try {
                const PIXI = await import('pixi.js');
                if (!alive) return;
                pixiRef.current = PIXI;

                const app = new PIXI.Application();
                await app.init({
                    width: container.clientWidth || 800,
                    height: container.clientHeight || 450,
                    backgroundAlpha: 0,
                    antialias: true,
                    resolution: window.devicePixelRatio || 1,
                    autoDensity: true,
                });
                if (!alive) {
                    app.destroy(true);
                    return;
                }
                container.innerHTML = '';
                container.appendChild(app.canvas);
                appRef.current = app;

                const texture = await loadPixiTextureWithFallback(PIXI, 'fountain', props.imageUrl, objectUrlsRef.current);
                if (!alive) return;
                const texW = texture.width || texture.baseTexture?.width || 1;
                const texH = texture.height || texture.baseTexture?.height || 1;
                textureSizeRef.current = { w: texW, h: texH };
                setAspectRatio(texW / texH);
                setPixiOk(true);

                const stage = app.stage;
                stage.eventMode = 'static';

                const world = new PIXI.Container();
                worldRef.current = world;
                stage.addChild(world);

                const bg = new PIXI.Sprite(texture);
                bg.eventMode = 'none';
                world.addChild(bg);

                const regionsLayer = new PIXI.Container();
                regionsLayerRef.current = regionsLayer;
                world.addChild(regionsLayer);

                const effectsLayer = new PIXI.Container();
                effectsLayerRef.current = effectsLayer;
                world.addChild(effectsLayer);

                rebuildRegions();
                ro.observe(container);
                doResize();

                const drawRegions = () => {
                    const ha = Math.max(0, Math.min(1, hintAlphaRef.current));
                    const mode = hintModeRef.current;
                    const strength: 'normal' | 'strong' = hintStrengthRef.current === 'strong' ? 'strong' : 'normal';
                    const maxStroke = strength === 'strong' ? 1 : 0.9;
                    const maxFill = strength === 'strong' ? 0.34 : 0.16;
                    const minStroke = mode === 'always' ? (strength === 'strong' ? 0.22 : 0.12) : mode === 'memory' ? 0.02 : 0;
                    const minFill = mode === 'always' ? (strength === 'strong' ? 0.06 : 0.02) : mode === 'memory' ? 0.0005 : 0;
                    const strokeAlpha = minStroke + ha * (maxStroke - minStroke);
                    const fillAlpha = minFill + ha * (maxFill - minFill);

                    const activeSet = new Set(activeRegionIdsRef.current || []);

                    for (const r of regionsRef.current) {
                        const g = r.g;
                        g.clear();
                        const pts = r.pointsPx;
                        g.poly(pts);

                        // Check by both regionId and stoneId for compatibility
                        const isActive = activeSet.has(r.regionId) || activeSet.has(r.stoneId);
                        const rFillAlpha = isActive ? 0.6 : fillAlpha;
                        const rStrokeAlpha = isActive ? 1.0 : strokeAlpha;

                        g.fill({ color: r.color, alpha: rFillAlpha });
                        g.poly(pts);
                        g.stroke({ width: isActive ? 6 : 3, color: isActive ? 0xffffff : r.color, alpha: rStrokeAlpha });

                        if (ha > 0.01 || isActive) {
                            g.poly(pts);
                            g.stroke({ width: isActive ? 12 : 8, color: r.color, alpha: rStrokeAlpha * 0.15 });
                        }
                    }
                };

                app.ticker.add(() => {
                    if (!alive) return;
                    drawRegions();

                    const now = performance.now();
                    const keep: typeof effectsRef.current = [];
                    for (const eff of effectsRef.current) {
                        const t = (now - eff.startMs) / eff.durationMs;
                        if (t >= 1) {
                            try { eff.g.destroy(); } catch { }
                            continue;
                        }
                        const g = eff.g;
                        g.clear();
                        if (eff.type === 'ripple') {
                            const a = 1 - t;
                            const radius = (Math.min(texW, texH) * 0.02) + (Math.min(texW, texH) * 0.08) * t;
                            const cx = typeof eff.x === 'number' ? eff.x : texW / 2;
                            const cy = typeof eff.y === 'number' ? eff.y : texH / 2;
                            g.circle(cx, cy, radius);
                            g.stroke({ width: 6, color: 0xffffff, alpha: 0.18 * a });
                        } else {
                            const a = 1 - t;
                            const x = ((g as any).__x ?? texW / 2) + (eff.vx ?? 0) * (1 + t * 30);
                            const y = ((g as any).__y ?? texH / 2) + (eff.vy ?? 0) * (1 + t * 30);
                            (g as any).__x = x;
                            (g as any).__y = y;
                            g.circle(x, y, 3 + 2 * (1 - a));
                            g.fill({ color: 0xffffff, alpha: 0.6 * a });
                        }
                        keep.push(eff);
                    }
                    effectsRef.current = keep;
                });
            } catch (e) {
                setPixiOk(false);
                console.warn('[MusicalCodeFountain] Pixi overlay init failed:', e);
            }
        })();

        return () => {
            alive = false;
            setPixiOk(false);
            try { ro.disconnect(); } catch { }
            try { appRef.current?.destroy(true); } catch { }
            appRef.current = null;
            pixiRef.current = null;
            worldRef.current = null;
            regionsLayerRef.current = null;
            effectsLayerRef.current = null;
            textureSizeRef.current = null;
            regionsRef.current = [];
            effectsRef.current = [];
            for (const u of objectUrlsRef.current.values()) {
                try { URL.revokeObjectURL(u); } catch { }
            }
            objectUrlsRef.current.clear();
            container.innerHTML = '';
        };
    }, [props.imageUrl, rebuildRegions]);

    return (
        <div style={{
            position: 'relative',
            width: '100%',
            border: '1px solid #222',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'rgba(0,0,0,0.2)',
            aspectRatio,
            ...props.style
        }}>
            <div style={{ position: 'absolute', inset: 0, opacity: pixiOk ? 0 : 1, pointerEvents: pixiOk ? 'none' : 'auto' as any }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={props.imageUrl} alt="Fountain" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} draggable={false} />
                <svg
                    viewBox={`${props.viewBox.x} ${props.viewBox.y} ${props.viewBox.w} ${props.viewBox.h}`}
                    preserveAspectRatio="none"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                >
                    {props.map.regions.map(r => {
                        const stone = props.stoneIdToStone.get(String(r.stoneId)) ?? null;
                        const color = stone?.color ?? (stone ? midiToHsl(stone.pitch) : '#60a5fa');
                        const ha = Math.max(0, Math.min(1, props.hintAlpha));
                        const strength: 'normal' | 'strong' = props.hintStrength === 'strong' ? 'strong' : 'normal';
                        const maxStroke = strength === 'strong' ? 1 : 0.9;
                        const maxFill = strength === 'strong' ? 0.34 : 0.16;
                        const minStroke =
                            props.hintMode === 'always' ? (strength === 'strong' ? 0.22 : 0.12) : props.hintMode === 'memory' ? 0.02 : 0;
                        const minFill =
                            props.hintMode === 'always' ? (strength === 'strong' ? 0.06 : 0.02) : props.hintMode === 'memory' ? 0.0005 : 0;
                        const strokeAlpha = minStroke + ha * (maxStroke - minStroke);
                        const fillAlpha = minFill + ha * (maxFill - minFill);
                        const canPress = !props.disabled;
                        const pts = (r.points || []).map(p => `${p.x},${p.y}`).join(' ');

                        // Check by both regionId and stoneId for compatibility
                        const isActive = props.activeRegionIds.includes(r.regionId) || props.activeRegionIds.includes(String(r.stoneId));
                        const rFillAlpha = isActive ? 0.6 : fillAlpha;
                        const rStrokeAlpha = isActive ? 1.0 : strokeAlpha;

                        return (
                            <polygon
                                key={r.regionId}
                                points={pts}
                                fill={color}
                                fillOpacity={rFillAlpha}
                                stroke={isActive ? '#ffffff' : color}
                                strokeOpacity={rStrokeAlpha}
                                strokeWidth={(props.viewBox.w <= 1.01 ? 0.006 : 3) * (isActive ? 2 : 1)}
                                style={{ cursor: canPress ? 'pointer' : 'default' }}
                                onPointerDown={(e) => {
                                    e.preventDefault();
                                    if (!canPress) return;
                                    onPressStoneIdRef.current(String(r.stoneId));
                                }}
                            />
                        );
                    })}
                </svg>
            </div>
            <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        </div>
    );
}
