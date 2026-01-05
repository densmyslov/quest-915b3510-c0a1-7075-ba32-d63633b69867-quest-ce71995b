import type { RuntimeSessionState } from './runtimeState';

const sessions = new Map<string, RuntimeSessionState>();
const playerToSession = new Map<string, string>();

export function getSessionById(sessionId: string): RuntimeSessionState | null {
  return sessions.get(sessionId) ?? null;
}

export function getSessionIdForPlayer(playerId: string): string | null {
  return playerToSession.get(playerId) ?? null;
}

export function getSessionForPlayer(playerId: string): RuntimeSessionState | null {
  const sessionId = getSessionIdForPlayer(playerId);
  if (!sessionId) return null;
  return getSessionById(sessionId);
}

export function setPlayerSessionMapping(playerId: string, sessionId: string) {
  playerToSession.set(playerId, sessionId);
}

export function putSession(session: RuntimeSessionState) {
  sessions.set(session.sessionId, session);
}

export function updateSession(sessionId: string, updater: (current: RuntimeSessionState) => RuntimeSessionState): RuntimeSessionState {
  const current = sessions.get(sessionId);
  if (!current) throw new Error(`Session not found: ${sessionId}`);
  const next = updater(current);
  sessions.set(sessionId, next);
  return next;
}

export function clearInMemoryRuntimeStore() {
  sessions.clear();
  playerToSession.clear();
}

