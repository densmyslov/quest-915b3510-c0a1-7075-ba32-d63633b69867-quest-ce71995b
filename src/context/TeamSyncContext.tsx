'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { QuestSession, TeamState, useTeamWebSocket } from '@/lib/useTeamWebSocket';

type TeamSyncContextValue = {
  teamCode: string | null;
  session: QuestSession | null;
  team: TeamState | null;
  connectionStatus: ReturnType<typeof useTeamWebSocket>['connectionStatus'];
  latency: ReturnType<typeof useTeamWebSocket>['latency'];
  setReady: ReturnType<typeof useTeamWebSocket>['setReady'];
  startGame: ReturnType<typeof useTeamWebSocket>['startGame'];
  leaveTeam: ReturnType<typeof useTeamWebSocket>['leaveTeam'];
  completePuzzle: ReturnType<typeof useTeamWebSocket>['completePuzzle'];
  arriveAtLocation: ReturnType<typeof useTeamWebSocket>['arriveAtLocation'];
  sendChat: ReturnType<typeof useTeamWebSocket>['sendChat'];
  requestSync: ReturnType<typeof useTeamWebSocket>['requestSync'];
  updatePlayerState: ReturnType<typeof useTeamWebSocket>['updatePlayerState'];
  sendPuzzleInteraction: ReturnType<typeof useTeamWebSocket>['sendPuzzleInteraction'];
  setOnPuzzleInteraction: (handler: ((sessionId: string, stopId: string, puzzleId: string, interactionType: string, data?: any) => void) | null) => void;
  setOnScoreUpdate: (handler: ((points: number, playerTotalPoints: number, teamTotalPoints: number, stopId: string, puzzleId: string) => void) | null) => void;
};

const TeamSyncContext = createContext<TeamSyncContextValue | null>(null);

const STORAGE_KEYS = {
  teamCode: 'quest_teamCode',
  sessionId: 'quest_sessionId',
  runtimeSessionId: 'quest_runtimeSessionId',
  playerName: 'quest_playerName',
  websocketUrl: 'quest_websocketUrl',
};

function readTeamSyncFromStorage(): { teamCode: string | null; session: QuestSession | null; websocketUrl: string | null } {
  if (typeof window === 'undefined') return { teamCode: null, session: null, websocketUrl: null };

  const fromSession = {
    teamCode: sessionStorage.getItem(STORAGE_KEYS.teamCode),
    sessionId: sessionStorage.getItem(STORAGE_KEYS.sessionId),
    runtimeSessionId: sessionStorage.getItem(STORAGE_KEYS.runtimeSessionId),
    playerName: sessionStorage.getItem(STORAGE_KEYS.playerName),
    websocketUrl: sessionStorage.getItem(STORAGE_KEYS.websocketUrl),
  };

  const fromLocal = {
    teamCode: localStorage.getItem(STORAGE_KEYS.teamCode),
    sessionId: localStorage.getItem(STORAGE_KEYS.sessionId),
    runtimeSessionId: localStorage.getItem(STORAGE_KEYS.runtimeSessionId),
    playerName: localStorage.getItem(STORAGE_KEYS.playerName),
    websocketUrl: localStorage.getItem(STORAGE_KEYS.websocketUrl),
  };

  // Prefer sessionStorage to avoid cross-tab collisions; migrate legacy localStorage state if present.
  const teamCode = fromSession.teamCode ?? fromLocal.teamCode;
  const sessionId = fromSession.sessionId ?? fromLocal.sessionId;
  const runtimeSessionId = fromSession.runtimeSessionId ?? fromLocal.runtimeSessionId;
  const playerName = fromSession.playerName ?? fromLocal.playerName;
  const websocketUrl = fromSession.websocketUrl ?? fromLocal.websocketUrl;

  if (teamCode && !fromSession.teamCode) {
    sessionStorage.setItem(STORAGE_KEYS.teamCode, teamCode);
    localStorage.removeItem(STORAGE_KEYS.teamCode);
  }
  if (sessionId && !fromSession.sessionId) {
    sessionStorage.setItem(STORAGE_KEYS.sessionId, sessionId);
    localStorage.removeItem(STORAGE_KEYS.sessionId);
  }
  if (runtimeSessionId && !fromSession.runtimeSessionId) {
    sessionStorage.setItem(STORAGE_KEYS.runtimeSessionId, runtimeSessionId);
    localStorage.removeItem(STORAGE_KEYS.runtimeSessionId);
  }
  if (playerName && !fromSession.playerName) {
    sessionStorage.setItem(STORAGE_KEYS.playerName, playerName);
    localStorage.removeItem(STORAGE_KEYS.playerName);
  }
  if (websocketUrl && !fromSession.websocketUrl) {
    sessionStorage.setItem(STORAGE_KEYS.websocketUrl, websocketUrl);
    localStorage.removeItem(STORAGE_KEYS.websocketUrl);
  }

  if (!teamCode || !sessionId || !playerName) {
    return { teamCode: teamCode || null, session: null, websocketUrl: websocketUrl || null };
  }

  return {
    teamCode,
    session: { sessionId, playerName, mode: 'team', teamCode, runtimeSessionId: runtimeSessionId || null },
    websocketUrl: websocketUrl || null,
  };
}

