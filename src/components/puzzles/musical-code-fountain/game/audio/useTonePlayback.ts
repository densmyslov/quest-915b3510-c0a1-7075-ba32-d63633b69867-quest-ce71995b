import * as React from 'react';
import type { MusicalReference } from '@/lib/musicxmlToReference';
import type { PlayerEvent } from '../scoring/types';

type Phase = 'idle' | 'listening' | 'input' | 'result';

type ToneRefs = {
  toneRef: React.MutableRefObject<typeof import('tone') | null>;
  synthRef: React.MutableRefObject<any>;
  lastSynthTriggerSecRef: React.MutableRefObject<number>;
  audioPlayerRef: React.MutableRefObject<any>;
  audioPlayerUrlRef: React.MutableRefObject<string>;
};

type UseTonePlaybackParams = {
  reference: MusicalReference | null;
  referenceAudioUrl: string;
  audioUrl: string;
  audioOriginalUrl: string;
  cropStartSec: number;
  cropEndSec: number | null;
  countInBeats: number;
  visualNudgeMs: number;
  phase: Phase;
  toneLoadedLabel: string;
  debugLog: (...args: any[]) => void;
  setPhase: (phase: Phase) => void;
  setPlayerEvents: React.Dispatch<React.SetStateAction<PlayerEvent[]>>;
  setJudge: (value: any | null) => void;
  setActiveNoteIds: (noteIds: string[]) => void;
  setActiveStoneIds?: (stoneIds: string[]) => void;
  setCountInBeat: (value: number | null) => void;
  setError: (value: string | null) => void;
  inputStartPerfMsRef: React.MutableRefObject<number | null>;
  inputAutoJudgeTimerRef: React.MutableRefObject<number | null>;
  computeLoopDurationMs: (events: Array<{ startTimeMs: number; durationMs: number }>) => number;
  midiToFreq: (midi: number) => number;
  playbackRate?: number;
};

