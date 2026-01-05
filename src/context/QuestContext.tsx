'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { QuestData } from '@/types/quest';
import { normalizeQuestData } from '@/lib/questDataUtils';

import { useQuestRuntime } from '@/hooks/useQuestRuntime';
import { useTeamSync } from '@/context/TeamSyncContext';

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

    // Determine player ID consistently with QuestMap logic
    const currentSessionId = teamSync.session?.sessionId ?? null;

    // Initialize Runtime globally so it persists across page navigations
    const runtime = useQuestRuntime({
        questId: normalizedData.questId ?? normalizedData.quest.id,
        questVersion: normalizedData.questVersion ?? 'v1',
        playerId: currentSessionId,
        teamCode: teamSync.teamCode,
        autoStart: true,
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
