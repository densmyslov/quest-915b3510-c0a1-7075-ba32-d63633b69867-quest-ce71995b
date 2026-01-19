'use client';

import React from 'react';
import { musicXmlToReference, type MusicalReference } from '@/lib/musicxmlToReference';
import { type JudgeResult, type PlayerEvent } from './game/scoring/types';
import { judgeAttemptV3 } from './game/scoring/judgeAttemptV3';
import { type FountainMap, extractFountainMap, inferFountainMapViewBox } from './game/rendering/fountainMap';
import { FountainPixiOverlay } from './game/rendering/FountainPixiOverlay';
import { useScoreRendering } from './game/rendering/useScoreRendering';
import { useTonePlayback } from './game/audio/useTonePlayback';
import { PlayMode } from './game/modes/PlayMode';
import type { ModeContext } from './game/modes/types';

export type Stone = {
  stoneId: string;
  pitch: number;
  color?: string;
  label?: string;
};

type AudioCrop = { cropStartSec: number; cropEndSec?: number };

type MusicalCodeFountainPuzzleData = {
  musicXmlUrl?: string;
  musicXml?: string;
  reference?: MusicalReference;
  referenceUrl?: string;
  audioUrl?: string;
  audioOriginalUrl?: string;
  editorPreview?: boolean;
  audioCrop?: AudioCrop;
  adjustmentMode?: 'timeline_shift' | 'musicxml_cut';
  visualNudgeMs?: number;
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
  return `hsl(${hue}, 85%, 55%)`;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

const normalizeCssColorForCanvas = (color: string): string => {
  const c = (color || '').trim();
  if (!c) return '';
  const hsl = c.match(/^hsl\(\s*([0-9.+-]+)\s+([0-9.+-]+)%\s+([0-9.+-]+)%\s*\)$/i);
  if (hsl) return `hsl(${hsl[1]}, ${hsl[2]}%, ${hsl[3]}%)`;
  const rgb = c.match(/^rgb\(\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*\)$/i);
  if (rgb) return `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`;
  return c;
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
      return `rgb(${rr}, ${gg}, ${bb})`;
    }
  }

  const m = c.match(/^hsla?\(\s*([0-9.+-]+)\s*(?:,|\s)\s*([0-9.+-]+)%\s*(?:,|\s)\s*([0-9.+-]+)%/i);
  if (m) {
    const h = Number(m[1]);
    const s = Number(m[2]);
    const l = Number(m[3]);
    if ([h, s, l].every(x => Number.isFinite(x))) {
      const ll = Math.max(0, Math.min(100, l + (100 - l) * amount));
      return `hsl(${h}, ${s}%, ${ll}%)`;
    }
  }

  return c || '#ffffff';
};

function computeLoopDurationMs(events: Array<{ startTimeMs: number; durationMs: number }>): number {
  let end = 0;
  for (const e of events) end = Math.max(end, e.startTimeMs + e.durationMs);
  return Math.max(0, end);
}

function applyTimelineShiftToReference(ref: MusicalReference, cropStartSec: number): MusicalReference {
  const shiftMs = Math.max(0, cropStartSec) * 1000;
  if (!Number.isFinite(shiftMs) || shiftMs <= 0) return ref;

  const events = (ref.events || [])
    .filter(e => (e.startTimeMs ?? 0) >= shiftMs)
    .map(e => ({
      ...e,
      startTimeMs: Math.round((e.startTimeMs ?? 0) - shiftMs),
    }));

  const changes = ref.tempo?.changes;
  const shiftedChanges = Array.isArray(changes)
    ? changes
      .filter(c => (c.startTimeMs ?? 0) >= shiftMs)
      .map(c => ({ ...c, startTimeMs: Math.round((c.startTimeMs ?? 0) - shiftMs) }))
    : undefined;

  return {
    ...ref,
    tempo: {
      ...ref.tempo,
      changes: shiftedChanges && shiftedChanges.length > 0 ? shiftedChanges : undefined,
    },
    events,
  };
}

function extractReference(puzzleData: MusicalCodeFountainPuzzleData | null): MusicalReference | null {
  const ref = puzzleData?.reference;
  if (!ref || ref.version !== 1) return null;
  if (!ref.tempo || typeof ref.tempo.bpm !== 'number') return null;
  if (!Array.isArray(ref.events)) return null;
  return ref;
}

