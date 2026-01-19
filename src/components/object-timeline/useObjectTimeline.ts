'use client';
// force-rebuild-1

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';

import { normalizeMediaTimeline, type NormalizedMediaTimelineItem } from '@/lib/mediaTimeline';
import { isQuestDebugEnabled } from '@/lib/debugFlags';
import { makeTimelineItemNodeId, sanitizeIdPart } from '@/runtime-core/compileQuest';
import { useDebugLog } from '@/context/DebugLogContext';
import type { QuestRuntimeClient } from '@/hooks/useQuestRuntime';
import type { QuestObject } from '@/types/quest';
import type { Transcription } from '@/types/transcription';
import type {
  PulsatingCircleEffect,
  TimelinePanel,
  TimelineProgressState,
  TimelineActionOverlayState,
  TimelineChatOverlayState,
  TimelineTextOverlayState,
  TimelineVideoOverlayState,
  TimelineUiState,
  TimelineDocumentOverlayState,
} from './types';
import { computeGpsEnabledItems, getTimelineVideoUrl } from './utils';
import { useTimelineOverlays } from './hooks/useTimelineOverlays';
import { useTimelineAudio, type QuestAudioAdapter } from './hooks/useTimelineAudio';

// #region Types & Interfaces

type TimelineAudioPayload = {
  url: string;
  objectName: string;
  objectId: string;
  transcription: Transcription | null;
  loop?: boolean;
  volume?: number;
  panelAutoCloseAfterEndedMs?: number | null;
};

type TimelineEffectAudioPayload = {
  url: string;
  objectName: string;
  objectId: string;
  loop?: boolean;
  volume?: number;
};

type UseObjectTimelineParams = {
  currentSessionId: string | null;
  stepsMode: boolean;
  questRuntime: QuestRuntimeClient;
  objectsById: Map<string, QuestObject>;
  hasPuzzle: (puzzleId: string) => boolean;
  canRunTimeline?: () => boolean;
  playAudio: (payload: TimelineAudioPayload) => void;
  playAudioBlocking: (payload: TimelineAudioPayload) => Promise<void>;
  playEffectAudio: (payload: TimelineEffectAudioPayload) => void;
  playEffectAudioBlocking: (payload: TimelineEffectAudioPayload) => Promise<void>;
  stopAudio: () => void;
  stopEffectAudio: () => void;
  waitForAudioPanelClose: () => Promise<void>;
  stopAudioRef: MutableRefObject<() => void>;
  questAudio: QuestAudioAdapter;
  addOrUpdatePulsatingCircle: (params: {
    objectId: string;
    center: [number, number];
    effect: PulsatingCircleEffect;
    source: 'object' | 'timeline';
    durationMs?: number;
  }) => void;
  removeTimelinePulsatingCircle: (objectId: string) => void;
  getValidCoordinates: (obj: QuestObject) => [number, number] | null;
  normalizeEffect: (effect: any) => PulsatingCircleEffect;
  getPuzzlePoints: (puzzleId: string) => number;
  timelineNodes?: Record<string, any>; // Add timeline nodes for reconstruction
};
// #endregion



