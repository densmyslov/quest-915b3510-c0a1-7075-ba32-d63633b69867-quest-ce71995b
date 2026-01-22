import { useCallback, useEffect, useRef } from 'react';
import { NormalizedMediaTimelineItem } from '@/lib/mediaTimeline';
import { makeTimelineItemNodeId } from '@/runtime-core/compileQuest';
import type { QuestRuntimeClient } from '@/hooks/useQuestRuntime';
import { TimelineProgressState } from '../types';

type UseTimelineLogicParams = {
    questRuntime: QuestRuntimeClient;
    stepsMode: boolean;
};

export function useTimelineLogic({ questRuntime, stepsMode }: UseTimelineLogicParams) {
    // Refs for volatile data to stabilize callbacks
    const snapshotRef = useRef(questRuntime.snapshot);
    const completedPuzzlesRef = useRef(questRuntime.completedPuzzles);
    const questRuntimeRef = useRef(questRuntime);

    useEffect(() => {
        snapshotRef.current = questRuntime.snapshot;
    }, [questRuntime.snapshot]);

    useEffect(() => {
        completedPuzzlesRef.current = questRuntime.completedPuzzles;
    }, [questRuntime.completedPuzzles]);

    useEffect(() => {
        questRuntimeRef.current = questRuntime;
    }, [questRuntime]);

    const computeRuntimeTimelineProgress = useCallback(
        (objectId: string, items: NormalizedMediaTimelineItem[], reset: boolean): TimelineProgressState => {
            if (reset) return { nextIndex: 0, completedKeys: {}, blockedByPuzzleId: null };

            const completedKeys: Record<string, true> = {};

            // Build completed keys map
            for (const item of items) {
                // Check static enabled only (GPS ref removed)
                const isEnabled = item.enabled !== false;

                if (!isEnabled) continue;

                const nodeId = makeTimelineItemNodeId(objectId, item.key);

                const node = snapshotRef.current?.nodes?.[nodeId];
                const puzzleId = item.type === 'puzzle' ? (item as any).puzzleId ?? (item as any).puzzle_id : null;
                const puzzleCompleted =
                    typeof puzzleId === 'string' && puzzleId.length
                        ? completedPuzzlesRef.current.has(puzzleId)
                        : false;
                const isCompleted =
                    puzzleCompleted ||
                    (node?.status === 'completed' &&
                        // For branching nodes, treat explicit failure as incomplete so the player can retry.
                        // The runtime supports overwriting fail -> success for puzzles/actions.
                        !(item.type === 'action' && (node.outcome === 'fail' || node.outcome === 'failure')) &&
                        !(item.type === 'puzzle' && (node.outcome === 'fail' || node.outcome === 'failure')));

                if (isCompleted) {
                    completedKeys[item.key] = true;
                }
            }

            // Find the first enabled item that is not completed yet.
            // Always scan from the beginning to avoid skipping a node when a completion call fails.
            let nextIndex = items.length;
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const isEnabled = item.enabled !== false;

                if (!isEnabled) continue;

                if (!completedKeys[item.key]) {
                    nextIndex = i;
                    break;
                }
            }

            return { nextIndex: nextIndex >= items.length ? items.length : nextIndex, completedKeys, blockedByPuzzleId: null };
        },
        [stepsMode] // Removed currentSessionId dependency
    );

    const completeRuntimeNode = useCallback(
        async (objectId: string, itemKey: string) => {
            if (!questRuntimeRef.current) return false;

            const nodeId = makeTimelineItemNodeId(objectId, itemKey);

            try {
                const beforeVersion = snapshotRef.current?.version ?? null;
                let result = await questRuntimeRef.current.completeNode(nodeId);

                // RETRY LOGIC (Handling 409 Conflicts due to stale snapshot version)
                if (
                    !result.success &&
                    (result.error?.includes('conflict') || result.error?.includes('version'))
                ) {
                    console.warn('[useObjectTimeline] Conflict detected. Starting retry loop...');
                    for (let i = 0; i < 3; i++) {
                        await new Promise(r => setTimeout(r, 800)); // Wait 800ms
                        console.log(`[useObjectTimeline] Retry attempt ${i + 1}`);
                        result = await questRuntimeRef.current.completeNode(nodeId);
                        if (result.success) break;
                    }
                }

                if (!result.success) {
                    console.warn('[QuestMap] Runtime node completion API failed', { objectId, itemKey, nodeId, error: result.error });
                    return false;
                }

                // Wait (briefly) for snapshot propagation.
                const deadline = Date.now() + 1500;
                while (Date.now() < deadline) {
                    const snap = snapshotRef.current;
                    const node = snap?.nodes?.[nodeId];
                    if (node?.status === 'completed') return true;
                    if (beforeVersion !== null && snap && snap.version > beforeVersion) {
                        // Snapshot updated but node not complete
                        break;
                    }
                    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
                }

                // Fallback: force-refresh snapshot (useful when polling is disabled and no runtime WS is connected).
                try {
                    await questRuntimeRef.current.refresh();
                } catch (err) {
                    console.warn('[QuestMap] Failed to refresh snapshot after node completion', { objectId, itemKey, nodeId, err });
                }

                const node = snapshotRef.current?.nodes?.[nodeId];
                const ok = node?.status === 'completed';

                if (!ok) {
                    console.warn('[QuestMap] Runtime node did not complete', { objectId, itemKey, nodeId, node });
                }
                // If the API call succeeded but our local snapshot didn't reflect it yet, fail open to avoid
                // stalling the timeline runner; the next refresh/poll will reconcile state.
                return true;
            } catch (err) {
                console.warn('[QuestMap] Failed to record runtime node completion:', { objectId, itemKey, nodeId, err });
                return false;
            }
        },
        [stepsMode]
    );

    return {
        snapshotRef,
        completedPuzzlesRef,
        computeRuntimeTimelineProgress,
        completeRuntimeNode
    };
}