function deriveStones(reference: MusicalReference, provided?: Stone[]): Stone[] {
  if (Array.isArray(provided) && provided.length) {
    return provided
      .filter(s => typeof s?.pitch === 'number' && Number.isFinite(s.pitch))
      .map(s => ({
        stoneId: String(s.stoneId ?? `stone_${s.pitch}`).trim(),
        pitch: s.pitch,
        color: typeof s.color === 'string' && s.color ? normalizeCssColorForCanvas(s.color) : midiToHsl(s.pitch),
        label: typeof s.label === 'string' && s.label ? s.label : String(s.pitch),
      }));
  }

  const pitches = Array.from(new Set(reference.events.map(e => e.pitch))).sort((a, b) => a - b);
  return pitches.map((pitch) => ({
    stoneId: `stone_${pitch}`,
    pitch,
    color: midiToHsl(pitch),
    label: String(pitch),
  }));
}

export function MusicalCodeFountainGame(props: {
  puzzleData: unknown;
  onComplete?: () => void;
  onClose?: () => void;
}) {
  const puzzleData = (props.puzzleData ?? null) as MusicalCodeFountainPuzzleData | null;
  const providedReference = React.useMemo(() => extractReference(puzzleData), [puzzleData]);
  const [remoteReference, setRemoteReference] = React.useState<MusicalReference | null>(null);
  const [generatedReference, setGeneratedReference] = React.useState<MusicalReference | null>(null);
  const [loadedXml, setLoadedXml] = React.useState<string | null>(null);
  const [forceGeneratedReference, setForceGeneratedReference] = React.useState(false);
  const [fountainMap, setFountainMap] = React.useState<FountainMap | null>(() => extractFountainMap(puzzleData));
  const reference = React.useMemo(() => {
    if (forceGeneratedReference && generatedReference) return generatedReference;
    return providedReference ?? remoteReference ?? generatedReference;
  }, [forceGeneratedReference, generatedReference, providedReference, remoteReference]);
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
  const audioUrl = absolutiseNonImageUrl(puzzleData?.audioUrl);
  const audioOriginalUrl = absolutiseNonImageUrl(puzzleData?.audioOriginalUrl);
  const cropStartSec =
    typeof puzzleData?.audioCrop?.cropStartSec === 'number' && Number.isFinite(puzzleData.audioCrop.cropStartSec) && puzzleData.audioCrop.cropStartSec >= 0
      ? puzzleData.audioCrop.cropStartSec
      : 0;
  const cropEndSec =
    typeof puzzleData?.audioCrop?.cropEndSec === 'number' && Number.isFinite(puzzleData.audioCrop.cropEndSec) && puzzleData.audioCrop.cropEndSec > 0
      ? puzzleData.audioCrop.cropEndSec
      : null;
  const visualNudgeMs =
    typeof puzzleData?.visualNudgeMs === 'number' && Number.isFinite(puzzleData.visualNudgeMs)
      ? Math.max(-200, Math.min(200, Math.round(puzzleData.visualNudgeMs)))
      : 0;

  const [phase, setPhase] = React.useState<'idle' | 'listening' | 'input' | 'result'>('idle');
  const [countInBeat, setCountInBeat] = React.useState<number | null>(null);
  const [fountainHintAlpha, setFountainHintAlpha] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);
  const [playerEvents, setPlayerEvents] = React.useState<PlayerEvent[]>([]);
  const [judge, setJudge] = React.useState<JudgeResult | null>(null);

  // Play Mode State
  const [playSubMode, setPlaySubMode] = React.useState<'listen' | 'perform'>('listen');
  const [playFailReason, setPlayFailReason] = React.useState<string | null>(null);
  const [countdown, setCountdown] = React.useState<number | null>(null);
  const [trainingTempo] = React.useState(1.0);
  const [fountainActiveRegionIds, setFountainActiveRegionIds] = React.useState<string[]>([]);

  const activeNoteIdsRef = React.useRef<Set<string>>(new Set());

  const inputStartPerfMsRef = React.useRef<number | null>(null);
  const inputAutoJudgeTimerRef = React.useRef<number | null>(null);

  // Play Mode Refs
  const hitEventIndicesRef = React.useRef<Set<number>>(new Set());
  const recordedEventsRef = React.useRef<PlayerEvent[]>([]);
  const lastInputTimeRef = React.useRef<number>(0);
  const countdownTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const activeStoneIdsRef = React.useRef<Set<string>>(new Set());
  const activeRegionIdsRef = React.useRef<Set<string>>(new Set());

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

  const pitchToStoneId = React.useMemo(() => {
    const m = new Map<number, string>();
    for (const s of stones) m.set(s.pitch, s.stoneId);
    return m;
  }, [stones]);

  const getColorForPitch = React.useCallback((pitch: number) => pitchToColor.get(pitch) ?? midiToHsl(pitch), [pitchToColor]);

  const mcfDebugEnabled = React.useMemo(() => {
    if (typeof window === 'undefined') return false;
    try {
      return new URLSearchParams(window.location.search).has('mcfDebug');
    } catch {
      return false;
    }
  }, []);
  const debugLog = React.useCallback((...args: any[]) => {
    if (!mcfDebugEnabled) return;
    // eslint-disable-next-line no-console
    console.log('[MusicalCodeFountain][debug]', ...args);
  }, [mcfDebugEnabled]);

  const stoneIdToRegionIds = React.useMemo(() => {
    const m = new Map<string, string[]>();
    if (fountainMap && Array.isArray(fountainMap.regions)) {
      for (const r of fountainMap.regions) {
        if (!r.stoneId) continue;
        const sId = String(r.stoneId).trim();
        const arr = m.get(sId) ?? [];
        arr.push(r.regionId);
        m.set(sId, arr);
      }
    }
    return m;
  }, [fountainMap]);

  const setActiveStoneIds = React.useCallback((stoneIds: string[]) => {
    activeStoneIdsRef.current = new Set(stoneIds);
    const regionIds = new Set<string>();
    for (const sId of stoneIds) {
      const rIds = stoneIdToRegionIds.get(sId);
      if (rIds) rIds.forEach(id => regionIds.add(id));
    }
    activeRegionIdsRef.current = regionIds;
    setFountainActiveRegionIds(Array.from(regionIds));
  }, [stoneIdToRegionIds]);

  const {
    scoreContainerRef,
    scoreReadyVersion,
    notesByIdRef,
    baseColorByIdRef,
    applyColorToNoteId,
  } = useScoreRendering({
    musicXmlText: loadedXml ?? '',
    generatedReference,
    providedReference,
    remoteReference,
    reference,
    phase,
    debugLog,
    setError,
    forceGeneratedReference,
    setForceGeneratedReference,
    pitchToColor,
  });

  const setActiveNoteIds = React.useCallback((noteIds: string[]) => {
    const ctxStub: any = {
      setActiveNoteIds: (ids: string[]) => {
        const prev = activeNoteIdsRef.current;
        for (const id of prev) {
          const base = baseColorByIdRef.current.get(id) ?? '#000000';
          applyColorToNoteId(id, base, 1.0);
        }
        const next = new Set(ids);
        activeNoteIdsRef.current = next;
        for (const id of next) {
          const base = baseColorByIdRef.current.get(id);
          const highlightColor = base ? lightenCssColor(base, 0.5) : '#ffffff';
          applyColorToNoteId(id, highlightColor, 1.4);
        }
      },
      setActiveStoneIds,
      pitchToStoneId,
      notesById: notesByIdRef.current,
    };

    PlayMode.handleActiveNotes(ctxStub, noteIds);
  }, [applyColorToNoteId, baseColorByIdRef, pitchToStoneId, setActiveStoneIds]);

  React.useEffect(() => {
    const active = Array.from(activeNoteIdsRef.current);
    if (active.length > 0) {
      setActiveNoteIds(active);
    }
  }, [scoreReadyVersion, setActiveNoteIds]);

  const referenceAudioUrl = audioUrl || audioOriginalUrl;
  const isEditorPreview = puzzleData?.editorPreview === true;

  const {
    toneLoaded,
    refs: { toneRef, audioPlayerRef },
    startListening,
    pressStone,
  } = useTonePlayback({
    reference,
    referenceAudioUrl,
    audioUrl,
    audioOriginalUrl,
    cropStartSec,
    cropEndSec,
    countInBeats,
    visualNudgeMs,
    phase,
    toneLoadedLabel: 'Audio engine is still loading. Please try again in a moment.',
    debugLog,
    setPhase,
    setPlayerEvents,
    setJudge,
    setActiveNoteIds,
    setActiveStoneIds,
    setCountInBeat,
    setError,
    inputStartPerfMsRef,
    inputAutoJudgeTimerRef,
    computeLoopDurationMs,
    midiToFreq,
    playbackRate: trainingTempo,
  });

  const canStart = toneLoaded && !!reference && !!loadedXml;
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

  React.useEffect(() => {
    setRemoteReference(null);
    setGeneratedReference(null);
    setForceGeneratedReference(false);
  }, [puzzleData?.musicXml, puzzleData?.musicXmlUrl, puzzleData?.referenceUrl, puzzleData?.selectedPartId, puzzleData?.selectedPartIndex]);

  React.useEffect(() => {
    let alive = true;
    const runDataLoad = async () => {
      try {
        setError(null);

        if (!puzzleData) {
          setError('Missing puzzle data');
          return;
        }

        const xml = puzzleData.musicXml
          ? puzzleData.musicXml
          : await (async () => {
            const url = absolutiseNonImageUrl(puzzleData.musicXmlUrl);
            if (!url) throw new Error('Missing musicXmlUrl');
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to load MusicXML: HTTP ${res.status}`);
            const text = await res.text();
            if (!text) throw new Error('MusicXML content is empty');
            return text;
          })();

        setLoadedXml(xml);

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
          const shouldShift = puzzleData?.adjustmentMode === 'timeline_shift';
          const cropStart =
            typeof puzzleData?.audioCrop?.cropStartSec === 'number' && Number.isFinite(puzzleData.audioCrop.cropStartSec) && puzzleData.audioCrop.cropStartSec > 0
              ? puzzleData.audioCrop.cropStartSec
              : 0;
          if (shouldShift && cropStart > 0) {
            localGeneratedReference = applyTimelineShiftToReference(localGeneratedReference, cropStart);
          }
          setGeneratedReference(localGeneratedReference);
        } catch (e) {
          console.warn('[MusicalCodeFountain] Failed to generate reference from MusicXML:', e);
          throw new Error('Failed to parse MusicXML');
        }

      } catch (e) {
        if (!alive) return;
        console.error('[MusicalCode] Data load error:', e);
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    runDataLoad();
    return () => {
      alive = false;
    };
  }, [puzzleData?.musicXml, puzzleData?.musicXmlUrl, puzzleData?.referenceUrl, puzzleData?.selectedPartId, puzzleData?.selectedPartIndex, puzzleData?.adjustmentMode, puzzleData?.audioCrop?.cropStartSec, puzzleData?.bpmOverride]);

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
    setActiveNoteIds([]);
    setActiveStoneIds([]);

    for (let i = 0; i < reference.events.length; i++) {
      const ev = reference.events[i]!;
      const okPitch = result.perNote[i]?.okPitch;
      const okTime = result.perNote[i]?.okTime;
      if (okPitch && okTime) {
        const base = baseColorByIdRef.current.get(ev.noteId) ?? getColorForPitch(ev.pitch);
        applyColorToNoteId(ev.noteId, base);
      } else if (okPitch && !okTime) {
        applyColorToNoteId(ev.noteId, '#f59e0b');
      } else if (result.perNote[i]?.pitchActual !== null) {
        applyColorToNoteId(ev.noteId, '#ef4444');
      } else {
        applyColorToNoteId(ev.noteId, '#6b7280');
      }
    }

    if (result.pass) props.onComplete?.();
  }, [applyColorToNoteId, getColorForPitch, hitWindowMs, maxExtraNotes, maxMissingNotes, passThreshold, props, reference, setActiveNoteIds, setActiveStoneIds]);

  // Check Play Input (strict real-time validation)
  const checkPlayInput = React.useCallback((pitch: number) => {
    const Tone = toneRef.current;

    PlayMode.handleInput({
      pitch,
      Tone,
      reference,
      countInBeats,
      hitWindowMs,
      playFailReason,
      state: {
        hitEventIndices: hitEventIndicesRef.current,
        lastInputTime: lastInputTimeRef,
        recordedEvents: recordedEventsRef.current,
      },
      actions: {
        setPlayFailReason,
        finalizeAttempt,
      }
    });
  }, [reference, hitWindowMs, finalizeAttempt, countInBeats, playFailReason, toneRef]);

  const onPressStoneId = React.useCallback((stoneId: string) => {
    const pitch = stoneIdToPitch.get(String(stoneId));
    if (typeof pitch !== 'number' || !Number.isFinite(pitch)) return;
    void pressStone(pitch);
    checkPlayInput(pitch);
  }, [checkPlayInput, pressStone, stoneIdToPitch]);

  // Handle Start Listening with Listen/Perform submode support
  const handleStartListening = React.useCallback((overrideMode?: 'listen' | 'perform') => {
    if (!toneLoaded || !canStart) return;
    if (notesByIdRef.current.size === 0) {
      console.warn('[MusicalCodeFountain] Score not indexed yet, cannot start');
      return;
    }

    // Clear previous state
    setPlayFailReason(null);
    hitEventIndicesRef.current.clear();
    recordedEventsRef.current = [];
    lastInputTimeRef.current = 0;
    setPlayerEvents([]);
    setJudge(null);

    const ctx: ModeContext = {
      startListening,
      setPhase,
      setActiveNoteIds,
      setActiveStoneIds,
      trainingTempo,
      pitchToStoneId,
      applyColorToNoteId,
      baseColorById: baseColorByIdRef.current,
      notesById: notesByIdRef.current,
    };

    const targetSubMode = overrideMode || playSubMode;
    if (overrideMode && overrideMode !== playSubMode) {
      setPlaySubMode(overrideMode);
    }

    if (targetSubMode === 'perform') {
      // 3-second countdown before perform starts
      let count = 3;
      setCountdown(count);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = setInterval(() => {
        count--;
        if (count <= 0) {
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
          setCountdown(null);
          PlayMode.start(ctx, 'perform');
        } else {
          setCountdown(count);
        }
      }, 1000);
    } else {
      PlayMode.start(ctx, 'listen');
    }
  }, [applyColorToNoteId, canStart, notesByIdRef, pitchToStoneId, playSubMode, setActiveNoteIds, setActiveStoneIds, startListening, toneLoaded, trainingTempo]);

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

  const reset = React.useCallback(() => {
    setJudge(null);
    setPlayerEvents([]);
    setPhase('idle');
    setActiveNoteIds([]);
    setActiveStoneIds([]);
    setCountInBeat(null);
    inputStartPerfMsRef.current = null;
    if (inputAutoJudgeTimerRef.current !== null) window.clearTimeout(inputAutoJudgeTimerRef.current);
    inputAutoJudgeTimerRef.current = null;

    // Clear Play Mode state
    setPlayFailReason(null);
    setCountdown(null);
    hitEventIndicesRef.current.clear();
    recordedEventsRef.current = [];
    lastInputTimeRef.current = 0;
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    // Stop audio
    const Tone = toneRef.current;
    if (Tone) {
      try {
        Tone.Transport.cancel();
        Tone.Transport.stop();
      } catch { }
    }
    try {
      audioPlayerRef.current?.stop?.();
    } catch { }

    for (const [noteId, color] of baseColorByIdRef.current.entries()) {
      applyColorToNoteId(noteId, color);
    }
  }, [applyColorToNoteId, audioPlayerRef, setActiveNoteIds, setActiveStoneIds, toneRef]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.repeat) return;

      const canInput = PlayMode.shouldAllowInput(phase);

      if (canInput) {
        const pitch = keyToPitch.get(k);
        if (typeof pitch === 'number') {
          e.preventDefault();
          void pressStone(pitch);
          checkPlayInput(pitch);
        } else if (k === 'enter') {
          e.preventDefault();
          finalizeAttempt(playerEvents);
        }
        return;
      }

      if (phase === 'idle' && (k === 'enter' || k === ' ')) {
        if (!canStart) return;
        e.preventDefault();
        handleStartListening();
        return;
      }

      if (phase === 'result' && k === 'r') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canStart, checkPlayInput, finalizeAttempt, handleStartListening, keyToPitch, phase, playerEvents, pressStone, reset]);

  return (
    <div style={{ height: '100%', width: '100%', minHeight: 0, minWidth: 0, background: '#0b0b0b', color: '#fff', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #222' }}>
        <div style={{ fontSize: 12, color: '#bbb' }}>
          {phase === 'listening' && typeof countInBeat === 'number' && countInBeat > 0 ? `Count-in ${countInBeat}/${countInBeats} · ` : ''}
          {phase}
        </div>
      </div>

      {error && <div style={{ padding: 10, background: 'rgba(200,0,0,0.15)', borderBottom: '1px solid rgba(200,0,0,0.3)' }}>{error}</div>}

      {/* Main Content Area */}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: 12, overflow: 'hidden', position: 'relative' }}>
        {/* PLAY MODE LAYOUT (Mobile Friendly - matches quest-platform) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', overflow: 'hidden' }}>

          {/* Shared Centered Container */}
          <div style={{ flex: 1, width: '100%', maxWidth: '800px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* 1. Score Area */}
            <div style={{ height: '140px', flex: '0 0 auto', overflow: 'hidden', paddingBottom: 10, position: 'relative' }}>
              {/* Use margin to shift the effective score area right */}
              <div style={{ marginLeft: '160px', width: 'calc(100% - 160px)', height: '100%' }}>
                <div ref={scoreContainerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
              </div>
            </div>

            {/* 2. Fountain Area */}
            <div style={{ flex: 1, minHeight: 0, position: 'relative', border: '1px solid #222', borderRadius: 8, overflow: 'hidden', background: '#111', display: 'flex', flexDirection: 'column' }}>
              {hasFountainOverlay ? (
                <FountainPixiOverlay
                  imageUrl={fountainImageUrl}
                  map={fountainMap!}
                  viewBox={fountainViewBox}
                  stoneIdToStone={stoneIdToStone}
                  disabled={!(phase === 'input' || phase === 'listening')}
                  hintAlpha={isEditorPreview ? 1 : fountainHintAlpha}
                  hintMode={isEditorPreview ? 'always' : fountainHintMode}
                  hintStrength={isEditorPreview ? 'strong' : 'normal'}
                  effectsEnabled={fountainEffectsEnabled}
                  onPressStoneId={onPressStoneId}
                  activeRegionIds={fountainActiveRegionIds}
                  style={{ flex: 1, height: '100%', width: '100%', aspectRatio: 'unset', border: 'none', borderRadius: 0 }}
                />
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
                  No Fountain Map
                </div>
              )}

              {/* Overlays (Countdown, Results) */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>

                {/* Training/Listen Stop Controls */}
                {(phase === 'listening' || phase === 'input') && (
                  <div style={{ position: 'absolute', top: 10, right: 10, pointerEvents: 'auto' }}>
                    <button onClick={reset} style={{ padding: '8px 16px', background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, fontSize: 12, fontWeight: 600, backdropFilter: 'blur(4px)' }}>
                      Stop / Reset
                    </button>
                  </div>
                )}

                {/* Countdown */}
                {countdown !== null && (
                  <div style={{ fontSize: 120, fontWeight: 900, color: '#fff', textShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
                    {countdown}
                  </div>
                )}

                {/* Result Overlay */}
                {phase === 'result' && judge && (
                  <div style={{ pointerEvents: 'auto', background: 'rgba(0,0,0,0.85)', padding: 24, borderRadius: 16, textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: judge.pass ? '#4ade80' : '#f87171', marginBottom: 8 }}>
                      {judge.pass ? 'Success!' : 'Try Again'}
                    </div>
                    <div style={{ color: '#ddd', marginBottom: 20 }}>
                      {Math.round(clamp01(judge.accuracy) * 100)}% Accuracy
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={reset} style={{ padding: '10px 20px', background: '#333', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                        Menu
                      </button>
                      {!judge.pass && (
                        <button onClick={() => { reset(); setTimeout(handleStartListening, 100); }} style={{ padding: '10px 20px', background: '#fff', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Control Buttons (Overlay Bottom Corners) - Only show when IDLE */}
              {phase === 'idle' && (
                <div style={{ position: 'absolute', bottom: 20, left: 20, right: 20, display: 'flex', justifyContent: 'space-between', pointerEvents: 'none', zIndex: 10 }}>
                  <button
                    onClick={() => handleStartListening('listen')}
                    disabled={!canStart}
                    style={{
                      pointerEvents: 'auto',
                      padding: '12px 32px',
                      background: '#3b82f6',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      fontWeight: 700,
                      cursor: canStart ? 'pointer' : 'not-allowed',
                      opacity: canStart ? 1 : 0.5,
                      fontSize: 16,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    }}
                  >
                    Listen
                  </button>
                  <button
                    onClick={() => handleStartListening('perform')}
                    disabled={!canStart}
                    style={{
                      pointerEvents: 'auto',
                      padding: '12px 32px',
                      background: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      fontWeight: 700,
                      cursor: canStart ? 'pointer' : 'not-allowed',
                      opacity: canStart ? 1 : 0.5,
                      fontSize: 16,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    }}
                  >
                    Perform
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
      {playFailReason && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#222', padding: 24, borderRadius: 12, border: '1px solid #444', textAlign: 'center', minWidth: 300 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#f87171', marginBottom: 12 }}>Performance Failed</div>
            <div style={{ marginBottom: 24, color: '#ccc', fontSize: 16 }}>{playFailReason}</div>
            <button
              onClick={reset}
              style={{
                padding: '10px 24px',
                background: '#333',
                color: '#fff',
                border: '1px solid #555',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14
              }}
            >
              Close & Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
