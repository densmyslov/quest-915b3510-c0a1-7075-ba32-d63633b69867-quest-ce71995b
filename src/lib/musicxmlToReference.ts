export type MusicalReferenceEvent = {
  noteId: string;
  partId?: string;
  pitch: number; // MIDI
  startBeat: number; // quarter-note beats
  durationBeats: number;
  startTimeMs: number;
  durationMs: number;
  measure: number;
  measureIndex: number;
  voice: string;
  staff: number;
};

export type MusicalReferenceTempoChange = {
  startBeat: number;
  startTimeMs: number;
  bpm: number; // quarter-note BPM
};

export type MusicalReference = {
  version: 1;
  metadata?: {
    ticksPerQuarter: number;
    source?: { type: 'musicxml' };
    timeSignature?: { beats: number; beatType: number };
  };
  tempo: { bpm: number; changes?: MusicalReferenceTempoChange[] };
  events: MusicalReferenceEvent[];
};

const STEP_TO_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const NOTE_UNIT_TO_QUARTERS: Record<string, number> = {
  '1024th': 1 / 256,
  '512th': 1 / 128,
  '256th': 1 / 64,
  '128th': 1 / 32,
  '64th': 1 / 16,
  '32nd': 1 / 8,
  '16th': 1 / 4,
  eighth: 1 / 2,
  quarter: 1,
  half: 2,
  whole: 4,
  breve: 8,
  long: 16,
  maxima: 32,
};

const readNumber = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const text = (el: Element | null): string | null => {
  const t = el?.textContent ?? null;
  return t && t.trim().length ? t.trim() : null;
};

const lcm = (a: number, b: number) => {
  const gcd = (x: number, y: number): number => (y === 0 ? Math.abs(x) : gcd(y, x % y));
  return Math.abs(a * b) / gcd(a, b);
};

function pitchToMidi(noteEl: Element): number | null {
  const pitchEl = noteEl.querySelector('pitch');
  if (!pitchEl) return null;
  const step = text(pitchEl.querySelector('step'));
  const octave = readNumber(text(pitchEl.querySelector('octave')));
  const alter = readNumber(text(pitchEl.querySelector('alter'))) ?? 0;
  if (!step || octave === null) return null;
  const base = STEP_TO_SEMITONE[step.toUpperCase()];
  if (typeof base !== 'number') return null;
  return (octave + 1) * 12 + base + alter;
}

function readTimeSignatureFrom(doc: Document): { beats: number; beatType: number } | null {
  const time = doc.querySelector('measure attributes time');
  if (!time) return null;
  const beats = readNumber(text(time.querySelector('beats')));
  const beatType = readNumber(text(time.querySelector('beat-type')));
  if (!beats || !beatType) return null;
  return { beats, beatType };
}

function readMetronomeQuarterBpm(directionEl: Element): number | null {
  const soundTempoAttr = directionEl.querySelector('sound[tempo]')?.getAttribute('tempo') ?? null;
  const soundTempo = readNumber(soundTempoAttr);
  if (soundTempo && soundTempo > 0) return soundTempo;

  const perMinute = readNumber(text(directionEl.querySelector('metronome per-minute')));
  if (!perMinute || perMinute <= 0) return null;

  const beatUnit = text(directionEl.querySelector('metronome beat-unit')) ?? 'quarter';
  const dotCount = directionEl.querySelectorAll('metronome beat-unit-dot').length;
  const base = NOTE_UNIT_TO_QUARTERS[beatUnit] ?? 1;
  const dotted = base * (dotCount > 0 ? 1.5 : 1);
  return perMinute * dotted;
}

function getTieFlags(noteEl: Element): { hasStart: boolean; hasStop: boolean } {
  const ties = Array.from(noteEl.querySelectorAll('tie, notations tied'));
  let hasStart = false;
  let hasStop = false;
  for (const t of ties) {
    const type = (t.getAttribute('type') ?? '').toLowerCase();
    if (type === 'start') hasStart = true;
    if (type === 'stop') hasStop = true;
  }
  return { hasStart, hasStop };
}

