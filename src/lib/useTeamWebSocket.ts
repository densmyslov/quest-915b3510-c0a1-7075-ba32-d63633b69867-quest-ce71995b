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
  startedAt?: string;
  gameExpiresAt?: string;
};

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export type UseTeamWebSocketOptions = {
  websocketUrl?: string | null;
  onMemberJoined?: (member: TeamMember, memberCount: number) => void;
  onMemberLeft?: (sessionId: string, playerName: string, memberCount: number) => void;
  onGameStarted?: (startedAt: string, expiresAt: string) => void;
  onPuzzleCompleted?: (sessionId: string, playerName: string, stopId: string, puzzleId: string) => void;
  onStopUnlocked?: (stopId: string, unlockedBy: string[]) => void;
  onLocationUpdate?: (sessionId: string, playerName: string, stopId: string) => void;
  onChatMessage?: (sessionId: string, playerName: string, message: string, timestamp: string) => void;
  onScoreUpdate?: (points: number, playerTotalPoints: number, teamTotalPoints: number, stopId: string, puzzleId: string) => void;
  onError?: (code: string, message: string) => void;
};

type ApiCreateJoinResponse = {
  teamCode: string;
  websocketUrl: string;
  session: QuestSession;
};

const STORED_WS_URL_KEY = 'quest_websocketUrl';

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

  url.pathname = '/ws';
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

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const clearPingTimer = () => {
    if (pingTimerRef.current !== null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  };

  const closeSocket = useCallback(() => {
    intentionalCloseRef.current = true;
    clearReconnectTimer();
    clearPingTimer();
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        ws.close(1000, 'closed');
      } catch {
        // ignore
      }
    }
  }, []);

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
  }, []);

  const sendRaw = useCallback((payload: unknown) => {
    const ws = wsRef.current;
    const text = JSON.stringify(payload);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      sendQueueRef.current.push(text);
      return;
    }
    ws.send(text);
  }, []);

  const flushQueue = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const queue = sendQueueRef.current.splice(0, sendQueueRef.current.length);
    for (const msg of queue) ws.send(msg);
  }, []);

  const applyPresence = (state: TeamState, online: string[], offline: string[]) => {
    const onlineSet = new Set(online);
    const offlineSet = new Set(offline);
    state.members = state.members.map((m) => ({
      ...m,
      online: onlineSet.has(m.sessionId) ? true : offlineSet.has(m.sessionId) ? false : m.online,
    }));
  };

  const connect = useCallback(() => {
    if (!teamCode || !session) return;

    intentionalCloseRef.current = false;
    clearReconnectTimer();
    clearPingTimer();

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
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      reconnectAttemptRef.current = 0;
      setConnectionStatus('connected');
      sendQueueRef.current = [];
      sendRaw({ type: 'join', sessionId: session.sessionId, playerName: session.playerName });
      flushQueue();

      pingTimerRef.current = window.setInterval(() => {
        lastPingSentAtRef.current = Date.now();
        sendRaw({ type: 'ping' });
      }, 10_000);
    });

    ws.addEventListener('message', (evt) => {
      let msg: any;
      try {
        msg = JSON.parse(String(evt.data));
      } catch {
        return;
      }

      const type = typeof msg?.type === 'string' ? msg.type : null;
      if (!type) return;

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
          if (!prev || !session) return prev;
          return {
            ...prev,
            members: prev.members.map((m) =>
              m.sessionId === session.sessionId
                ? { ...m, totalPoints: playerTotalPoints }
                : m
            ),
          };
        });

        optionsRef.current.onScoreUpdate?.(points, playerTotalPoints, teamTotalPoints, stopId, puzzleId);
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

    ws.addEventListener('close', () => {
      clearPingTimer();
      wsRef.current = null;
      if (!intentionalCloseRef.current) {
        setConnectionStatus('reconnecting');
        scheduleReconnect();
      } else {
        setConnectionStatus('disconnected');
      }
    });

    ws.addEventListener('error', () => {
      setConnectionStatus('error');
    });
  }, [apiUrl, flushQueue, scheduleReconnect, sendRaw, session, teamCode]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (!teamCode || !session) {
      setTeam(null);
      setLatency(null);
      closeSocket();
      setConnectionStatus('disconnected');
      return;
    }

    connect();

    return () => {
      closeSocket();
    };
  }, [closeSocket, connect, session, teamCode]);

  const setReady = useCallback(
    (ready: boolean) => {
      if (!session) return;
      sendRaw({ type: 'ready', sessionId: session.sessionId, ready });
    },
    [sendRaw, session],
  );

  const startGame = useCallback(() => {
    if (!session) return;
    sendRaw({ type: 'start_game', sessionId: session.sessionId });
  }, [sendRaw, session]);

  const leaveTeam = useCallback(() => {
    if (!session) return;
    sendRaw({ type: 'leave', sessionId: session.sessionId });
    closeSocket();
    setTeam(null);
  }, [closeSocket, sendRaw, session]);

  const completePuzzle = useCallback(
    (stopId: string, puzzleId: string) => {
      if (!session) return;
      sendRaw({ type: 'puzzle_complete', sessionId: session.sessionId, stopId, puzzleId });
    },
    [sendRaw, session],
  );

  const arriveAtLocation = useCallback(
    (stopId: string) => {
      if (!session) return;
      sendRaw({ type: 'location_arrived', sessionId: session.sessionId, stopId });
    },
    [sendRaw, session],
  );

  const sendChat = useCallback(
    (message: string) => {
      if (!session) return;
      sendRaw({ type: 'chat', sessionId: session.sessionId, message });
    },
    [sendRaw, session],
  );

  const requestSync = useCallback(() => {
    if (!session) return;
    sendRaw({ type: 'sync_request', sessionId: session.sessionId });
  }, [sendRaw, session]);

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
      if (!session) return;
      sendRaw({
        type: 'player_state_update',
        sessionId: session.sessionId,
        ...update,
      });
    },
    [sendRaw, session],
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
  };
}
