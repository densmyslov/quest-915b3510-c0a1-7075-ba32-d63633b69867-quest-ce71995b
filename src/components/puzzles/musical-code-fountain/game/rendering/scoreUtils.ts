import { midiToHsl } from '../../domain/colors';

// ============================================================================
// Types
// ============================================================================

export type IndexedNote = {
    noteId: string;
    pitch: number;
    gNote: any; // graphical note (OSMD)
};

export type NoteIndex = Map<string, IndexedNote[]>;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalizes a CSS color string to a format that can be used in a Canvas context (hsl/rgb).
 */
export const normalizeCssColorForCanvas = (color: string): string => {

    const c = (color || '').trim();
    if (!c) return '';
    const hsl = c.match(/^hsl\(\s*([0-9.+-]+)\s+([0-9.+-]+)%\s+([0-9.+-]+)%\s*\)$/i);
    if (hsl) return `hsl(${hsl[1]}, ${hsl[2]}%, ${hsl[3]}%)`;
    const rgb = c.match(/^rgb\(\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*\)$/i);
    if (rgb) return `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`;
    return c;
};

export const lightenCssColor = (color: string, amount01: number): string => {
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
            // Use comma-separated syntax for broad Canvas/WebGL compatibility.
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
            // Use comma-separated syntax for broad Canvas/WebGL compatibility.
            return `hsl(${h}, ${s}%, ${ll}%)`;
        }
    }

    return c || '#ffffff';
};

/**
 * Indexes notes from an OSMD instance by a unique ID.
 * This enables mapping between the visual score and the game logic (playback/coloring).
 */
