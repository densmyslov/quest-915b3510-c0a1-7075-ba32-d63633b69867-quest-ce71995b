'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';


import { getQuestApiUrl } from '../utils/apiConfig';

export type TeamMember = {
  sessionId: string;
  playerName: string;
  ready: boolean;
  online: boolean;
  joinedAt: string;
  lastSeenAt?: string;
  totalPoints?: number;
  puzzleCompletions?: Record<string, { points: number; completedAt: string }>;
  // PlayerState v2.0 fields
  currentObjectId?: string | null;
  highestCompletedNumber?: number;
  position?: {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: string;
  } | null;
};

export type TeamState = {
  teamCode: string;
  runtimeSessionId?: string;
  createdAt: string;
  expiresAt: string;
  leaderSessionId?: string;
  startedAt?: string;
  gameExpiresAt?: string;
  members: TeamMember[];
  stopCompletions: Record<string, string[]>;
  lastLocationBySession: Record<string, string>;
};

export type QuestSession = {
  sessionId: string;
  playerName: string;
  mode: 'solo' | 'team';
  teamCode?: string;
  runtimeSessionId?: string | null;
  startedAt?: string;
  gameExpiresAt?: string;
};

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export type UseTeamWebSocketOptions = {
  websocketUrl?: string | null;
  debug?: boolean;
  onMemberJoined?: (member: TeamMember, memberCount: number) => void;
  onMemberLeft?: (sessionId: string, playerName: string, memberCount: number) => void;
  onGameStarted?: (startedAt: string, expiresAt: string) => void;
  onPuzzleCompleted?: (sessionId: string, playerName: string, stopId: string, puzzleId: string) => void;
  onStopUnlocked?: (stopId: string, unlockedBy: string[]) => void;
  onLocationUpdate?: (sessionId: string, playerName: string, stopId: string) => void;
  onChatMessage?: (sessionId: string, playerName: string, message: string, timestamp: string) => void;
  onScoreUpdate?: (points: number, playerTotalPoints: number, teamTotalPoints: number, stopId: string, puzzleId: string) => void;
  onPuzzleInteraction?: (sessionId: string, stopId: string, puzzleId: string, interactionType: string, data?: any) => void;
  onError?: (code: string, message: string) => void;
};

type ApiCreateJoinResponse = {
  teamCode: string;
  websocketUrl: string;
  session: QuestSession;
};

const STORED_WS_URL_KEY = 'quest_websocketUrl';
const STORED_WS_DEBUG_KEY = 'quest_ws_debug';

function readWsDebugFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('wsDebug') === '1') return true;
  } catch {
    // ignore
  }
  try {
    const raw = sessionStorage.getItem(STORED_WS_DEBUG_KEY) ?? localStorage.getItem(STORED_WS_DEBUG_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

// function getQuestApiUrl(): string {
//   // Priority 2: Check environment variables (for local development)
//   const fromQuestVar = process.env.NEXT_PUBLIC_QUEST_API_URL;
//   const fromLegacyVar = process.env.NEXT_PUBLIC_API_URL;

//   console.log('[DEBUG getQuestApiUrl] NEXT_PUBLIC_QUEST_API_URL:', fromQuestVar);
//   console.log('[DEBUG getQuestApiUrl] NEXT_PUBLIC_API_URL:', fromLegacyVar);

//   if (fromQuestVar) {
//     const url = fromQuestVar.replace(/\/+$/, '');
//     console.log('[DEBUG getQuestApiUrl] Using NEXT_PUBLIC_QUEST_API_URL:', url);
//     return url;
//   }
//   if (fromLegacyVar) {
//     const url = fromLegacyVar.replace(/\/+$/, '');
//     console.log('[DEBUG getQuestApiUrl] Using NEXT_PUBLIC_API_URL:', url);
//     return url;
//   }

//   if (typeof window !== 'undefined') {
//     console.log('[DEBUG getQuestApiUrl] Falling back to window.location.origin:', window.location.origin);
//     return window.location.origin;
//   }

//   console.log('[DEBUG getQuestApiUrl] Falling back to localhost:8787');
//   return 'http://localhost:8787';
// }



function normalizeToWsUrl(baseUrl: string, teamCode: string): string | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;

  // Only set pathname to '/ws' if no pathname exists (for backward compatibility)
  // Otherwise, preserve the existing pathname (e.g., '/dev' for AWS API Gateway stages)
  if (!url.pathname || url.pathname === '/') {
    url.pathname = '/ws';
  }
  url.searchParams.set('teamCode', teamCode);
  return url.toString();
}

function readStoredWebsocketUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(STORED_WS_URL_KEY) ?? localStorage.getItem(STORED_WS_URL_KEY);
}

