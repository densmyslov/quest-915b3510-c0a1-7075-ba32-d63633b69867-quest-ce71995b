import { useCallback, MutableRefObject } from 'react';
import type { QuestObject } from '@/types/quest';
import { normalizeMediaTimeline, type NormalizedMediaTimelineItem } from '@/lib/mediaTimeline';
import { makeTimelineItemNodeId, sanitizeIdPart } from '@/runtime-core/compileQuest';
import type { TimelineProgressState, PulsatingCircleEffect } from '../types';
import { getTimelineVideoUrl } from '../utils';
import { getTextDisplayConfig, getVideoConfig, getItemImageUrls } from '../timelineUtils';

// Define the comprehensive Context needed for execution
// This avoids passing 50 arguments
export interface TimelineExecutionContext {
    debugEnabled: boolean;
    canRunTimeline?: () => boolean;
    timelineNodes?: Record<string, any>;
    addLog: (level: string, message: string, data?: any) => void;
    // State Refs
    timelineRunRef: MutableRefObject<{ cancel: boolean; objectId: string; version: number; status: 'running' | 'idle' } | null>;
    snapshotRef: MutableRefObject<any>; // Using any for snapshot to avoid circular types if possible, or strict type
    completedPuzzlesRef: MutableRefObject<Set<string>>;
    resumeAttemptedRef: MutableRefObject<string | null>;

    // Logic
    computeRuntimeTimelineProgress: (objectId: string, items: NormalizedMediaTimelineItem[], reset: boolean) => TimelineProgressState;
    completeRuntimeNode: (objectId: string, itemKey: string) => Promise<boolean>;
    setTimelineUi: (value: any | ((prev: any) => any)) => void;
    setTimelineProgress: (objectId: string, version: number, progress: TimelineProgressState) => void;

    // External Refs/Callbacks
    questRuntime: any;
    currentSessionId: string | null;
    hasPuzzle: (id: string) => boolean;
    getValidCoordinates: (obj: QuestObject) => [number, number] | null;
    getPuzzlePoints: (id: string) => number;
    normalizeEffect: (effect: any) => PulsatingCircleEffect;
    addOrUpdatePulsatingCircle: (params: any) => void;

    // Overlays
    showTimelineText: (params: any) => Promise<void>;
    showTimelineChat: (params: any) => Promise<void>;
    showTimelineVideo: (params: any) => Promise<void>;
    showTimelineAction: (params: any) => Promise<any>;
    showTimelineDocument: (params: any) => Promise<void>;
    showTimelineAr: (params: any) => Promise<any>;
    navigateToPuzzle: (puzzleId: string, objectId: string, itemKey?: string) => void;

    // Audio
    playTimelineAudioItem: (params: any) => Promise<void>;
}

