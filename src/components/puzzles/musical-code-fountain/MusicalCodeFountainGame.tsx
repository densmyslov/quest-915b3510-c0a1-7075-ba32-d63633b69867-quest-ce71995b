'use client';

import React from 'react';
import { useQuest } from '@/context/QuestContext';
import { musicXmlToReference, type MusicalReference, type MusicalReferenceEvent } from '@/lib/musicxmlToReference';

type Stone = {
  stoneId: string;
  pitch: number;
  color?: string;
  label?: string;
};

type FountainMapPoint = { x: number; y: number };
type FountainMapRegion = {
  regionId: string;
  stoneId: string;
  points: FountainMapPoint[];
};
type FountainMap = {
  version: 1;
  coordinateSpace?: 'normalized' | 'pixels';
  imageSize?: { width: number; height: number };
  regions: FountainMapRegion[];
};

type MusicalCodeFountainPuzzleData = {
  musicXmlUrl?: string;
  musicXml?: string;
  reference?: MusicalReference;
  referenceUrl?: string;
  fountainImageUrl?: string;
  fountainMap?: FountainMap;
  fountainMapUrl?: string;
  fountainHintMode?: 'always' | 'memory' | 'off';
  fountainHintDurationMs?: number;
  fountainHintFadeMs?: number;
  fountainEffectsEnabled?: boolean;
  selectedPartId?: string;
  selectedPartIndex?: number;
  bpmOverride?: number;
  loops?: number;
  countInBeats?: number;
  hitWindowMs?: number;
  passThreshold?: number;
  maxExtraNotes?: number;
  maxMissingNotes?: number;
  stones?: Stone[];
};

type PlayerEvent = { pitch: number; tLocalMs: number };

