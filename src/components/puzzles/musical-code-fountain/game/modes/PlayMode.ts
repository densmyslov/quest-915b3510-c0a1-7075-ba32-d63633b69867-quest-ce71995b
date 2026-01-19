import { ModeContext } from './types';
import type { MusicalReference } from '@/lib/musicxmlToReference';

export interface PlayInputParams {
    pitch: number;
    Tone: any;
    reference: MusicalReference | null;
    countInBeats: number;
    hitWindowMs: number;
    playFailReason: string | null;

    // Mutable state (passed as objects/refs)
    state: {
        hitEventIndices: Set<number>;
        lastInputTime: { current: number };
        recordedEvents: Array<{ pitch: number; tLocalMs: number }>;
    };

    actions: {
        setPlayFailReason: (reason: string) => void;
        finalizeAttempt: (events: any[]) => void;
    };
}

export const PlayMode = {
    start: (ctx: ModeContext, subMode: 'listen' | 'perform' = 'perform') => {
        if (subMode === 'listen') {
            ctx.startListening({
                loop: true,
                muteAudio: false,
                autoStart: true,
            });
        } else {
            // Perform mode: Visuals only, auto-start (after countdown handled by Game)
            ctx.startListening({
                loop: false,
                muteAudio: true,
                autoStart: true,
                onComplete: () => {
                    // If we reach the end without failure, it's a pass?
                    // Actually, failure is handled by active checks.
                    // Success is only when all notes are hit.
                    // Ideally we might want a timeout check here if user missed the last note.
                }
            });
        }
    },

    handleActiveNotes: (ctx: ModeContext, noteIds: string[]) => {
        ctx.setActiveNoteIds(noteIds);

        // Map active notes to their corresponding stones (regions)
        const toneIds = new Set<string>();
        for (const nId of noteIds) {
            const notes = ctx.notesById.get(nId);
            if (notes) {
                for (const note of notes) {
                    // Try exact match first, then rounded if needed?
                    // Usually OSMD pitches are integers for MIDI notes but let's be safe
                    const p = Math.round(note.pitch);
                    const sId = ctx.pitchToStoneId.get(p);
                    if (sId) toneIds.add(sId);
                }
            }
        }
        ctx.setActiveStoneIds(Array.from(toneIds));
    },

    shouldAllowInput: (phase: string) => {
        return phase === 'input' || phase === 'listening';
    },

    handleInput: ({
        pitch,
        Tone,
        reference,
        playFailReason,
        state,
        actions,
        hitWindowMs,
    }: PlayInputParams) => {
        if (playFailReason) return;
        if (!Tone || !reference) return;

        // Log reference events on first input (heuristic)
        if (state.recordedEvents.length === 0) {
            console.log('[PerformDebug] Reference Events:', reference.events.map((e, i) => ({
                idx: i,
                p: e.pitch,
                t: (e.startTimeMs / 1000).toFixed(3),
                dur: e.durationMs
            })));
        }

        const fail = (reason: string) => {
            try { Tone.Transport.stop(); } catch { }
            actions.setPlayFailReason(reason);
        };

        // If transport not started, we can't judge timing in Perform mode (since it auto-starts).
        // Unless something went wrong.
        if (Tone.Transport.state !== 'started') {
            // Maybe user hit before countdown finished? (Game logic shields this usually)
            return;
        }

        const t = Tone.Transport.seconds;

        // Find closest event
        let bestEventIdx = -1;
        let minDiff = Infinity;

        // Note: The transport time in useTonePlayback schedules events relative to 0 (after count-in).
        // But count-in is scheduled effectively.
        // Let's assume t=0 is start of melody.
        // reference.events[i].startTimeMs is relative to 0.

        for (let i = 0; i < reference.events.length; i++) {
            if (state.hitEventIndices.has(i)) continue;

            const e = reference.events[i]!;
            const eTime = e.startTimeMs / 1000;
            const diff = Math.abs(eTime - t);
            if (diff < minDiff) {
                minDiff = diff;
                bestEventIdx = i;
            }
        }

        const targetEvent = bestEventIdx !== -1 ? reference.events[bestEventIdx] : null;
        console.log(`[PerformDebug] Input Pitch: ${pitch} | Time: ${t.toFixed(3)}s`);
        if (targetEvent) {
            console.log(`[PerformDebug] Best Match Event: Index ${bestEventIdx} (Pitch: ${targetEvent.pitch}, Time: ${(targetEvent.startTimeMs / 1000).toFixed(3)}s)`);
            console.log(`[PerformDebug] Time Diff: ${minDiff.toFixed(3)}s (Window: ${(hitWindowMs / 1000).toFixed(3)}s)`);
            console.log(`[PerformDebug] Pitch Match: ${pitch} === ${targetEvent.pitch} ? ${pitch === targetEvent.pitch}`);
        } else {
            console.log(`[PerformDebug] No matching event found`);
        }

        // Strict Judging
        const strictWindowSec = (hitWindowMs || 300) / 1000;

        if (bestEventIdx === -1 || minDiff > strictWindowSec) {
            fail(`Too early or too late! (>${Math.round(strictWindowSec * 1000)}ms)`);
            return;
        }

        // Check if we found a valid event
        if (!targetEvent) {
            fail('Internal Error: No event found');
            return;
        }

        if (state.hitEventIndices.has(bestEventIdx)) {
            // This event has already been hit, ignore further inputs for it
            return;
        }

        if (targetEvent.pitch !== pitch) {
            fail('Wrong Note!');
            return;
        }

        // Success for this note
        state.hitEventIndices.add(bestEventIdx);

        // Record the ACTUAL input time and pitch
        state.recordedEvents.push({
            pitch,
            tLocalMs: t * 1000, // Tone.Transport.seconds -> ms
        });

        // Check completion
        if (state.hitEventIndices.size === reference.events.length) {
            try { Tone.Transport.stop(); } catch { }
            // Pass the RECORDED events, not the reference/perfect events
            actions.finalizeAttempt(state.recordedEvents);
        }
    },
};
