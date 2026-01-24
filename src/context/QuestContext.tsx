'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { QuestData } from '@/types/quest';
import { normalizeQuestData } from '@/lib/questDataUtils';

import { useQuestRuntime } from '@/hooks/useQuestRuntime';
import { useTeamSync } from '@/context/TeamSyncContext';
import { getOrCreateDeviceId } from '@/utils/deviceId';

function getRuntimeSessionId(params: {
    teamCode: string | null;
    runtimeSessionId: string | null;
    persistedRuntimeSessionId: string | null;
    persistedSessionId: string | null;
}): string | null {
    const { teamCode, runtimeSessionId, persistedRuntimeSessionId, persistedSessionId } = params;
    // In team mode, runtime session should be explicitly provisioned (not derived from teamCode).
    if (teamCode) return runtimeSessionId ?? persistedRuntimeSessionId;
    // Solo mode: runtime session = local sessionId (or persisted runtimeSessionId if present).
    return persistedRuntimeSessionId ?? persistedSessionId;
}

function getRuntimePlayerId(params: { teamCode: string | null; teamSessionId: string | null; deviceId: string }): string {
    const { teamCode, teamSessionId, deviceId } = params;
    // In team mode, treat the Worker sessionId as the Runtime playerId.
    if (teamCode && teamSessionId) return teamSessionId;
    // In solo mode, keep a stable per-device playerId.
    return deviceId;
}

interface QuestContextType {
    data: QuestData | null;
    progress: QuestProgress;
    updateProgress: (newProgress: Partial<QuestProgress>) => void;
    unlockPiece: (pieceId: string) => void;
    runtime: ReturnType<typeof useQuestRuntime> | null;
}

export interface QuestProgress {
    collectedPieces: string[];
    placedPieces: string[];
    completedPuzzles: string[];
    currentStage?: string;
}

const QuestStaticContext = createContext<QuestData | null>(null);

export function useQuestData() {
    return useContext(QuestStaticContext);
}

const QuestContext = createContext<QuestContextType>({
    data: null,
    progress: { collectedPieces: [], placedPieces: [], completedPuzzles: [] },
    updateProgress: () => { },
    unlockPiece: () => { },
    runtime: null
});

export function useQuest() {
    return useContext(QuestContext);
}

interface QuestProviderProps {
    data: QuestData;
    children: ReactNode;
}

export function QuestProvider({ data, children }: QuestProviderProps) {
    const normalizedData = React.useMemo(() => normalizeQuestData(data), [data]);
    const teamSync = useTeamSync();
    const deviceId = React.useMemo(() => getOrCreateDeviceId(), []);

    const persistedSessionId = React.useMemo(() => {
        if (typeof window === 'undefined') return null;
        try {
            return sessionStorage.getItem('quest_sessionId');
        } catch {
            return null;
        }
    }, []);

    const persistedRuntimeSessionId = React.useMemo(() => {
        if (typeof window === 'undefined') return null;
        try {
            return sessionStorage.getItem('quest_runtimeSessionId');
        } catch {
            return null;
        }
    }, []);

    React.useEffect(() => {
        const sid = teamSync.session?.sessionId;
        if (!sid) return;
        try {
            sessionStorage.setItem('quest_sessionId', sid);
        } catch {
            // ignore
        }
    }, [teamSync.session?.sessionId]);

    React.useEffect(() => {
        const rsid = teamSync.session?.runtimeSessionId;
        if (!rsid) return;
        try {
            sessionStorage.setItem('quest_runtimeSessionId', rsid);
        } catch {
            // ignore
        }
    }, [teamSync.session?.runtimeSessionId]);

    // Initialize Runtime globally so it persists across page navigations


    // Initialize Runtime globally so it persists across page navigations
    const runtimeSessionId = React.useMemo(() => {
        return getRuntimeSessionId({
            teamCode: teamSync.teamCode,
            runtimeSessionId: teamSync.session?.runtimeSessionId ?? teamSync.team?.runtimeSessionId ?? null,
            persistedRuntimeSessionId,
            persistedSessionId,
        });
    }, [persistedRuntimeSessionId, persistedSessionId, teamSync.session?.runtimeSessionId, teamSync.team?.runtimeSessionId, teamSync.teamCode]);

    const runtimePlayerId = React.useMemo(() => {
        return getRuntimePlayerId({
            teamCode: teamSync.teamCode,
            teamSessionId: teamSync.session?.sessionId ?? null,
            deviceId,
        });
    }, [deviceId, teamSync.session?.sessionId, teamSync.teamCode]);

    const runtime = useQuestRuntime({
        questId: normalizedData.questId ?? normalizedData.quest.id,
        questVersion: normalizedData.questVersion ?? 'v1',
        playerId: runtimePlayerId,
        teamCode: teamSync.teamCode,
        // Team runtime session is shared by teamCode; solo uses persisted sessionId.
        sessionId: runtimeSessionId,
        autoStart: false,
        pollIntervalMs: teamSync.connectionStatus === 'connected' ? 0 : 10_000
    });

    const [progress, setProgress] = React.useState<QuestProgress>({
        collectedPieces: [],
        placedPieces: [],
        completedPuzzles: []
    });

    // Load progress from localStorage on mount
    React.useEffect(() => {
        const saved = localStorage.getItem('quest_progress');
        if (saved) {
            try {
                setProgress(JSON.parse(saved));
            } catch (e) {
                console.error('Failed to load progress', e);
            }
        }
    }, []);

    // Save progress to localStorage whenever it changes
    React.useEffect(() => {
        localStorage.setItem('quest_progress', JSON.stringify(progress));
    }, [progress]);

    const updateProgress = (newProgress: Partial<QuestProgress>) => {
        setProgress(prev => ({ ...prev, ...newProgress }));
    };

    const unlockPiece = (pieceId: string) => {
        setProgress(prev => {
            if (prev.collectedPieces.includes(pieceId)) return prev;
            return {
                ...prev,
                collectedPieces: [...prev.collectedPieces, pieceId]
            };
        });
    };

    const contextValue = React.useMemo(() => ({
        data: normalizedData,
        progress,
        updateProgress,
        unlockPiece,
        runtime
    }), [normalizedData, progress, runtime]);

    return (
        <QuestStaticContext.Provider value={normalizedData}>
            <QuestContext.Provider value={contextValue}>
                {children}
            </QuestContext.Provider>
        </QuestStaticContext.Provider>
    );
}
