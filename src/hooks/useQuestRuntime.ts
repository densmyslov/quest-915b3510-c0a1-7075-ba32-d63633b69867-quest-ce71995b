'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompiledQuestDefinition, NodeId, ObjectId } from '@/runtime-core/compiledQuest';
import type { RuntimeDelta, RuntimeSnapshot } from '@/runtime-core/runtimeState';

type UseQuestRuntimeParams = {
  questId: string | null;
  sessionId?: string | null;
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
  startOrJoin: (options?: { reset?: boolean }) => Promise<void>;
  arriveAtObject: (objectId: ObjectId) => Promise<void>;
  completeNode: (nodeId: NodeId) => Promise<{ success: boolean; error?: string }>;
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
    teamCode, // eslint-disable-line @typescript-eslint/no-unused-vars
    sessionId, // Destructure new param
    playerName: playerNameProp,
    autoStart = true,
    pollIntervalMs = 10_000,
  } = params;

  const runtimeSessionId = useMemo(() => {
    // 1. Explicit session ID (e.g. from API/TeamSync) takes precedence
    if (sessionId) return sessionId;

    // 2. Fallback to playerId (User-specific)
    // We intentionally ignore teamCode here to prevent shared sessions
    if (playerId) return playerId;

    return null;
  }, [sessionId, playerId]);

  const [storedPlayerName, setStoredPlayerName] = useState<string | null>(() => readPlayerNameFromStorage());

  useEffect(() => {
    const handler = () => {
      setStoredPlayerName(readPlayerNameFromStorage());
    };
    window.addEventListener('quest_session_changed', handler);
    return () => window.removeEventListener('quest_session_changed', handler);
  }, []);

  const playerName = useMemo(() => {
    return playerNameProp ?? storedPlayerName ?? (playerId ? `Player-${playerId.slice(0, 8)}` : null);
  }, [playerId, playerNameProp, storedPlayerName]);

  const [definition, setDefinition] = useState<CompiledQuestDefinition | null>(null);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [deltas, setDeltas] = useState<RuntimeDelta[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState<boolean>(false);

  const loadedDefinitionKeyRef = useRef<string | null>(null);
  const loadDefinitionInFlightRef = useRef<Promise<void> | null>(null);
  const startedSessionKeyRef = useRef<string | null>(null);
  const startOrJoinInFlightRef = useRef<Promise<void> | null>(null);
  const startOrJoinInFlightKeyRef = useRef<string | null>(null);

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
    const definitionKey = `${questId}:${questVersion}`;
    if (definition && loadedDefinitionKeyRef.current === definitionKey) return;
    if (loadDefinitionInFlightRef.current) {
      await loadDefinitionInFlightRef.current;
      return;
    }
    const url = `/api/runtime/compiled?questId=${encodeURIComponent(questId)}&questVersion=${encodeURIComponent(questVersion)}`;
    const p = (async () => {
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
      loadedDefinitionKeyRef.current = definitionKey;
    })();

    loadDefinitionInFlightRef.current = p;
    try {
      await p;
    } finally {
      loadDefinitionInFlightRef.current = null;
    }
  }, [definition, questId, questVersion]);

  const startOrJoin = useCallback(async (options?: { reset?: boolean }) => {
    if (!questId || !runtimeSessionId || !playerId || !playerName) return;

    const sessionKey = `${questId}:${questVersion}:${runtimeSessionId}:${playerId}`;
    if (!options?.reset) {
      if (hasStarted && startedSessionKeyRef.current === sessionKey && snapshot && definition) return;
      if (startOrJoinInFlightRef.current && startOrJoinInFlightKeyRef.current === sessionKey) {
        await startOrJoinInFlightRef.current;
        return;
      }
    }

    setLoading(true);
    const p = (async () => {
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
        reset: options?.reset,
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
      setHasStarted(true);
      startedSessionKeyRef.current = sessionKey;
    })();

    startOrJoinInFlightRef.current = p;
    startOrJoinInFlightKeyRef.current = sessionKey;
    try {
      await p;
    } finally {
      if (startOrJoinInFlightRef.current === p) {
        startOrJoinInFlightRef.current = null;
        startOrJoinInFlightKeyRef.current = null;
      }
      setLoading(false);
    }
  }, [definition, hasStarted, loadDefinition, playerId, playerName, questId, questVersion, runtimeSessionId, snapshot]);

  useEffect(() => {
    setHasStarted(false);
    startedSessionKeyRef.current = null;
    startOrJoinInFlightRef.current = null;
    startOrJoinInFlightKeyRef.current = null;
    loadDefinitionInFlightRef.current = null;
    loadedDefinitionKeyRef.current = null;
  }, [playerId, questId, questVersion, runtimeSessionId]);

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
    async (nodeId: NodeId): Promise<{ success: boolean; error?: string }> => {
      if (!playerId || !runtimeSessionId) return { success: false, error: 'No session' };
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
        return { success: false, error: res.error };
      }
      if (!res.data.success) {
        setError(res.data.error ?? 'Node completion failed');
        return { success: false, error: res.data.error };
      }
      if (res.data.snapshot) setSnapshot(res.data.snapshot);
      if (Array.isArray(res.data.deltas)) setDeltas(res.data.deltas);
      setError(null);
      return { success: true };
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

  useEffect(() => {
    const changed = lastPollKeyRef.current !== lastPollKey;
    if (changed) {
      lastPollKeyRef.current = lastPollKey;
      console.log('[useQuestRuntime] Poll key changed:', lastPollKey);
    }

    if (!questId || !playerId || !runtimeSessionId) return;
    if (!autoStart && !hasStarted) return;

    // Only start/join if we haven't already done so for this session configuration.
    // This prevents redundant Start calls when other deps (like pollIntervalMs) change.
    const sessionKey = `${questId}:${questVersion}:${runtimeSessionId}:${playerId}`;
    if (autoStart && startedSessionKeyRef.current !== sessionKey) {
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
  }, [autoStart, hasStarted, pollIntervalMs, questId, questVersion, playerId, refresh, runtimeSessionId, startOrJoin, lastPollKey]);

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
    // Avoid pulling snapshots / triggering server-side traversal before the user explicitly starts the runtime
    // (when autoStart is disabled).
    if (!autoStart && !hasStarted) return;
    const handler = () => void refresh();
    window.addEventListener('quest_runtime_deltas', handler);
    return () => {
      window.removeEventListener('quest_runtime_deltas', handler);
    };
  }, [autoStart, hasStarted, refresh]);

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
