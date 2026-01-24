import { useState, useRef, useCallback } from 'react';
import type {
    TimelineActionOverlayState,
    TimelineArOverlayState,
    TimelineChatOverlayState,
    TimelineDocumentOverlayState,
    TimelineTextOverlayState,
    TimelineVideoOverlayState,
} from '../types';

type UseTimelineOverlaysParams = {
    completeRuntimeNode: (objectId: string, itemKey: string) => Promise<boolean>;
    onPuzzleComplete?: (puzzleId: string, objectId: string) => Promise<void>;
};

export function useTimelineOverlays({ completeRuntimeNode, onPuzzleComplete }: UseTimelineOverlaysParams) {
    // #region State & Refs
    const [timelinePuzzleOverlay, setTimelinePuzzleOverlay] = useState<{ puzzleId: string; objectId: string; itemKey?: string } | null>(null);

    const [timelineTextOverlay, _setTimelineTextOverlay] = useState<TimelineTextOverlayState | null>(null);
    const timelineTextOverlayRef = useRef<TimelineTextOverlayState | null>(null);
    const setTimelineTextOverlay = useCallback((overlay: TimelineTextOverlayState | null) => {
        timelineTextOverlayRef.current = overlay;
        _setTimelineTextOverlay(overlay);
    }, []);

    const [timelineVideoOverlay, setTimelineVideoOverlay] = useState<TimelineVideoOverlayState | null>(null);
    const [timelineActionOverlay, setTimelineActionOverlay] = useState<TimelineActionOverlayState | null>(null);
    const [timelineChatOverlay, setTimelineChatOverlay] = useState<TimelineChatOverlayState | null>(null);
    const [timelineArOverlay, setTimelineArOverlay] = useState<TimelineArOverlayState | null>(null);

    const [timelineDocumentOverlay, _setTimelineDocumentOverlay] = useState<TimelineDocumentOverlayState | null>(null);
    const timelineDocumentOverlayRef = useRef<TimelineDocumentOverlayState | null>(null);
    const setTimelineDocumentOverlay = useCallback((overlay: TimelineDocumentOverlayState | null) => {
        timelineDocumentOverlayRef.current = overlay;
        _setTimelineDocumentOverlay(overlay);
    }, []);

    const timelineTextResolveRef = useRef<(() => void) | null>(null);
    const timelineDocumentResolveRef = useRef<(() => void) | null>(null);
    const timelineTextTimeoutRef = useRef<number | null>(null);
    const timelineVideoResolveRef = useRef<(() => void) | null>(null);
    const timelineChatResolveRef = useRef<(() => void) | null>(null);
    const timelineActionResolveRef = useRef<((evidence: Record<string, unknown>) => void) | null>(null);
    const timelineArResolveRef = useRef<((evidence: Record<string, unknown>) => void) | null>(null);
    // #endregion

    // #region Text Overlay Handlers
    const closeTimelineText = useCallback(() => {
        if (timelineTextTimeoutRef.current) {
            window.clearTimeout(timelineTextTimeoutRef.current);
            timelineTextTimeoutRef.current = null;
        }

        const currentOverlay = timelineTextOverlayRef.current;
        if (currentOverlay?.objectId && currentOverlay?.itemKey) {
            void completeRuntimeNode(currentOverlay.objectId, currentOverlay.itemKey);
        }

        setTimelineTextOverlay(null);
        const resolve = timelineTextResolveRef.current;
        timelineTextResolveRef.current = null;
        if (resolve) {
            try {
                resolve();
            } catch {
                // ignore
            }
        }
    }, [completeRuntimeNode, setTimelineTextOverlay]);

    const showTimelineText = useCallback(
        async (params: {
            title?: string;
            text: string;
            transcription?: { words: Array<{ word: string; start: number; end: number }> };
            imageUrls?: string[];
            mode: 'seconds' | 'until_close';
            seconds: number;
            blocking: boolean;
            objectId?: string;
            itemKey?: string;
        }) => {
            closeTimelineText();

            const title = params.title ?? 'Message';
            const seconds = Number.isFinite(params.seconds) ? Math.max(1, Math.round(params.seconds)) : 5;

            setTimelineTextOverlay({
                title,
                text: params.text,
                transcription: params.transcription,
                imageUrls: params.imageUrls,
                mode: params.mode,
                seconds,
                objectId: params.objectId,
                itemKey: params.itemKey
            });

            const waitForClose = new Promise<void>((resolve) => {
                timelineTextResolveRef.current = resolve;
            });

            const waitForTimer =
                params.mode === 'seconds'
                    ? new Promise<void>((resolve) => {
                        timelineTextTimeoutRef.current = window.setTimeout(() => {
                            timelineTextTimeoutRef.current = null;
                            resolve();
                        }, seconds * 1000);
                    })
                    : null;

            if (!params.blocking) {
                if (waitForTimer) {
                    void waitForTimer.then(() => closeTimelineText());
                }
                return;
            }

            if (!waitForTimer) {
                await waitForClose;
                closeTimelineText();
                if (params.objectId && params.itemKey) {
                    await completeRuntimeNode(params.objectId, params.itemKey);
                }
                return;
            }

            await Promise.race([waitForClose, waitForTimer]);
            closeTimelineText();
            if (params.objectId && params.itemKey) {
                await completeRuntimeNode(params.objectId, params.itemKey);
            }
        },
        [closeTimelineText, completeRuntimeNode, setTimelineTextOverlay]
    );
    // #endregion

    // #region Video Overlay Handlers
    const resolveTimelineVideo = useCallback(() => {
        const resolve = timelineVideoResolveRef.current;
        timelineVideoResolveRef.current = null;
        if (resolve) {
            try {
                resolve();
            } catch {
                // ignore
            }
        }
    }, []);

    const closeTimelineVideo = useCallback(() => {
        setTimelineVideoOverlay(null);
        resolveTimelineVideo();
    }, [resolveTimelineVideo]);

    const showTimelineVideo = useCallback(
        async (params: {
            title?: string;
            url: string;
            blocking: boolean;
            objectId?: string;
            itemKey?: string;
            autoPlay?: boolean;
            muted?: boolean;
            loop?: boolean;
            posterUrl?: string;
        }) => {
            closeTimelineVideo();
            const title = params.title ?? 'Video';
            const autoPlay = typeof params.autoPlay === 'boolean' ? params.autoPlay : true;
            // Default to muted when autoplaying to satisfy browser autoplay policies.
            const muted = typeof params.muted === 'boolean' ? params.muted : autoPlay;
            const loop = typeof params.loop === 'boolean' ? params.loop : false;
            const posterUrl = typeof params.posterUrl === 'string' ? params.posterUrl : undefined;

            const overlayState = {
                title,
                url: params.url,
                autoPlay,
                muted,
                loop,
                posterUrl
            };

            if (!params.blocking) {
                setTimelineVideoOverlay(overlayState);
                return;
            }

            await new Promise<void>((resolve) => {
                timelineVideoResolveRef.current = resolve;
                setTimelineVideoOverlay(overlayState);
            });
            closeTimelineVideo();
            if (params.objectId && params.itemKey) {
                await completeRuntimeNode(params.objectId, params.itemKey);
            }
        },
        [closeTimelineVideo, completeRuntimeNode]
    );
    // #endregion

    // #region Chat Overlay Handlers
    const resolveTimelineChat = useCallback(() => {
        const resolve = timelineChatResolveRef.current;
        timelineChatResolveRef.current = null;
        if (resolve) {
            try {
                resolve();
            } catch {
                // ignore
            }
        }
    }, []);

    const closeTimelineChat = useCallback(() => {
        setTimelineChatOverlay(null);
        resolveTimelineChat();
    }, [resolveTimelineChat]);

    const showTimelineChat = useCallback(
        async (params: {
            title?: string;
            blocking: boolean;
            sessionId?: string | null;
            playerId?: string | null;
            firstMessage?: string;
            imageUrls?: string[];
            goal?: Record<string, any>;
            objectId?: string;
            itemKey?: string;
        }) => {
            closeTimelineChat();

            const title = params.title ?? 'Chat';

            const overlayState = {
                title,
                sessionId: params.sessionId,
                playerId: params.playerId,
                firstMessage: params.firstMessage,
                imageUrls: params.imageUrls,
                goal: params.goal
            };

            if (!params.blocking) {
                setTimelineChatOverlay(overlayState);
                return;
            }

            await new Promise<void>((resolve) => {
                timelineChatResolveRef.current = resolve;
                setTimelineChatOverlay(overlayState);
            });
            closeTimelineChat();
            if (params.objectId && params.itemKey) {
                await completeRuntimeNode(params.objectId, params.itemKey);
            }
        },
        [closeTimelineChat, completeRuntimeNode]
    );
    // #endregion

    // #region Action Overlay Handlers
    const resolveTimelineAction = useCallback((evidence: Record<string, unknown>) => {
        const resolve = timelineActionResolveRef.current;
        timelineActionResolveRef.current = null;
        if (resolve) {
            try {
                resolve(evidence);
            } catch {
                // ignore
            }
        }
    }, []);

    const completeTimelineAction = useCallback(
        (evidence: Record<string, unknown>) => {
            setTimelineActionOverlay(null);
            resolveTimelineAction(evidence);
        },
        [resolveTimelineAction],
    );

    const cancelTimelineAction = useCallback(() => {
        completeTimelineAction({ __cancelled: true });
    }, [completeTimelineAction]);

    const showTimelineAction = useCallback(
        async (params: { title?: string; actionKind: string; params: Record<string, any> }) => {
            cancelTimelineAction();

            const title = params.title ?? 'Action';

            return await new Promise<Record<string, unknown>>((resolve) => {
                timelineActionResolveRef.current = resolve;
                setTimelineActionOverlay({
                    title,
                    actionKind: params.actionKind,
                    params: params.params,
                });
            });
        },
        [cancelTimelineAction]
    );
    // #endregion

    // #region AR Overlay Handlers
    const resolveTimelineAr = useCallback((evidence: Record<string, unknown>) => {
        const resolve = timelineArResolveRef.current;
        timelineArResolveRef.current = null;
        if (resolve) {
            try {
                resolve(evidence);
            } catch {
                // ignore
            }
        }
    }, []);

    const completeTimelineAr = useCallback(
        (evidence: Record<string, unknown>) => {
            setTimelineArOverlay(null);
            resolveTimelineAr(evidence);
        },
        [resolveTimelineAr]
    );

    const cancelTimelineAr = useCallback(() => {
        completeTimelineAr({ __cancelled: true });
    }, [completeTimelineAr]);

    const showTimelineAr = useCallback(
        async (params: TimelineArOverlayState) => {
            cancelTimelineAr();
            return await new Promise<Record<string, unknown>>((resolve) => {
                timelineArResolveRef.current = resolve;
                setTimelineArOverlay(params);
            });
        },
        [cancelTimelineAr]
    );
    // #endregion

    // #region Document Overlay Handlers
    const resolveTimelineDocument = useCallback(() => {
        const resolve = timelineDocumentResolveRef.current;
        timelineDocumentResolveRef.current = null;
        if (resolve) {
            try {
                resolve();
            } catch {
                // ignore
            }
        }
    }, []);

    const closeTimelineDocument = useCallback(() => {
        const currentOverlay = timelineDocumentOverlayRef.current;
        if (currentOverlay?.objectId && currentOverlay?.itemKey) {
            void completeRuntimeNode(currentOverlay.objectId, currentOverlay.itemKey);
        }
        setTimelineDocumentOverlay(null);
        resolveTimelineDocument();
    }, [resolveTimelineDocument, completeRuntimeNode, setTimelineDocumentOverlay]);

    const showTimelineDocument = useCallback(
        async (params: {
            title?: string;
            media_id?: string;
            media_url?: string;
            text?: string;
            blocking: boolean;
            objectId?: string;
            itemKey?: string;
        }) => {
            closeTimelineDocument();

            const title = params.title ?? 'Document';

            if (!params.blocking) {
                setTimelineDocumentOverlay({
                    title,
                    media_id: params.media_id,
                    media_url: params.media_url,
                    text: params.text,
                    objectId: params.objectId,
                    itemKey: params.itemKey
                });
                return;
            }

            await new Promise<void>((resolve) => {
                timelineDocumentResolveRef.current = resolve;
                setTimelineDocumentOverlay({
                    title,
                    media_id: params.media_id,
                    media_url: params.media_url,
                    text: params.text,
                    objectId: params.objectId,
                    itemKey: params.itemKey
                });
            });

            closeTimelineDocument();
        },
        [closeTimelineDocument, setTimelineDocumentOverlay]
    );
    // #endregion

    // #region Puzzle Overlay Handlers
    const closeTimelinePuzzle = useCallback(() => {
        setTimelinePuzzleOverlay(null);
    }, []);

    const completeTimelinePuzzle = useCallback(
        async () => {
            if (timelinePuzzleOverlay && onPuzzleComplete) {
                await onPuzzleComplete(timelinePuzzleOverlay.puzzleId, timelinePuzzleOverlay.objectId);
            }
            setTimelinePuzzleOverlay(null);
        },
        [timelinePuzzleOverlay, onPuzzleComplete]
    );
    // #endregion

    return {
        // States
        timelineTextOverlay,
        timelineVideoOverlay,
        timelineChatOverlay,
        timelineActionOverlay,
        timelineArOverlay,
        timelineDocumentOverlay,
        timelinePuzzleOverlay,
        setTimelinePuzzleOverlay,

        // Handlers
        showTimelineText,
        closeTimelineText,
        showTimelineVideo,
        closeTimelineVideo,
        showTimelineChat,
        closeTimelineChat,
        showTimelineAction,
        completeTimelineAction,
        cancelTimelineAction,
        showTimelineAr,
        completeTimelineAr,
        cancelTimelineAr,
        showTimelineDocument,
        closeTimelineDocument,
        closeTimelinePuzzle,
        completeTimelinePuzzle
    };
}
