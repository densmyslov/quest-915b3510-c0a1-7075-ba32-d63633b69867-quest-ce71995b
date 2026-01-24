import { useState, useRef, useCallback, useEffect, SyntheticEvent } from 'react';

import type { Transcription } from '@/types/transcription';

interface ActiveAudioState {
    objectId: string;
    name: string;
    url: string;
    transcription: Transcription | null;
    mode: 'narration' | 'audio'; // Defaulted to 'narration' in code
    loop?: boolean;
    volume?: number;
    panelAutoCloseAfterEndedMs?: number | null;
}

interface AudioPayload {
    url: string;
    objectName: string;
    objectId: string;
    transcription: Transcription | null;
    loop?: boolean;
    volume?: number;
    panelAutoCloseAfterEndedMs?: number | null;
}

interface EffectPayload {
    url: string;
    objectName: string;
    objectId: string;
    loop?: boolean;
    volume?: number;
}

interface UseQuestAudioProps {
    onNotification: (message: string | null) => void;
}

export const useMapAudio = ({ onNotification }: UseQuestAudioProps) => {
    // Refs
    const audioRef = useRef<HTMLAudioElement>(null);
    const effectAudioRef = useRef<HTMLAudioElement>(null);

    const activeAudioRef = useRef<ActiveAudioState | null>(null); // Mirror for closure access
    const activeEffectRef = useRef<{ objectId: string; loop: boolean } | null>(null);

    const audioUnlockedRef = useRef(false);
    const audioUnlockInFlightRef = useRef<Promise<boolean> | null>(null);
    const audioAutoplayRef = useRef(false);

    const blockingAudioResolveRef = useRef<(() => void) | null>(null);
    const blockingEffectResolveRef = useRef<(() => void) | null>(null);

    const pendingEffectBlockingRef = useRef<{ payload: EffectPayload; resolve: () => void } | null>(null);
    const pendingNarrationAudioRef = useRef<AudioPayload | null>(null);
    const pendingEffectAudioRef = useRef<EffectPayload | null>(null);

    const narrationPlayRetryRef = useRef<{ url: string; attempts: number } | null>(null);

    const stopAudioRef = useRef<() => void>(() => { });
    const stopEffectAudioRef = useRef<() => void>(() => { });

    const audioPanelCloseResolveRef = useRef<(() => void) | null>(null);
    const audioPanelAutoCloseTimeoutRef = useRef<number | null>(null);

    // State
    const [activeAudio, setActiveAudio] = useState<ActiveAudioState | null>(null);
    const [audioIsPlaying, setAudioIsPlaying] = useState(false);
    const [audioCurrentTime, setAudioCurrentTime] = useState(0);
    const [audioDuration, setAudioDuration] = useState(0);
    const [audioPanelCollapsed, setAudioPanelCollapsed] = useState(false);
    const [effectPlaybackRate, setEffectPlaybackRateState] = useState(1);
    const [isEffectPlaying, setIsEffectPlaying] = useState(false);

    // Sync activeAudioRef
    useEffect(() => {
        activeAudioRef.current = activeAudio;
    }, [activeAudio]);

    // Helpers
    const resolveAudioPanelClose = useCallback(() => {
        const resolve = audioPanelCloseResolveRef.current;
        if (!resolve) return;
        audioPanelCloseResolveRef.current = null;
        try {
            resolve();
        } catch {
            // ignore
        }
    }, []);

    const waitForAudioPanelClose = useCallback(() => {
        resolveAudioPanelClose();
        return new Promise<void>((resolve) => {
            audioPanelCloseResolveRef.current = resolve;
        });
    }, [resolveAudioPanelClose]);

    const resolveBlockingAudio = useCallback(() => {
        const resolve = blockingAudioResolveRef.current;
        if (!resolve) return;
        blockingAudioResolveRef.current = null;
        try {
            resolve();
        } catch {
            // ignore
        }
    }, []);

    const clearAudioPanelAutoClose = useCallback(() => {
        if (!audioPanelAutoCloseTimeoutRef.current) return;
        window.clearTimeout(audioPanelAutoCloseTimeoutRef.current);
        audioPanelAutoCloseTimeoutRef.current = null;
    }, []);

    const scheduleAudioPanelAutoClose = useCallback((ms: number) => {
        clearAudioPanelAutoClose();
        if (!Number.isFinite(ms) || ms <= 0) return;
        audioPanelAutoCloseTimeoutRef.current = window.setTimeout(() => {
            stopAudioRef.current?.();
        }, ms);
    }, [clearAudioPanelAutoClose]);

    const resolveBlockingEffect = useCallback(() => {
        const resolve = blockingEffectResolveRef.current;
        if (!resolve) return;
        blockingEffectResolveRef.current = null;
        try {
            resolve();
        } catch {
            // ignore
        }
    }, []);

    // Effect playback rate control (1x to 5x)
    const setEffectPlaybackRate = useCallback((rate: number) => {
        const clampedRate = Math.max(1, Math.min(5, Math.round(rate)));
        setEffectPlaybackRateState(clampedRate);
        const audio = effectAudioRef.current;
        if (audio) {
            audio.playbackRate = clampedRate;
        }
    }, []);

    const cycleEffectPlaybackRate = useCallback(() => {
        setEffectPlaybackRateState(prev => {
            const nextRate = prev >= 5 ? 1 : prev + 1;
            const audio = effectAudioRef.current;
            if (audio) {
                audio.playbackRate = nextRate;
            }
            return nextRate;
        });
    }, []);

    // Core Logic
    const unlockAudio = useCallback(async (): Promise<boolean> => {
        if (audioUnlockedRef.current) {
            return true; // Already unlocked
        }
        if (audioUnlockInFlightRef.current) {
            return audioUnlockInFlightRef.current;
        }

        audioUnlockInFlightRef.current = (async () => {
            try {
                // 1. AudioContext unlock (Web Audio API)
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                if (AudioContextClass) {
                    const ctx = new AudioContextClass();
                    const buffer = ctx.createBuffer(1, 1, 22050);
                    const source = ctx.createBufferSource();
                    source.buffer = buffer;
                    source.connect(ctx.destination);
                    source.start(0);
                    try {
                        await ctx.close();
                    } catch {
                        // ignore
                    }
                }

                // 2. HTML5 Audio element unlock
                // Prioritize hosted file for reliability, with data URIs as fallback
                const silentFormats = [
                    '/audio/silence.mp3',
                    'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v////////////////////////////////////////////////////////////////MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMz/////////////////////////////////////////////////////////////////AAAAAExhdmM1OC4xMzQAAAAAAAAAAAAAAAAkAAAAAAAAA4T/88DE8AAAAGwAAAABpAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//MwxMsAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/zMEAAAA=',
                    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
                ];

                const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
                    /req_safari_ui_webview/i.test(navigator.userAgent);

                console.log('[useMapAudio] UserAgent:', navigator.userAgent, 'isSafari:', isSafari);

                let unlocked = false;
                let unlockedSrc: string | null = null;
                let lastError = null;

                const audioToUnlock = effectAudioRef.current; // Use effect audio for unlock

                if (!audioToUnlock) {
                    console.error('[useMapAudio] effectAudioRef is null during unlock');
                    return false;
                }

                for (const src of silentFormats) {
                    try {
                        audioToUnlock.src = src;
                        audioToUnlock.volume = 0.01;
                        (audioToUnlock as any).playsInline = true;

                        console.log('[useMapAudio] Attempting unlock play on:', {
                            src,
                            audioRefExists: !!audioToUnlock
                        });

                        // Call play() immediately to preserve user gesture context.
                        // The browser will queue playback if the audio isn't ready yet.
                        await Promise.race([
                            (async () => {
                                try {
                                    await audioToUnlock.play();
                                    console.log('[useMapAudio] Unlock play resolved');
                                } catch (e: any) {
                                    console.error('[useMapAudio] Unlock play rejected:', e?.name, e?.message);
                                    if (e?.name === 'AbortError') {
                                        // On Safari, AbortError often means "not ready", but sometimes it effectively processed the gesture.
                                        // We'll treat it as a warning but continue if possible, or fail this format.
                                        throw e;
                                    }
                                    throw e;
                                }
                            })(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Audio unlock timeout')), 2000))
                        ]);

                        // Wait a bit before pausing to prevent Safari from aborting "too fast"
                        await new Promise(resolve => setTimeout(resolve, 200));

                        audioToUnlock.pause();
                        audioToUnlock.currentTime = 0;
                        if (!isSafari) {
                            // Only remove src if not Safari (Safari sometimes likes keeping it primed)
                            audioToUnlock.removeAttribute('src');
                            audioToUnlock.load();
                        }

                        unlocked = true;
                        unlockedSrc = src;
                        break;
                    } catch (err) {
                        lastError = err;
                    }
                }

                if (!unlocked) {
                    throw lastError || new Error('All audio formats failed');
                }

                // Prime narration element too if possible
                if (unlockedSrc) {
                    const narrationEl = audioRef.current;
                    if (narrationEl) {
                        try {
                            narrationEl.src = unlockedSrc;
                            narrationEl.volume = 0.01;
                            (narrationEl as any).playsInline = true;

                            // Just load/prime it, don't necessarily need full play/pause cycle if the context is unlocked,
                            // but safest to mirror the successful unlock
                            await narrationEl.play();
                            await new Promise(resolve => setTimeout(resolve, 150));
                            narrationEl.pause();
                            narrationEl.currentTime = 0;
                        } catch {
                            // ignore
                        }
                    }
                }

                audioUnlockedRef.current = true;
                return true;
            } catch {
                audioUnlockedRef.current = false;
                return false;
            } finally {
                audioUnlockInFlightRef.current = null;
            }
        })();

        return audioUnlockInFlightRef.current;
    }, []);

    // Handlers
    const handleAudioTimeUpdate = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
        setAudioCurrentTime(event.currentTarget.currentTime);
    }, []);

    const handleAudioPlay = useCallback(() => {
        setAudioIsPlaying(true);
    }, []);

    const handleAudioPause = useCallback(() => {
        setAudioIsPlaying(false);
    }, []);

    const handleAudioEnded = useCallback(() => {
        setAudioIsPlaying(false);
        resolveBlockingAudio();
        if (activeAudioRef.current?.panelAutoCloseAfterEndedMs) {
            scheduleAudioPanelAutoClose(activeAudioRef.current.panelAutoCloseAfterEndedMs);
        }
    }, [resolveBlockingAudio, scheduleAudioPanelAutoClose]);

    const handleAudioLoadedMetadata = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
        setAudioDuration(event.currentTarget.duration || 0);
    }, []);

    const handleAudioError = useCallback(() => {
        resolveBlockingAudio();
        resolveAudioPanelClose();
    }, [resolveAudioPanelClose, resolveBlockingAudio]);

    // Playback Functions
    const startAudioPlayback = useCallback((payload: AudioPayload) => {
        const { url, objectName, objectId, transcription, loop, volume } = payload;
        clearAudioPanelAutoClose();
        narrationPlayRetryRef.current = { url, attempts: 0 };

        if (audioRef.current) {
            try {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            } catch {
            }
        }

        setActiveAudio({
            objectId,
            name: objectName,
            url,
            transcription,
            mode: 'narration',
            loop,
            volume,
            panelAutoCloseAfterEndedMs: payload.panelAutoCloseAfterEndedMs ?? null
        });
        setAudioCurrentTime(0);
        setAudioDuration(0);
        setAudioIsPlaying(false);
        setAudioPanelCollapsed(false);
        audioAutoplayRef.current = true;
    }, [clearAudioPanelAutoClose]);

    const stopEffectAudio = useCallback(() => {
        const audio = effectAudioRef.current;
        if (audio) {
            try {
                audio.pause();
                audio.currentTime = 0;
                audio.removeAttribute('src');
                audio.load();
            } catch {
            }
        }

        activeEffectRef.current = null;
        pendingEffectAudioRef.current = null;
        setIsEffectPlaying(false);

        const pendingBlocking = pendingEffectBlockingRef.current;
        pendingEffectBlockingRef.current = null;
        if (pendingBlocking) {
            try {
                pendingBlocking.resolve();
            } catch {
            }
        }

        resolveBlockingEffect();
    }, [resolveBlockingEffect]);

    // Wire up stopEffectAudioRef
    useEffect(() => {
        stopEffectAudioRef.current = stopEffectAudio;
    }, [stopEffectAudio]);

    const startEffectPlayback = useCallback(async (payload: EffectPayload) => {
        const audio = effectAudioRef.current;
        if (!audio) return;

        try {
            audio.pause();
            audio.currentTime = 0;
        } catch {
        }

        const normalizedVolume =
            typeof payload.volume === 'number' ? Math.min(1, Math.max(0, payload.volume / 100)) : 1;

        try {
            audio.src = payload.url;
            audio.loop = !!payload.loop;
            audio.volume = normalizedVolume;
            audio.currentTime = 0;
            audio.load();
        } catch {
            activeEffectRef.current = null;
            onNotification('Audio non disponibile');
            setTimeout(() => onNotification(null), 4000);
            return;
        }

        activeEffectRef.current = { objectId: payload.objectId, loop: !!payload.loop };
        audio.onended = () => {
            if (!audio.loop) {
                activeEffectRef.current = null;
                setIsEffectPlaying(false);
            }
        };

        try {
            await audio.play();
            setIsEffectPlaying(true);
        } catch (err: any) {
            if (err?.name === 'NotAllowedError') {
                audioUnlockedRef.current = false;
                pendingEffectAudioRef.current = payload;
                onNotification('Audio bloccato: tocca Play/Steps, Attiva Bussola o la mappa per abilitare l\'audio');
                setTimeout(() => onNotification(null), 4000);
            }
        }
    }, [onNotification]);

    const startEffectPlaybackBlocking = useCallback((payload: EffectPayload, resolve: () => void) => {
        resolveBlockingEffect();

        const audio = effectAudioRef.current;
        if (!audio) {
            console.error('[useQuestAudio] effectAudioRef is null during blocking playback');
            resolve();
            return;
        }

        const cleanup = () => {
            audio.removeEventListener('ended', handleDone);
            audio.removeEventListener('error', handleDone);
        };

        const handleDone = () => {
            cleanup();
            activeEffectRef.current = null;
            setIsEffectPlaying(false);
            resolveBlockingEffect();
        };

        try {
            audio.pause();
            audio.currentTime = 0;
        } catch {
        }

        const normalizedVolume =
            typeof payload.volume === 'number' ? Math.min(1, Math.max(0, payload.volume / 100)) : 1;

        blockingEffectResolveRef.current = resolve;
        audio.addEventListener('ended', handleDone);
        audio.addEventListener('error', handleDone);

        audio.src = payload.url;
        audio.loop = false;
        audio.volume = normalizedVolume;
        audio.currentTime = 0;
        try {
            audio.load();
        } catch {
            cleanup();
            handleDone();
            return;
        }

        activeEffectRef.current = { objectId: payload.objectId, loop: false };
        audio.onended = () => {
            activeEffectRef.current = null;
            setIsEffectPlaying(false);
            // Ensure blocking promise resolves even if addEventListener callback doesn't fire
            resolveBlockingEffect();
        };

        setIsEffectPlaying(true);
        try {
            const playPromise = audio.play();
            if (playPromise && typeof (playPromise as any).catch === 'function') {
                void playPromise.catch((err: any) => {
                    cleanup();
                    if (err?.name === 'NotAllowedError') {
                        audioUnlockedRef.current = false;
                        blockingEffectResolveRef.current = null;
                        pendingEffectBlockingRef.current = { payload: { ...payload, loop: false }, resolve };
                        onNotification('Audio bloccato: tocca Play/Steps, Attiva Bussola o la mappa per abilitare l\'audio');
                        setTimeout(() => onNotification(null), 4000);
                        return;
                    }
                    handleDone();
                });
            }
        } catch {
            cleanup();
            handleDone();
        }
    }, [resolveBlockingEffect, onNotification]);

    const playEffectAudioBlocking = useCallback((payload: EffectPayload) => {
        return new Promise<void>((resolve) => {
            const previous = pendingEffectBlockingRef.current;
            if (previous) {
                try {
                    previous.resolve();
                } catch {
                    // ignore
                }
            }

            if (!audioUnlockedRef.current) {
                pendingEffectBlockingRef.current = {
                    payload: { ...payload, loop: false },
                    resolve
                };
                onNotification('Tocca Play/Steps o Attiva Bussola (o interagisci con la mappa) per attivare l\'audio');
                setTimeout(() => onNotification(null), 4000);
                return;
            }

            pendingEffectBlockingRef.current = null;
            startEffectPlaybackBlocking({ ...payload, loop: false }, resolve);
        });
    }, [startEffectPlaybackBlocking, onNotification]);

    const playEffectAudio = useCallback((payload: EffectPayload) => {
        if (blockingEffectResolveRef.current) return;
        if (pendingEffectBlockingRef.current) return;

        if (!audioUnlockedRef.current) {
            pendingEffectAudioRef.current = payload;
            onNotification('Tocca Play/Steps o Attiva Bussola (o interagisci con la mappa) per attivare l\'audio');
            setTimeout(() => onNotification(null), 4000);
            return;
        }

        pendingEffectAudioRef.current = null;
        void startEffectPlayback(payload);
    }, [startEffectPlayback, onNotification]);

    const flushPendingAudio = useCallback(() => {
        if (!audioUnlockedRef.current) return;

        const pendingNarration = pendingNarrationAudioRef.current;
        pendingNarrationAudioRef.current = null;
        if (pendingNarration) {
            startAudioPlayback(pendingNarration);
        }

        const pendingBlockingEffect = pendingEffectBlockingRef.current;
        if (pendingBlockingEffect) {
            pendingEffectBlockingRef.current = null;
            startEffectPlaybackBlocking(pendingBlockingEffect.payload, pendingBlockingEffect.resolve);
            return;
        }

        const pendingEffect = pendingEffectAudioRef.current;
        pendingEffectAudioRef.current = null;
        if (pendingEffect) {
            void startEffectPlayback(pendingEffect);
        }
    }, [startAudioPlayback, startEffectPlayback, startEffectPlaybackBlocking]);

    const playAudio = useCallback((payload: AudioPayload) => {
        if (!audioUnlockedRef.current) {
            pendingNarrationAudioRef.current = payload;
            onNotification('Tocca Play/Steps o Attiva Bussola (o interagisci con la mappa) per attivare l\'audio');
            setTimeout(() => onNotification(null), 4000);
            return;
        }

        pendingNarrationAudioRef.current = null;
        startAudioPlayback(payload);
    }, [startAudioPlayback, onNotification]);

    const playAudioBlocking = useCallback(async (payload: AudioPayload) => {
        resolveBlockingAudio();
        return new Promise<void>((resolve) => {
            blockingAudioResolveRef.current = resolve;
            playAudio({
                ...payload,
                loop: false
            });
        });
    }, [playAudio, resolveBlockingAudio]);

    const stopAudio = useCallback(() => {
        clearAudioPanelAutoClose();
        if (audioRef.current) {
            try {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                audioRef.current.removeAttribute('src');
                audioRef.current.load();
            } catch {
                // ignore
            }
        }
        resolveBlockingAudio();
        resolveAudioPanelClose();
        audioAutoplayRef.current = false;
        pendingNarrationAudioRef.current = null;
        setAudioIsPlaying(false);
        setAudioCurrentTime(0);
        setAudioDuration(0);
        setActiveAudio(null);
        setAudioPanelCollapsed(false);
    }, [clearAudioPanelAutoClose, resolveAudioPanelClose, resolveBlockingAudio]);

    // Wire up stopAudioRef
    useEffect(() => {
        stopAudioRef.current = stopAudio;
    }, [stopAudio]);

    // Active Audio Effect / Autoplay Logic
    useEffect(() => {
        if (!activeAudio) return;
        const audio = audioRef.current;
        if (!audio) return;

        const normalizedVolume = typeof activeAudio.volume === 'number'
            ? Math.min(1, Math.max(0, activeAudio.volume / 100))
            : 1;

        try {
            audio.src = activeAudio.url;
            audio.loop = !!activeAudio.loop;
            audio.volume = normalizedVolume;
            audio.currentTime = 0;
            audio.load();
        } catch {
            onNotification('Audio non disponibile');
            setTimeout(() => onNotification(null), 4000);
            resolveBlockingAudio();
            resolveAudioPanelClose();
            return;
        }

        if (!audioAutoplayRef.current) return;
        audioAutoplayRef.current = false;

        let playPromise: Promise<void> | undefined;
        try {
            playPromise = audio.play();
        } catch {
            playPromise = undefined;
        }

        playPromise
            ?.then(() => {
            })
            .catch((e: any) => {
                if (e?.name === 'AbortError') {
                    // Retry logic for AbortError
                    const retry = narrationPlayRetryRef.current;
                    const currentUrl = activeAudioRef.current?.url;
                    if (
                        retry &&
                        retry.url === activeAudio.url &&
                        currentUrl === activeAudio.url &&
                        retry.attempts < 1
                    ) {
                        retry.attempts += 1;
                        narrationPlayRetryRef.current = retry;
                        window.setTimeout(() => {
                            const stillCurrent = activeAudioRef.current?.url === activeAudio.url;
                            const el = audioRef.current;
                            const stillMounted = !!el && document.contains(el);
                            if (!stillCurrent || !stillMounted) return;
                            try {
                                void el!.play().catch(() => {
                                });
                            } catch {
                            }
                        }, 150);
                        return;
                    }

                    // If we can't/shouldn't retry, don't leave blocking callers hanging.
                    resolveBlockingAudio();
                    resolveAudioPanelClose();
                }
                if (e?.name === 'NotAllowedError') {
                    pendingNarrationAudioRef.current = {
                        url: activeAudio.url,
                        objectName: activeAudio.name,
                        objectId: activeAudio.objectId,
                        transcription: activeAudio.transcription,
                        loop: activeAudio.loop,
                        volume: activeAudio.volume,
                        panelAutoCloseAfterEndedMs: activeAudio.panelAutoCloseAfterEndedMs
                    };
                    onNotification('Audio bloccato: tocca Play/Steps, Attiva Bussola o la mappa per abilitare l\'audio');
                    audioUnlockedRef.current = false;
                    setTimeout(() => onNotification(null), 4000);
                    resolveBlockingAudio();
                    resolveAudioPanelClose();
                } else if (e?.name === 'NotSupportedError') {
                    onNotification('Audio non supportato o non disponibile');
                    setTimeout(() => onNotification(null), 4000);
                    resolveBlockingAudio();
                    resolveAudioPanelClose();
                } else {
                    // Unknown playback failure; avoid deadlocking blocking timeline steps.
                    resolveBlockingAudio();
                    resolveAudioPanelClose();
                }
            });
    }, [activeAudio, onNotification, resolveAudioPanelClose, resolveBlockingAudio]);


    return {
        state: {
            activeAudio,
            isPlaying: audioIsPlaying,
            currentTime: audioCurrentTime,
            duration: audioDuration,
            isPanelCollapsed: audioPanelCollapsed,
            setPanelCollapsed: setAudioPanelCollapsed,
            effectPlaybackRate,
            isEffectPlaying
        },
        controls: {
            unlockAudio,
            playAudio,
            playAudioBlocking,
            stopAudio,
            playEffectAudio,
            playEffectAudioBlocking,
            stopEffectAudio,
            waitForAudioPanelClose,
            flushPendingAudio,
            audioCurrentTime,
            setEffectPlaybackRate,
            cycleEffectPlaybackRate
        },
        refs: {
            audioRef,
            effectAudioRef,
            audioUnlockedRef,
            activeEffectRef,
            stopAudioRef,
            stopEffectAudioRef
        },
        handlers: {
            onTimeUpdate: handleAudioTimeUpdate,
            onPlay: handleAudioPlay,
            onPause: handleAudioPause,
            onEnded: handleAudioEnded,
            onLoadedMetadata: handleAudioLoadedMetadata,
            onError: handleAudioError
        }
    };
};