type JudgeResult = {
  pass: boolean;
  accuracy: number; // pitch + time
  pitchAccuracy: number;
  hitWindowMs: number;
  maxExtraNotes: number;
  maxMissingNotes: number;
  anchorOffsetMs: number;
  perNote: Array<{
    noteId: string;
    expectedMs: number;
    actualMs: number | null;
    pitchExpected: number;
    pitchActual: number | null;
    okPitch: boolean;
    okTime: boolean;
    offsetMs: number | null;
    windowMs: number;
    matchedPlayerIndex: number | null;
  }>;
  extras: Array<{ pitch: number; actualMs: number; playerIndex: number }>;
  telemetry: {
    matched: number;
    missing: number;
    extras: number;
    meanOffsetMs: number | null;
    stdOffsetMs: number | null;
  };
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const PUZZLE_DATA_WORKER_BASE_URL =
  process.env.NEXT_PUBLIC_PUZZLE_DATA_WORKER_URL ||
  process.env.NEXT_PUBLIC_PUZZLE_DATA_PROXY_URL ||
  'https://quest-data-proxy-dev.denslov.workers.dev';

const stripLeadingSlashes = (s: string) => s.replace(/^\/+/, '');

const toPuzzleAssetUrl = (key: string): string => {
  const cleaned = stripLeadingSlashes(key);
  if (!cleaned) return '';
  return `${PUZZLE_DATA_WORKER_BASE_URL.replace(/\/+$/, '')}/${cleaned}`;
};

const absolutiseNonImageUrl = (u: unknown): string => {
  const s = typeof u === 'string' ? u : '';
  if (!s) return '';
  if (s.startsWith('data:')) return s;
  if (s.startsWith('http')) return s;
  return toPuzzleAssetUrl(s);
};

const midiToHsl = (midi: number) => {
  const hue = ((midi * 37) % 360 + 360) % 360;
  return `hsl(${hue} 85% 55%)`;
};

const lightenCssColor = (color: string, amount01: number): string => {
  const amount = Math.max(0, Math.min(1, amount01));
  const c = (color || '').trim();

  const hex = c.startsWith('#') ? c.slice(1) : null;
  if (hex && (hex.length === 3 || hex.length === 6)) {
    const full = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex;
    const n = Number.parseInt(full, 16);
    if (Number.isFinite(n)) {
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      const rr = Math.round(r + (255 - r) * amount);
      const gg = Math.round(g + (255 - g) * amount);
      const bb = Math.round(b + (255 - b) * amount);
      return `rgb(${rr} ${gg} ${bb})`;
    }
  }

  const m = c.match(/^hsla?\(\s*([0-9.+-]+)\s*(?:,|\s)\s*([0-9.+-]+)%\s*(?:,|\s)\s*([0-9.+-]+)%/i);
  if (m) {
    const h = Number(m[1]);
    const s = Number(m[2]);
    const l = Number(m[3]);
    if ([h, s, l].every(x => Number.isFinite(x))) {
      const ll = Math.max(0, Math.min(100, l + (100 - l) * amount));
      return `hsl(${h} ${s}% ${ll}%)`;
    }
  }

  return c || '#ffffff';
};

const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

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
      const computed = String(context.fillStyle); // usually rgb(...)
      const m = computed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
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

function computeLoopDurationMs(events: MusicalReferenceEvent[]): number {
  let end = 0;
  for (const e of events) {
    end = Math.max(end, e.startTimeMs + e.durationMs);
  }
  return Math.max(0, end);
}

function computePerNoteWindows(params: {
  reference: MusicalReference;
  hitWindowMs: number;
}): number[] {
  const { reference, hitWindowMs } = params;
  const minWindowMs = 60;
  const out: number[] = [];
  const evs = reference.events;
  for (let i = 0; i < evs.length; i++) {
    const cur = evs[i]!;
    const next = evs[i + 1] ?? null;
    let ioi = next ? next.startTimeMs - cur.startTimeMs : cur.durationMs;
    if (!Number.isFinite(ioi) || ioi <= 0) ioi = cur.durationMs;
    if (!Number.isFinite(ioi) || ioi <= 0) ioi = 500;
    const w = Math.max(minWindowMs, Math.min(hitWindowMs, Math.floor(ioi * 0.45)));
    out.push(w);
  }
  return out;
}

type JudgeAttemptParams = {
  reference: MusicalReference;
  player: PlayerEvent[];
  hitWindowMs: number;
  passThreshold: number;
  maxExtraNotes: number;
  maxMissingNotes: number;
};

function buildOffsetCandidates(params: {
  reference: MusicalReference;
  player: PlayerEvent[];
}): number[] {
  const { reference, player } = params;
  const ref = reference.events;
  const n = ref.length;
  const m = player.length;
  const out: number[] = [];

  if (n > 0 && m > 0) out.push(player[0]!.tLocalMs - ref[0]!.startTimeMs);
  out.push(0);

  const kRef = Math.min(8, n);
  const kPlayer = Math.min(8, m);
  for (let i = 0; i < kRef; i++) {
    for (let j = 0; j < kPlayer; j++) {
      if (ref[i]!.pitch !== player[j]!.pitch) continue;
      out.push(player[j]!.tLocalMs - ref[i]!.startTimeMs);
    }
  }

  const unique = new Map<number, number>();
  for (const o of out) {
    const key = Math.round(o);
    if (!unique.has(key)) unique.set(key, o);
  }
  return Array.from(unique.values()).slice(0, 24);
}

function judgeAttemptV3(params: JudgeAttemptParams): JudgeResult {
  const { reference, player, hitWindowMs, passThreshold, maxExtraNotes, maxMissingNotes } = params;
  const ref = reference.events;
  const n = ref.length;
  const m = player.length;
  const windows = computePerNoteWindows({ reference, hitWindowMs });

  if (n === 0) {
    return {
      pass: false,
      accuracy: 0,
      pitchAccuracy: 0,
      hitWindowMs,
      maxExtraNotes,
      maxMissingNotes,
      anchorOffsetMs: 0,
      perNote: [],
      extras: player.map((p, idx) => ({ pitch: p.pitch, actualMs: p.tLocalMs, playerIndex: idx })),
      telemetry: { matched: 0, missing: 0, extras: m, meanOffsetMs: null, stdOffsetMs: null },
    };
  }

  const candidates = buildOffsetCandidates({ reference, player });

  type AlignmentCell = { cost: number; prev: 'match' | 'del' | 'ins' | null };
  const costDel = 2; // missing expected note
  const costIns = 1; // extra played note

  const evaluateOffset = (anchorOffsetMs: number) => {
    const dp: AlignmentCell[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => ({ cost: 0, prev: null })));

    dp[0]![0] = { cost: 0, prev: null };
    for (let i = 1; i <= n; i++) dp[i]![0] = { cost: dp[i - 1]![0]!.cost + costDel, prev: 'del' };
    for (let j = 1; j <= m; j++) dp[0]![j] = { cost: dp[0]![j - 1]!.cost + costIns, prev: 'ins' };

    const matchCost = (i: number, j: number): number => {
      const r = ref[i]!;
      const p = player[j]!;
      const expectedMs = r.startTimeMs;
      const actualMs = p.tLocalMs - anchorOffsetMs;
      const w = windows[i] ?? hitWindowMs;
      const dt = Math.abs(actualMs - expectedMs);

      if (r.pitch === p.pitch) {
        // Prefer on-time matches; allow off-time but penalize.
        const normalized = dt / Math.max(1, w);
        return Math.min(6, normalized);
      }

      // Pitch mismatch: prefer treating as substitution vs delete+insert, but more expensive than a good match.
      const normalized = dt / Math.max(1, w);
      return 2 + Math.min(4, normalized);
    };

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const costMatch = dp[i - 1]![j - 1]!.cost + matchCost(i - 1, j - 1);
        const costDelHere = dp[i - 1]![j]!.cost + costDel;
        const costInsHere = dp[i]![j - 1]!.cost + costIns;

        let best = costMatch;
        let prev: AlignmentCell['prev'] = 'match';
        if (costDelHere < best) {
          best = costDelHere;
          prev = 'del';
        }
        if (costInsHere < best) {
          best = costInsHere;
          prev = 'ins';
        }
        dp[i]![j] = { cost: best, prev };
      }
    }

    const perNote: JudgeResult['perNote'] = Array.from({ length: n }, (_, i) => {
      const r = ref[i]!;
      return {
        noteId: r.noteId,
        expectedMs: r.startTimeMs,
        actualMs: null,
        pitchExpected: r.pitch,
        pitchActual: null,
        okPitch: false,
        okTime: false,
        offsetMs: null,
        windowMs: windows[i] ?? hitWindowMs,
        matchedPlayerIndex: null,
      };
    });
    const extras: JudgeResult['extras'] = [];

    let i = n;
    let j = m;
    const usedPlayers = new Set<number>();
    while (i > 0 || j > 0) {
      const cell = dp[i]![j]!;
      const prev = cell.prev;
      if (prev === 'match') {
        const ri = i - 1;
        const pj = j - 1;
        const r = ref[ri]!;
        const p = player[pj]!;
        const expectedMs = r.startTimeMs;
        const actualMs = p.tLocalMs - anchorOffsetMs;
        const w = windows[ri] ?? hitWindowMs;
        const dt = actualMs - expectedMs;
        perNote[ri] = {
          noteId: r.noteId,
          expectedMs,
          actualMs,
          pitchExpected: r.pitch,
          pitchActual: p.pitch,
          okPitch: r.pitch === p.pitch,
          okTime: Math.abs(dt) <= w,
          offsetMs: dt,
          windowMs: w,
          matchedPlayerIndex: pj,
        };
        usedPlayers.add(pj);
        i--;
        j--;
        continue;
      }
      if (prev === 'del') {
        i--;
        continue;
      }
      if (prev === 'ins') {
        j--;
        continue;
      }
      break;
    }

    for (let idx = 0; idx < m; idx++) {
      if (usedPlayers.has(idx)) continue;
      const p = player[idx]!;
      extras.push({ pitch: p.pitch, actualMs: p.tLocalMs - anchorOffsetMs, playerIndex: idx });
    }

    let pitchCorrect = 0;
    let timeCorrect = 0;
    const offsets: number[] = [];
    for (const pn of perNote) {
      if (pn.actualMs === null || pn.pitchActual === null) continue;
      if (pn.okPitch) {
        pitchCorrect++;
        if (pn.okTime) {
          timeCorrect++;
          if (typeof pn.offsetMs === 'number' && Number.isFinite(pn.offsetMs)) offsets.push(pn.offsetMs);
        }
      }
    }

    const pitchAccuracy = pitchCorrect / n;
    const accuracy = timeCorrect / n;
    const missing = perNote.filter(x => x.actualMs === null).length;

    const meanOffsetMs = offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : null;
    const stdOffsetMs = offsets.length && meanOffsetMs !== null
      ? Math.sqrt(offsets.reduce((a, b) => a + Math.pow(b - meanOffsetMs, 2), 0) / offsets.length)
      : null;

    const pass =
      pitchAccuracy >= passThreshold &&
      accuracy >= passThreshold &&
      missing <= maxMissingNotes &&
      extras.length <= maxExtraNotes;

    return {
      pass,
      accuracy,
      pitchAccuracy,
      hitWindowMs,
      maxExtraNotes,
      maxMissingNotes,
      anchorOffsetMs,
      perNote,
      extras,
      telemetry: {
        matched: pitchCorrect,
        missing,
        extras: extras.length,
        meanOffsetMs,
        stdOffsetMs,
      },
      _score: { timeCorrect, pitchCorrect, missing, extras: extras.length, cost: dp[n]![m]!.cost },
    };
  };

  let best: any | null = null;
  for (const off of candidates) {
    const r = evaluateOffset(off);
    if (!best) {
      best = r;
      continue;
    }
    const a = best._score;
    const b = r._score;
    const better =
      b.timeCorrect > a.timeCorrect ||
      (b.timeCorrect === a.timeCorrect && b.pitchCorrect > a.pitchCorrect) ||
      (b.timeCorrect === a.timeCorrect && b.pitchCorrect === a.pitchCorrect && b.missing < a.missing) ||
      (b.timeCorrect === a.timeCorrect && b.pitchCorrect === a.pitchCorrect && b.missing === a.missing && b.extras < a.extras) ||
      (b.timeCorrect === a.timeCorrect && b.pitchCorrect === a.pitchCorrect && b.missing === a.missing && b.extras === a.extras && b.cost < a.cost);
    if (better) best = r;
  }

  const { _score: _scoreDiscard, ...result } = best as any;
  void _scoreDiscard;
  return result as JudgeResult;
}

