'use client';

import { useState, useEffect } from 'react';
import { createTeam as apiCreateTeam, joinTeam as apiJoinTeam } from './useTeamWebSocket';

export type Session = {
    sessionId: string;
    mode: 'solo' | 'team';
    teamCode?: string;
    status: 'pending' | 'ready';
    expiresAt?: number;
};

export type Team = {
    teamCode: string;
    teamName?: string;
};

const SOLO_TEAM_STORAGE = {
    flag: 'quest_soloTeam',
    startedAt: 'quest_teamStartedAt',
};

const WEBSOCKET_URL_KEY = 'quest_websocketUrl';
const RUNTIME_SESSION_ID_KEY = 'quest_runtimeSessionId';

/*
function getOrCreateDeviceId(): string {
    if (typeof window === 'undefined') return 'unknown-device';
    const key = 'quest_deviceId';
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created =
        (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID()
            : `device-${Math.random().toString(16).slice(2)}-${Date.now()}`;
    localStorage.setItem(key, created);
    return created;
}
*/

function notifySessionChanged() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('quest_session_changed'));
}



export function useQuestSession() {
    const [session, setSession] = useState<Session | null>(null);
    const [team, setTeam] = useState<Team | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadState = async () => {
            try {
                const fromSession = {
                    sessionId: sessionStorage.getItem('quest_sessionId'),
                    teamCode: sessionStorage.getItem('quest_teamCode'),
                    runtimeSessionId: sessionStorage.getItem(RUNTIME_SESSION_ID_KEY),
                    expiresAt: sessionStorage.getItem('quest_expiresAt')
                };

                const fromLocal = {
                    sessionId: localStorage.getItem('quest_sessionId'),
                    teamCode: localStorage.getItem('quest_teamCode'),
                    runtimeSessionId: localStorage.getItem(RUNTIME_SESSION_ID_KEY),
                    expiresAt: localStorage.getItem('quest_expiresAt')
                };

                const storedSessionId = fromSession.sessionId ?? fromLocal.sessionId;
                const storedTeamCode = fromSession.teamCode ?? fromLocal.teamCode;
                const storedRuntimeSessionId = fromSession.runtimeSessionId ?? fromLocal.runtimeSessionId;
                const storedExpiresAt = fromSession.expiresAt ?? fromLocal.expiresAt;

                // Migrate legacy localStorage session state to sessionStorage to avoid cross-tab collisions.
                if (!fromSession.sessionId && fromLocal.sessionId) {
                    sessionStorage.setItem('quest_sessionId', fromLocal.sessionId);
                    localStorage.removeItem('quest_sessionId');
                }
                if (!fromSession.teamCode && fromLocal.teamCode) {
                    sessionStorage.setItem('quest_teamCode', fromLocal.teamCode);
                    localStorage.removeItem('quest_teamCode');
                }
                if (!fromSession.runtimeSessionId && fromLocal.runtimeSessionId) {
                    sessionStorage.setItem(RUNTIME_SESSION_ID_KEY, fromLocal.runtimeSessionId);
                    localStorage.removeItem(RUNTIME_SESSION_ID_KEY);
                }
                if (!fromSession.expiresAt && fromLocal.expiresAt) {
                    sessionStorage.setItem('quest_expiresAt', fromLocal.expiresAt);
                    localStorage.removeItem('quest_expiresAt');
                }

                if (storedSessionId && storedSessionId !== 'undefined') {
                    const expiresAt = storedExpiresAt ? Number(storedExpiresAt) : undefined;
                    setSession({
                        sessionId: storedSessionId,
                        mode: storedTeamCode ? 'team' : 'solo',
                        teamCode: storedTeamCode || undefined,
                        status: 'ready',
                        expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined
                    });
                } else {
                    // Invalid ID in storage, clear it
                    if (storedSessionId === 'undefined') {
                        sessionStorage.removeItem('quest_sessionId');
                        localStorage.removeItem('quest_sessionId');
                    }
                }
                void storedRuntimeSessionId;

                if (storedTeamCode) {
                    setTeam({ teamCode: storedTeamCode });
                }
            } catch (err: any) {
                console.error("Failed to load session", err);
                setError(err.message);
                // If 404, maybe clear storage?
                if (err.message.includes('not found')) {
                    sessionStorage.removeItem('quest_sessionId');
                    sessionStorage.removeItem('quest_teamCode');
                    localStorage.removeItem('quest_sessionId');
                    localStorage.removeItem('quest_teamCode');
                }
            } finally {
                setLoading(false);
            }
        };
        loadState();
    }, []);

    const createLocalSoloSession = (name: string): Session => {
        const sessionId =
            (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function')
                ? crypto.randomUUID()
                : `solo-${Math.random().toString(16).slice(2)}-${Date.now()}`;

        const expiresAt = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
        const created: Session = { sessionId, mode: 'solo', status: 'ready', expiresAt };

        setSession(created);
        setTeam(null);

        sessionStorage.removeItem('quest_teamCode');
        sessionStorage.removeItem(SOLO_TEAM_STORAGE.flag);
        sessionStorage.removeItem(SOLO_TEAM_STORAGE.startedAt);
        sessionStorage.removeItem(WEBSOCKET_URL_KEY);

        sessionStorage.setItem('quest_sessionId', sessionId);
        sessionStorage.setItem(RUNTIME_SESSION_ID_KEY, sessionId);
        sessionStorage.setItem('quest_expiresAt', String(expiresAt));
        sessionStorage.setItem('quest_playerName', name);
        notifySessionChanged();

        return created;
    };

    const createSession = async (name: string, questId: string) => {
        console.log('[useQuestSession] createSession START', { name, questId });
        setLoading(true);
        try {
            if (!questId) throw new Error('Missing questId');
            // Prefer "solo as 1-player team" to avoid /api/sessions (which may require DynamoDB).
            try {
                console.log('[useQuestSession] Calling apiCreateTeam', { name, questId });
                const result = await apiCreateTeam(name, questId);
                console.log('[useQuestSession] apiCreateTeam returned:', result);
                const teamCode = result.teamCode;
                const sessionId = result.session?.sessionId;
                const runtimeSessionId = result.session?.runtimeSessionId ?? null;
                if (!teamCode || !sessionId) throw new Error('Team creation succeeded but missing teamCode/sessionId');

                const created: Session = { sessionId, mode: 'team', teamCode, status: 'ready' };
                setSession(created);
                setTeam({ teamCode });

                const startedAtIso = new Date().toISOString();

                sessionStorage.setItem('quest_teamCode', teamCode);
                sessionStorage.setItem('quest_sessionId', sessionId);
                if (runtimeSessionId) sessionStorage.setItem(RUNTIME_SESSION_ID_KEY, runtimeSessionId);
                sessionStorage.removeItem('quest_expiresAt');
                sessionStorage.setItem('quest_playerName', name);
                sessionStorage.setItem(WEBSOCKET_URL_KEY, result.websocketUrl || '');
                sessionStorage.setItem(SOLO_TEAM_STORAGE.flag, '1');
                sessionStorage.setItem(SOLO_TEAM_STORAGE.startedAt, startedAtIso);
                notifySessionChanged();

                console.log('[useQuestSession] Session storage updated, returning session:', created);
                return created;
            } catch (err) {
                console.warn('[useQuestSession] solo team creation failed, falling back to local solo session', err);
                return createLocalSoloSession(name);
            }
        } catch (err: any) {
            console.error('[useQuestSession] createSession ERROR:', err);
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const createTeam = async (
        name: string,
        questId: string,
        expectedPlayers: number = 2,
        teamName?: string
    ) => {
        setLoading(true);
        try {
            if (!questId) throw new Error('Missing questId');
            void expectedPlayers;
            void teamName;

            const result = await apiCreateTeam(name, questId);
            const teamCode = result.teamCode;
            const created: Team = { teamCode };

            const sessionId = result.session.sessionId;
            const runtimeSessionId = result.session.runtimeSessionId ?? null;
            setSession({ sessionId, mode: 'team', teamCode, status: 'ready' });

            setTeam(created);
            sessionStorage.setItem('quest_teamCode', teamCode);
            sessionStorage.setItem('quest_sessionId', sessionId);
            if (runtimeSessionId) sessionStorage.setItem(RUNTIME_SESSION_ID_KEY, runtimeSessionId);
            sessionStorage.removeItem('quest_expiresAt');
            sessionStorage.setItem('quest_playerName', name);
            sessionStorage.setItem(WEBSOCKET_URL_KEY, result.websocketUrl || '');
            sessionStorage.removeItem(SOLO_TEAM_STORAGE.flag);
            sessionStorage.removeItem(SOLO_TEAM_STORAGE.startedAt);
            notifySessionChanged();
            return created;
        } catch (err: any) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const joinTeam = async (code: string, name: string, questId: string) => {
        setLoading(true);
        try {
            if (!questId) throw new Error('Missing questId');

            const result = await apiJoinTeam(code, name);
            const teamCode = result.teamCode;
            const joined: Team = { teamCode };

            const sessionId = result.session.sessionId;
            const runtimeSessionId = result.session.runtimeSessionId ?? null;
            setSession({ sessionId, mode: 'team', teamCode, status: 'ready' });

            setTeam(joined);
            sessionStorage.setItem('quest_teamCode', teamCode);
            sessionStorage.setItem('quest_sessionId', sessionId);
            if (runtimeSessionId) sessionStorage.setItem(RUNTIME_SESSION_ID_KEY, runtimeSessionId);
            sessionStorage.removeItem('quest_expiresAt');
            sessionStorage.setItem('quest_playerName', name);
            sessionStorage.setItem(WEBSOCKET_URL_KEY, result.websocketUrl || '');
            sessionStorage.removeItem(SOLO_TEAM_STORAGE.flag);
            sessionStorage.removeItem(SOLO_TEAM_STORAGE.startedAt);
            notifySessionChanged();
            return joined;
        } catch (err: any) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return {
        session,
        team,
        loading,
        error,
        createSession,
        createTeam,
        joinTeam
    };
}

export function useQuestTimer(session: Session | null) {
    const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));

    useEffect(() => {
        if (!session?.expiresAt) return; // No timer needed if no session or expiry
        const interval = setInterval(() => {
            setNow(Math.floor(Date.now() / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [session?.expiresAt]);

    if (!session || !session.expiresAt) {
        return { remaining: null, isExpired: false };
    }

    const left = session.expiresAt - now;
    const isExpired = left <= 0;
    const remaining = isExpired ? 0 : left;

    return { remaining, isExpired };
}

export function formatRemainingTime(seconds: number) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