type TempoMark = { startTick: number; bpm: number };

type RawEvent = {
  partId: string;
  startTick: number;
  durationTicks: number;
  pitch: number;
  measure: number;
  measureIndex: number;
  staff: number;
  voice: string;
  localTick: number;
};

function buildTempoTimeline(params: {
  tempoMarks: TempoMark[];
  bpmOverride?: number;
  ticksPerQuarter: number;
}): { bpm0: number; changes: TempoMark[]; tickToMs: (tick: number) => number; spanToMs: (startTick: number, endTick: number) => number } {
  const { bpmOverride, ticksPerQuarter } = params;
  const marks = [...params.tempoMarks].filter(m => Number.isFinite(m.bpm) && m.bpm > 0 && Number.isFinite(m.startTick) && m.startTick >= 0);
  marks.sort((a, b) => a.startTick - b.startTick);

  const normalized: TempoMark[] = [];

  if (typeof bpmOverride === 'number' && bpmOverride > 0) {
    normalized.push({ startTick: 0, bpm: bpmOverride });
  } else {
    const first = marks.find(m => m.startTick === 0) ?? null;
    normalized.push({ startTick: 0, bpm: first?.bpm ?? 120 });
    for (const m of marks) {
      if (m.startTick === 0) continue;
      const prev = normalized[normalized.length - 1]!;
      if (m.startTick === prev.startTick) {
        prev.bpm = m.bpm;
        continue;
      }
      if (m.bpm === prev.bpm) continue;
      normalized.push({ startTick: m.startTick, bpm: m.bpm });
    }
  }

  const segmentStarts = normalized.map(m => m.startTick);
  const segmentBpms = normalized.map(m => m.bpm);
  const segmentTimeMs: number[] = [];
  segmentTimeMs[0] = 0;

  for (let i = 1; i < normalized.length; i++) {
    const prevTick = segmentStarts[i - 1]!;
    const tick = segmentStarts[i]!;
    const bpm = segmentBpms[i - 1]!;
    const msPerTick = 60_000 / (bpm * ticksPerQuarter);
    segmentTimeMs[i] = segmentTimeMs[i - 1]! + (tick - prevTick) * msPerTick;
  }

  const findSegment = (tick: number) => {
    let lo = 0;
    let hi = segmentStarts.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (segmentStarts[mid]! <= tick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const tickToMs = (tick: number): number => {
    const i = findSegment(tick);
    const bpm = segmentBpms[i]!;
    const msPerTick = 60_000 / (bpm * ticksPerQuarter);
    return segmentTimeMs[i]! + (tick - segmentStarts[i]!) * msPerTick;
  };

  const spanToMs = (startTick: number, endTick: number): number => {
    if (endTick <= startTick) return 0;
    let t = startTick;
    let ms = 0;
    while (t < endTick) {
      const i = findSegment(t);
      const nextBoundary = i + 1 < segmentStarts.length ? segmentStarts[i + 1]! : Number.POSITIVE_INFINITY;
      const segEnd = Math.min(endTick, nextBoundary);
      const bpm = segmentBpms[i]!;
      const msPerTick = 60_000 / (bpm * ticksPerQuarter);
      ms += (segEnd - t) * msPerTick;
      t = segEnd;
    }
    return ms;
  };

  return { bpm0: segmentBpms[0]!, changes: normalized, tickToMs, spanToMs };
}

function parseFirstPart(doc: Document): Element | null {
  return doc.querySelector('part');
}

function parseSelectedPart(doc: Document, partId?: string, partIndex?: number): Element | null {
  const parts = Array.from(doc.querySelectorAll('part'));
  if (!parts.length) return null;
  if (typeof partId === 'string' && partId.length) {
    const found = parts.find(p => (p.getAttribute('id') ?? '') === partId);
    if (found) return found;
  }
  if (typeof partIndex === 'number' && Number.isFinite(partIndex) && partIndex >= 0) {
    return parts[Math.floor(partIndex)] ?? parts[0] ?? null;
  }
  return parts[0] ?? null;
}

function computeTicksPerQuarter(doc: Document): number {
  const divisionsEls = Array.from(doc.querySelectorAll('divisions'));
  let t = 1;
  for (const el of divisionsEls) {
    const d = readNumber(text(el));
    if (!d || d <= 0) continue;
    t = lcm(t, Math.floor(d));
    if (!Number.isFinite(t) || t <= 0 || t > 100_000) return 960; // safety fallback
  }
  return t;
}

export function musicXmlToReference(
  xml: string,
  options?: { bpmOverride?: number; partId?: string; partIndex?: number },
): MusicalReference {
  if (typeof DOMParser === 'undefined') {
    throw new Error('musicXmlToReference requires DOMParser (run in browser/client)');
  }

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid MusicXML (parsererror)');
  }

  const part = parseSelectedPart(doc, options?.partId, options?.partIndex);
  const partId = part?.getAttribute('id') ?? 'P1';
  const timeSignature = readTimeSignatureFrom(doc) ?? undefined;
  const ticksPerQuarter = computeTicksPerQuarter(doc);

  if (!part) {
    const bpm = typeof options?.bpmOverride === 'number' && options.bpmOverride > 0 ? options.bpmOverride : 120;
    return {
      version: 1,
      metadata: { ticksPerQuarter, source: { type: 'musicxml' }, timeSignature },
      tempo: { bpm },
      events: [],
    };
  }

  let currentDivisions = 1;
  let measureStartTick = 0;
  let cursorTick = 0;
  const lastStartTickByVoice = new Map<string, number>();
  const openTieEventIndexByKey = new Map<string, number>();

  const tempoMarks: TempoMark[] = [];
  const rawEvents: RawEvent[] = [];

  const measures = Array.from(part.querySelectorAll(':scope > measure'));
  for (let mi = 0; mi < measures.length; mi++) {
    const measureEl = measures[mi]!;
    const measureNumber = readNumber(measureEl.getAttribute('number') ?? '') ?? mi + 1;

    cursorTick = measureStartTick;
    let maxTickSeen = measureStartTick;
    lastStartTickByVoice.clear();

    const children = Array.from(measureEl.children);
    for (const child of children) {
      const tag = child.tagName.toLowerCase();

      if (tag === 'attributes') {
        const d = readNumber(text(child.querySelector('divisions')));
        if (d && d > 0) currentDivisions = d;
        continue;
      }

      const factor = ticksPerQuarter / currentDivisions;

      if (tag === 'backup' || tag === 'forward') {
        const durDiv = readNumber(text(child.querySelector('duration'))) ?? 0;
        const delta = Math.round(durDiv * factor);
        cursorTick += tag === 'backup' ? -delta : delta;
        maxTickSeen = Math.max(maxTickSeen, cursorTick);
        continue;
      }

      if (tag === 'direction') {
        const bpm = readMetronomeQuarterBpm(child);
        if (bpm) {
          const offsetDiv = readNumber(text(child.querySelector('offset'))) ?? 0;
          const offsetTick = Math.round(offsetDiv * factor);
          tempoMarks.push({ startTick: measureStartTick + offsetTick, bpm });
        }
        continue;
      }

      if (tag === 'sound') {
        const bpm = readNumber(child.getAttribute('tempo') ?? null);
        if (bpm && bpm > 0) {
          tempoMarks.push({ startTick: measureStartTick, bpm });
        }
        continue;
      }

      if (tag !== 'note') continue;

      if (child.querySelector('grace')) continue;

      const isRest = !!child.querySelector('rest');
      const isChord = !!child.querySelector('chord');
      const durationDiv = readNumber(text(child.querySelector('duration'))) ?? 0;
      const durationTicks = Math.max(0, Math.round(durationDiv * factor));

      const staff = readNumber(text(child.querySelector('staff'))) ?? 1;
      const voice = text(child.querySelector('voice')) ?? '1';
      const voiceKey = `${staff}:${voice}`;

      const startTick = isChord ? (lastStartTickByVoice.get(voiceKey) ?? cursorTick) : cursorTick;
      if (!isChord) lastStartTickByVoice.set(voiceKey, startTick);

      if (!isChord) {
        cursorTick += durationTicks;
        maxTickSeen = Math.max(maxTickSeen, cursorTick);
      }

      if (isRest) continue;

      const midi = pitchToMidi(child);
      if (midi === null) continue;

      const tie = getTieFlags(child);
      const tieKey = `${voiceKey}:${midi}`;

      const isContinuation = tie.hasStop;
      const isTieStart = tie.hasStart;

      if (isContinuation) {
        const openIdx = openTieEventIndexByKey.get(tieKey);
        if (typeof openIdx === 'number') {
          rawEvents[openIdx]!.durationTicks += durationTicks;
          if (!isTieStart) openTieEventIndexByKey.delete(tieKey);
          continue;
        }
      }

      const localTick = startTick - measureStartTick;

      const ev: RawEvent = {
        partId,
        startTick,
        durationTicks,
        pitch: midi,
        measure: measureNumber,
        measureIndex: mi,
        staff,
        voice,
        localTick,
      };
      const idx = rawEvents.length;
      rawEvents.push(ev);
      if (isTieStart) openTieEventIndexByKey.set(tieKey, idx);
    }

    // Advance by observed measure duration, including rests and non-note time movement.
    measureStartTick = maxTickSeen;
  }

  // Assign stable chord indices (per startTick/staff/voice) and build noteId.
  const grouped = new Map<string, RawEvent[]>();
  for (const e of rawEvents) {
    const k = `${e.partId}:${e.startTick}:${e.staff}:${e.voice}`;
    const arr = grouped.get(k) ?? [];
    arr.push(e);
    grouped.set(k, arr);
  }
  for (const arr of grouped.values()) {
    arr.sort((a, b) => a.pitch - b.pitch);
  }

  const { bpm0, changes, tickToMs, spanToMs } = buildTempoTimeline({
    tempoMarks,
    bpmOverride: options?.bpmOverride,
    ticksPerQuarter,
  });

  const events: MusicalReferenceEvent[] = [];
  for (const arr of grouped.values()) {
    for (let ci = 0; ci < arr.length; ci++) {
      const e = arr[ci]!;
      const startBeat = e.startTick / ticksPerQuarter;
      const durationBeats = e.durationTicks / ticksPerQuarter;
      const startTimeMs = tickToMs(e.startTick);
      const durationMs = spanToMs(e.startTick, e.startTick + e.durationTicks);
      events.push({
        noteId: `p${e.partId}-mi${e.measureIndex}-t${e.localTick}-s${e.staff}-v${e.voice}-c${ci}`,
        partId: e.partId,
        pitch: e.pitch,
        startBeat,
        durationBeats,
        startTimeMs: Math.round(startTimeMs),
        durationMs: Math.max(1, Math.round(durationMs)),
        measure: e.measure,
        measureIndex: e.measureIndex,
        voice: e.voice,
        staff: e.staff,
      });
    }
  }

  events.sort((a, b) => a.startTimeMs - b.startTimeMs || a.pitch - b.pitch);

  const tempoChanges: MusicalReferenceTempoChange[] = changes.map(m => {
    const startBeat = m.startTick / ticksPerQuarter;
    return { startBeat, startTimeMs: Math.round(tickToMs(m.startTick)), bpm: m.bpm };
  });

  return {
    version: 1,
    metadata: { ticksPerQuarter, source: { type: 'musicxml' }, timeSignature },
    tempo: { bpm: bpm0, changes: tempoChanges.length > 1 ? tempoChanges : undefined },
    events,
  };
}