function extractReference(puzzleData: MusicalCodeFountainPuzzleData | null): MusicalReference | null {
  const ref = puzzleData?.reference;
  if (!ref || ref.version !== 1) return null;
  if (!ref.tempo || typeof ref.tempo.bpm !== 'number') return null;
  if (!Array.isArray(ref.events)) return null;
  return ref;
}

function extractFountainMap(puzzleData: MusicalCodeFountainPuzzleData | null): FountainMap | null {
  const fm = puzzleData?.fountainMap as FountainMap | undefined;
  if (!fm || fm.version !== 1) return null;
  if (!Array.isArray(fm.regions)) return null;
  return fm;
}

function inferFountainMapViewBox(map: FountainMap): { x: number; y: number; w: number; h: number } {
  if (map.coordinateSpace === 'pixels' && map.imageSize?.width && map.imageSize?.height) {
    return { x: 0, y: 0, w: map.imageSize.width, h: map.imageSize.height };
  }
  const points = map.regions.flatMap(r => r.points || []);
  let maxX = 0;
  let maxY = 0;
  for (const p of points) {
    if (typeof p?.x === 'number' && Number.isFinite(p.x)) maxX = Math.max(maxX, p.x);
    if (typeof p?.y === 'number' && Number.isFinite(p.y)) maxY = Math.max(maxY, p.y);
  }
  const looksNormalized = maxX <= 1.01 && maxY <= 1.01;
  return looksNormalized ? { x: 0, y: 0, w: 1, h: 1 } : { x: 0, y: 0, w: Math.max(1, maxX), h: Math.max(1, maxY) };
}

