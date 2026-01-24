'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTeamSync } from '@/context/TeamSyncContext';
import { useQuestAudio } from '@/context/QuestAudioContext';
import { ANCESTORS, getAncestor } from './ancestors';

// Configuration
const VIDEO_2_ID = '5cfadee7a3c914547ac08a0d73677ec6';
const CUSTOMER_CODE = 'customer-yshabc4ttf2nlnnu';
const STREAM_POSTER_HEIGHT_PX = 600;
const INTRO_BACKGROUND_IMAGE_URL =
    'https://imagedelivery.net/PLjImLTp3_--j_ey0SPDBA/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20251227-174758-06ec1ee1.jpg/public';

function buildStreamPosterUrl(videoId: string) {
    return `https://${CUSTOMER_CODE}.cloudflarestream.com/${videoId}/thumbnails/thumbnail.jpg?time=&height=${STREAM_POSTER_HEIGHT_PX}`;
}

function buildStreamIframeSrc(videoId: string, opts: { muted: boolean }) {
    const params = new URLSearchParams();
    params.set('muted', opts.muted ? 'true' : 'false');
    params.set('preload', 'true');
    params.set('autoplay', 'true');
    params.set('poster', buildStreamPosterUrl(videoId));
    params.set('analytics', 'false');
    params.set('dnt', 'true');
    return `https://${CUSTOMER_CODE}.cloudflarestream.com/${videoId}/iframe?${params.toString()}`;
}

declare global {
    interface Window {
        Stream?: (iframe: HTMLIFrameElement) => {
            addEventListener: (event: string, callback: () => void) => void;
            removeEventListener?: (event: string, callback: () => void) => void;
            play: () => Promise<void>;
            pause?: () => Promise<void> | void;
            muted: boolean;
            volume: number;
        };
    }
}

interface IntroductionProps {
    playerName: string;
    onComplete: () => void;
    unlockAudio: () => Promise<void> | Promise<boolean>;
    audioUrl: string;
}

