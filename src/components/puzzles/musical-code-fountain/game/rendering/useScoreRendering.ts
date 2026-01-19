import * as React from 'react';
import { type MusicalReference } from '@/lib/musicxmlToReference';
import {
  type NoteIndex,
  indexOsmdNotesByNoteId,
  applyNoteStyle,
  colorAllNotes,
} from './scoreUtils';

type UseScoreRenderingParams = {
  musicXmlText: string;
  generatedReference: MusicalReference | null;
  providedReference: MusicalReference | null;
  remoteReference: MusicalReference | null;
  reference: MusicalReference | null;
  phase: string;
  debugLog: (...args: any[]) => void;
  setError: (err: string | null) => void;
  forceGeneratedReference: boolean;
  setForceGeneratedReference: (v: boolean) => void;
  pitchToColor: Map<number, string>;
};

export function useScoreRendering(params: UseScoreRenderingParams) {
  const {
    musicXmlText,
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
  } = params;

  const scoreContainerRef = React.useRef<HTMLDivElement>(null);
  const osmdRef = React.useRef<any>(null);
  const notesByIdRef = React.useRef<NoteIndex>(new Map());
  const baseColorByIdRef = React.useRef<Map<string, string>>(new Map());
  const [scoreReadyVersion, setScoreReadyVersion] = React.useState(0);

  const applyColorToNoteId = React.useCallback((noteId: string, color: string, scale: number = 1.0) => {
    applyNoteStyle({
      noteId,
      notesMap: notesByIdRef.current,
      color,
      scale,
    });
  }, []);

  React.useEffect(() => {
    const container = scoreContainerRef.current;
    if (!container) return;
    if (!musicXmlText) return;

    let alive = true;
    let rendered = false;
    let rendering = false;
    let ro: ResizeObserver | null = null;

    const maybeRender = async () => {
      if (!alive) return;
      if (rendered || rendering) return;
      const w = container.clientWidth || 0;
      const h = container.clientHeight || 0;
      if (w <= 0 || h <= 0) {
        debugLog('score: waiting for non-zero size', { w, h });
        return;
      }

      rendering = true;
      try {
        const mod = await import('opensheetmusicdisplay');
        if (!alive) return;
        const OpenSheetMusicDisplay = (mod as any).OpenSheetMusicDisplay as any;

        setError(null);
        container.innerHTML = '';
        const osmd = new OpenSheetMusicDisplay(container, {
          backend: 'svg',
          drawTitle: false,
          drawingParameters: 'compact',
          autoResize: false,
          defaultColorMusic: '#AAAAAA',
          defaultColorLabel: '#AAAAAA',
          drawPartNames: false,
        });
        osmdRef.current = osmd;
        await osmd.load(musicXmlText);
        await osmd.render();
        if (!alive) return;

        const ticksPerQuarter = generatedReference?.metadata?.ticksPerQuarter ?? 960;
        notesByIdRef.current = indexOsmdNotesByNoteId({ osmd, ticksPerQuarter });
        setScoreReadyVersion(v => v + 1);
        debugLog('score: rendered', { w, h, notes: notesByIdRef.current.size });
        rendered = true;
      } catch (e) {
        if (!alive) return;
        console.warn('[MusicalCodeFountain] Failed to render score:', e);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        rendering = false;
      }
    };

    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => { void maybeRender(); });
      ro.observe(container);
    }
    void maybeRender();

    return () => {
      alive = false;
      try { ro?.disconnect(); } catch { }
    };
  }, [debugLog, musicXmlText, generatedReference?.metadata?.ticksPerQuarter, setError]);

  React.useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    const ticksPerQuarter = generatedReference?.metadata?.ticksPerQuarter ?? 960;
    notesByIdRef.current = indexOsmdNotesByNoteId({ osmd, ticksPerQuarter });
    setScoreReadyVersion(v => v + 1);
  }, [generatedReference?.metadata?.ticksPerQuarter]);

  React.useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    if (!reference) return;

    const xmlTicks = generatedReference?.metadata?.ticksPerQuarter;
    const refTicks = reference?.metadata?.ticksPerQuarter;
    const ticksPerQuarter = xmlTicks ?? refTicks ?? 960;

    notesByIdRef.current = indexOsmdNotesByNoteId({ osmd, ticksPerQuarter });
    setScoreReadyVersion(v => v + 1);
  }, [reference, generatedReference?.metadata?.ticksPerQuarter]);

  React.useEffect(() => {
    const map = notesByIdRef.current;
    if (!map || map.size === 0) return;

    const preferred = providedReference ?? remoteReference;
    const hasPreferred = !!preferred && Array.isArray(preferred.events) && preferred.events.length > 0;
    const canFallback = !!generatedReference && Array.isArray(generatedReference.events) && generatedReference.events.length > 0;

    const matchRatio = (ref: MusicalReference): number => {
      const evs = Array.isArray(ref.events) ? ref.events : [];
      if (!evs.length) return 0;
      let matches = 0;
      for (const e of evs) if (map.has(e.noteId)) matches++;
      return matches / evs.length;
    };

    if (!forceGeneratedReference && hasPreferred && canFallback) {
      const pRatio = matchRatio(preferred!);
      const gRatio = matchRatio(generatedReference!);

      if (phase === 'idle' && pRatio < 0.95 && gRatio > pRatio) {
        setForceGeneratedReference(true);
      }
    }

    const base = colorAllNotes({
      notesMap: map,
      pitchToColor,
    });

    baseColorByIdRef.current = base;
  }, [forceGeneratedReference, generatedReference, providedReference, reference, remoteReference, scoreReadyVersion, phase, pitchToColor, setForceGeneratedReference]);

  return {
    scoreContainerRef,
    scoreReadyVersion,
    osmdRef,
    notesByIdRef,
    baseColorByIdRef,
    forceGeneratedReference,
    setForceGeneratedReference,
    applyColorToNoteId,
  };
}