function resolveWebsocketUrl(
  apiUrl: string,
  teamCode: string,
  explicitWsUrl?: string | null,
): { url: string; source: 'explicit' | 'stored' | 'apiUrl' } | null {
  if (explicitWsUrl) {
    const normalized = normalizeToWsUrl(explicitWsUrl, teamCode);
    if (normalized) return { url: normalized, source: 'explicit' };
  }

  const stored = readStoredWebsocketUrl();
  if (stored) {
    const normalized = normalizeToWsUrl(stored, teamCode);
    if (normalized) return { url: normalized, source: 'stored' };
  }

  const fallback = normalizeToWsUrl(apiUrl, teamCode);
  return fallback ? { url: fallback, source: 'apiUrl' } : null;
}

function normalizeTeamCodeInput(teamCode: string): string {
  let normalized = teamCode.trim();

  // Strip URL protocols (http://, https://, ws://, wss://)
  normalized = normalized.replace(/^(https?|wss?):\/\//i, '');

  // If it looks like a URL with a path, extract just the last segment
  // This handles cases like "quest-abc.pages.dev/team/QUEST-123" -> "QUEST-123"
  const pathMatch = normalized.match(/\/([^\/]+)$/);
  if (pathMatch) {
    normalized = pathMatch[1];
  }

  return normalized
    .toUpperCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212\uFE63\uFF0D]/g, '-')
    .replace(/[\s\u200B\uFEFF]+/g, '');
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const base = getQuestApiUrl();
  const fullUrl = `${base}${path}`;
  console.log('[useTeamWebSocket] apiPost START', { url: fullUrl, body });

  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  console.log('[useTeamWebSocket] apiPost fetch completed', { status: res.status, ok: res.ok });
  const responseText = await res.text();
  if (!res.ok) {
    console.error('[useTeamWebSocket] apiPost ERROR response:', { status: res.status, responseText });
    throw new Error(responseText || `HTTP ${res.status}: ${res.statusText}`);
  }

  try {
    const json = JSON.parse(responseText) as T;
    console.log('[useTeamWebSocket] apiPost SUCCESS response:', json);
    return json;
  } catch (parseError) {
    console.error('[useTeamWebSocket] apiPost JSON parse error:', { responseText, parseError });
    throw new Error(`Invalid JSON response: ${responseText}`);
  }
}

export async function createTeam(playerName: string, questId?: string, questVersion?: string): Promise<ApiCreateJoinResponse> {
  console.log('[useTeamWebSocket] createTeam START', { playerName, questId, questVersion });
  const payload = {
    playerName,
    questId,
    questVersion: questVersion || 'v1'
  };
  console.log('[useTeamWebSocket] Calling apiPost /api/teams with:', payload);
  const res = await apiPost<ApiCreateJoinResponse>('/api/teams', payload);
  console.log('[useTeamWebSocket] apiPost /api/teams returned:', res);
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(STORED_WS_URL_KEY, res.websocketUrl || '');
      console.log('[useTeamWebSocket] Stored websocketUrl in sessionStorage:', res.websocketUrl);
    } catch {
      // ignore
    }
  }
  return res;
}

export async function joinTeam(teamCode: string, playerName: string): Promise<ApiCreateJoinResponse> {
  const normalized = normalizeTeamCodeInput(teamCode);
  const res = await apiPost<ApiCreateJoinResponse>(`/api/teams/${encodeURIComponent(normalized)}/join`, { playerName });
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(STORED_WS_URL_KEY, res.websocketUrl || '');
    } catch {
      // ignore
    }
  }
  return res;
}

