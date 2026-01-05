'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompiledQuestDefinition, NodeId, ObjectId } from '@/runtime-core/compiledQuest';
import type { RuntimeDelta, RuntimeSnapshot } from '@/runtime-core/runtimeState';

type UseQuestRuntimeParams = {
  questId: string | null;
  questVersion: string;
  playerId: string | null;
  teamCode?: string | null;
  playerName?: string | null;
  autoStart?: boolean;
  pollIntervalMs?: number;
};

type RuntimeResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function postJson<T>(url: string, body: unknown): Promise<RuntimeResult<T>> {
  console.log(`[QuestRuntime] POST ${url}`, body);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`[QuestRuntime] POST ${url} Response:`, res.status, text.slice(0, 500)); // slice to avoid flooding console
    if (!res.ok) return { ok: false, error: text || `HTTP ${res.status}: ${res.statusText}` };
    return { ok: true, data: JSON.parse(text) as T };
  } catch (err) {
    console.error(`[QuestRuntime] POST ${url} Error:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function getJson<T>(url: string): Promise<RuntimeResult<T>> {
  try {
    const res = await fetch(url, { method: 'GET' });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: text || `HTTP ${res.status}: ${res.statusText}` };
    return { ok: true, data: JSON.parse(text) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function readPlayerNameFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem('quest_playerName') ?? null;
  } catch {
    return null;
  }
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `evt_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export type QuestRuntimeClient = {
  sessionId: string | null;
  definition: CompiledQuestDefinition | null;
  snapshot: RuntimeSnapshot | null;
  deltas: RuntimeDelta[];
  loading: boolean;
  error: string | null;

  completedObjects: Set<string>;
  completedPuzzles: Set<string>;
  scoreByPlayerId: Map<string, number>;

  refresh: () => Promise<void>;
  startOrJoin: () => Promise<void>;
  arriveAtObject: (objectId: ObjectId) => Promise<void>;
  completeNode: (nodeId: NodeId) => Promise<void>;
  submitPuzzleSuccess: (params: { puzzleId: string; objectId?: string; points?: number }) => Promise<void>;
  startActionAttempt: (nodeId: NodeId) => Promise<{ attemptId: string; attemptGroupId: string | null } | null>;
  submitAction: (params: {
    nodeId: NodeId;
    attemptId: string;
    attemptGroupId?: string | null;
    evidence?: Record<string, unknown>;
  }) => Promise<{ outcome: string | null; verificationDetails?: unknown } | null>;
  getPuzzleNodeId: (puzzleId: string, objectId?: string) => string | null;
};

export function useQuestRuntime(params: UseQuestRuntimeParams): QuestRuntimeClient {
  const {
    questId,
    questVersion,
    playerId,
    teamCode,
    playerName: playerNameProp,
    autoStart = true,
    pollIntervalMs = 10_000,
  } = params;

  const runtimeSessionId = useMemo(() => {
    if (!playerId) return null;
    return (teamCode && teamCode.trim().length ? teamCode.trim() : playerId) as string;
  }, [playerId, teamCode]);

  const playerName = useMemo(() => {
    return playerNameProp ?? readPlayerNameFromStorage() ?? (playerId ? `Player-${playerId.slice(0, 8)}` : null);
  }, [playerId, playerNameProp]);

  const [definition, setDefinition] = useState<CompiledQuestDefinition | null>(null);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [deltas, setDeltas] = useState<RuntimeDelta[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const puzzleNodeIdByKey = useMemo(() => {
    const map = new Map<string, string>();
    if (!definition) return map;
    for (const [nodeId, node] of Object.entries(definition.timelineNodes)) {
      if ((node as any).type !== 'puzzle') continue;
      const pid = (node as any).payload?.puzzleId;
      if (typeof pid !== 'string' || !pid.length) continue;
      const objectId = (node as any).objectId;
      if (typeof objectId !== 'string' || !objectId.length) continue;
      map.set(`${objectId}:${pid}`, nodeId);
    }
    return map;
  }, [definition]);

  const getPuzzleNodeId = useCallback(
    (puzzleId: string, objectId?: string): string | null => {
      if (!definition) return null;
      if (objectId) {
        return puzzleNodeIdByKey.get(`${objectId}:${puzzleId}`) ?? null;
      }
      // fallback: first match across objects
      for (const [nodeId, node] of Object.entries(definition.timelineNodes)) {
        if ((node as any).type !== 'puzzle') continue;
        const pid = (node as any).payload?.puzzleId;
        if (pid === puzzleId) return nodeId;
      }
      return null;
    },
    [definition, puzzleNodeIdByKey],
  );

  const refresh = useCallback(async () => {
    if (!runtimeSessionId || !playerId) return;
    const url = `/api/runtime/session/${encodeURIComponent(runtimeSessionId)}?playerId=${encodeURIComponent(playerId)}`;
    const res = await getJson<{ success: boolean; snapshot?: RuntimeSnapshot; error?: string }>(url);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (!res.data.success || !res.data.snapshot) {
      setError(res.data.error ?? 'Failed to load snapshot');
      return;
    }
    setSnapshot(res.data.snapshot);
    setError(null);
  }, [playerId, runtimeSessionId]);

  const loadDefinition = useCallback(async () => {
    if (!questId) return;
    const url = `/api/runtime/compiled?questId=${encodeURIComponent(questId)}&questVersion=${encodeURIComponent(questVersion)}`;
    const res = await getJson<{ success: boolean; definition?: CompiledQuestDefinition; error?: string }>(url);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (!res.data.success || !res.data.definition) {
      setError(res.data.error ?? 'Failed to load compiled definition');
      return;
    }
    setDefinition(res.data.definition);
  }, [questId, questVersion]);

  const startOrJoin = useCallback(async () => {
    if (!questId || !runtimeSessionId || !playerId || !playerName) return;
    setLoading(true);
    try {
      await loadDefinition();
      const res = await postJson<{
        success: boolean;
        sessionId?: string;
        snapshot?: RuntimeSnapshot;
        deltas?: RuntimeDelta[];
        error?: string;
      }>('/api/runtime/session/start', {
        sessionId: runtimeSessionId,
        playerId,
        playerName,
        questId,
        questVersion,
        eventId: makeId(),
        dedupeKey: `start:${runtimeSessionId}:${playerId}`,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (!res.data.success) {
        setError(res.data.error ?? 'Failed to start session');
        return;
      }
      if (res.data.snapshot) setSnapshot(res.data.snapshot);
      if (Array.isArray(res.data.deltas)) setDeltas(res.data.deltas);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [loadDefinition, playerId, playerName, questId, questVersion, runtimeSessionId]);

  const arriveAtObject = useCallback(
    async (objectId: ObjectId) => {
      if (!playerId || !runtimeSessionId) return;
      const res = await postJson<{ success: boolean; snapshot?: RuntimeSnapshot; deltas?: RuntimeDelta[]; error?: string }>(
        '/api/runtime/object/arrive',
        {
          sessionId: runtimeSessionId,
          playerId,
          objectId,
          eventId: makeId(),
          dedupeKey: `arrive:${playerId}:${objectId}`,
        },
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (!res.data.success) {
        setError(res.data.error ?? 'Arrival failed');
        return;
      }
      if (res.data.snapshot) setSnapshot(res.data.snapshot);
      if (Array.isArray(res.data.deltas)) setDeltas(res.data.deltas);
      setError(null);
    },
    [playerId, runtimeSessionId],
  );

  const completeNode = useCallback(
    async (nodeId: NodeId) => {
      if (!playerId || !runtimeSessionId) return;
      const res = await postJson<{ success: boolean; snapshot?: RuntimeSnapshot; deltas?: RuntimeDelta[]; error?: string }>(
        '/api/runtime/node/complete',
        {
          sessionId: runtimeSessionId,
          playerId,
          nodeId,
          eventId: makeId(),
          dedupeKey: `nodeComplete:${playerId}:${nodeId}`,
        },
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (!res.data.success) {
        setError(res.data.error ?? 'Node completion failed');
        return;
      }
      if (res.data.snapshot) setSnapshot(res.data.snapshot);
      if (Array.isArray(res.data.deltas)) setDeltas(res.data.deltas);
      setError(null);
    },
    [playerId, runtimeSessionId],
  );

  const submitPuzzleSuccess = useCallback(
    async (submit: { puzzleId: string; objectId?: string; points?: number }) => {
      if (!playerId || !runtimeSessionId) return;
      const res = await postJson<{ success: boolean; snapshot?: RuntimeSnapshot; deltas?: RuntimeDelta[]; error?: string }>(
        '/api/runtime/puzzle/submit',
        {
          sessionId: runtimeSessionId,
          playerId,
          puzzleId: submit.puzzleId,
          objectId: submit.objectId,
          outcome: 'success',
          points: submit.points,
          attemptGroupId: null,
          eventId: makeId(),
          dedupeKey: `puzzle:${playerId}:${submit.objectId ?? ''}:${submit.puzzleId}`,
        },
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (!res.data.success) {
        setError(res.data.error ?? 'Puzzle submit failed');
        return;
      }
      if (res.data.snapshot) setSnapshot(res.data.snapshot);
      if (Array.isArray(res.data.deltas)) setDeltas(res.data.deltas);
      setError(null);
    },
    [playerId, runtimeSessionId],
  );

  const startActionAttempt = useCallback(
    async (nodeId: NodeId) => {
      if (!playerId || !runtimeSessionId) return null;
      const res = await postJson<{
        success: boolean;
        attemptId?: string;
        attemptGroupId?: string | null;
        error?: string;
      }>('/api/runtime/action/start', {
        sessionId: runtimeSessionId,
        playerId,
        nodeId,
        eventId: makeId(),
        dedupeKey: `actionStart:${playerId}:${nodeId}:${Date.now()}`,
      });
      if (!res.ok) {
        setError(res.error);
        return null;
      }
      if (!res.data.success || typeof res.data.attemptId !== 'string' || !res.data.attemptId.length) {
        setError(res.data.error ?? 'Action start failed');
        return null;
      }
      setError(null);
      return {
        attemptId: res.data.attemptId,
        attemptGroupId: typeof res.data.attemptGroupId === 'string' ? res.data.attemptGroupId : null,
      };
    },
    [playerId, runtimeSessionId],
  );

  const submitAction = useCallback(
    async (submit: {
      nodeId: NodeId;
      attemptId: string;
      attemptGroupId?: string | null;
      evidence?: Record<string, unknown>;
    }) => {
      if (!playerId || !runtimeSessionId) return null;
      const res = await postJson<{
        success: boolean;
        snapshot?: RuntimeSnapshot;
        deltas?: RuntimeDelta[];
        verificationDetails?: unknown;
        error?: string;
      }>('/api/runtime/action/submit', {
        sessionId: runtimeSessionId,
        playerId,
        nodeId: submit.nodeId,
        attemptId: submit.attemptId,
        attemptGroupId: submit.attemptGroupId ?? null,
        evidence: submit.evidence ?? {},
        eventId: makeId(),
        dedupeKey: `action:${playerId}:${submit.nodeId}:${submit.attemptId}:${Date.now()}`,
      });
      if (!res.ok) {
        setError(res.error);
        return null;
      }
      if (!res.data.success) {
        setError(res.data.error ?? 'Action submit failed');
        return null;
      }
      if (res.data.snapshot) setSnapshot(res.data.snapshot);
      if (Array.isArray(res.data.deltas)) setDeltas(res.data.deltas);
      setError(null);

      const outcome = ((res.data.snapshot?.nodes?.[submit.nodeId] as any)?.outcome as string | null | undefined) ?? null;
      return { outcome, verificationDetails: res.data.verificationDetails };
    },
    [playerId, runtimeSessionId],
  );

  // Poll for snapshot updates (until realtime broadcast is fully wired).
  const pollRef = useRef<number | null>(null);
  const lastPollKey = `${runtimeSessionId ?? 'none'}:${playerId ?? 'none'}`;
  const lastPollKeyRef = useRef(lastPollKey);
  const startedSessionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const changed = lastPollKeyRef.current !== lastPollKey;
    if (changed) {
      lastPollKeyRef.current = lastPollKey;
      console.log('[useQuestRuntime] Poll key changed:', lastPollKey);
    }

    if (!autoStart) return;
    if (!questId || !playerId || !runtimeSessionId) return;

    // Only start/join if we haven't already done so for this session configuration.
    // This prevents redundant Start calls when other deps (like pollIntervalMs) change.
    const sessionKey = `${questId}:${questVersion}:${runtimeSessionId}:${playerId}`;
    if (startedSessionKeyRef.current !== sessionKey) {
      console.log('[useQuestRuntime] Auto-starting session:', sessionKey);
      startedSessionKeyRef.current = sessionKey;
      void startOrJoin();
    }

    if (pollIntervalMs <= 0) return;
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [autoStart, pollIntervalMs, questId, questVersion, playerId, refresh, runtimeSessionId, startOrJoin, lastPollKey]);

  const completedObjects = useMemo(() => {
    const set = new Set<string>();
    if (!snapshot) return set;
    for (const [objectId, st] of Object.entries(snapshot.objects)) {
      if (st.completedAt) set.add(objectId);
    }
    return set;
  }, [snapshot]);

  const completedPuzzles = useMemo(() => {
    const set = new Set<string>();
    if (!definition || !snapshot) return set;
    for (const [nodeId, nodeState] of Object.entries(snapshot.nodes)) {
      const node = (definition as any).timelineNodes?.[nodeId];
      if (!node || node.type !== 'puzzle') continue;
      if (nodeState.status !== 'completed' || nodeState.outcome !== 'success') continue;
      const pid = node.payload?.puzzleId;
      if (typeof pid === 'string' && pid.length) set.add(pid);
    }
    return set;
  }, [definition, snapshot]);

  const scoreByPlayerId = useMemo(() => {
    const map = new Map<string, number>();
    if (!snapshot) return map;
    for (const [id, p] of Object.entries(snapshot.players)) {
      map.set(id, p.score);
    }
    return map;
  }, [snapshot]);

  // Auto-refresh when runtime deltas arrive via TeamRoom WS (dispatched as a window event).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => void refresh();
    window.addEventListener('quest_runtime_deltas', handler);
    return () => {
      window.removeEventListener('quest_runtime_deltas', handler);
    };
  }, [refresh]);

  return useMemo(() => ({
    sessionId: runtimeSessionId,
    definition,
    snapshot,
    deltas,
    loading,
    error,
    completedObjects,
    completedPuzzles,
    scoreByPlayerId,
    refresh,
    startOrJoin,
    arriveAtObject,
    completeNode,
    submitPuzzleSuccess,
    startActionAttempt,
    submitAction,
    getPuzzleNodeId,
  }), [
    runtimeSessionId,
    definition,
    snapshot,
    deltas,
    loading,
    error,
    completedObjects,
    completedPuzzles,
    scoreByPlayerId,
    refresh,
    startOrJoin,
    arriveAtObject,
    completeNode,
    submitPuzzleSuccess,
    startActionAttempt,
    submitAction,
    getPuzzleNodeId,
  ]);
}