export default function Introduction({ playerName, onComplete, unlockAudio, audioUrl }: IntroductionProps) {
    const { team, session } = useTeamSync();
    const { duration, currentTime, playBackgroundAudio, stopBackgroundAudio } = useQuestAudio();
    const [step, setStep] = useState<'VIDEO' | 'TEXT'>('VIDEO');

    const introText = useMemo(() => {
        if (!playerName.trim()) return '';

        const nameParts = playerName.trim().split(' ');
        const userFirstName = nameParts[0];
        const userSurname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : playerName;

        let ancestor = ANCESTORS[0];
        if (team && session) {
            ancestor = getAncestor(session.sessionId, team.members);
        }

        return `Gentile ${userFirstName} ${ancestor.name} (${userSurname}),

vi è stato concesso l’accesso a un **portale temporale** unico — un fenomeno rarissimo, scoperto dai ricercatori del **Museo delle Grigne** durante le esplorazioni delle **grotte carsiche del sistema Releccio**, la **seconda più profonda rete carsica d’Italia**.
Nei pressi della cosiddetta **Porta di Prada** è stato registrato un **potente picco energetico**, probabilmente causato da una fortissima concentrazione emotiva in una specifica zona di questo arco naturale di roccia calcarea — evento che, a quanto pare, si sta verificando proprio nelle ultime ore.
È sorprendente notare che, secondo le leggende locali, la **Porta di Prada** fosse considerata un passaggio verso il mondo sotterraneo. E sembra che non si tratti soltanto di una leggenda.

Questo portale si attiva **solo per coloro le cui radici sono legate a Esino Lario**
e **solo in presenza di un forte sbalzo energetico**, generato da un intenso stato emotivo concentrato in un punto preciso — condizione che, come detto, risulta attiva in questo momento.

I nostri sistemi hanno stabilito che lei è un discendente di Daniela ${ancestor.name}, che nel ${ancestor.year} fuggì in ${ancestor.country} per scappare dalla ${ancestor.occupation}, contro la quale aveva cercato di combattere a lungo.

Temendo ulteriori persecuzioni, il suo antenato cambiò il proprio cognome originale ${ancestor.name} con quello che lei ha indicato al momento della registrazione (${userSurname}).

Ora vi viene offerta un’opportunità — e allo stesso tempo una responsabilità:
**attraversare il portale temporale e tornare all’anno 1926,**
per prevenire una tragedia che potrebbe portare alla scomparsa del villaggio di **Esino Lario.**`;
    }, [playerName, team, session]);

    // Video State
    const [videoSoundEnabled, setVideoSoundEnabled] = useState(false);
    const videoIframeRef = useRef<HTMLIFrameElement>(null);
    const videoPlayerRef = useRef<ReturnType<NonNullable<typeof window.Stream>> | null>(null);
    const soundAutoAttemptedRef = useRef(false);

    // Text State
    const [visibleChars, setVisibleChars] = useState(0);
    const [isTyping, setIsTyping] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);
    const introContainerRef = useRef<HTMLDivElement>(null);

    const goToText = useCallback(() => {
        setVisibleChars(0);
        setIsTyping(true);
        setStep('TEXT');
    }, [setVisibleChars, setIsTyping, setStep]);

    // Parse logic
    const parseText = (text: string) => {
        const lines = text.split('\n');
        return lines.map(line => {
            const parts = line.split(/(\*\*.*?\*\*)/g);
            return parts.map(part => {
                if (part.startsWith('**') && part.endsWith('**')) {
                    return { text: part.slice(2, -2), bold: true };
                }
                return { text: part, bold: false };
            }).filter(p => p.text.length > 0);
        });
    };

    const parsedLines = parseText(introText);

    // Calculate total content length (ignoring markdown chars)
    const lineLengths = parsedLines.map(line => line.reduce((lAcc, seg) => lAcc + seg.text.length, 0));
    const totalLength = lineLengths.reduce((acc, length) => acc + length, 0);
    const lineStartOffsets = (() => {
        const offsets: number[] = [];
        let offset = 0;
        for (const length of lineLengths) {
            offsets.push(offset);
            offset += length;
        }
        return offsets;
    })();

    const enableSoundForVideo = useCallback(() => {
        const iframe = videoIframeRef.current;
        if (!iframe || !window.Stream) return;

        const player = videoPlayerRef.current ?? window.Stream(iframe);
        videoPlayerRef.current = player;

        try {
            unlockAudio().catch(() => { });
        } catch { }

        try { player.muted = false; } catch { }
        try { player.volume = 0.5; } catch { }

        void player.play().then(
            () => {
                setTimeout(() => {
                    const isUnmuted = (() => {
                        try { return !player.muted && player.volume > 0; }
                        catch { return false; }
                    })();
                    setVideoSoundEnabled(isUnmuted);
                }, 50);
            },
            () => {
                setVideoSoundEnabled(false);
            }
        );
    }, [unlockAudio]);

    // Auto-enable sound
    useEffect(() => {
        if (soundAutoAttemptedRef.current) return;

        soundAutoAttemptedRef.current = true;
        const timer = window.setTimeout(() => enableSoundForVideo(), 500);
        return () => window.clearTimeout(timer);
    }, [enableSoundForVideo]);

    // Attach Video Listeners
    useEffect(() => {
        if (step === 'VIDEO' && videoIframeRef.current && window.Stream) {
            try {
                const player = window.Stream(videoIframeRef.current);
                videoPlayerRef.current = player;

                const onEnded = () => {
                    goToText();
                };

                const onError = (e?: any) => {
                    console.error('[Introduction] Transition video error:', e);
                    goToText();
                };

                player.addEventListener('ended', onEnded);
                player.addEventListener('error', onError);

                player.play().catch(e => {
                    console.warn('[Introduction] Transition auto-play failed:', e);
                });

                return () => {
                    try {
                        player.removeEventListener?.('ended', onEnded);
                        player.removeEventListener?.('error', onError);
                    } catch { }
                };
            } catch (e) {
                console.error('[Introduction] Stream SDK init failed', e);
                window.setTimeout(() => goToText(), 0); // Fallback
            }
        }
    }, [step, goToText]);

    // --- AUDIO SYNCED TEXT REVEAL ---

    // 1. Trigger audio when entering TEXT step
    useEffect(() => {
        if (step === 'TEXT') {
            console.log('[Introduction] Entering TEXT step - starting audio');

            // Unlock first just in case
            unlockAudio().catch(() => { });

            playBackgroundAudio({
                url: audioUrl,
                loop: false, // Don't loop narration
                volume: 100,
                continueIfAlreadyPlaying: false // Restart synchronization
            }).catch(e => console.warn('[Introduction] Failed to play sync audio', e));
        }
    }, [step, audioUrl, playBackgroundAudio, unlockAudio]);

    // 2. Stream text at a fixed readable speed (characters per second)
    const CHARS_PER_SECOND = 30; // 30 chars/s (half speed)

    useEffect(() => {
        if (step !== 'TEXT') return;
        if (!isTyping || totalLength === 0) return;

        const interval = setInterval(() => {
            setVisibleChars(prev => {
                // ~30 updates per second (33ms)
                // Increment = 30 / 30 = 1 char per tick => 30 chars/sec
                const next = prev + 1;
                if (next >= totalLength) {
                    setIsTyping(false);
                    clearInterval(interval);
                    return totalLength;
                }
                return next;
            });
        }, 33); // 33ms = ~30 updates per second

        return () => clearInterval(interval);
    }, [step, totalLength, isTyping]); // eslint-disable-line react-hooks/exhaustive-deps

    // Cleanup audio on unmount or complete
    useEffect(() => {
        return () => {
            // Optional: stop audio if they leave mid-intro?
            // stopBackgroundAudio();
            // Actually, page logic might want to keep it or switch it.
            // page.tsx switches to map, which plays map audio.
        };
    }, []);


    // Track if user has manually scrolled away
    const userScrolledAwayRef = useRef(false);
    const lastAutoScrollRef = useRef(0);

    // Detect manual scroll
    useEffect(() => {
        if (step !== 'TEXT' || !introContainerRef.current) return;

        const container = introContainerRef.current;
        const handleScroll = () => {
            // If this scroll happened right after auto-scroll, ignore it
            if (Date.now() - lastAutoScrollRef.current < 100) return;

            const { scrollTop, scrollHeight, clientHeight } = container;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            // User scrolled away if they're more than 200px from bottom
            userScrolledAwayRef.current = distanceFromBottom > 200;
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [step]);

    // Auto-scroll to follow streaming text
    useEffect(() => {
        if (step !== 'TEXT') return;
        if (!isTyping) return; // Stop auto-scrolling when typing is done
        if (userScrolledAwayRef.current) return; // Respect user's scroll position

        if (scrollRef.current) {
            lastAutoScrollRef.current = Date.now();
            scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [visibleChars, step, isTyping]);


    if (step === 'TEXT') {
        return (
            <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black animate-fade-in">
                <img
                    src={INTRO_BACKGROUND_IMAGE_URL}
                    alt=""
                    className="border-none w-full h-full object-cover"
                />
                <div ref={introContainerRef} className="absolute inset-0 flex flex-col items-center overflow-y-auto">
                    <div className="w-1/2 my-auto py-24 space-y-8 font-mono leading-relaxed text-lg md:text-xl text-white">
                        {parsedLines.map((lineSegments, i) => {
                            const lineOffset = lineStartOffsets[i] ?? 0;
                            return (
                                <p key={i} className="min-h-[1em] drop-shadow-md">
                                    {lineSegments.map((seg, j) => {
                                        const segmentPrefix = lineSegments.slice(0, j).reduce((sum, s) => sum + s.text.length, 0);
                                        const segmentStart = lineOffset + segmentPrefix;
                                        const remaining = visibleChars - segmentStart;
                                        if (remaining <= 0) return null;

                                        const textToShow = seg.text.slice(0, Math.min(seg.text.length, remaining));

                                        return (
                                            <span key={j} className={seg.bold ? 'font-bold text-yellow-500' : ''}>
                                                {textToShow}
                                            </span>
                                        );
                                    })}
                                </p>
                            );
                        })}
                        <div ref={scrollRef} />
                        {!isTyping && (
                            <div className="pt-8 flex justify-center animate-fade-in">
                                <button
                                    onClick={() => {
                                        unlockAudio().catch(() => { });
                                        onComplete();
                                    }}
                                    className="rounded-full bg-white text-black px-8 py-3 font-bold hover:bg-gray-200 transition-colors"
                                >
                                    Accetta di aprire il portale temporale
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                {isTyping && (
                    <button onClick={() => {
                        unlockAudio().catch(() => { });
                        setIsTyping(false);
                        setVisibleChars(totalLength);
                        // Also jump audio to end?
                        // For now just show all text. Audio will keep playing or end naturally.
                    }} className="absolute bottom-8 right-8 z-[70] text-gray-500 hover:text-white text-sm bg-black/50 px-3 py-1 rounded">Skip Animation</button>
                )}
            </div>
        );
    }
    // ... (rest of render)

    return (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black animate-fade-in">
            <iframe
                ref={videoIframeRef}
                src={buildStreamIframeSrc(VIDEO_2_ID, { muted: false })}
                className="border-none w-full h-full object-cover"
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                allowFullScreen={true}
            ></iframe>
            {!videoSoundEnabled && (
                <button
                    onClick={() => void enableSoundForVideo()}
                    className="absolute bottom-12 left-8 z-[70] bg-white/10 hover:bg-white/20 backdrop-blur-md text-white/80 px-4 py-2 rounded-full text-sm font-medium transition-all border border-white/10 hover:scale-105 active:scale-95"
                >
                    Enable Sound
                </button>
            )}
            <button
                onClick={() => goToText()}
                className="absolute bottom-12 right-8 z-[70] bg-white/10 hover:bg-white/20 backdrop-blur-md text-white/80 px-4 py-2 rounded-full text-sm font-medium transition-all border border-white/10 hover:scale-105 active:scale-95"
            >
                Skip →
            </button>
        </div>
    );
}