export function useTeamWebSocket(teamCode: string | null, session: QuestSession | null, options: UseTeamWebSocketOptions = {}) {
  const [team, setTeam] = useState<TeamState | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [latency, setLatency] = useState<number | null>(null);

  // Extract stable primitives to avoid object identity churn
  const sessionId = session?.sessionId ?? null;
  const playerName = session?.playerName ?? null;

  const apiUrl = useMemo(() => getQuestApiUrl(), []);

  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef<UseTeamWebSocketOptions>(options);
  const connectRef = useRef<(() => void) | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalCloseRef = useRef(false);

  const pingTimerRef = useRef<number | null>(null);
  const lastPingSentAtRef = useRef<number | null>(null);

  const sendQueueRef = useRef<string[]>([]);
  const debugRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
    debugRef.current = options.debug ?? readWsDebugFlag();
  }, [options]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearPingTimer = useCallback(() => {
    if (pingTimerRef.current !== null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    intentionalCloseRef.current = true;
    clearReconnectTimer();
    clearPingTimer();
    sendQueueRef.current = [];
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        ws.close(1000, 'closed');
      } catch {
        // ignore
      }
    }
    setConnectionStatus('disconnected');
  }, [clearPingTimer, clearReconnectTimer]);

  const scheduleReconnect = useCallback(() => {
    if (intentionalCloseRef.current) return;
    clearReconnectTimer();
    const attempt = reconnectAttemptRef.current++;
    const baseDelay = Math.min(30_000, 500 * 2 ** attempt);
    const jitter = Math.floor(Math.random() * 250);
    setConnectionStatus((prev) => (prev === 'connected' ? 'reconnecting' : prev));
    reconnectTimerRef.current = window.setTimeout(() => {
      connectRef.current?.();
    }, baseDelay + jitter);
  }, [clearReconnectTimer]);

  // Store sendRaw and flushQueue in refs to avoid recreation
  const sendRawRef = useRef<(payload: unknown) => void>(() => {});
  const flushQueueRef = useRef<() => void>(() => {});

  const sendRaw = useCallback((payload: unknown) => {
    const ws = wsRef.current;
    const text = JSON.stringify(payload);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      sendQueueRef.current.push(text);
      if (debugRef.current) {
        const readyState = ws?.readyState ?? null;
        console.debug('[useTeamWebSocket] queue send', { readyState, queued: sendQueueRef.current.length, payload });
      }
      return;
    }
    if (debugRef.current) console.debug('[useTeamWebSocket] send', { payload });
    ws.send(text);
  }, []);

  const flushQueue = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const queue = sendQueueRef.current.splice(0, sendQueueRef.current.length);
    for (const msg of queue) ws.send(msg);
  }, []);

  // Update refs when functions change
  useEffect(() => {
    sendRawRef.current = sendRaw;
    flushQueueRef.current = flushQueue;
  }, [sendRaw, flushQueue]);

  const applyPresence = (state: TeamState, online: string[], offline: string[]) => {
    const onlineSet = new Set(online);
    const offlineSet = new Set(offline);
    state.members = state.members.map((m) => ({
      ...m,
      online: onlineSet.has(m.sessionId) ? true : offlineSet.has(m.sessionId) ? false : m.online,
    }));
  };

  const connect = useCallback(() => {
    if (!teamCode || !sessionId || !playerName) return;

    // Prevent duplicate connections
    if (
      wsRef.current?.readyState === WebSocket.CONNECTING ||
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CLOSING
    ) {
      console.log('[useTeamWebSocket] Skipping connect - already connecting/connected', {
        readyState: wsRef.current.readyState
      });
      return;
    }

    console.log('[useTeamWebSocket] Starting connection', { teamCode, sessionId });

    intentionalCloseRef.current = false;
    clearReconnectTimer();
    clearPingTimer();
    if (debugRef.current) {
      console.debug('[useTeamWebSocket] connect params', {
        teamCode,
        sessionId,
        playerName,
        explicitWsUrl: optionsRef.current.websocketUrl ?? null,
        apiUrl,
      });
    }

    const resolved = resolveWebsocketUrl(apiUrl, teamCode, optionsRef.current.websocketUrl);
    if (!resolved) {
      setConnectionStatus('error');
      optionsRef.current.onError?.(
        'ws_not_configured',
        'WebSocket URL is not configured. Set QUEST_API_URL (recommended) or NEXT_PUBLIC_QUEST_API_URL.',
      );
      return;
    }

    const url = resolved.url;
    if (debugRef.current) console.debug('[useTeamWebSocket] resolved ws url', resolved);

    if (resolved.source === 'apiUrl' && typeof window !== 'undefined') {
      const parsed = new URL(url);
      const isSameOriginWs = parsed.host === window.location.host && parsed.pathname === '/ws';
      if (isSameOriginWs) {
        setConnectionStatus('error');
        optionsRef.current.onError?.(
          'ws_invalid_origin',
          'WebSocket URL points to the app origin (/ws), but this app does not host a WebSocket server. Configure QUEST_API_URL or NEXT_PUBLIC_QUEST_API_URL.',
        );
        return;
      }
    }

    setConnectionStatus((prev) => (prev === 'connected' ? 'reconnecting' : 'connecting'));

    const ws = new WebSocket(url);
    const wsId = Math.random().toString(16).slice(2, 8);
    console.log('[useTeamWebSocket] Creating WebSocket', { wsId, url });
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      // Ignore stale socket events
      if (wsRef.current !== ws) {
        console.log('[useTeamWebSocket] Ignoring stale open event', { wsId });
        return;
      }
      console.log('[useTeamWebSocket] WebSocket opened', { wsId, url });
      reconnectAttemptRef.current = 0;
      setConnectionStatus('connected');
      sendRawRef.current({ type: 'join', sessionId, playerName });
      flushQueueRef.current();

      pingTimerRef.current = window.setInterval(() => {
        lastPingSentAtRef.current = Date.now();
        sendRawRef.current({ type: 'ping' });
      }, 10_000);
    });

    ws.addEventListener('message', (evt) => {
      // Ignore stale socket events
      if (wsRef.current !== ws) return;
      let msg: any;
      try {
        msg = JSON.parse(String(evt.data));
      } catch {
        if (debugRef.current) console.debug('[useTeamWebSocket] message parse failed', { wsId, data: String(evt.data) });
        return;
      }

      const type = typeof msg?.type === 'string' ? msg.type : null;
      if (!type) return;
      if (debugRef.current) {
        if (type === 'puzzle_interaction' || type === 'score_update' || type === 'error') {
          console.debug('[useTeamWebSocket] recv', { wsId, type, msg });
        }
      }

      if (type === 'pong') {
        const sentAt = lastPingSentAtRef.current;
        if (sentAt) setLatency(Math.max(0, Date.now() - sentAt));
        return;
      }

      if (type === 'welcome') {
        const state: TeamState | undefined = msg.state;
        if (state) setTeam(state);
        return;
      }

      if (type === 'state_sync') {
        const state: TeamState | undefined = msg.state;
        if (state) setTeam(state);
        return;
      }

      if (type === 'member_joined') {
        const member: TeamMember | undefined = msg.member;
        const memberCount: number | undefined = msg.memberCount;
        if (!member || typeof memberCount !== 'number') return;
        setTeam((prev) => {
          if (!prev) return prev;
          const exists = prev.members.some((m) => m.sessionId === member.sessionId);
          const next: TeamState = exists
            ? { ...prev, members: prev.members.map((m) => (m.sessionId === member.sessionId ? member : m)) }
            : { ...prev, members: [...prev.members, member] };
          return next;
        });
        optionsRef.current.onMemberJoined?.(member, memberCount);
        return;
      }

      if (type === 'member_left') {
        const sessionId: string | undefined = msg.sessionId;
        const playerName: string | undefined = msg.playerName;
        const memberCount: number | undefined = msg.memberCount;
        if (!sessionId || !playerName || typeof memberCount !== 'number') return;
        setTeam((prev) => (prev ? { ...prev, members: prev.members.filter((m) => m.sessionId !== sessionId) } : prev));
        optionsRef.current.onMemberLeft?.(sessionId, playerName, memberCount);
        return;
      }

      if (type === 'member_ready') {
        const sessionId: string | undefined = msg.sessionId;
        const ready: boolean | undefined = msg.ready;
        if (!sessionId || typeof ready !== 'boolean') return;
        setTeam((prev) =>
          prev
            ? { ...prev, members: prev.members.map((m) => (m.sessionId === sessionId ? { ...m, ready } : m)) }
            : prev,
        );
        return;
      }

      if (type === 'game_started') {
        const startedAt: string | undefined = msg.startedAt;
        const expiresAt: string | undefined = msg.expiresAt;
        if (!startedAt || !expiresAt) return;
        setTeam((prev) => (prev ? { ...prev, startedAt, gameExpiresAt: expiresAt } : prev));
        optionsRef.current.onGameStarted?.(startedAt, expiresAt);
        return;
      }

      if (type === 'puzzle_completed') {
        const sessionId: string | undefined = msg.sessionId;
        const playerName: string | undefined = msg.playerName;
        const stopId: string | undefined = msg.stopId;
        const puzzleId: string | undefined = msg.puzzleId;
        if (!sessionId || !playerName || !stopId || !puzzleId) return;
        setTeam((prev) => {
          if (!prev) return prev;
          const existing = prev.stopCompletions[stopId] ?? [];
          const nextStop = existing.includes(sessionId) ? existing : [...existing, sessionId];
          return { ...prev, stopCompletions: { ...prev.stopCompletions, [stopId]: nextStop } };
        });
        optionsRef.current.onPuzzleCompleted?.(sessionId, playerName, stopId, puzzleId);
        return;
      }

      if (type === 'stop_unlocked') {
        const stopId: string | undefined = msg.stopId;
        const unlockedBy: string[] | undefined = msg.unlockedBy;
        if (!stopId || !Array.isArray(unlockedBy)) return;
        optionsRef.current.onStopUnlocked?.(stopId, unlockedBy);
        return;
      }

      if (type === 'location_update') {
        const sessionId: string | undefined = msg.sessionId;
        const playerName: string | undefined = msg.playerName;
        const stopId: string | undefined = msg.stopId;
        if (!sessionId || !playerName || !stopId) return;
        setTeam((prev) => (prev ? { ...prev, lastLocationBySession: { ...prev.lastLocationBySession, [sessionId]: stopId } } : prev));
        optionsRef.current.onLocationUpdate?.(sessionId, playerName, stopId);
        return;
      }

      if (type === 'chat_message') {
        const sessionId: string | undefined = msg.sessionId;
        const playerName: string | undefined = msg.playerName;
        const message: string | undefined = msg.message;
        const timestamp: string | undefined = msg.timestamp;
        if (!sessionId || !playerName || !message || !timestamp) return;
        optionsRef.current.onChatMessage?.(sessionId, playerName, message, timestamp);
        return;
      }

      if (type === 'runtime_delta') {
        // Dispatch a window event to trigger useQuestRuntime refresh
        if (typeof window !== 'undefined') {
          const event = new CustomEvent('quest_runtime_deltas', { detail: msg.deltas });
          window.dispatchEvent(event);
        }
        return;
      }

      if (type === 'score_update') {
        const points: number | undefined = msg.points;
        const playerTotalPoints: number | undefined = msg.playerTotalPoints;
        const teamTotalPoints: number | undefined = msg.teamTotalPoints;
        const stopId: string | undefined = msg.stopId;
        const puzzleId: string | undefined = msg.puzzleId;
        if (typeof points !== 'number' || typeof playerTotalPoints !== 'number' ||
          typeof teamTotalPoints !== 'number' || !stopId || !puzzleId) return;

        // Update local team state with player's new total points
        setTeam((prev) => {
          if (!prev || !sessionId) return prev;
          return {
            ...prev,
            members: prev.members.map((m) =>
              m.sessionId === sessionId
                ? { ...m, totalPoints: playerTotalPoints }
                : m
            ),
          };
        });

        optionsRef.current.onScoreUpdate?.(points, playerTotalPoints, teamTotalPoints, stopId, puzzleId);
        return;
      }

      if (type === 'puzzle_interaction') {
        const sessionId: string | undefined = msg.sessionId;
        const stopId: string | undefined = msg.stopId;
        const puzzleId: string | undefined = msg.puzzleId;
        const interactionType: string | undefined = msg.interactionType;
        const data: any = msg.data;

        if (!sessionId || !stopId || !puzzleId || !interactionType) return;
        optionsRef.current.onPuzzleInteraction?.(sessionId, stopId, puzzleId, interactionType, data);
        return;
      }

      if (type === 'player_state_update') {
        const sessionId: string | undefined = msg.sessionId;
        const currentObjectId: string | null | undefined = msg.currentObjectId;
        const highestCompletedNumber: number | undefined = msg.highestCompletedNumber;
        const position: any = msg.position;

        if (!sessionId) return;

        setTeam((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            members: prev.members.map((m) =>
              m.sessionId === sessionId
                ? {
                  ...m,
                  currentObjectId: currentObjectId !== undefined ? currentObjectId : m.currentObjectId,
                  highestCompletedNumber: highestCompletedNumber !== undefined ? highestCompletedNumber : m.highestCompletedNumber,
                  position: position !== undefined ? position : m.position,
                }
                : m
            ),
          };
        });
        return;
      }

      if (type === 'presence_update') {
        const online: string[] | undefined = msg.online;
        const offline: string[] | undefined = msg.offline;
        if (!Array.isArray(online) || !Array.isArray(offline)) return;
        setTeam((prev) => {
          if (!prev) return prev;
          const next = { ...prev, members: [...prev.members] };
          applyPresence(next, online, offline);
          return next;
        });
        return;
      }

      if (type === 'error') {
        const code: string | undefined = msg.code;
        const message: string | undefined = msg.message;
        if (code && message) optionsRef.current.onError?.(code, message);
        return;
      }
    });

    ws.addEventListener('close', (event) => {
      // Ignore stale socket events
      if (wsRef.current !== ws) {
        console.log('[useTeamWebSocket] Ignoring stale close event', { wsId, code: event.code, reason: event.reason });
        return;
      }
      clearPingTimer();
      wsRef.current = null;
      console.log('[useTeamWebSocket] WebSocket closed', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        intentional: intentionalCloseRef.current,
        url
      });
      if (!intentionalCloseRef.current && event.code === 1000 && event.reason === 'replaced') {
        setConnectionStatus('error');
        optionsRef.current.onError?.(
          'ws_replaced',
          'WebSocket connection was replaced by another connection for this session (another tab/device).',
        );
        return;
      }
      if (!intentionalCloseRef.current) {
        setConnectionStatus('reconnecting');
        scheduleReconnect();
      } else {
        setConnectionStatus('disconnected');
      }
    });

    ws.addEventListener('error', () => {
      // Ignore stale socket events
      if (wsRef.current !== ws) return;
      // Note: WebSocket error events don't contain detailed error info in browsers
      // The actual error details will be in the subsequent 'close' event
      console.error('[useTeamWebSocket] WebSocket error occurred', {
        url,
        wsId,
        message: 'Check the subsequent close event for error details (code/reason)'
      });
      setConnectionStatus('error');
    });
  }, [apiUrl, clearPingTimer, clearReconnectTimer, scheduleReconnect, sessionId, playerName, teamCode]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    console.log('[useTeamWebSocket] Main effect triggered', { teamCode, sessionId, playerName });

    if (!teamCode || !sessionId || !playerName) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTeam(null);
      setLatency(null);
      closeSocket();
      setConnectionStatus('disconnected');
      return;
    }

    connect();

    return () => {
      console.log('[useTeamWebSocket] Main effect cleanup', { teamCode, sessionId, playerName });
      closeSocket();
    };
  }, [closeSocket, connect, sessionId, playerName, teamCode]);

  const setReady = useCallback(
    (ready: boolean) => {
      if (!sessionId) return;
      sendRaw({ type: 'ready', sessionId, ready });
    },
    [sendRaw, sessionId],
  );

  const startGame = useCallback(() => {
    if (!sessionId) return;
    sendRaw({ type: 'start_game', sessionId });
  }, [sendRaw, sessionId]);

  const leaveTeam = useCallback(() => {
    if (!sessionId) return;
    sendRaw({ type: 'leave', sessionId });
    closeSocket();
    setTeam(null);
  }, [closeSocket, sendRaw, sessionId]);

  const completePuzzle = useCallback(
    (stopId: string, puzzleId: string) => {
      if (!sessionId) return;
      sendRaw({ type: 'puzzle_complete', sessionId, stopId, puzzleId });
    },
    [sendRaw, sessionId],
  );

  const arriveAtLocation = useCallback(
    (stopId: string) => {
      if (!sessionId) return;
      sendRaw({ type: 'location_arrived', sessionId, stopId });
    },
    [sendRaw, sessionId],
  );

  const sendChat = useCallback(
    (message: string) => {
      if (!sessionId) return;
      sendRaw({ type: 'chat', sessionId, message });
    },
    [sendRaw, sessionId],
  );

  const requestSync = useCallback(() => {
    if (!sessionId) return;
    sendRaw({ type: 'sync_request', sessionId });
  }, [sendRaw, sessionId]);

  const updatePlayerState = useCallback(
    (update: {
      currentObjectId?: string | null;
      highestCompletedNumber?: number;
      position?: {
        lat: number;
        lng: number;
        accuracy: number;
        timestamp: string;
      } | null;
    }) => {
      if (!sessionId) return;
      sendRaw({
        type: 'player_state_update',
        sessionId,
        ...update,
      });
    },
    [sendRaw, sessionId],
  );


  const sendPuzzleInteraction = useCallback(
    (stopId: string, puzzleId: string, interactionType: string, data?: any) => {
      if (!sessionId) return;
      sendRaw({
        type: 'puzzle_interaction',
        sessionId,
        stopId,
        puzzleId,
        interactionType,
        data,
      });
    },
    [sendRaw, sessionId],
  );
  return {
    team,
    connectionStatus,
    latency,
    setReady,
    startGame,
    leaveTeam,
    completePuzzle,
    arriveAtLocation,
    sendChat,
    requestSync,
    updatePlayerState,
    sendPuzzleInteraction,
  };
}