export function TeamSyncProvider({ children }: { children: React.ReactNode }) {
  const [{ teamCode, session, websocketUrl }, setLocal] = useState(() => readTeamSyncFromStorage());

  useEffect(() => {
    const handler = () => setLocal(readTeamSyncFromStorage());
    window.addEventListener('quest_session_changed', handler);
    return () => {
      window.removeEventListener('quest_session_changed', handler);
    };
  }, []);

  // Use ref instead of state to avoid triggering re-renders and WebSocket reconnections
  const puzzleHandlerRef = React.useRef<((sessionId: string, stopId: string, puzzleId: string, interactionType: string, data?: any) => void) | null>(null);
  const scoreUpdateHandlerRef = React.useRef<((points: number, playerTotalPoints: number, teamTotalPoints: number, stopId: string, puzzleId: string) => void) | null>(null);

  // Stable callback that doesn't change when handler is updated
  const setPuzzleHandler = React.useCallback((handler: ((sessionId: string, stopId: string, puzzleId: string, interactionType: string, data?: any) => void) | null) => {
    puzzleHandlerRef.current = handler;
  }, []);

  const setScoreUpdateHandler = React.useCallback((handler: ((points: number, playerTotalPoints: number, teamTotalPoints: number, stopId: string, puzzleId: string) => void) | null) => {
    scoreUpdateHandlerRef.current = handler;
  }, []);

  const wsOptions = useMemo(() => ({
    websocketUrl,
    onPuzzleInteraction: (sessionId: string, stopId: string, puzzleId: string, interactionType: string, data?: any) => {
      puzzleHandlerRef.current?.(sessionId, stopId, puzzleId, interactionType, data);
    },
    onScoreUpdate: (points: number, playerTotalPoints: number, teamTotalPoints: number, stopId: string, puzzleId: string) => {
      scoreUpdateHandlerRef.current?.(points, playerTotalPoints, teamTotalPoints, stopId, puzzleId);
    },
  }), [websocketUrl]); // Removed puzzleHandler dependency - use ref instead
  const ws = useTeamWebSocket(teamCode, session, wsOptions);

  const value: TeamSyncContextValue = useMemo(
    () => ({
      teamCode,
      session,
      team: ws.team,
      connectionStatus: ws.connectionStatus,
      latency: ws.latency,
      setReady: ws.setReady,
      startGame: ws.startGame,
      leaveTeam: ws.leaveTeam,
      completePuzzle: ws.completePuzzle,
      arriveAtLocation: ws.arriveAtLocation,
      sendChat: ws.sendChat,
      requestSync: ws.requestSync,
      updatePlayerState: ws.updatePlayerState,
      sendPuzzleInteraction: ws.sendPuzzleInteraction,
      setOnPuzzleInteraction: setPuzzleHandler,
      setOnScoreUpdate: setScoreUpdateHandler,
    }),
    [session, teamCode, ws, setPuzzleHandler, setScoreUpdateHandler], // Removed puzzleHandler dependency
  );

  return <TeamSyncContext.Provider value={value}>{children}</TeamSyncContext.Provider>;
}

export function useTeamSync() {
  const ctx = useContext(TeamSyncContext);
  if (!ctx) throw new Error('useTeamSync must be used within TeamSyncProvider');
  return ctx;
}
