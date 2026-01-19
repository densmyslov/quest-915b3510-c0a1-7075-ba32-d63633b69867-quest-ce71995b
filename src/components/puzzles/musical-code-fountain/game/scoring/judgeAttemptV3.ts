import { type MusicalReference } from '@/lib/musicxmlToReference';
import { type JudgeResult, type PlayerEvent } from './types';

export type JudgeAttemptParams = {
    reference: MusicalReference;
    player: PlayerEvent[];
    hitWindowMs: number;
    passThreshold: number;
    maxExtraNotes: number;
    maxMissingNotes: number;
};

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

export function judgeAttemptV3(params: JudgeAttemptParams): JudgeResult {
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
