import { useRef, useState, useCallback } from 'react';
import { TimelineUiState, TimelineProgressState } from '../types';

export function useTimelineState() {
    const timelineRunRef = useRef<{ cancel: boolean; objectId: string; version: number; status: 'running' | 'idle' } | null>(null);
    const [timelineUi, setTimelineUi] = useState<TimelineUiState | null>(null);

    const setTimelineProgress = useCallback((objectId: string, version: number, progress: TimelineProgressState) => {
        setTimelineUi((prev) => {
            if (!prev) return prev;
            if (prev.objectId !== objectId || prev.version !== version) return prev;
            return { ...prev, progress };
        });
    }, []);

    return {
        timelineUi,
        setTimelineUi,
        timelineRunRef,
        setTimelineProgress
    };
}