export function useTimelineExecution(ctx: TimelineExecutionContext) {
    const {
        debugEnabled,
        canRunTimeline,
        timelineNodes,
        addLog,
        timelineRunRef,
        snapshotRef,
        completedPuzzlesRef,
        computeRuntimeTimelineProgress,
        completeRuntimeNode,
        setTimelineUi,
        setTimelineProgress,
        questRuntime,
        currentSessionId,
        hasPuzzle,
        getValidCoordinates,
        normalizeEffect,
        addOrUpdatePulsatingCircle,
        showTimelineText,
        showTimelineChat,
        showTimelineVideo,
        showTimelineAction,
        showTimelineDocument,
        showTimelineAr,
        navigateToPuzzle,
        playTimelineAudioItem
    } = ctx;

    const executeTimelineEffect = useCallback(async (obj: QuestObject, item: NormalizedMediaTimelineItem, params: { blocking: boolean }) => {
        const effectType = (item as any).effectType ?? (item as any).effect_type ?? 'pulsating_circles';
        if (effectType !== 'pulsating_circles') {
            console.log('[QuestMap] Unsupported timeline effect type:', effectType, item);
            return;
        }

        const coords = getValidCoordinates(obj);
        if (!coords) return;

        const payload = (item as any).payload ?? (item as any).params ?? {};
        const durationMs =
            typeof payload?.durationMs === 'number' ? payload.durationMs : Number(payload?.durationMs ?? 0);
        const normalizedDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;

        const effectConfig = {
            ...(obj as any).pulsating_effect,
            ...(payload && typeof payload === 'object' ? payload : {})
        };
        const effect = normalizeEffect(effectConfig);

        addOrUpdatePulsatingCircle({
            objectId: obj.id,
            center: coords,
            effect,
            source: 'timeline',
            durationMs: normalizedDurationMs > 0 ? normalizedDurationMs : undefined
        });

        if (params.blocking && normalizedDurationMs > 0) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, normalizedDurationMs));
        }
    }, [addOrUpdatePulsatingCircle, getValidCoordinates, normalizeEffect]);

    const runObjectTimeline = useCallback(
        async (obj: QuestObject, options?: { reset?: boolean }) => {
            if (canRunTimeline && !canRunTimeline()) {
                console.log('[useObjectTimeline] runObjectTimeline blocked (waiting for user interaction)', {
                    objectId: obj.id,
                    options,
                });
                return;
            }
            console.log('[useObjectTimeline] runObjectTimeline START', { objectId: obj.id, options });

            const timeline = normalizeMediaTimeline(obj, timelineNodes);
            if (!timeline || !timeline.items.length) {
                console.log('[useObjectTimeline] No timeline or items, returning early');
                return;
            }

            const shouldReset = options?.reset === true;
            let progress = computeRuntimeTimelineProgress(obj.id, timeline.items, shouldReset);
            console.log('[useObjectTimeline] Initial progress computed', {
                progress,
                shouldReset,
                completedKeys: progress.completedKeys,
                snapshotNodes: Object.keys(snapshotRef.current?.nodes || {}),
                completedPuzzles: Array.from(completedPuzzlesRef.current),
                timelineItems: timeline.items.map((item, idx) => ({
                    index: idx,
                    key: item.key,
                    type: item.type,
                    enabled: item.enabled
                }))
            });

            setTimelineUi({
                objectId: obj.id,
                objectName: obj.name,
                version: timeline.version,
                items: timeline.items,
                progress,
                isRunning: false
            });

            const existing = timelineRunRef.current;
            console.log('[useObjectTimeline] Checking existing timeline run', {
                existing,
                objectId: obj.id,
                version: timeline.version,
                shouldReset
            });

            if (
                existing &&
                existing.objectId === obj.id &&
                existing.version === timeline.version &&
                !existing.cancel
            ) {
                if (!shouldReset && existing.status === 'running') {
                    console.log('[useObjectTimeline] Timeline already running, returning early (continue-if-already-playing guard)');
                    return;
                }
                console.log('[useObjectTimeline] Cancelling existing timeline run');
                existing.cancel = true;
            }

            // Cancel any existing run (switching objects).
            if (existing) {
                existing.cancel = true;
            }
            timelineRunRef.current = { cancel: false, objectId: obj.id, version: timeline.version, status: 'running' };

            // Sequential runner (blocking items only stop progression).
            setTimelineUi((prev: any) => (prev && prev.objectId === obj.id ? { ...prev, isRunning: true } : prev));

            let idx = progress.nextIndex;
            console.log('[useObjectTimeline] Starting timeline loop', { startIndex: idx, totalItems: timeline.items.length });

            try {
                for (; idx < timeline.items.length; idx++) {
                    const runState = timelineRunRef.current;
                    console.log('[useObjectTimeline] Loop iteration', { idx, itemKey: timeline.items[idx]?.key, itemType: timeline.items[idx]?.type, runState });

                    if (!runState || runState.cancel || runState.objectId !== obj.id || runState.version !== timeline.version) {
                        console.log('[useObjectTimeline] Breaking loop - runState invalid', { runState, currentObjId: obj.id, version: timeline.version });
                        break;
                    }

                    const item = timeline.items[idx];

                    const isEnabled = item.enabled !== false;

                    if (!isEnabled) {
                        console.log('[useObjectTimeline] Skipping disabled item', {
                            idx,
                            key: item.key,
                            staticEnabled: isEnabled,
                        });
                        progress = { ...progress, nextIndex: idx + 1, blockedByPuzzleId: null };
                        setTimelineProgress(obj.id, timeline.version, progress);
                        continue;
                    }

                    // Skip already-completed items (checked in progress.completedKeys)
                    if (progress.completedKeys[item.key]) {
                        console.log('[useObjectTimeline] Skipping already-completed item', { idx, key: item.key, type: item.type });
                        progress = {
                            ...progress,
                            nextIndex: idx + 1,
                            blockedByPuzzleId: null
                        };
                        setTimelineUi((prev: any) => (prev && prev.objectId === obj.id ? { ...prev, progress } : prev));
                        continue;
                    }

                    console.log('[useObjectTimeline] Processing timeline item', { idx, key: item.key, type: item.type, blocking: item.blocking });

                    if (item.delayMs > 0) {
                        await new Promise<void>((resolve) => window.setTimeout(resolve, item.delayMs));
                    }

                    if (item.type === 'text') {
                        const text = (item as any).text;
                        if (typeof text === 'string' && text.length) {
                            const { mode, seconds } = getTextDisplayConfig(item);
                            await showTimelineText({
                                title: item.title ?? obj.name,
                                text,
                                imageUrls: getItemImageUrls(item),
                                mode,
                                seconds,
                                blocking: item.blocking,
                                objectId: obj.id,
                                itemKey: item.key
                            });
                        }
                        progress = computeRuntimeTimelineProgress(obj.id, timeline.items, false);
                        setTimelineProgress(obj.id, timeline.version, progress);
                        continue;
                    }

                    if (item.type === 'effect') {
                        await executeTimelineEffect(obj, item, { blocking: item.blocking });
                        const ok = await completeRuntimeNode(obj.id, item.key);
                        if (!ok) break;
                        progress = computeRuntimeTimelineProgress(obj.id, timeline.items, false);
                        setTimelineProgress(obj.id, timeline.version, progress);
                        continue;
                    }

                    if (item.type === 'chat') {
                        console.log('[useObjectTimeline] Starting chat', { key: item.key, item });
                        const payload = (item as any).payload ?? (item as any).params ?? {};
                        await showTimelineChat({
                            title: item.title ?? obj.name,
                            blocking: item.blocking !== false,
                            sessionId: currentSessionId,
                            playerId: questRuntime.snapshot?.me?.playerId,
                            firstMessage: (item as any).firstMessage ?? (item as any).first_message,
                            imageUrls: getItemImageUrls(item),
                            goal: (item as any).goal_injection ?? payload.goal_injection ?? payload.goal
                        });
                        const ok = await completeRuntimeNode(obj.id, item.key);
                        if (!ok) break;
                        progress = computeRuntimeTimelineProgress(obj.id, timeline.items, false);
                        setTimelineProgress(obj.id, timeline.version, progress);
                        continue;
                    }

                    if (item.type === 'audio' || item.type === 'streaming_text_audio') {
                        await playTimelineAudioItem({
                            item,
                            idx,
                            timelineItems: timeline.items,
                            objectId: obj.id,
                            objectName: obj.name,
                            getTextDisplayConfig,
                        });
                        console.log('[useObjectTimeline] Completing audio node', { key: item.key });
                        {
                            const ok = await completeRuntimeNode(obj.id, item.key);
                            if (!ok) break;
                        }
                        console.log('[useObjectTimeline] Audio node completed', { key: item.key });
                        progress = computeRuntimeTimelineProgress(obj.id, timeline.items, false);
                        setTimelineProgress(obj.id, timeline.version, progress);
                        continue;
                    }

                    if (item.type === 'video') {
                        const url = getTimelineVideoUrl(item);
                        if (url) {
                            const config = getVideoConfig(item);
                            await showTimelineVideo({
                                title: item.title ?? obj.name,
                                url,
                                blocking: item.blocking,
                                ...config
                            });
                        }
                        {
                            const ok = await completeRuntimeNode(obj.id, item.key);
                            if (!ok) break;
                        }
                        progress = computeRuntimeTimelineProgress(obj.id, timeline.items, false);
                        setTimelineProgress(obj.id, timeline.version, progress);
                        continue;
                    }

                    if (item.type === 'action') {
                        const nodeId = makeTimelineItemNodeId(obj.id, item.key);
                        const actionKind =
                            (item as any).actionKind ??
                            (item as any).action_kind ??
                            (item as any).payload?.actionKind ??
                            (item as any).payload?.action_kind;
                        const actionKindStr = typeof actionKind === 'string' && actionKind.length ? actionKind : 'action';
                        const rawParams = (item as any).params ?? (item as any).payload?.params ?? (item as any).payload ?? {};
                        const actionParams = rawParams && typeof rawParams === 'object' ? (rawParams as Record<string, any>) : {};

                        const attempt = await questRuntime.startActionAttempt(nodeId);
                        if (!attempt) {
                            console.warn('[useObjectTimeline] Failed to start action attempt', { nodeId, key: item.key, actionKind: actionKindStr });
                            await showTimelineText({
                                title: item.title ?? obj.name,
                                text: 'Unable to start this action. Please try again.',
                                mode: 'seconds',
                                seconds: 3,
                                blocking: true,
                            });
                            break;
                        }

                        console.log('[useObjectTimeline] Starting action attempt', { nodeId, key: item.key, actionKind: actionKindStr, params: actionParams });

                        const evidence = await showTimelineAction({
                            title: item.title ?? obj.name,
                            actionKind: actionKindStr,
                            params: actionParams,
                        });

                        const cancelled =
                            (evidence as any)?.__cancelled === true ||
                            (evidence && typeof evidence === 'object' && Object.keys(evidence).length === 0);
                        if (cancelled) {
                            console.log('[useObjectTimeline] Action cancelled; leaving node incomplete', { nodeId, key: item.key, actionKind: actionKindStr });
                            break;
                        }

                        const beforeVersion = snapshotRef.current?.version ?? null;
                        const submitted = await questRuntime.submitAction({
                            nodeId,
                            attemptId: attempt.attemptId,
                            attemptGroupId: attempt.attemptGroupId,
                            evidence,
                        });
                        if (!submitted) {
                            console.warn('[useObjectTimeline] Action submit failed', { nodeId, key: item.key, actionKind: actionKindStr });
                            await showTimelineText({
                                title: item.title ?? obj.name,
                                text: 'Action submit failed. Please try again.',
                                mode: 'seconds',
                                seconds: 4,
                                blocking: true,
                            });
                            break;
                        }

                        if (submitted.outcome === 'fail' || submitted.outcome === 'failure') {
                            console.warn('[useObjectTimeline] Action verification failed', { nodeId, key: item.key, actionKind: actionKindStr });
                            if (debugEnabled) {
                                addLog('warn', '[useObjectTimeline] action outcome=fail', {
                                    objectId: obj.id,
                                    nodeId,
                                    key: item.key,
                                    actionKind: actionKindStr,
                                    verificationDetails: submitted.verificationDetails ?? null,
                                });
                            }
                            await showTimelineText({
                                title: item.title ?? obj.name,
                                text: 'Action failed. Try again.',
                                mode: 'seconds',
                                seconds: 3,
                                blocking: true,
                            });
                            break;
                        }

                        // Wait for snapshot to reflect action completion (sync with React state update cycle)
                        const actionDeadline = Date.now() + 1500;
                        while (Date.now() < actionDeadline) {
                            const snap = snapshotRef.current;
                            const actionNode = snap?.nodes?.[nodeId];
                            // Action is complete when status is 'completed' and outcome is not 'fail'
                            const isFailureOutcome = actionNode?.outcome === 'fail' || actionNode?.outcome === 'failure';
                            if (actionNode?.status === 'completed' && !isFailureOutcome) {
                                console.log('[useObjectTimeline] Action node confirmed completed in snapshot', { nodeId, key: item.key });
                                break;
                            }
                            // If snapshot version updated but action not complete, stop waiting
                            if (beforeVersion !== null && snap && snap.version > beforeVersion && actionNode?.status !== 'completed') {
                                console.warn('[useObjectTimeline] Snapshot updated but action not marked complete', { nodeId, key: item.key, actionNode });
                                break;
                            }
                            await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
                        }

                        progress = computeRuntimeTimelineProgress(obj.id, timeline.items, false);
                        setTimelineProgress(obj.id, timeline.version, progress);
                        continue;
                    }

                    if (item.type === 'document') {
                        await showTimelineDocument({
                            title: item.title ?? obj.name,
                            media_id: (item as any).media_id,
                            media_url: (item as any).media_url ?? (item as any).mediaUrl,
                            text: (item as any).text,
                            blocking: item.blocking !== false,
                            objectId: obj.id,
                            itemKey: item.key
                        });
                        // Node completion is handled in closeTimelineDocument when close button is clicked
                        // Re-compute progress using updated snapshot to detect newly unlocked nodes
                        progress = computeRuntimeTimelineProgress(obj.id, timeline.items, false);
                        setTimelineProgress(obj.id, timeline.version, progress);
                        continue;
                    }

                    if (item.type === 'ar') {
                        const cfgRaw = (item as any).ar ?? (item as any).payload ?? {};
                        const taskPrompt =
                            cfgRaw.task_prompt === '<OD>' || cfgRaw.task_prompt === '<REFERRING_EXPRESSION_SEGMENTATION>'
                                ? cfgRaw.task_prompt
                                : '<REFERRING_EXPRESSION_SEGMENTATION>';
                        const overlayState = {
                            title: item.title ?? obj.name,
                            config: {
                                task_prompt: taskPrompt,
                                text_input: typeof cfgRaw.text_input === 'string' ? cfgRaw.text_input : undefined,
                                overlay: typeof cfgRaw.overlay === 'string' ? cfgRaw.overlay : undefined,
                                origin: cfgRaw.origin === 'center' || cfgRaw.origin === 'top' ? cfgRaw.origin : undefined,
                                match_target_image_url:
                                    typeof cfgRaw.match_target_image_url === 'string' ? cfgRaw.match_target_image_url : undefined,
                                match_target_image_key:
                                    typeof cfgRaw.match_target_image_key === 'string' ? cfgRaw.match_target_image_key : undefined,
                            },
                        };

                        const evidence = await showTimelineAr(overlayState);
                        const cancelled = (evidence as any)?.__cancelled === true;
                        if (cancelled) break;

                        const ok = await completeRuntimeNode(obj.id, item.key);
                        if (!ok) break;

                        progress = computeRuntimeTimelineProgress(obj.id, timeline.items, false);
                        setTimelineProgress(obj.id, timeline.version, progress);
                        continue;
                    }

                    if (item.type === 'puzzle') {
                        const puzzleId = (item as any).puzzleId ?? (item as any).puzzle_id;
                        if (typeof puzzleId !== 'string' || !puzzleId.length) {
                            progress = {
                                ...progress,
                                completedKeys: { ...progress.completedKeys, [item.key]: true },
                                nextIndex: idx + 1,
                                blockedByPuzzleId: null
                            };
                            setTimelineProgress(obj.id, timeline.version, progress);
                            continue;
                        }

                        // Guard against stale timeline data: avoid navigating to non-existent puzzles.
                        if (!hasPuzzle(puzzleId)) {
                            console.warn('[QuestMap] Skipping timeline puzzle item (missing):', {
                                objectId: obj.id,
                                puzzleId,
                                exists: hasPuzzle(puzzleId)
                            });
                            progress = {
                                ...progress,
                                completedKeys: { ...progress.completedKeys, [item.key]: true },
                                nextIndex: idx + 1,
                                blockedByPuzzleId: null
                            };
                            setTimelineProgress(obj.id, timeline.version, progress);
                            continue;
                        }

                        const isCompleted = completedPuzzlesRef.current.has(puzzleId);
                        if (isCompleted) {
                            progress = {
                                ...progress,
                                completedKeys: { ...progress.completedKeys, [item.key]: true },
                                nextIndex: idx + 1,
                                blockedByPuzzleId: null
                            };
                            setTimelineProgress(obj.id, timeline.version, progress);
                            continue;
                        }

                        progress = { ...progress, blockedByPuzzleId: puzzleId };
                        setTimelineProgress(obj.id, timeline.version, progress);

                        navigateToPuzzle(puzzleId, obj.id, item.key);
                        break;
                    }
                }

                console.log('[useObjectTimeline] Timeline loop ended', { finalIdx: idx, totalItems: timeline.items.length, reachedEnd: idx >= timeline.items.length });

                // If we completed all timeline items, complete the __end node to trigger object completion and point distribution
                if (idx >= timeline.items.length) {
                    console.log('[useObjectTimeline] All timeline items completed, completing __end node', { objectId: obj.id });
                    const endNodeId = `tl_${sanitizeIdPart(obj.id)}__end`;
                    console.log('[useObjectTimeline] Calling completeNode for __end', { endNodeId });
                    try {
                        // Capture state before completion
                        const prevObjectId = snapshotRef.current?.players?.[snapshotRef.current?.me?.playerId]?.currentObjectId;

                        await questRuntime.completeNode(endNodeId);
                        console.log('[useObjectTimeline] __end node completed successfully', { endNodeId });

                        // Sync: Wait for the global state (currentObjectId) to change.
                        // This prevents the UI from "finishing" the timeline while the map still shows the old object.
                        // Strategy: Poll local state -> Refresh if needed -> Poll again -> Fail open

                        const verifyStateChange = () => {
                            const snap = snapshotRef.current;
                            if (!snap) return false;

                            const currObjectId = snap.players?.[snap.me?.playerId]?.currentObjectId;

                            // 1. Check if currentObjectId moved away from the object we just finished
                            if (currObjectId && currObjectId !== obj.id) return true;

                            // 2. Check if the NEXT object is visible (if we can infer it - hard without context, relying on 1)

                            return false;
                        };

                        let synced = false;
                        const pollInterval = 50;

                        // Phase 1: Fast poll local state (500ms)
                        for (let i = 0; i < 10; i++) {
                            if (verifyStateChange()) { synced = true; break; }
                            await new Promise(r => setTimeout(r, pollInterval));
                        }

                        // Phase 2: Force refresh if still stale
                        if (!synced) {
                            console.log('[useObjectTimeline] State still stale after local poll, forcing refresh');
                            try {
                                await questRuntime.refresh();
                            } catch (e) {
                                console.warn('[useObjectTimeline] Refresh failed', e);
                            }
                        }

                        // Phase 3: Poll again (500ms)
                        if (!synced) {
                            for (let i = 0; i < 10; i++) {
                                if (verifyStateChange()) { synced = true; break; }
                                await new Promise(r => setTimeout(r, pollInterval));
                            }
                        }

                        if (!synced) {
                            console.warn('[useObjectTimeline] State sync timed out. Map marker visibility may lag.');
                            addLog('warn', '[Timeline] State sync timeout', {
                                prevObjectId,
                                currentObjectId: snapshotRef.current?.players?.[snapshotRef.current?.me?.playerId]?.currentObjectId
                            });
                        } else {
                            const snap = snapshotRef.current;
                            const finalCurrentObjectId = snap?.players?.[snap.me?.playerId]?.currentObjectId;
                            const finalVisibleIds = snap?.me?.visibleObjectIds;

                            console.log('[useObjectTimeline] State sync confirmed', {
                                prevObjectId,
                                newCurrentObjectId: finalCurrentObjectId,
                                visibleObjectIds: finalVisibleIds,
                                completedObjectIds: Array.from(completedPuzzlesRef.current || []) // Using completedPuzzlesRef as proxy or completedObjects if available on runtime
                            });

                            addLog('info', '[Timeline] State sync confirmed', {
                                prevObjectId,
                                newCurrentObjectId: finalCurrentObjectId,
                                visibleObjectIds: finalVisibleIds,
                                // Note: questRuntime.completedObjects is the Set of completed objects
                                completedObjectsCount: questRuntime.completedObjects?.size,
                                completedObjects: Array.from(questRuntime.completedObjects || [])
                            });
                        }

                    } catch (err) {
                        console.warn('[useObjectTimeline] Failed to complete __end node:', { objectId: obj.id, endNodeId, err });
                    }
                } else {
                    console.log('[useObjectTimeline] Timeline did NOT reach end', { finalIdx: idx, totalItems: timeline.items.length, reason: 'Loop broke early or blocked by puzzle' });
                }

                console.log('[useObjectTimeline] runObjectTimeline END', {
                    objectId: obj.id,
                    finalIndex: idx,
                    totalItems: timeline.items.length,
                    completed: idx >= timeline.items.length
                });

                setTimelineUi((prev: any) => (prev && prev.objectId === obj.id ? { ...prev, isRunning: false } : prev));
            } finally {
                if (timelineRunRef.current && timelineRunRef.current.objectId === obj.id && timelineRunRef.current.version === timeline.version) {
                    timelineRunRef.current.status = 'idle';
                }
            }
        },
        [
            canRunTimeline,
            timelineNodes,
            timelineRunRef,
            snapshotRef,
            completedPuzzlesRef,
            computeRuntimeTimelineProgress,
            completeRuntimeNode,
            setTimelineUi,
            setTimelineProgress,
            questRuntime,
            currentSessionId,
            hasPuzzle,
            showTimelineText,
            showTimelineChat,
            showTimelineVideo,
            showTimelineAction,
            showTimelineDocument,
            showTimelineAr,
            playTimelineAudioItem,
            debugEnabled,
            executeTimelineEffect,
            navigateToPuzzle,
            addLog
        ]
    );

    return { runObjectTimeline };
}