export function indexOsmdNotesByNoteId(params: {
    osmd: any;
    ticksPerQuarter: number;
}): NoteIndex {
    const { osmd, ticksPerQuarter } = params;
    const out = new Map<string, IndexedNote[]>();
    const noteToIdMap = new Map<any, string>(); // Map<Note, NoteId> to track start notes

    const sheet = osmd?.Sheet;
    const rules = osmd?.EngravingRules;
    if (!sheet || !rules) return out;

    const measures = sheet.SourceMeasures as any[] | undefined;
    if (!Array.isArray(measures)) return out;

    let accumulatedMeasureStart = 0;

    for (const sm of measures) {
        const measureDurationTicks = sm.Duration ? (sm.Duration.RealValue * (4 * ticksPerQuarter)) : 0;

        const staffEntries = sm.VerticalSourceStaffEntryContainers as any[] | undefined;
        if (Array.isArray(staffEntries)) {
            for (const container of staffEntries) {
                if (!container) continue;

                const staffEntriesList = container.StaffEntries as any[] | undefined;
                if (Array.isArray(staffEntriesList)) {
                    for (const se of staffEntriesList) {
                        if (!se) continue;
                        const voiceEntries = se.VoiceEntries as any[] | undefined;
                        if (Array.isArray(voiceEntries)) {
                            for (const ve of voiceEntries) {
                                const notes = ve.Notes as any[] | undefined;
                                if (Array.isArray(notes)) {
                                    for (const note of notes) {
                                        if (!note || note.isRest()) continue;

                                        // Retrieve Part ID
                                        const partId = se.ParentStaff?.ParentInstrument?.IdString ?? 'P1';

                                        // Retrieve Voice ID
                                        const voiceId = ve.ParentVoice?.VoiceId ? String(ve.ParentVoice.VoiceId) : '1';

                                        // Retrieve Staff ID
                                        const staffId = se.ParentStaff?.Id ?? 1;

                                        // Retrieve Measure Index
                                        const measureIndex = sm.measureListIndex ?? 0;

                                        // Retrieve Local Tick
                                        // container.Timestamp.RealValue is measure-relative quarters.
                                        const localTick = Math.round((container.Timestamp?.RealValue ?? 0) * 4 * ticksPerQuarter);

                                        // Calculate Chord Index (ci)
                                        // We need to know the index of this note in the sorted chord.
                                        // musicXmlToReference sorts by pitch.
                                        const sortedNotes = [...notes].sort((a: any, b: any) => {
                                            const pA = a?.Pitch?.halfTone ?? 0;
                                            const pB = b?.Pitch?.halfTone ?? 0;
                                            return pA - pB;
                                        });
                                        const chordIndex = sortedNotes.indexOf(note);

                                        // Construct ID matching musicXmlToReference
                                        // `p${e.partId}-mi${e.measureIndex}-t${e.localTick}-s${e.staff}-v${e.voice}-c${ci}`
                                        let noteId = `p${partId}-mi${measureIndex}-t${localTick}-s${staffId}-v${voiceId}-c${chordIndex}`;

                                        // Store mapping for this note
                                        noteToIdMap.set(note, noteId);

                                        // Tie handling:
                                        if (note.NoteTie && !note.NoteTie.StartNote) {
                                            const startNote = note.NoteTie.StartNote;
                                            if (startNote && noteToIdMap.has(startNote)) {
                                                noteId = noteToIdMap.get(startNote)!;
                                            }
                                        }

                                        noteToIdMap.set(note, noteId);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        accumulatedMeasureStart += measureDurationTicks;
    }

    // SECOND PASS: Iterate Graphical Measures to find SVG elements and link to NoteIds
    // This is more reliable for "coloring" because we need the graphical object.
    const graphicalMeasures = osmd.GraphicSheet?.MeasureList; // [][] (measures per staff)
    if (Array.isArray(graphicalMeasures)) {
        for (const measureColumn of graphicalMeasures) {
            if (!Array.isArray(measureColumn)) continue;
            for (const gm of measureColumn) {
                if (!gm) continue;
                const staffEntries = gm.staffEntries as any[];
                if (!Array.isArray(staffEntries)) continue;

                for (const gse of staffEntries) {
                    const gves = gse.graphicalVoiceEntries as any[];
                    if (!Array.isArray(gves)) continue;
                    for (const gve of gves) {
                        const gNotes = gve.notes as any[];
                        if (!Array.isArray(gNotes)) continue;
                        for (const gNote of gNotes) {
                            const sourceNote = gNote.sourceNote;
                            if (!sourceNote) continue;

                            const noteId = noteToIdMap.get(sourceNote);
                            if (noteId) {
                                const pitch = (sourceNote.Pitch?.halfTone ?? 0) + 12;

                                let arr = out.get(noteId);
                                if (!arr) {
                                    arr = [];
                                    out.set(noteId, arr);
                                }
                                arr.push({ noteId, pitch, gNote });
                            }
                        }
                    }
                }
            }
        }
    }

    return out;
}

/**
 * Applies a specific color and scale to a note identified by noteId.
 */
export function applyNoteStyle(params: {
    noteId: string;
    notesMap: NoteIndex;
    color: string;
    scale?: number;
}) {
    const { noteId, notesMap, color, scale = 1.0 } = params;
    const c = normalizeCssColorForCanvas(color);

    const entries = notesMap.get(noteId);
    if (!entries) return;

    for (const entry of entries) {
        if (entry.gNote && typeof entry.gNote.setColor === 'function') {
            const applyToNoteheads = true;
            const applyToStem = true;
            const applyToBeams = true;
            const applyToTies = true;

            try {
                entry.gNote.setColor(c, { applyToNoteheads, applyToStem, applyToBeams, applyToTies });
            } catch { }

            // Scale update
            try {
                const svgEl = (entry.gNote as any).getSVGGElement?.();
                if (svgEl instanceof SVGElement) {
                    if (Math.abs(scale - 1.0) > 0.01) {
                        // Apply scaling centered on the element
                        svgEl.style.transform = `scale(${scale})`;
                        svgEl.style.transformBox = 'fill-box';
                        svgEl.style.transformOrigin = 'center';
                        svgEl.style.transition = 'transform 0.1s ease-out';
                    } else {
                        // Reset scaling
                        svgEl.style.transform = '';
                        svgEl.style.transformBox = '';
                        svgEl.style.transformOrigin = '';
                        svgEl.style.transition = '';
                    }
                }
            } catch { }
        }
    }
}

/**
 * Colors all notes in the map based on their pitch.
 * Returns a map of base colors used for each noteId.
 */
export function colorAllNotes(params: {
    notesMap: NoteIndex;
    pitchToColor?: Map<number, string>;
}): Map<string, string> {
    const { notesMap, pitchToColor } = params;
    const baseColors = new Map<string, string>();

    const getColor = (pitch: number) => {
        const p = Math.round(pitch);
        if (pitchToColor) {
            const custom = pitchToColor.get(p);
            if (custom) return custom;
        }
        return midiToHsl(p);
    };

    for (const [noteId, entries] of notesMap.entries()) {
        for (const entry of entries) {
            const c = getColor(entry.pitch);
            baseColors.set(noteId, c);
            try {
                entry.gNote?.setColor?.(c, { applyToNoteheads: true, applyToStem: true, applyToBeams: true, applyToTies: true });
            } catch { }
        }
    }

    return baseColors;
}