export function useObjectTimeline({
  currentSessionId,
  stepsMode,
  questRuntime,
  objectsById,
  hasPuzzle,
  canRunTimeline,
  playAudio,
  playAudioBlocking,
  playEffectAudio,
  playEffectAudioBlocking,
  stopAudio,
  stopEffectAudio,
  waitForAudioPanelClose,
  stopAudioRef,
  questAudio,
  addOrUpdatePulsatingCircle,
  removeTimelinePulsatingCircle,
  getValidCoordinates,
  normalizeEffect,
  getPuzzlePoints,
  timelineNodes
}: UseObjectTimelineParams) {
  const { addLog } = useDebugLog();
  const debugEnabled = useMemo(() => isQuestDebugEnabled(), []);

  // #region State & Refs
  // const router = useRouter();
  // const router = useRouter();
  const timelineRunRef = useRef<{ cancel: boolean; objectId: string; version: number; status: 'running' | 'idle' } | null>(null);
  const [timelineUi, setTimelineUi] = useState<TimelineUiState | null>(null);
  // #endregion
  // #endregion

  // #region Effects
  // Refs for volatile data to stabilize callbacks
  const snapshotRef = useRef(questRuntime.snapshot);
  const completedPuzzlesRef = useRef(questRuntime.completedPuzzles);
  const questRuntimeRef = useRef(questRuntime);
  const resumeAttemptedRef = useRef<string | null>(null);
  const prevCompletedPuzzlesSizeRef = useRef(questRuntime.completedPuzzles.size);
  const gpsEnabledItemsRef = useRef<Set<string>>(new Set());
  // #endregion

  // Keep refs in sync with latest runtime state.
  // Without this, timeline progression can "stick" because completion checks read a stale snapshot.
  useEffect(() => {
    snapshotRef.current = questRuntime.snapshot;
  }, [questRuntime.snapshot]);

  useEffect(() => {
    completedPuzzlesRef.current = questRuntime.completedPuzzles;
    prevCompletedPuzzlesSizeRef.current = questRuntime.completedPuzzles.size;
  }, [questRuntime.completedPuzzles]);

  useEffect(() => {
    questRuntimeRef.current = questRuntime;
  }, [questRuntime]);



  // #region Progress & Completion Logic



  const computeRuntimeTimelineProgress = useCallback(
    (objectId: string, items: NormalizedMediaTimelineItem[], reset: boolean): TimelineProgressState => {
      if (reset) return { nextIndex: 0, completedKeys: {}, blockedByPuzzleId: null };

      const completedKeys: Record<string, true> = {};
      const gpsEnabledKeys = gpsEnabledItemsRef.current;

      // Build completed keys map
      for (const item of items) {
        // Check BOTH static enabled AND GPS-enabled
        const isStaticallyEnabled = item.enabled !== false;
        const isGpsEnabled = !(item as any).gpsTrigger?.enabled || gpsEnabledKeys.has(item.key);
        const isFullyEnabled = isStaticallyEnabled && isGpsEnabled;

        if (!isFullyEnabled) continue;

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
            !(item.type === 'action' && node.outcome === 'fail') &&
            !(item.type === 'puzzle' && node.outcome === 'fail'));

        if (isCompleted) {
          completedKeys[item.key] = true;
        }
      }

      // Find the first enabled item that is not completed yet.
      // Always scan from the beginning to avoid skipping a node when a completion call fails.
      let nextIndex = items.length;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        const isStaticallyEnabled = item.enabled !== false;
        const isGpsEnabled = !(item as any).gpsTrigger?.enabled || gpsEnabledKeys.has(item.key);
        const isFullyEnabled = isStaticallyEnabled && isGpsEnabled;

        if (!isFullyEnabled) continue;

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
      // NOTE: We don't strictly need currentSessionId for the API call (questRuntime handles it),
      // but keeping the check if needed for safety. Removing strict dependency if feasible.
      if (!questRuntimeRef.current) return false;

      const nodeId = makeTimelineItemNodeId(objectId, itemKey);

      try {
        const beforeVersion = snapshotRef.current?.version ?? null;
        let result = await questRuntimeRef.current.completeNode(nodeId);

        // RETRY LOGIC (Handling 409 Conflicts due to stale snapshot version)
        if (!result.success && result.error?.includes('conflict') || result.error?.includes('version')) {
          console.warn('[useObjectTimeline] Conflict detected. Starting retry loop...');
          for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 800)); // Wait 800ms
            console.log(`[useObjectTimeline] Retry attempt ${i + 1}`);
            result = await questRuntimeRef.current.completeNode(nodeId);
            if (result.success) break;
          }
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

        const node = snapshotRef.current?.nodes?.[nodeId];
        const ok = node?.status === 'completed';

        if (!ok) {
          console.warn('[QuestMap] Runtime node did not complete', { objectId, itemKey, nodeId, node });
        }
        return ok;
      } catch (err) {
        console.warn('[QuestMap] Failed to record runtime node completion:', { objectId, itemKey, nodeId, err });
        return false;
      }
    },
    [stepsMode] // Removed currentSessionId dependency if not needed, or keep it.
  );
  // #endregion

  // #region Overlay Handlers (Extracted)
  const {
    timelineTextOverlay,
    timelineVideoOverlay,
    timelineChatOverlay,
    timelineActionOverlay,
    timelineDocumentOverlay,
    timelinePuzzleOverlay,
    setTimelinePuzzleOverlay,
    showTimelineText,
    closeTimelineText,
    showTimelineVideo,
    closeTimelineVideo,
    showTimelineChat,
    closeTimelineChat,
    showTimelineAction,
    completeTimelineAction,
    cancelTimelineAction,
    showTimelineDocument,
    closeTimelineDocument,
    closeTimelinePuzzle,
    completeTimelinePuzzle
  } = useTimelineOverlays({ completeRuntimeNode });
  // #endregion

  const { playTimelineAudioItem, stopTimelineAudioItem } = useTimelineAudio({
    debugEnabled,
    addLog,
    questAudio,
    playAudio,
    playAudioBlocking,
    playEffectAudio,
    playEffectAudioBlocking,
    stopAudio,
    stopEffectAudio,
  });

  // #region UI State Setters

  const setTimelineProgress = useCallback((objectId: string, version: number, progress: TimelineProgressState) => {
    setTimelineUi((prev) => {
      if (!prev) return prev;
      if (prev.objectId !== objectId || prev.version !== version) return prev;
      return { ...prev, progress };
    });
  }, []);
  // #endregion

















  const navigateToPuzzle = useCallback(
    (puzzleId: string, objectId: string, itemKey?: string) => {
      // Overlay Mode: Set state to show overlay instead of navigating
      if (debugEnabled) {
        addLog('info', '[useObjectTimeline] navigateToPuzzle', { puzzleId, objectId, itemKey, stepsMode });
      }
      setTimelinePuzzleOverlay({ puzzleId, objectId, itemKey });
    },
    [addLog, debugEnabled, stepsMode]
  );



  // #region Main Execution Logic

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

      // ... (logging)

      const getTextDisplayConfig = (item: any): { mode: 'seconds' | 'until_close'; seconds: number } => {
        // ... (implementation same as before)
        const rawMode = item?.displayMode ?? item?.display_mode ?? 'seconds';
        const mode: 'seconds' | 'until_close' = rawMode === 'until_close' ? 'until_close' : 'seconds';
        const rawSeconds = item?.displaySeconds ?? item?.display_seconds ?? 5;
        const seconds = Number.isFinite(Number(rawSeconds)) ? Math.max(1, Number(rawSeconds) || 5) : 5;
        return { mode, seconds };
      };

      const getVideoConfig = (item: any) => {
        // ... (implementation same as before)
        const rawAutoPlay = item?.autoPlay ?? item?.autoplay ?? item?.auto_play;
        const rawMuted = item?.muted ?? item?.mute;
        const rawLoop = item?.loop;
        const rawPoster = item?.posterUrl ?? item?.poster_url ?? item?.poster;
        return {
          autoPlay: typeof rawAutoPlay === 'boolean' ? rawAutoPlay : true,
          muted: typeof rawMuted === 'boolean' ? rawMuted : false,
          loop: typeof rawLoop === 'boolean' ? rawLoop : false,
          posterUrl: typeof rawPoster === 'string' ? rawPoster : undefined
        };
      };

      const getItemImageUrls = (item: any): string[] => {
        const raw = item?.image_urls ?? item?.imageUrls ?? [];
        if (!Array.isArray(raw)) return [];
        return raw.filter((v: unknown): v is string => typeof v === 'string' && v.length > 0);
      };

      const executeTimelineEffect = async (item: NormalizedMediaTimelineItem, params: { blocking: boolean }) => {
        // ... (implementation same as before)
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
      };

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
          return; // Continue-if-already-playing (recommended)
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
      setTimelineUi((prev) => (prev && prev.objectId === obj.id ? { ...prev, isRunning: true } : prev));

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

          // Check BOTH static AND GPS enablement
          const isStaticallyEnabled = item.enabled !== false;
          const isGpsEnabled = !(item as any).gpsTrigger?.enabled || gpsEnabledItemsRef.current.has(item.key);
          const isFullyEnabled = isStaticallyEnabled && isGpsEnabled;

          if (!isFullyEnabled) {
            console.log('[useObjectTimeline] Skipping disabled item', {
              idx,
              key: item.key,
              staticEnabled: isStaticallyEnabled,
              gpsEnabled: isGpsEnabled,
              hasGpsTrigger: !!(item as any).gpsTrigger?.enabled
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
            setTimelineUi((prev) => (prev && prev.objectId === obj.id ? { ...prev, progress } : prev));
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
            // Node completion is handled in closeTimelineText when close button is clicked
            // or when timer expires (which also calls closeTimelineText)
            // Re-compute progress using updated snapshot to detect newly unlocked nodes
            progress = computeRuntimeTimelineProgress(obj.id, timeline.items, false);
            setTimelineProgress(obj.id, timeline.version, progress);
            continue;
          }

          if (item.type === 'effect') {
            await executeTimelineEffect(item, { blocking: item.blocking });
            const ok = await completeRuntimeNode(obj.id, item.key);
            if (!ok) break;
            // Re-compute progress using updated snapshot to detect newly unlocked nodes
            progress = computeRuntimeTimelineProgress(obj.id, timeline.items, false);
            setTimelineProgress(obj.id, timeline.version, progress);
            continue;
          }

          if (item.type === 'chat') {
            console.log('[useObjectTimeline] Starting chat', { key: item.key, item }); // Added item logging
            const payload = (item as any).payload ?? (item as any).params ?? {};
            console.log('[useObjectTimeline] Chat Goal Debug:', {
              itemGoal: (item as any).goal_injection,
              payloadGoal: payload.goal_injection,
              legacyGoal: payload.goal,
              finalGoal: (item as any).goal_injection ?? payload.goal_injection ?? payload.goal
            });
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
            // Re-compute progress using updated snapshot to detect newly unlocked nodes
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
            // Re-compute progress using updated snapshot to detect newly unlocked nodes
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

            const attempt = await questRuntimeRef.current.startActionAttempt(nodeId);
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
            const submitted = await questRuntimeRef.current.submitAction({
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

            if (submitted.outcome === 'fail') {
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
              if (actionNode?.status === 'completed' && actionNode?.outcome !== 'fail') {
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
              if (debugEnabled) {
                addLog('warn', '[useObjectTimeline] timeline puzzle missing, skipping', {
                  objectId: obj.id,
                  puzzleId,
                  key: item.key
                });
              }
              progress = {
                ...progress,
                completedKeys: { ...progress.completedKeys, [item.key]: true },
                nextIndex: idx + 1,
                blockedByPuzzleId: null
              };
              setTimelineProgress(obj.id, timeline.version, progress);
              continue;
            }

            // USE REF HERE
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
            if (debugEnabled) {
              addLog('info', '[useObjectTimeline] blocked by puzzle', {
                objectId: obj.id,
                puzzleId,
                key: item.key,
                stepsMode
              });
            }

            if (stepsMode) {
              // In steps mode, we now want autoplay behavior (same as Play mode),
              // so we do NOT break here anymore.
              // break;
            }

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
            await questRuntimeRef.current.completeNode(endNodeId);
            console.log('[useObjectTimeline] __end node completed successfully', { endNodeId });
            // Force a refresh to ensure the "Next Object Visible" state is reflected in the snapshot immediately
            await questRuntimeRef.current.refresh();
          } catch (err) {
            console.warn('[useObjectTimeline] Failed to complete __end node:', { objectId: obj.id, endNodeId, err });
          }
        } else {
          console.log('[useObjectTimeline] Timeline did NOT reach end', { finalIdx: idx, totalItems: timeline.items.length, reason: 'Loop broke early or blocked by puzzle' });
        }

        // Allow reruns once the sequential pass stops (e.g. after navigating to a puzzle).
        // timelineRunRef.current = null; // Don't null, just idle.

        console.log('[useObjectTimeline] runObjectTimeline END', {
          objectId: obj.id,
          finalIndex: idx,
          totalItems: timeline.items.length,
          completed: idx >= timeline.items.length
        });

        setTimelineUi((prev) => (prev && prev.objectId === obj.id ? { ...prev, isRunning: false } : prev));
      } finally {
        if (timelineRunRef.current && timelineRunRef.current.objectId === obj.id && timelineRunRef.current.version === timeline.version) {
          timelineRunRef.current.status = 'idle';
        }
      }
    },
    [
      addLog,
      addOrUpdatePulsatingCircle,
      canRunTimeline,
      completeRuntimeNode,
      computeRuntimeTimelineProgress,
      debugEnabled,
      navigateToPuzzle,
      playTimelineAudioItem,
      playAudio,
      playAudioBlocking,
      questAudio,
      showTimelineText,
      currentSessionId,
      playEffectAudio,
      playEffectAudioBlocking,
      showTimelineAction,
      showTimelineVideo,
      showTimelineChat,
      stepsMode,
      // REMOVED questRuntime.completedPuzzles dependency to avoid loops
      waitForAudioPanelClose,
      stopAudioRef,
      getValidCoordinates,
      normalizeEffect,
      hasPuzzle,
      // REMOVED questRuntime.completedPuzzles dependency to avoid loops
      waitForAudioPanelClose,
      stopAudioRef,
      getValidCoordinates,
      normalizeEffect,
      hasPuzzle,
      setTimelineProgress,
      showTimelineDocument,
      closeTimelineDocument,
    ]
  );


  useEffect(() => {
    if (!timelineUi?.progress.blockedByPuzzleId) return;
    const puzzleId = timelineUi.progress.blockedByPuzzleId;
    if (!questRuntime.completedPuzzles.has(puzzleId)) return;

    // Prevent double-resume for the same puzzle
    if (resumeAttemptedRef.current === puzzleId) return;
    resumeAttemptedRef.current = puzzleId;

    const obj = objectsById.get(timelineUi.objectId);
    if (!obj) return;
    void runObjectTimeline(obj);
  }, [objectsById, questRuntime.completedPuzzles, runObjectTimeline, timelineUi]);

  // #region Steps Mode Handlers

  const openTimelinePuzzle = useCallback(
    (itemKey: string) => {
      if (!timelineUi) return;
      const item = timelineUi.items.find((it) => it.key === itemKey);
      if (!item || item.type !== 'puzzle') return;
      const puzzleId = (item as any).puzzleId ?? (item as any).puzzle_id;
      if (typeof puzzleId !== 'string' || !puzzleId.length) return;
      if (debugEnabled) {
        addLog('info', '[useObjectTimeline] openTimelinePuzzle (Steps UI)', {
          itemKey,
          puzzleId,
          objectId: timelineUi.objectId
        });
      }
      navigateToPuzzle(puzzleId, timelineUi.objectId, itemKey);
    },
    [addLog, debugEnabled, navigateToPuzzle, timelineUi]
  );

  const openTimelineAction = useCallback(
    async (itemKey: string) => {
      if (!timelineUi) return;
      const item = timelineUi.items.find((it) => it.key === itemKey);
      if (!item || item.type !== 'action') return;

      const actionKind =
        (item as any).actionKind ??
        (item as any).action_kind ??
        (item as any).payload?.actionKind ??
        (item as any).payload?.action_kind;
      const actionKindStr = typeof actionKind === 'string' && actionKind.length ? actionKind : 'action';
      const rawParams = (item as any).params ?? (item as any).payload?.params ?? (item as any).payload ?? {};
      const actionParams = rawParams && typeof rawParams === 'object' ? (rawParams as Record<string, any>) : {};

      if (debugEnabled) {
        addLog('info', '[useObjectTimeline] openTimelineAction (Steps UI)', {
          itemKey,
          actionKind: actionKindStr,
          objectId: timelineUi.objectId
        });
      }

      const nodeId = makeTimelineItemNodeId(timelineUi.objectId, item.key);
      const attempt = await questRuntime.startActionAttempt(nodeId);
      if (!attempt) {
        console.warn('[useObjectTimeline] Failed to start action attempt (Steps mode)', { nodeId, actionKind: actionKindStr });
        await showTimelineText({
          title: item.title ?? timelineUi.objectName,
          text: 'Unable to start this action. Please try again.',
          mode: 'seconds',
          seconds: 3,
          blocking: true,
        });
        return;
      }

      const evidence = await showTimelineAction({
        title: item.title ?? timelineUi.objectName,
        actionKind: actionKindStr,
        params: actionParams,
      });

      const cancelled =
        (evidence as any)?.__cancelled === true ||
        (evidence && typeof evidence === 'object' && Object.keys(evidence).length === 0);
      if (cancelled) {
        console.log('[useObjectTimeline] Action cancelled (Steps mode)', { nodeId, key: item.key, actionKind: actionKindStr });
        return;
      }

      const submitted = await questRuntime.submitAction({
        nodeId,
        attemptId: attempt.attemptId,
        attemptGroupId: attempt.attemptGroupId,
        evidence,
      });
      if (!submitted) {
        console.warn('[useObjectTimeline] Action submit failed (Steps mode)', { nodeId, key: item.key, actionKind: actionKindStr });
        return;
      }

      // Refresh timeline after successful action completion
      const obj = objectsById.get(timelineUi.objectId);
      if (obj) {
        void runObjectTimeline(obj);
      }
    },
    [addLog, debugEnabled, timelineUi, questRuntime, showTimelineText, showTimelineAction, objectsById, runObjectTimeline]
  );

  const skipTimelineItem = useCallback(
    async (itemKey: string) => {
      if (!stepsMode) return;
      if (!timelineUi) return;

      const itemIndex = timelineUi.items.findIndex((it) => it.key === itemKey);
      if (itemIndex < 0) return;
      const item = timelineUi.items[itemIndex];

      // Stop any currently blocking foreground audio.
      stopTimelineAudioItem(item);

      if (item.type === 'text') {
        closeTimelineText();
      }

      if (item.type === 'video') {
        closeTimelineVideo();
      }

      if (item.type === 'chat') {
        closeTimelineChat();
      }

      if (item.type === 'document') {
        closeTimelineDocument();
      }

      if (item.type === 'effect') {
        const effectType = (item as any).effectType ?? (item as any).effect_type ?? 'pulsating_circles';
        if (effectType === 'pulsating_circles') {
          removeTimelinePulsatingCircle(timelineUi.objectId);
        }
      }

      if (item.type === 'action') {
        const nodeId = makeTimelineItemNodeId(timelineUi.objectId, item.key);
        const attempt = await questRuntime.startActionAttempt(nodeId);
        if (!attempt) {
          console.warn('[QuestMap] Steps-mode action start failed:', { nodeId });
        } else {
          const kind =
            (item as any).actionKind ??
            (item as any).action_kind ??
            (item as any).payload?.actionKind ??
            (item as any).payload?.action_kind;
          const kindStr = typeof kind === 'string' && kind.length ? kind : 'action';

          const rawParams = (item as any).params ?? (item as any).payload?.params ?? (item as any).payload ?? {};
          const params = rawParams && typeof rawParams === 'object' ? (rawParams as Record<string, any>) : {};

          const evidence: Record<string, unknown> = (() => {
            if (kindStr === 'image_match') {
              return { bypass: true };
            }
            if (kindStr === 'knockknock') {
              const requiredKnocksRaw = params.requiredKnocks ?? params.required_knocks;
              const requiredKnocksNum = Number.isFinite(Number(requiredKnocksRaw)) ? Math.floor(Number(requiredKnocksRaw)) : 3;
              const requiredKnocks = Math.max(2, Math.min(10, requiredKnocksNum));

              const maxIntervalRaw = params.maxIntervalMs ?? params.max_interval_ms;
              const maxIntervalMs = Number.isFinite(Number(maxIntervalRaw)) ? Math.max(0, Math.floor(Number(maxIntervalRaw))) : 2000;

              const expectedRaw = params.expectedPattern ?? params.expected_pattern;
              const expectedPattern: number[] | null = (() => {
                const arr = Array.isArray(expectedRaw) ? expectedRaw : null;
                if (!arr || !arr.length) return null;
                const nums = arr.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
                return nums.length ? nums : null;
              })();

              const start = Date.now();
              const timestamps: number[] = [start];

              const intervals: number[] = (() => {
                if (expectedPattern && expectedPattern.length === requiredKnocks - 1) {
                  const total = expectedPattern.reduce((a, b) => a + b, 0);
                  if (maxIntervalMs > 0 && total > maxIntervalMs && total > 0) {
                    const scale = maxIntervalMs / total;
                    return expectedPattern.map((x) => Math.max(1, Math.floor(x * scale)));
                  }
                  return expectedPattern;
                }
                const interval = maxIntervalMs > 0 ? Math.max(1, Math.floor(maxIntervalMs / requiredKnocks)) : 200;
                return Array.from({ length: requiredKnocks - 1 }, () => interval);
              })();

              let t = start;
              for (const dt of intervals) {
                t += dt;
                timestamps.push(t);
              }
              return { knockPattern: timestamps };
            }
            return {};
          })();

          try {
            await questRuntime.submitAction({
              nodeId,
              attemptId: attempt.attemptId,
              attemptGroupId: attempt.attemptGroupId,
              evidence,
            });
          } catch (err) {
            console.warn('[QuestMap] Steps-mode action submit failed:', err);
          }
        }
      } else if (item.type === 'puzzle') {
        const puzzleId = (item as any).puzzleId ?? (item as any).puzzle_id;
        if (typeof puzzleId === 'string' && puzzleId.length) {
          const points = getPuzzlePoints(puzzleId);
          try {
            await questRuntime.submitPuzzleSuccess({ puzzleId, objectId: timelineUi.objectId, points });
          } catch (err) {
            console.warn('[QuestMap] Steps-mode puzzle skip failed:', err);
          }
        }
      } else if (item.type === 'document') {
        // Show document overlay with slide-into-folder animation
        await showTimelineDocument({
          title: item.title ?? timelineUi.objectName,
          media_id: (item as any).media_id,
          media_url: (item as any).media_url ?? (item as any).mediaUrl,
          text: (item as any).text,
          blocking: true,
          objectId: timelineUi.objectId,
          itemKey: item.key
        });
        await completeRuntimeNode(timelineUi.objectId, item.key);
      } else {
        await completeRuntimeNode(timelineUi.objectId, item.key);
      }

      const nextProgress: TimelineProgressState = {
        ...timelineUi.progress,
        completedKeys: { ...timelineUi.progress.completedKeys, [item.key]: true },
        blockedByPuzzleId: null,
      };

      if (itemIndex === timelineUi.progress.nextIndex) {
        nextProgress.nextIndex = itemIndex + 1;
      }

      setTimelineProgress(timelineUi.objectId, timelineUi.version, nextProgress);

      // Restart the runner with the updated progress.
      const runState = timelineRunRef.current;
      if (runState) runState.cancel = true;
      const obj = objectsById.get(timelineUi.objectId);
      if (obj) {
        void runObjectTimeline(obj);
      }
    },
    [
      closeTimelineText,
      closeTimelineVideo,
      closeTimelineChat,
      completeRuntimeNode,
      getPuzzlePoints,
      objectsById,
      questRuntime,
      removeTimelinePulsatingCircle,
      runObjectTimeline,
      setTimelineProgress,
      stepsMode,
      stopTimelineAudioItem,
      timelineUi,
    ],
  );

  const openTimelineItem = useCallback(
    (itemKey: string) => {
      if (!timelineUi) return;
      const item = timelineUi.items.find((it) => it.key === itemKey);
      if (!item) return;

      if (item.type === 'puzzle') {
        openTimelinePuzzle(itemKey);
      } else if (item.type === 'action') {
        void openTimelineAction(itemKey);
      }
    },
    [timelineUi, openTimelinePuzzle, openTimelineAction]
  );

  const stepsTimelinePanel: TimelinePanel | null = useMemo(() => {
    // console.log('[useObjectTimeline] Computing stepsTimelinePanel', { stepsMode, hasTimelineUi: !!timelineUi });
    if (!stepsMode) return null;
    if (!timelineUi) {
      console.log('[useObjectTimeline] stepsTimelinePanel: Missing timelineUi in steps mode');
      return null;
    }

    const items = timelineUi.items.map((item, idx) => {
      const puzzleId = item.type === 'puzzle' ? (item as any).puzzleId ?? (item as any).puzzle_id : null;
      const isPuzzleCompleted =
        item.type === 'puzzle' && typeof puzzleId === 'string' ? questRuntime.completedPuzzles.has(puzzleId) : false;

      const done =
        isPuzzleCompleted ||
        idx < timelineUi.progress.nextIndex ||
        !!timelineUi.progress.completedKeys[item.key];

      const current = idx === timelineUi.progress.nextIndex;

      const label = (() => {
        if (typeof (item as any).title === 'string' && (item as any).title.length) return (item as any).title;
        if (item.type === 'puzzle') return `Puzzle ${typeof puzzleId === 'string' ? puzzleId : ''}`.trim();
        if (item.type === 'streaming_text_audio') return 'Audio con testo';
        if (item.type === 'audio') return 'Audio';
        if (item.type === 'video') return 'Video';
        if (item.type === 'text') return 'Testo';
        if (item.type === 'chat') return 'Chat';
        if (item.type === 'action') return 'Azione';
        if (item.type === 'effect') return 'Effetto';
        if (item.type === 'document') return 'Documento';
        return item.type;
      })();

      // Determine if item can be opened
      const canOpenPuzzle = item.type === 'puzzle' && typeof puzzleId === 'string' && puzzleId.length > 0;
      const canOpenAction = item.type === 'action'; // All actions can be opened
      const canOpen = canOpenPuzzle || canOpenAction;

      // GPS trigger info
      const trigger = (item as any).gpsTrigger;
      const isGpsGated = !!(trigger?.enabled);
      const isGpsEnabled = gpsEnabledItemsRef.current.has(item.key);
      const gpsLocked = isGpsGated && !isGpsEnabled;

      return {
        key: item.key,
        type: item.type,
        label,
        done,
        current,
        canOpen,
        gpsLocked,
        gpsTriggerMode: trigger?.mode || null,
        gpsDistanceMeters: trigger?.distanceMeters || null
      };
    });

    return {
      objectId: timelineUi.objectId,
      objectName: timelineUi.objectName,
      blockedByPuzzleId: timelineUi.progress.blockedByPuzzleId,
      items,
      onSkip: skipTimelineItem,
      onOpen: openTimelineItem
    };
  }, [openTimelineItem, questRuntime.completedPuzzles, skipTimelineItem, stepsMode, timelineUi]);
  // #endregion

  // #region Return

  return {
    runObjectTimeline,
    stepsTimelinePanel,
    timelineActionOverlay,
    completeTimelineAction,
    cancelTimelineAction,
    timelineDocumentOverlay,
    closeTimelineDocument,
    timelineTextOverlay,
    closeTimelineText,
    timelineVideoOverlay,
    closeTimelineVideo,
    timelineChatOverlay,
    closeTimelineChat,
    timelinePuzzleOverlay,
    closeTimelinePuzzle,
    completeTimelinePuzzle,
    openTimelineItem,
    skipTimelineItem,
  };
}
// #endregion