function FountainPixiOverlay(props: {
  imageUrl: string;
  map: FountainMap;
  viewBox: { x: number; y: number; w: number; h: number };
  stoneIdToStone: Map<string, Stone>;
  disabled: boolean;
  hintAlpha: number; // 0..1
  hintMode: 'always' | 'memory' | 'off';
  effectsEnabled: boolean;
  onPressStoneId: (stoneId: string) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const pixiRef = React.useRef<any>(null);
  const appRef = React.useRef<any>(null);
  const worldRef = React.useRef<any>(null);
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
  const onPressStoneIdRef = React.useRef(props.onPressStoneId);
  React.useEffect(() => { hintAlphaRef.current = props.hintAlpha; }, [props.hintAlpha]);
  React.useEffect(() => { disabledRef.current = props.disabled; }, [props.disabled]);
  React.useEffect(() => { effectsEnabledRef.current = props.effectsEnabled; }, [props.effectsEnabled]);
  React.useEffect(() => { hintModeRef.current = props.hintMode; }, [props.hintMode]);
  React.useEffect(() => { onPressStoneIdRef.current = props.onPressStoneId; }, [props.onPressStoneId]);

  React.useEffect(() => {
    let alive = true;
    const container = containerRef.current;
    if (!container) return;
    const objectUrls = objectUrlsRef.current;

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

        const vb = props.viewBox;
        const toPx = (p: { x: number; y: number }) => {
          const xn = (p.x - vb.x) / vb.w;
          const yn = (p.y - vb.y) / vb.h;
          return { x: xn * texW, y: yn * texH };
        };

        regionsRef.current = [];
        for (const r of props.map.regions) {
          const stone = props.stoneIdToStone.get(String(r.stoneId)) ?? null;
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
            // Press flash + ripple + particles.
            const now = performance.now();
            const ripple = new PIXI.Graphics();
            ripple.eventMode = 'none';
            world.addChild(ripple);
            effectsRef.current.push({ g: ripple, startMs: now, durationMs: 520, type: 'ripple', x: cx, y: cy });

            for (let i = 0; i < 10; i++) {
              const dot = new PIXI.Graphics();
              dot.eventMode = 'none';
              world.addChild(dot);
              const a = (Math.PI * 2 * i) / 10 + (Math.random() - 0.5) * 0.6;
              const speed = (Math.min(texW, texH) * 0.0012) * (0.7 + Math.random() * 0.8);
              effectsRef.current.push({ g: dot, startMs: now, durationMs: 420 + Math.random() * 180, type: 'particle', vx: Math.cos(a) * speed, vy: Math.sin(a) * speed });
              (dot as any).__x = cx;
              (dot as any).__y = cy;
            }
          });
          world.addChild(g);

          regionsRef.current.push({
            regionId: r.regionId,
            stoneId: String(r.stoneId),
            pointsPx,
            centroid: { x: cx, y: cy },
            color: c,
            g,
          });
        }

        const resize = () => {
          const w = container.clientWidth || 1;
          const h = container.clientHeight || 1;
          app.renderer.resize(w, h);
          const scale = Math.min(w / texW, h / texH);
          world.scale.set(scale);
          world.position.set((w - texW * scale) / 2, (h - texH * scale) / 2);
        };
        resize();
        const ro = new ResizeObserver(() => resize());
        ro.observe(container);

        const drawRegions = () => {
          const ha = Math.max(0, Math.min(1, hintAlphaRef.current));
          const mode = hintModeRef.current;
          const minStroke = mode === 'always' ? 0.12 : mode === 'memory' ? 0.02 : 0;
          const minFill = mode === 'always' ? 0.02 : mode === 'memory' ? 0.0005 : 0;
          const strokeAlpha = minStroke + ha * (0.9 - minStroke);
          const fillAlpha = minFill + ha * (0.16 - minFill);

          for (const r of regionsRef.current) {
            const g = r.g;
            g.clear();
            const pts = r.pointsPx;
            g.poly(pts);
            g.fill({ color: r.color, alpha: fillAlpha });
            g.poly(pts);
            g.stroke({ width: 3, color: r.color, alpha: strokeAlpha });
            // subtle glow outline
            if (ha > 0.01) {
              g.poly(pts);
              g.stroke({ width: 8, color: r.color, alpha: strokeAlpha * 0.15 });
            }
          }
        };

        app.ticker.add(() => {
          if (!alive) return;
          drawRegions();

          // Animate effects
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

        return () => {
          ro.disconnect();
        };
      } catch (e) {
        setPixiOk(false);
        console.warn('[MusicalCodeFountain] Pixi overlay init failed:', e);
      }
    })();

    return () => {
      alive = false;
      setPixiOk(false);
      try {
        appRef.current?.destroy(true);
      } catch { }
      appRef.current = null;
      worldRef.current = null;
      regionsRef.current = [];
      for (const u of objectUrls.values()) {
        try { URL.revokeObjectURL(u); } catch { }
      }
      objectUrls.clear();
      container.innerHTML = '';
    };
  }, [props.imageUrl, props.map, props.stoneIdToStone, props.viewBox]);

  return (
    <div
      className="relative w-full overflow-hidden rounded border border-gray-800 bg-black/20"
      style={{ aspectRatio }}
    >
      <div className={`absolute inset-0 ${pixiOk ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={props.imageUrl} alt="Fountain" className="absolute inset-0 w-full h-full object-contain select-none" draggable={false} />
        <svg
          viewBox={`${props.viewBox.x} ${props.viewBox.y} ${props.viewBox.w} ${props.viewBox.h}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
        >
          {props.map.regions.map(r => {
            const stone = props.stoneIdToStone.get(String(r.stoneId)) ?? null;
            const color = stone?.color ?? (stone ? midiToHsl(stone.pitch) : '#60a5fa');
            const ha = Math.max(0, Math.min(1, props.hintAlpha));
            const minStroke = props.hintMode === 'always' ? 0.12 : props.hintMode === 'memory' ? 0.02 : 0;
            const minFill = props.hintMode === 'always' ? 0.02 : props.hintMode === 'memory' ? 0.0005 : 0;
            const strokeAlpha = minStroke + ha * (0.9 - minStroke);
            const fillAlpha = minFill + ha * (0.16 - minFill);
            const canPress = !props.disabled;
            const pts = (r.points || []).map(p => `${p.x},${p.y}`).join(' ');
            return (
              <polygon
                key={r.regionId}
                points={pts}
                fill={color}
                fillOpacity={fillAlpha}
                stroke={color}
                strokeOpacity={strokeAlpha}
                strokeWidth={props.viewBox.w <= 1.01 ? 0.006 : 3}
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

      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}

function deriveStones(reference: MusicalReference, provided?: Stone[]): Stone[] {
  if (Array.isArray(provided) && provided.length) {
    return provided
      .filter(s => typeof s?.pitch === 'number' && Number.isFinite(s.pitch))
      .map(s => ({
        stoneId: String(s.stoneId ?? `stone_${s.pitch}`),
        pitch: s.pitch,
        color: typeof s.color === 'string' && s.color ? s.color : midiToHsl(s.pitch),
        label: typeof s.label === 'string' && s.label ? s.label : String(s.pitch),
      }));
  }

  const pitches = Array.from(new Set(reference.events.map(e => e.pitch))).sort((a, b) => a - b);
  return pitches.map((pitch, idx) => ({
    stoneId: `stone_${idx}`,
    pitch,
    color: midiToHsl(pitch),
    label: String(pitch),
  }));
}

function indexOsmdNotesByNoteId(params: {
  osmd: any;
  ticksPerQuarter: number;
}): Map<string, Array<{ noteId: string; pitch: number; gNote: any }>> {
  const { osmd, ticksPerQuarter } = params;
  const out = new Map<string, Array<{ noteId: string; pitch: number; gNote: any }>>();

  const sheet = osmd?.Sheet;
  const rules = osmd?.EngravingRules;
  if (!sheet || !rules) return out;

  const measures = sheet.SourceMeasures as any[] | undefined;
  if (!Array.isArray(measures)) return out;

  for (const sm of measures) {
    const measureIndex = typeof sm?.measureListIndex === 'number' ? sm.measureListIndex : null;
    const vcontainers = sm?.VerticalSourceStaffEntryContainers as any[] | undefined;
    if (measureIndex === null || !Array.isArray(vcontainers)) continue;

    for (const vc of vcontainers) {
      const staffEntries = vc?.StaffEntries as any[] | undefined;
      if (!Array.isArray(staffEntries)) continue;

      for (const staffEntry of staffEntries) {
        const staffId = staffEntry?.ParentStaff?.Id;
        const partId = staffEntry?.ParentStaff?.ParentInstrument?.IdString;
        if (typeof staffId !== 'number' || !Number.isFinite(staffId)) continue;
        if (typeof partId !== 'string' || !partId.length) continue;

        const voiceEntries = staffEntry?.VoiceEntries as any[] | undefined;
        if (!Array.isArray(voiceEntries)) continue;

        for (const ve of voiceEntries) {
          const voiceIdNum = ve?.ParentVoice?.VoiceId;
          const voiceId = typeof voiceIdNum === 'number' ? String(voiceIdNum) : null;
          if (!voiceId) continue;

          const ts = ve?.Timestamp?.RealValue;
          if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
          const localQuarterBeats = ts * 4;
          const localTick = Math.round(localQuarterBeats * ticksPerQuarter);

          const notes = (ve?.Notes as any[] | undefined) ?? [];
          const playableNotes = notes
            .filter(n => n && typeof n.isRest === 'function' ? !n.isRest() : !n?.isRestFlag)
            .filter(n => !n?.IsGraceNote);

          // Determine a stable chord index by sorting by pitch.
          const sorted = [...playableNotes].sort((a, b) => (a?.halfTone ?? 0) - (b?.halfTone ?? 0));
          for (let chordIndex = 0; chordIndex < sorted.length; chordIndex++) {
            const n = sorted[chordIndex]!;
            const tie = n?.NoteTie;
            if (tie && tie?.StartNote && tie.StartNote !== n) {
              continue; // Skip tie continuations; reference merges ties into start note.
            }

            const pitch = typeof n?.halfTone === 'number' ? n.halfTone : null;
            if (pitch === null || !Number.isFinite(pitch)) continue;

            const noteId = `p${partId}-mi${measureIndex}-t${localTick}-s${staffId}-v${voiceId}-c${chordIndex}`;
            const gNote = rules.GNote ? rules.GNote(n) : null;
            if (!gNote) continue;
            const arr = out.get(noteId) ?? [];
            arr.push({ noteId, pitch, gNote });
            out.set(noteId, arr);
          }
        }
      }
    }
  }

  return out;
}

export function MusicalCodeFountainGame(props: {
  puzzleData: unknown;
  onComplete?: () => void;
  onClose?: () => void;
}) {
  const { runtime } = useQuest();

  const puzzleData = (props.puzzleData ?? null) as MusicalCodeFountainPuzzleData | null;
  const providedReference = React.useMemo(() => extractReference(puzzleData), [puzzleData]);
  const [remoteReference, setRemoteReference] = React.useState<MusicalReference | null>(null);
  const [generatedReference, setGeneratedReference] = React.useState<MusicalReference | null>(null);
  const [forceGeneratedReference, setForceGeneratedReference] = React.useState(false);
  const [fountainMap, setFountainMap] = React.useState<FountainMap | null>(() => extractFountainMap(puzzleData));
  const reference = React.useMemo(() => {
    if (forceGeneratedReference && generatedReference) return generatedReference;
    return providedReference ?? remoteReference ?? generatedReference;
  }, [forceGeneratedReference, generatedReference, providedReference, remoteReference]);
  const loops = typeof puzzleData?.loops === 'number' && puzzleData.loops > 0 ? Math.floor(puzzleData.loops) : 3;
  const countInBeats =
    typeof puzzleData?.countInBeats === 'number' && puzzleData.countInBeats >= 0 ? puzzleData.countInBeats : 4;
  const hitWindowMs =
    typeof puzzleData?.hitWindowMs === 'number' && puzzleData.hitWindowMs > 0 ? puzzleData.hitWindowMs : 180;
  const passThreshold =
    typeof puzzleData?.passThreshold === 'number' && puzzleData.passThreshold > 0 && puzzleData.passThreshold <= 1
      ? puzzleData.passThreshold
      : 0.8;
  const maxExtraNotes =
    typeof puzzleData?.maxExtraNotes === 'number' && Number.isFinite(puzzleData.maxExtraNotes) && puzzleData.maxExtraNotes >= 0
      ? Math.floor(puzzleData.maxExtraNotes)
      : 2;
  const maxMissingNotes =
    typeof puzzleData?.maxMissingNotes === 'number' && Number.isFinite(puzzleData.maxMissingNotes) && puzzleData.maxMissingNotes >= 0
      ? Math.floor(puzzleData.maxMissingNotes)
      : 0;

  const [phase, setPhase] = React.useState<'idle' | 'listening' | 'input' | 'result'>('idle');
  const [loopIndex, setLoopIndex] = React.useState(0);
  const [countInBeat, setCountInBeat] = React.useState<number | null>(null);
  const [fountainHintAlpha, setFountainHintAlpha] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);
  const [playerEvents, setPlayerEvents] = React.useState<PlayerEvent[]>([]);
  const [judge, setJudge] = React.useState<JudgeResult | null>(null);

  const scoreContainerRef = React.useRef<HTMLDivElement | null>(null);
  const osmdRef = React.useRef<any>(null);
  const notesByIdRef = React.useRef<Map<string, Array<{ noteId: string; pitch: number; gNote: any }>>>(new Map());
  const baseColorByIdRef = React.useRef<Map<string, string>>(new Map());
  const activeNoteIdsRef = React.useRef<Set<string>>(new Set());

  const toneRef = React.useRef<typeof import('tone') | null>(null);
  const synthRef = React.useRef<any>(null);

  const inputStartPerfMsRef = React.useRef<number | null>(null);
  const inputAutoJudgeTimerRef = React.useRef<number | null>(null);
  const lastInputPerfMsRef = React.useRef<number | null>(null);

  const stones = React.useMemo(() => {
    if (!reference) return [];
    return deriveStones(reference, puzzleData?.stones);
  }, [reference, puzzleData?.stones]);

  React.useEffect(() => {
    setFountainMap(extractFountainMap(puzzleData));
  }, [puzzleData]);

  React.useEffect(() => {
    const url = absolutiseNonImageUrl(puzzleData?.fountainMapUrl);
    if (!url) return;
    if (puzzleData?.fountainMap?.version === 1) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as FountainMap;
        if (!alive) return;
        if (json?.version === 1 && Array.isArray(json.regions)) {
          setFountainMap(json);
        }
      } catch (e) {
        console.warn('[MusicalCodeFountain] Failed to load fountainMapUrl:', e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [puzzleData?.fountainMap, puzzleData?.fountainMapUrl]);

  const pitchLabel = React.useMemo(() => {
    const m = new Map<number, string>();
    for (const s of stones) {
      if (typeof s.pitch === 'number' && Number.isFinite(s.pitch)) {
        m.set(s.pitch, s.label ?? String(s.pitch));
      }
    }
    return (pitch: number) => m.get(pitch) ?? String(pitch);
  }, [stones]);

  const pitchKey = React.useMemo(() => {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    const m = new Map<number, string>();
    for (let i = 0; i < Math.min(keys.length, stones.length); i++) {
      m.set(stones[i]!.pitch, keys[i]!);
    }
    return m;
  }, [stones]);

  const keyToPitch = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const [pitch, k] of pitchKey.entries()) m.set(k, pitch);
    return m;
  }, [pitchKey]);

  const stoneIdToStone = React.useMemo(() => {
    const m = new Map<string, Stone>();
    for (const s of stones) m.set(String(s.stoneId), s);
    return m;
  }, [stones]);

  const stoneIdToPitch = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stones) m.set(String(s.stoneId), s.pitch);
    return m;
  }, [stones]);

  const pitchToColor = React.useMemo(() => {
    const m = new Map<number, string>();
    for (const s of stones) m.set(s.pitch, s.color || midiToHsl(s.pitch));
    return m;
  }, [stones]);

  const getColorForPitch = React.useCallback((pitch: number) => pitchToColor.get(pitch) ?? midiToHsl(pitch), [pitchToColor]);

  const canStart = !!reference && (typeof puzzleData?.musicXml === 'string' || typeof puzzleData?.musicXmlUrl === 'string');
  const fountainImageUrl = absolutiseNonImageUrl(puzzleData?.fountainImageUrl);
  const hasFountainOverlay = !!fountainImageUrl && !!fountainMap && Array.isArray(fountainMap.regions) && fountainMap.regions.length > 0;
  const fountainViewBox = React.useMemo(() => (fountainMap ? inferFountainMapViewBox(fountainMap) : { x: 0, y: 0, w: 1, h: 1 }), [fountainMap]);
  const fountainHintMode: 'always' | 'memory' | 'off' = (() => {
    const v = puzzleData?.fountainHintMode;
    return v === 'always' || v === 'memory' || v === 'off' ? v : 'always';
  })();
  const fountainHintDurationMs =
    typeof puzzleData?.fountainHintDurationMs === 'number' && Number.isFinite(puzzleData.fountainHintDurationMs) && puzzleData.fountainHintDurationMs >= 0
      ? Math.floor(puzzleData.fountainHintDurationMs)
      : 1200;
  const fountainHintFadeMs =
    typeof puzzleData?.fountainHintFadeMs === 'number' && Number.isFinite(puzzleData.fountainHintFadeMs) && puzzleData.fountainHintFadeMs >= 0
      ? Math.floor(puzzleData.fountainHintFadeMs)
      : 900;
  const fountainEffectsEnabled = typeof puzzleData?.fountainEffectsEnabled === 'boolean' ? puzzleData.fountainEffectsEnabled : true;

  React.useEffect(() => {
    if (!hasFountainOverlay) {
      setFountainHintAlpha(1);
      return;
    }
    if (fountainHintMode === 'always') {
      setFountainHintAlpha(1);
      return;
    }
    if (fountainHintMode === 'off') {
      setFountainHintAlpha(0);
      return;
    }
    // memory mode
    if (phase !== 'input') {
      setFountainHintAlpha(1);
      return;
    }

    setFountainHintAlpha(1);
    let timeout: number | null = null;
    let raf: number | null = null;

    timeout = window.setTimeout(() => {
      const start = performance.now();
      const step = () => {
        const t = (performance.now() - start) / Math.max(1, fountainHintFadeMs);
        const a = 1 - Math.min(1, Math.max(0, t));
        setFountainHintAlpha(a);
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, Math.max(0, fountainHintDurationMs));

    return () => {
      if (timeout !== null) window.clearTimeout(timeout);
      if (raf !== null) window.cancelAnimationFrame(raf);
    };
  }, [fountainHintDurationMs, fountainHintFadeMs, fountainHintMode, hasFountainOverlay, phase]);

  const applyColorToNoteId = React.useCallback((noteId: string, color: string) => {
    const entries = notesByIdRef.current.get(noteId) ?? [];
    for (const e of entries) {
      try {
        e.gNote?.setColor?.(color, {
          applyToNoteheads: true,
          applyToStem: true,
          applyToBeams: true,
          applyToFlag: true,
          applyToLedgerLines: true,
          applyToTies: true,
          applyToModifiers: true,
        });
      } catch { }
    }
  }, []);

  const setActiveNoteIds = React.useCallback((noteIds: string[]) => {
    const prev = activeNoteIdsRef.current;
    for (const id of prev) {
      const base = baseColorByIdRef.current.get(id);
      if (base) applyColorToNoteId(id, base);
    }
    const next = new Set(noteIds);
    activeNoteIdsRef.current = next;
    for (const id of next) {
      const base = baseColorByIdRef.current.get(id);
      applyColorToNoteId(id, base ? lightenCssColor(base, 0.35) : '#ffffff');
    }
  }, [applyColorToNoteId]);

  React.useEffect(() => {
    setRemoteReference(null);
    setGeneratedReference(null);
    setForceGeneratedReference(false);
  }, [puzzleData?.musicXml, puzzleData?.musicXmlUrl, puzzleData?.referenceUrl, puzzleData?.selectedPartId, puzzleData?.selectedPartIndex]);

  React.useEffect(() => {
    let alive = true;
    const container = scoreContainerRef.current;
    if (!container) return;
    if (!puzzleData?.musicXml && !puzzleData?.musicXmlUrl) return;

    const run = async () => {
      try {
        setError(null);

        const xml = puzzleData.musicXml
          ? puzzleData.musicXml
          : await (async () => {
            const url = absolutiseNonImageUrl(puzzleData.musicXmlUrl);
            if (!url) throw new Error('Missing musicXmlUrl');
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to load MusicXML: HTTP ${res.status}`);
            return await res.text();
          })();

        let localRemoteReference: MusicalReference | null = null;
        if (typeof puzzleData.referenceUrl === 'string' && puzzleData.referenceUrl) {
          try {
            const refUrl = absolutiseNonImageUrl(puzzleData.referenceUrl);
            const refRes = await fetch(refUrl, { cache: 'no-store' });
            if (refRes.ok) {
              const refJson = (await refRes.json()) as MusicalReference;
              if (refJson?.version === 1 && refJson?.tempo?.bpm && Array.isArray(refJson?.events)) {
                localRemoteReference = refJson;
                setRemoteReference(refJson);
              }
            }
          } catch (e) {
            console.warn('[MusicalCodeFountain] Failed to load referenceUrl:', e);
          }
        }

        const bpmOverride =
          typeof puzzleData?.bpmOverride === 'number' && Number.isFinite(puzzleData.bpmOverride) && puzzleData.bpmOverride > 0
            ? puzzleData.bpmOverride
            : undefined;
        const partId = typeof puzzleData?.selectedPartId === 'string' && puzzleData.selectedPartId ? puzzleData.selectedPartId : undefined;
        const partIndex =
          typeof puzzleData?.selectedPartIndex === 'number' && Number.isFinite(puzzleData.selectedPartIndex) && puzzleData.selectedPartIndex >= 0
            ? puzzleData.selectedPartIndex
            : undefined;

        let localGeneratedReference: MusicalReference | null = null;
        try {
          localGeneratedReference = musicXmlToReference(xml, { bpmOverride, partId, partIndex });
          setGeneratedReference(localGeneratedReference);
        } catch (e) {
          console.warn('[MusicalCodeFountain] Failed to generate reference from MusicXML:', e);
        }

        const mod = await import('opensheetmusicdisplay');
        const OpenSheetMusicDisplay = (mod as any).OpenSheetMusicDisplay as any;

        container.innerHTML = '';
        const osmd = new OpenSheetMusicDisplay(container, {
          backend: 'svg',
          drawTitle: true,
          drawingParameters: 'compact',
        });

        await osmd.load(xml);
        await osmd.render();
        osmdRef.current = osmd;

        if (!alive) return;
        const ticksPerQuarter = localGeneratedReference?.metadata?.ticksPerQuarter ?? 960;
        const map = indexOsmdNotesByNoteId({ osmd, ticksPerQuarter });
        notesByIdRef.current = map;

        const preferred = providedReference ?? localRemoteReference;
        const hasPreferred = !!preferred && Array.isArray(preferred.events) && preferred.events.length > 0;
        const canFallback = !!localGeneratedReference && Array.isArray(localGeneratedReference.events) && localGeneratedReference.events.length > 0;

        const matchRatio = (ref: MusicalReference): number => {
          const evs = Array.isArray(ref.events) ? ref.events : [];
          if (!evs.length) return 0;
          let matches = 0;
          for (const e of evs) if (map.has(e.noteId)) matches++;
          return matches / evs.length;
        };

        if (!forceGeneratedReference && hasPreferred && canFallback) {
          const pRatio = matchRatio(preferred!);
          const gRatio = matchRatio(localGeneratedReference!);
          if (pRatio < 0.2 && gRatio > 0.6) {
            setForceGeneratedReference(true);
          }
        }

        const refForColors =
          (forceGeneratedReference ? localGeneratedReference : null) ?? preferred ?? localGeneratedReference ?? null;
        if (!refForColors) return;

        const base = new Map<string, string>();
        for (const ev of refForColors.events) {
          const c = getColorForPitch(ev.pitch);
          base.set(ev.noteId, c);
        }
        baseColorByIdRef.current = base;

        for (const [noteId, entries] of map.entries()) {
          const baseColor = base.get(noteId);
          if (!baseColor) continue;
          for (const e of entries) {
            try {
              e.gNote?.setColor?.(baseColor, {
                applyToNoteheads: true,
                applyToStem: true,
                applyToBeams: true,
                applyToTies: true,
              });
            } catch { }
          }
        }
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    run();
    return () => {
      alive = false;
    };
  }, [forceGeneratedReference, getColorForPitch, providedReference, puzzleData?.bpmOverride, puzzleData?.musicXml, puzzleData?.musicXmlUrl, puzzleData?.referenceUrl, puzzleData?.selectedPartId, puzzleData?.selectedPartIndex]);

  React.useEffect(() => {
    return () => {
      const Tone = toneRef.current;
      if (!Tone) return;
      try {
        Tone.Transport.cancel();
        Tone.Transport.stop();
      } catch { }
      try {
        synthRef.current?.dispose?.();
      } catch { }
      synthRef.current = null;
    };
  }, []);

  const ensureTone = React.useCallback(async () => {
    if (toneRef.current) return toneRef.current;
    const Tone = await import('tone');
    toneRef.current = Tone;
    return Tone;
  }, []);

  const startListening = React.useCallback(async () => {
    if (!reference) return;
    setError(null);
    setJudge(null);
    setPlayerEvents([]);
    setLoopIndex(0);
    setPhase('listening');
    setActiveNoteIds([]);
    setCountInBeat(countInBeats > 0 ? 0 : null);
    lastInputPerfMsRef.current = null;
    if (inputAutoJudgeTimerRef.current !== null) window.clearTimeout(inputAutoJudgeTimerRef.current);
    inputAutoJudgeTimerRef.current = null;

    const Tone = await ensureTone();
    await Tone.start();

    if (!synthRef.current) {
      synthRef.current = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.2, release: 0.2 },
      }).toDestination();
    }

    const bpm = reference.tempo.bpm;
    const beatSec = 60 / bpm;
    const countInSec = countInBeats * beatSec;
    const loopDurMs = computeLoopDurationMs(reference.events);
    const loopDurSec = loopDurMs / 1000;

    Tone.Transport.cancel();
    Tone.Transport.stop();
    Tone.Transport.position = 0 as any;
    Tone.Transport.bpm.value = bpm;

    if (countInBeats > 0) {
      for (let i = 0; i < countInBeats; i++) {
        const beat = i + 1;
        Tone.Transport.schedule(() => setCountInBeat(beat), i * beatSec);
      }
      Tone.Transport.schedule(() => setCountInBeat(null), countInSec + 0.01);
    }

    for (let k = 0; k < loops; k++) {
      const loopOffsetSec = countInSec + k * loopDurSec;
      const groups = new Map<number, number[]>();
      for (let i = 0; i < reference.events.length; i++) {
        const e = reference.events[i]!;
        const key = Math.round(e.startTimeMs);
        const arr = groups.get(key) ?? [];
        arr.push(i);
        groups.set(key, arr);
      }

      for (const [startMs, idxs] of groups.entries()) {
        const t = loopOffsetSec + startMs / 1000;
        Tone.Transport.schedule((time: number) => {
          const noteIds: string[] = [];
          for (const i of idxs) {
            const e = reference.events[i]!;
            const freq = midiToFreq(e.pitch);
            const dur = Math.max(0.03, e.durationMs / 1000);
            synthRef.current?.triggerAttackRelease?.(freq, dur, time, 0.9);
            noteIds.push(e.noteId);
          }
          setActiveNoteIds(noteIds);
        }, t);
      }

      Tone.Transport.schedule(() => setLoopIndex(k + 1), loopOffsetSec + loopDurSec);
    }

    Tone.Transport.schedule(() => {
      setActiveNoteIds([]);
      setPhase('input');
      inputStartPerfMsRef.current = performance.now();
      setCountInBeat(null);
      try {
        Tone.Transport.stop();
        Tone.Transport.cancel();
      } catch { }
    }, countInSec + loops * loopDurSec + 0.05);

    Tone.Transport.start();
  }, [ensureTone, reference, loops, countInBeats, setActiveNoteIds]);

  const pressStone = React.useCallback(
    async (pitch: number) => {
      if (!reference) return;
      if (phase !== 'input') return;

      const start = inputStartPerfMsRef.current;
      if (start === null) return;

      const tLocalMs = performance.now() - start;
      lastInputPerfMsRef.current = performance.now();

      const Tone = await ensureTone();
      await Tone.start();
      if (!synthRef.current) {
        synthRef.current = new Tone.Synth().toDestination();
      }
      const freq = midiToFreq(pitch);
      synthRef.current?.triggerAttackRelease?.(freq, 0.18, Tone.now(), 0.9);

      setPlayerEvents(prev => [...prev, { pitch, tLocalMs }]);
    },
    [ensureTone, phase, reference],
  );

  const finalizeAttempt = React.useCallback((events: PlayerEvent[]) => {
    if (!reference) return;
    if (!events.length) return;

    const result = judgeAttemptV3({
      reference,
      player: events,
      hitWindowMs,
      passThreshold,
      maxExtraNotes,
      maxMissingNotes,
    });
    setJudge(result);
    setPhase('result');

    for (let i = 0; i < reference.events.length; i++) {
      const ev = reference.events[i]!;
      const okPitch = result.perNote[i]?.okPitch;
      const okTime = result.perNote[i]?.okTime;
      if (okPitch && okTime) {
        const base = baseColorByIdRef.current.get(ev.noteId);
        if (base) applyColorToNoteId(ev.noteId, base);
      } else if (okPitch && !okTime) {
        applyColorToNoteId(ev.noteId, '#f59e0b');
      } else if (result.perNote[i]?.pitchActual !== null) {
        applyColorToNoteId(ev.noteId, '#ef4444');
      } else {
        applyColorToNoteId(ev.noteId, '#6b7280');
      }
    }

    if (result.pass) props.onComplete?.();
  }, [applyColorToNoteId, hitWindowMs, maxExtraNotes, maxMissingNotes, passThreshold, props, reference]);

  // Auto-judge after brief inactivity so early extras don't prematurely end the attempt.
  React.useEffect(() => {
    if (phase !== 'input') return;
    if (!reference) return;
    if (playerEvents.length === 0) return;

    if (inputAutoJudgeTimerRef.current !== null) window.clearTimeout(inputAutoJudgeTimerRef.current);
    const inactivityMs = Math.max(900, hitWindowMs * 6);
    inputAutoJudgeTimerRef.current = window.setTimeout(() => {
      finalizeAttempt(playerEvents);
    }, inactivityMs);

    return () => {
      if (inputAutoJudgeTimerRef.current !== null) window.clearTimeout(inputAutoJudgeTimerRef.current);
      inputAutoJudgeTimerRef.current = null;
    };
  }, [finalizeAttempt, hitWindowMs, phase, playerEvents, reference]);

  const onPressStoneId = React.useCallback((stoneId: string) => {
    const pitch = stoneIdToPitch.get(String(stoneId));
    if (typeof pitch !== 'number' || !Number.isFinite(pitch)) return;
    void pressStone(pitch);
  }, [pressStone, stoneIdToPitch]);

  const resetAttempt = React.useCallback(() => {
    setJudge(null);
    setPlayerEvents([]);
    setPhase('idle');
    setLoopIndex(0);
    setActiveNoteIds([]);
    setCountInBeat(null);
    inputStartPerfMsRef.current = null;
    lastInputPerfMsRef.current = null;
    if (inputAutoJudgeTimerRef.current !== null) window.clearTimeout(inputAutoJudgeTimerRef.current);
    inputAutoJudgeTimerRef.current = null;

    const Tone = toneRef.current;
    if (Tone) {
      try {
        Tone.Transport.cancel();
        Tone.Transport.stop();
      } catch { }
    }

    for (const [noteId, color] of baseColorByIdRef.current.entries()) {
      applyColorToNoteId(noteId, color);
    }
  }, [applyColorToNoteId, setActiveNoteIds]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const k = (e.key || '').toLowerCase();
      if (e.repeat) return;

      if (phase === 'idle' && (k === 'enter' || k === ' ')) {
        if (!canStart) return;
        e.preventDefault();
        void startListening();
        return;
      }

      if (phase === 'input') {
        if (k === 'enter') {
          e.preventDefault();
          finalizeAttempt(playerEvents);
          return;
        }
        const pitch = keyToPitch.get(k);
        if (typeof pitch === 'number') {
          e.preventDefault();
          void pressStone(pitch);
        }
        return;
      }

      if (phase === 'result' && k === 'r') {
        e.preventDefault();
        resetAttempt();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canStart, finalizeAttempt, keyToPitch, phase, playerEvents, pressStone, resetAttempt, startListening]);

  if (!reference) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-900 text-white p-6">
        <div className="text-xl font-semibold mb-2">Musical Code</div>
        <div className="text-gray-300 text-sm text-center max-w-lg">
          Waiting for MusicXML to load and generate a playable reference timeline…
        </div>
        <button onClick={props.onClose} className="mt-6 px-4 py-2 bg-gray-700 rounded">
          Exit
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-gray-950 text-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="font-semibold">Musical Code</div>
        <div className="flex items-center gap-3 text-sm text-gray-300">
          {phase === 'listening' && typeof countInBeat === 'number' && countInBeat > 0 && (
            <div>Count-in: {countInBeat}/{countInBeats}</div>
          )}
          <div>Loop: {Math.min(loopIndex, loops)}/{loops}</div>
          <div>Mode: {phase}</div>
          <button onClick={props.onClose} className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700">
            Exit
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-900/40 border-b border-red-800 text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 overflow-hidden">
        <div className="bg-gray-900/40 rounded border border-gray-800 overflow-auto">
          <div className="px-3 py-2 border-b border-gray-800 text-sm text-gray-300 flex items-center justify-between">
            <div>Score</div>
            <div className="text-xs text-gray-400">Pitch colours match stones</div>
          </div>
          <div ref={scoreContainerRef} className="p-3" />
        </div>

        <div className="bg-gray-900/40 rounded border border-gray-800 overflow-auto">
          <div className="px-3 py-2 border-b border-gray-800 text-sm text-gray-300 flex items-center justify-between">
            <div>Fountain Stones</div>
            <div className="text-xs text-gray-400">
              {phase === 'input' ? 'Your turn' : 'Listen first'}
            </div>
          </div>

          <div className="p-4">
            {phase === 'idle' && (
              <div className="flex flex-col gap-3 mb-4">
                <button
                  onClick={startListening}
                  disabled={!canStart}
                  className={`px-4 py-3 rounded font-semibold ${canStart ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-700 cursor-not-allowed'
                    }`}
                >
                  Start (plays {loops}×)
                </button>
                <div className="text-xs text-gray-400">
                  Audio requires a tap to start on iOS/Safari.
                </div>
              </div>
            )}

            {phase === 'listening' && (
              <div className="mb-4 text-sm text-gray-300">
                Listening… {typeof countInBeat === 'number' && countInBeat > 0 ? `(count-in ${countInBeat}/${countInBeats})` : ''}
              </div>
            )}

            {phase === 'input' && (
              <div className="mb-4">
                <div className="text-sm text-green-300">
                  Repeat the melody ({playerEvents.length} hits · {reference.events.length} notes)
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => finalizeAttempt(playerEvents)}
                    disabled={playerEvents.length === 0}
                    className={`px-3 py-2 rounded text-sm font-semibold ${playerEvents.length === 0 ? 'bg-gray-700 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                  >
                    Finish (Enter)
                  </button>
                  <button
                    onClick={resetAttempt}
                    className="px-3 py-2 rounded text-sm bg-gray-800 hover:bg-gray-700"
                  >
                    Reset
                  </button>
                  <div className="text-[11px] text-gray-400">
                    Auto-checks after a short pause.
                  </div>
                </div>
              </div>
            )}

            {phase === 'result' && judge && (
              <div className="mb-4">
                <div className={`text-sm font-semibold ${judge.pass ? 'text-green-300' : 'text-red-300'}`}>
                  {judge.pass ? 'Pass' : 'Fail'} ({Math.round(clamp01(judge.accuracy) * 100)}% timing · {Math.round(clamp01(judge.pitchAccuracy) * 100)}% pitch)
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Missing: {judge.telemetry.missing} · Extras: {judge.telemetry.extras} · Hit window: ±{judge.hitWindowMs}ms
                  {typeof judge.telemetry.meanOffsetMs === 'number' ? ` · Mean offset: ${Math.round(judge.telemetry.meanOffsetMs)}ms` : ''}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Keys: press <span className="font-semibold">1–9</span> to tap stones. Press <span className="font-semibold">R</span> to retry.
                </div>
                {!judge.pass && (
                  <button
                    onClick={resetAttempt}
                    className="mt-3 px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 text-sm"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {!hasFountainOverlay && stones.map(s => (
                <button
                  key={s.stoneId}
                  onClick={() => pressStone(s.pitch)}
                  disabled={phase !== 'input'}
                  className={`rounded px-3 py-5 text-sm font-semibold border transition ${phase === 'input'
                    ? 'border-white/20 hover:border-white/40'
                    : 'border-white/10 opacity-60 cursor-not-allowed'
                    }`}
                  style={{
                    background: s.color ?? midiToHsl(s.pitch),
                    color: '#0b0b0b',
                  }}
                  aria-label={`Stone ${s.label ?? s.pitch}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate">{s.label ?? s.pitch}</div>
                    <div className="text-[11px] font-bold opacity-80">{pitchKey.get(s.pitch) ?? ''}</div>
                  </div>
                </button>
              ))}
            </div>

            {hasFountainOverlay && (
              <div className="mt-3">
                <div className="text-xs text-gray-400 mb-2">
                  Tap stones on the fountain. Keyboard: <span className="font-semibold">1–9</span> still works.
                </div>
                <FountainPixiOverlay
                  imageUrl={fountainImageUrl}
                  map={fountainMap!}
                  viewBox={fountainViewBox}
                  stoneIdToStone={stoneIdToStone}
                  disabled={phase !== 'input'}
                  hintAlpha={fountainHintAlpha}
                  hintMode={fountainHintMode}
                  effectsEnabled={fountainEffectsEnabled}
                  onPressStoneId={onPressStoneId}
                />
                {fountainHintMode === 'memory' && phase === 'input' && (
                  <div className="mt-2 text-[11px] text-gray-400">
                    Hints fade after {fountainHintDurationMs}ms.
                  </div>
                )}
              </div>
            )}

            {phase === 'result' && judge && (
              <div className="mt-6 text-xs text-gray-300">
                <div className="font-semibold mb-2">Timing feedback</div>
                <div className="max-h-52 overflow-auto rounded border border-gray-800 bg-black/20">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-gray-900/80 text-gray-300">
                      <tr>
                        <th className="px-2 py-2 font-semibold">#</th>
                        <th className="px-2 py-2 font-semibold">Note</th>
                        <th className="px-2 py-2 font-semibold">Result</th>
                        <th className="px-2 py-2 font-semibold tabular-nums">Offset</th>
                      </tr>
                    </thead>
                    <tbody>
                      {judge.perNote.slice(0, reference.events.length).map((n, idx) => {
                        const refEv = reference.events[idx]!;
                        const offset = typeof n.offsetMs === 'number' ? Math.round(n.offsetMs) : null;
                        const timingHint =
                          n.okPitch && !n.okTime && typeof offset === 'number'
                            ? offset < 0
                              ? 'Too early'
                              : 'Too late'
                            : null;
                        const verdict =
                          n.okPitch && n.okTime ? 'OK' : n.okPitch ? (timingHint ?? 'Off-time') : n.pitchActual === null ? 'Missing' : 'Wrong';
                        const verdictClass =
                          n.okPitch && n.okTime ? 'text-green-300' : n.okPitch ? 'text-amber-300' : n.pitchActual === null ? 'text-gray-400' : 'text-red-300';

                        return (
                          <tr key={`${n.noteId}:${idx}`} className="border-t border-gray-900/60">
                            <td className="px-2 py-2 text-gray-400 tabular-nums">{idx + 1}</td>
                            <td className="px-2 py-2">
                              <span className="font-semibold" style={{ color: getColorForPitch(refEv.pitch) }}>
                                {pitchLabel(refEv.pitch)}
                              </span>{' '}
                              <span className="text-gray-500">({refEv.pitch})</span>
                            </td>
                            <td className={`px-2 py-2 ${verdictClass}`}>{verdict}</td>
                            <td className="px-2 py-2 tabular-nums text-gray-400">
                              {offset === null ? '—' : `${offset > 0 ? '+' : ''}${offset}ms`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {runtime?.error && (
              <div className="mt-6 text-xs text-red-300">
                Runtime error: {runtime.error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