export function useTonePlayback(params: UseTonePlaybackParams) {
  const {
    reference,
    referenceAudioUrl,
    audioUrl,
    audioOriginalUrl,
    cropStartSec,
    cropEndSec,
    countInBeats,
    visualNudgeMs,
    phase,
    toneLoadedLabel,
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
    playbackRate = 1,
  } = params;

  const toneRef = React.useRef<typeof import('tone') | null>(null);
  const synthRef = React.useRef<any>(null);
  const lastSynthTriggerSecRef = React.useRef<number>(0);
  const audioPlayerRef = React.useRef<any>(null);
  const audioPlayerUrlRef = React.useRef<string>('');

  const ensureTone = React.useCallback(async () => {
    if (toneRef.current) return toneRef.current;
    const Tone = await import('tone');
    toneRef.current = Tone;
    return Tone;
  }, []);

  const [toneLoaded, setToneLoaded] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    ensureTone()
      .then(() => {
        if (!alive) return;
        setToneLoaded(true);
      })
      .catch((e) => {
        console.warn('[MusicalCodeFountain] Failed to preload Tone.js:', e);
      });
    return () => { alive = false; };
  }, [ensureTone]);

  React.useEffect(() => {
    const Tone = toneRef.current;
    if (!Tone || phase !== 'listening' || !reference) return;
    try {
      const effectiveBpm = reference.tempo.bpm * playbackRate;
      if (Tone.Transport.bpm.value !== effectiveBpm) {
        Tone.Transport.bpm.value = effectiveBpm;
      }
      if (audioPlayerRef.current) {
        audioPlayerRef.current.playbackRate = playbackRate;
      }
    } catch { }
  }, [playbackRate, phase, reference]);

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
      try {
        audioPlayerRef.current?.dispose?.();
      } catch { }
      synthRef.current = null;
      lastSynthTriggerSecRef.current = 0;
      audioPlayerRef.current = null;
      audioPlayerUrlRef.current = '';
    };
  }, []);

  const startListening = React.useCallback((options?: { onComplete?: () => void; playbackRate?: number; loop?: boolean; muteAudio?: boolean; autoStart?: boolean }) => {
    if (!reference) return;
    setPhase('listening');
    setPlayerEvents([]);
    setJudge(null);
    setActiveNoteIds([]);
    setActiveStoneIds?.([]);
    setCountInBeat(countInBeats > 0 ? 0 : null);
    if (inputAutoJudgeTimerRef.current !== null) window.clearTimeout(inputAutoJudgeTimerRef.current);
    inputAutoJudgeTimerRef.current = null;

    const Tone = toneRef.current;
    if (!Tone) {
      setError(toneLoadedLabel);
      return;
    }

    debugLog('startListening', { toneLoaded, phase, ctxState: (() => { try { return Tone.getContext?.()?.state; } catch { return null; } })() });
    try { void Tone.start(); } catch { }

    void (async () => {
      let useReferenceAudio = !!referenceAudioUrl;
      if (useReferenceAudio) {
        const url = referenceAudioUrl;
        try {
          if (!audioPlayerRef.current || audioPlayerUrlRef.current !== url) {
            try {
              audioPlayerRef.current?.dispose?.();
            } catch { }
            const player = new (Tone as any).Player(url).toDestination();
            await player.load(url);
            audioPlayerRef.current = player;
            audioPlayerUrlRef.current = url;
          }
        } catch (e) {
          console.warn('[MusicalCodeFountain] Failed to load audioUrl, falling back to synth:', e);
          useReferenceAudio = false;
          try {
            audioPlayerRef.current?.dispose?.();
          } catch { }
          audioPlayerRef.current = null;
          audioPlayerUrlRef.current = '';
        }
      }

      if (!useReferenceAudio && !synthRef.current) synthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();

      const rate = options?.playbackRate ?? 1;
      const effectiveBpm = reference.tempo.bpm * rate;
      const beatSec = 60 / effectiveBpm;
      const countInSec = countInBeats * beatSec;
      const loopDurSec = (computeLoopDurationMs(reference.events) / 1000) / rate;

      Tone.Transport.cancel();
      Tone.Transport.stop();
      Tone.Transport.position = 0 as any;
      Tone.Transport.bpm.value = effectiveBpm;

      if (countInBeats > 0) {
        for (let i = 0; i < countInBeats; i++) {
          const beat = i + 1;
          Tone.Transport.schedule(() => setCountInBeat(beat), i * beatSec);
        }
        Tone.Transport.schedule(() => setCountInBeat(null), countInSec + 0.01);
      }

      const loopOffsetSec = countInSec;

      const groups = new Map<number, number[]>();
      const sortedEvents = reference.events.map((e, i) => ({ e, i })).sort((a, b) => a.e.startTimeMs - b.e.startTimeMs);

      let currentGroupKey: number | null = null;
      for (const { e, i } of sortedEvents) {
        const t = Math.round(e.startTimeMs);
        if (currentGroupKey === null || Math.abs(t - currentGroupKey) > 30) {
          currentGroupKey = t;
        }
        const arr = groups.get(currentGroupKey) ?? [];
        arr.push(i);
        groups.set(currentGroupKey, arr);
      }

      const groupEntries = Array.from(groups.entries());
      for (let i = 0; i < groupEntries.length; i++) {
        const [startMs, idxs] = groupEntries[i]!;
        const nextGroup = groupEntries[i + 1];

        const t = loopOffsetSec + (Math.max(0, startMs + visualNudgeMs) / 1000) / rate;

        const untilNextMs = nextGroup ? nextGroup[0] - startMs : 1000;
        const noteDurMs = Math.max(...idxs.map(idx => reference.events[idx]!.durationMs || 300));
        const visualDurMs = Math.min(noteDurMs, untilNextMs * 0.85);
        const visualDurSec = (visualDurMs / 1000) / rate;

        Tone.Transport.schedule((time: number) => {
          const noteIds: string[] = [];
          const freqs: number[] = [];

          for (const idx of idxs) {
            const e = reference.events[idx]!;
            noteIds.push(e.noteId);
            freqs.push(midiToFreq(e.pitch));
          }

          setActiveNoteIds(noteIds);

          if (!useReferenceAudio && !options?.muteAudio) {
            const chordDurSec = 0.18;
            try {
              synthRef.current?.triggerAttackRelease?.(freqs.length === 1 ? freqs[0] : freqs, chordDurSec / rate, time, 0.9);
            } catch (e) {
              console.warn('[MusicalCodeFountain] Synth trigger failed:', e);
            }
          }
        }, t);

        Tone.Transport.schedule(() => {
          setActiveNoteIds([]);
        }, t + visualDurSec);
      }

      if (useReferenceAudio && audioPlayerRef.current && !options?.muteAudio) {
        const hasCroppedFile = !!audioUrl && !!audioOriginalUrl && audioUrl !== audioOriginalUrl;
        const startOffsetSec = hasCroppedFile ? 0 : Math.max(0, cropStartSec);
        const segDurSec =
          typeof cropEndSec === 'number' && cropEndSec > cropStartSec
            ? cropEndSec - cropStartSec
            : (computeLoopDurationMs(reference.events) / 1000);
        const durationSec = Number.isFinite(segDurSec) && segDurSec > 0.01 ? segDurSec : undefined;

        audioPlayerRef.current.playbackRate = rate;

        Tone.Transport.schedule((time: number) => {
          try {
            audioPlayerRef.current.start(time, startOffsetSec, durationSec);
          } catch { }
        }, loopOffsetSec);
      }

      if (options?.loop) {
        Tone.Transport.loop = true;
        Tone.Transport.setLoopPoints(loopOffsetSec, loopOffsetSec + loopDurSec);
      } else {
        Tone.Transport.schedule(() => {
          if (options?.onComplete) {
            options.onComplete();
          } else {
            setPhase('input');
            inputStartPerfMsRef.current = performance.now();
          }
          setActiveNoteIds([]);
          setActiveStoneIds?.([]);
          setCountInBeat(null);
          try {
            Tone.Transport.stop();
            Tone.Transport.cancel();
          } catch { }
          try {
            audioPlayerRef.current?.stop?.();
          } catch { }
        }, countInSec + loopDurSec + 0.05);
      }

      if (options?.autoStart !== false) {
        Tone.Transport.start();
      }
    })();
  }, [
    audioOriginalUrl,
    audioUrl,
    computeLoopDurationMs,
    countInBeats,
    cropEndSec,
    cropStartSec,
    debugLog,
    inputAutoJudgeTimerRef,
    inputStartPerfMsRef,
    midiToFreq,
    phase,
    reference,
    referenceAudioUrl,
    setActiveNoteIds,
    setActiveStoneIds,
    setCountInBeat,
    setError,
    setJudge,
    setPhase,
    setPlayerEvents,
    toneLoaded,
    toneLoadedLabel,
    visualNudgeMs,
  ]);

  const pressStone = React.useCallback((pitch: number) => {
    if (!reference) {
      debugLog('pressStone blocked: no reference', { pitch, phase });
      return;
    }
    const Tone = toneRef.current;
    if (!Tone) {
      setError(toneLoadedLabel);
      debugLog('pressStone blocked: Tone missing', { pitch, phase, toneLoaded });
      return;
    }

    try { void Tone.start(); } catch { }
    if (!synthRef.current) synthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();

    const now = Tone.now();
    const t = Math.max(now, lastSynthTriggerSecRef.current + 0.001);
    lastSynthTriggerSecRef.current = t;

    debugLog('pressStone trigger', { pitch, t, ctxState: (() => { try { return Tone.getContext?.()?.state; } catch { return null; } })() });
    try {
      synthRef.current?.triggerAttackRelease?.(midiToFreq(pitch), 0.18, t, 0.9);
    } catch (e) {
      console.warn('[MusicalCodeFountain] pressStone synth trigger failed:', e);
    }

    if (phase === 'input') {
      const start = inputStartPerfMsRef.current;
      if (start !== null) {
        const tLocalMs = performance.now() - start;
        setPlayerEvents(prev => [...prev, { pitch, tLocalMs }]);
      }
    }
  }, [
    debugLog,
    inputStartPerfMsRef,
    midiToFreq,
    phase,
    reference,
    setError,
    setPlayerEvents,
    toneLoaded,
    toneLoadedLabel,
  ]);

  return {
    toneLoaded,
    refs: {
      toneRef,
      synthRef,
      lastSynthTriggerSecRef,
      audioPlayerRef,
      audioPlayerUrlRef,
    } as ToneRefs,
    startListening,
    pressStone,
  };
}
