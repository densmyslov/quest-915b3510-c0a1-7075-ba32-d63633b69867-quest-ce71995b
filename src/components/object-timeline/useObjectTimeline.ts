'use client';
// force-rebuild-2

import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';

import { isQuestDebugEnabled } from '@/lib/debugFlags';
import { useDebugLog } from '@/context/DebugLogContext';
import type { QuestRuntimeClient } from '@/hooks/useQuestRuntime';
import type { QuestObject } from '@/types/quest';
import type { Transcription } from '@/types/transcription';
import type {
  PulsatingCircleEffect,
} from './types';
import { useTimelineOverlays } from './hooks/useTimelineOverlays';
import { useTimelineAudio, type QuestAudioAdapter } from './hooks/useTimelineAudio';
import { useTimelineState } from './hooks/useTimelineState';
import { useTimelineLogic } from './hooks/useTimelineLogic';
import { useTimelineExecution, TimelineExecutionContext } from './hooks/useTimelineExecution';
import { useStepsMode } from './hooks/useStepsMode';

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

  // 1. Core State
  const {
    timelineUi,
    setTimelineUi,
    timelineRunRef,
    setTimelineProgress
  } = useTimelineState();

  // 2. Core Logic (Progress & Completion)
  const {
    snapshotRef,
    completedPuzzlesRef,
    // resumeAttemptedRef is managed in execution context roughly, but let's check
    // Actually, resumeAttemptedRef was local. We need it.
    computeRuntimeTimelineProgress,
    completeRuntimeNode
  } = useTimelineLogic({ questRuntime, stepsMode });

  // Note: resumeAttemptedRef was not exported from useTimelineLogic.
  // It is used in an effect in the Main Logic.
  // Let's re-create it locally or move it.
  // The 'resume' effect is actually in the main body (lines 972-1000 in original).
  // I will keep it here or move to execution.
  // Ideally, timeline logic should be pure.
  // I'll keep the effect here or inside a hook.
  // Let's keep `resumeAttemptedRef` here as it's part of the glue logic.

  const onPuzzleComplete = useCallback(async (puzzleId: string, objectId: string) => {
    const points = getPuzzlePoints(puzzleId);
    try {
      await questRuntime.submitPuzzleSuccess({ puzzleId, objectId, points });
    } catch (err) {
      addLog('warn', '[useObjectTimeline] Puzzle completion failed', { puzzleId, objectId, err });
    }
  }, [addLog, getPuzzlePoints, questRuntime]);

  // 3. Overlays
  const {
    timelineTextOverlay,
    timelineVideoOverlay,
    timelineChatOverlay,
    timelineActionOverlay,
    timelineArOverlay,
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
    showTimelineAr,
    completeTimelineAr,
    cancelTimelineAr,
    showTimelineDocument,
    closeTimelineDocument,
    closeTimelinePuzzle,
    completeTimelinePuzzle
  } = useTimelineOverlays({ completeRuntimeNode, onPuzzleComplete });

  // 4. Audio
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

  const navigateToPuzzle = useCallback(
    (puzzleId: string, objectId: string, itemKey?: string) => {
      if (debugEnabled) {
        addLog('info', '[useObjectTimeline] navigateToPuzzle', { puzzleId, objectId, itemKey, stepsMode });
      }
      setTimelinePuzzleOverlay({ puzzleId, objectId, itemKey });
    },
    [addLog, debugEnabled, setTimelinePuzzleOverlay, stepsMode]
  );

  // 5. Execution (The Main Loop)
  // We need a ref for resume attempts logic
  // Use React.useRef since we are in the component

  // Re-declare refs needed for execution that are local here
  const _resumeAttemptedRef = useRef<string | null>(null);

  // Construct Context
  const executionContext: TimelineExecutionContext = {
    debugEnabled,
    canRunTimeline,
    timelineNodes,
    addLog: addLog as any,
    timelineRunRef,
    snapshotRef,
    completedPuzzlesRef,
    resumeAttemptedRef: _resumeAttemptedRef,
    computeRuntimeTimelineProgress,
    completeRuntimeNode,
    setTimelineUi,
    setTimelineProgress,
    questRuntime,
    currentSessionId,
    hasPuzzle,
    getValidCoordinates,
    getPuzzlePoints,
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
  };

  const { runObjectTimeline } = useTimelineExecution(executionContext);

  // 6. Resume Logic (Effect)
  useEffect(() => {
    if (!timelineUi?.progress.blockedByPuzzleId) return;
    const puzzleId = timelineUi.progress.blockedByPuzzleId;
    if (!questRuntime.completedPuzzles.has(puzzleId)) return;

    if (_resumeAttemptedRef.current === puzzleId) return;

    if (!stepsMode) {
      const playerId = snapshotRef.current?.me?.playerId;
      const currentRuntimeObjectId = playerId ? snapshotRef.current?.players?.[playerId]?.currentObjectId : null;
      if (currentRuntimeObjectId && currentRuntimeObjectId !== timelineUi.objectId) {
        console.warn('[useObjectTimeline] Skipping resume for stale object', {
          staleObjectId: timelineUi.objectId,
          currentRuntimeObjectId
        });
        return;
      }
    }

    _resumeAttemptedRef.current = puzzleId;

    const obj = objectsById.get(timelineUi.objectId);
    if (!obj) return;
    void runObjectTimeline(obj);
  }, [objectsById, questRuntime.completedPuzzles, runObjectTimeline, timelineUi, stepsMode, snapshotRef]);

  // 7. Steps Mode
  const { stepsTimelinePanel, openTimelineItem, skipTimelineItem } = useStepsMode({
    stepsMode,
    timelineUi,
    questRuntime,
    objectsById,
    debugEnabled,
    addLog: addLog as any,
    navigateToPuzzle,
    showTimelineText,
    showTimelineAction,
    showTimelineDocument,
    showTimelineAr,
    closeTimelineText,
    closeTimelineVideo,
    closeTimelineChat,
    closeTimelineDocument,
    stopTimelineAudioItem,
    removeTimelinePulsatingCircle,
    completeRuntimeNode,
    setTimelineProgress,
    runObjectTimeline,
    timelineRunRef,
    getPuzzlePoints
  });

  return {
    runObjectTimeline,
    stepsTimelinePanel,
    timelineActionOverlay,
    completeTimelineAction,
    cancelTimelineAction,
    timelineArOverlay,
    completeTimelineAr,
    cancelTimelineAr,
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
