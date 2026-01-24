'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuest } from '@/context/QuestContext';
import { useTeamSync } from '@/context/TeamSyncContext';
import { useQuestSession } from '@/lib/useQuestSession';
import { useQuestAudio } from '@/context/QuestAudioContext';
import Script from 'next/script';
import RegistrationView from '../../components/RegistrationView';
import { ANCESTORS, getAncestor } from './ancestors';
import Introduction from './Introduction';

// Configuration
// Force rebuild to clear cache - 2026-01-23T07:00:00Z
const VIDEO_ID = '5927e58c7d91e46b39f8b3a80fbaa363';
const VIDEO_2_ID = '5cfadee7a3c914547ac08a0d73677ec6';
const STREAMING_AUDIO_URL =
  'https://pub-877f23628132452cb9b12cf3cf618c69.r2.dev/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20260123-014953-0a06e271.mp3';
const SILENT_AUDIO_URL = '/audio/silence.mp3'; // Hosted silence file for Safari unlock
const CUSTOMER_CODE = 'customer-yshabc4ttf2nlnnu';

const STREAM_SDK_SRC = 'https://embed.cloudflarestream.com/embed/sdk.latest.js';


const LANDING_BACKGROUND_IMAGE_URL =
  'https://imagedelivery.net/PLjImLTp3_--j_ey0SPDBA/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20251206-170129-f585b661.jpg/public';
const LANDING_BACKGROUND_IMAGE_CSS = `url('${LANDING_BACKGROUND_IMAGE_URL}')`;

const INITIAL_INTRO_IMAGE_URL =
  'https://imagedelivery.net/PLjImLTp3_--j_ey0SPDBA/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20260104-151658-6bd79ee8.webp/public';



const INITIAL_IMAGE_VISIBLE_MS = 10_000;
const INITIAL_IMAGE_FADE_MS = 1_600;

const STREAM_POSTER_HEIGHT_PX = 600;

function buildStreamPosterUrl(videoId: string) {
  return `https://${CUSTOMER_CODE}.cloudflarestream.com/${videoId}/thumbnails/thumbnail.jpg?time=&height=${STREAM_POSTER_HEIGHT_PX}`;
}

function buildStreamIframeSrc(videoId: string, opts: { muted: boolean }) {
  const params = new URLSearchParams();
  params.set('muted', opts.muted ? 'true' : 'false');
  params.set('preload', 'true');
  params.set('autoplay', 'true');
  params.set('poster', buildStreamPosterUrl(videoId));
  // Attempt to disable analytics beacons
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

type PageState = 'INITIAL_IMAGE' | 'SPLASH' | 'VIDEO' | 'REGISTRATION' | 'INTRO';

export default function LandingPage() {
  const { data } = useQuest();
  const router = useRouter();
  const { createSession, createTeam, joinTeam } = useQuestSession();
  const teamSync = useTeamSync();
  const { unlockBackgroundAudio, playBackgroundAudio, stopBackgroundAudio, isBackgroundLocked, isBackgroundPlaying } = useQuestAudio();

  const [state, setState] = useState<PageState>('INITIAL_IMAGE');
  const [playerName, setPlayerName] = useState('');

  // UX State
  const [isTitleLeaving, setIsTitleLeaving] = useState(false);
  const [isIntroImageFading, setIsIntroImageFading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const introImageAutoAdvanceTimeoutRef = useRef<number | null>(null);
  const introImageExitTimeoutRef = useRef<number | null>(null);
  const introImageExitStartedRef = useRef(false);

  // Registration Form State
  const [isTeam, setIsTeam] = useState(false);
  const [teamSize, setTeamSize] = useState('2');
  const [accessCode, setAccessCode] = useState('');
  // const [hasCode, setHasCode] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Video State
  const [isSdkLoaded, setIsSdkLoaded] = useState(false);
  const videoPlayerRef = useRef<ReturnType<NonNullable<typeof window.Stream>> | null>(null);
  const [videoSoundEnabled, setVideoSoundEnabled] = useState(false);

  const clearIntroImageTimeout = (timeoutRef: React.MutableRefObject<number | null>) => {
    if (!timeoutRef.current) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  };

  const startIntroImageExit = () => {
    if (introImageExitStartedRef.current) return;
    introImageExitStartedRef.current = true;
    clearIntroImageTimeout(introImageAutoAdvanceTimeoutRef);
    setIsIntroImageFading(true);
    clearIntroImageTimeout(introImageExitTimeoutRef);
    introImageExitTimeoutRef.current = window.setTimeout(() => {
      setState('SPLASH');
      setIsIntroImageFading(false);
    }, INITIAL_IMAGE_FADE_MS);
  };

  const enableSoundForVideo = () => {
    const iframe = iframeRef.current;
    if (!iframe || !window.Stream) return;

    const player = videoPlayerRef.current ?? window.Stream(iframe);
    videoPlayerRef.current = player;

    // NOTE: keep this synchronous; awaiting anything before `play()` can lose the user activation
    // needed for unmuted playback on iOS/Safari.
    try {
      unlockBackgroundAudio().catch(() => {
        // ignore - video unmute doesn't depend on HTMLAudioElement unlock
      });
    } catch {
      // ignore
    }

    try {
      player.muted = false;
    } catch {
      // ignore
    }
    try {
      player.volume = 0.5;
    } catch {
      // ignore
    }

    void player.play().then(
      () => {
        window.setTimeout(() => {
          const isUnmuted = (() => {
            try {
              return !player.muted && player.volume > 0;
            } catch {
              return false;
            }
          })();
          setVideoSoundEnabled(isUnmuted);
        }, 50);
      },
      () => {
        setVideoSoundEnabled(false);
      },
    );
  };

  useEffect(() => {
    if (state === 'VIDEO') setVideoSoundEnabled(false);
  }, [state]);


  // --- PHASE 0: INITIAL IMAGE ---
  useEffect(() => {
    if (state === 'INITIAL_IMAGE') {
      introImageExitStartedRef.current = false;
      setIsIntroImageFading(false);
      clearIntroImageTimeout(introImageAutoAdvanceTimeoutRef);
      clearIntroImageTimeout(introImageExitTimeoutRef);
      introImageAutoAdvanceTimeoutRef.current = window.setTimeout(() => {
        startIntroImageExit();
      }, INITIAL_IMAGE_VISIBLE_MS);

      return () => {
        clearIntroImageTimeout(introImageAutoAdvanceTimeoutRef);
        clearIntroImageTimeout(introImageExitTimeoutRef);
      };
    }
  }, [state]);

  // --- PHASE 1: SPLASH ---
  useEffect(() => {
    if (state === 'SPLASH') {
      const timer = setTimeout(() => {
        setState('VIDEO');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  // --- VIDEO LISTENERS (Robust) ---
  // Fallback for Main Video
  useEffect(() => {
    if (state === 'VIDEO') {
      const timer = setTimeout(() => {
        handleVideoEnded();
      }, 45000); // Reduce to 45s fallback (was 3m)
      return () => clearTimeout(timer);
    }
  }, [state]);

  // Handle SDK Load
  const handleSdkLoad = () => {
    setIsSdkLoaded(true);
  };

  // Attach Listener for Main Video
  useEffect(() => {
    if (state === 'VIDEO' && isSdkLoaded && iframeRef.current && window.Stream) {
      try {
        const player = window.Stream(iframeRef.current);
        videoPlayerRef.current = player;

        const onEnded = () => {
          handleVideoEnded();
        };

        const onError = (e?: any) => {
          console.error('[page.tsx] Video playback error:', e);
          // Fallback to end video so we don't hang
          handleVideoEnded();
        };

        player.addEventListener('ended', onEnded);
        player.addEventListener('error', onError);

        player.play().catch(e => {
          console.warn('[page.tsx] Auto-play failed:', e);
          // If we can't play, we might want to show "enable sound" or just wait.
          // But if it's a critical error (like Access Denied), the 'error' event might fire?
          // Actually, play() promise rejection is usually for autoplay policy.
          // 'error' event is for media loading failures.
        });

        return () => {
          try {
            player.removeEventListener?.('ended', onEnded);
            player.removeEventListener?.('error', onError);
          } catch { }
        };
      } catch (e) {
        console.error('[page.tsx] Stream SDK init failed', e);
        // Force advance if SDK crashes
        handleVideoEnded();
      }
    }
  }, [state, isSdkLoaded]);


  // --- HANDLERS ---
  const handleVideoEnded = () => {
    setIsTitleLeaving(true);
    setTimeout(() => {
      setState('REGISTRATION');
      setTimeout(() => setShowForm(true), 200);
    }, 3000);
  };


  // Hook to handle INTRO state and ensure audio is playing
  // MOVED TO: Introduction.tsx


  const handleStartAdventure = async (nameOverride?: string) => {
    // Just switch state, Introduction component handles logic
    setState('INTRO');
  };

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    if (state !== 'REGISTRATION') return;
    if (!teamSync.session || !teamSync.team) return;
    if (!teamSync.team.startedAt) return;
    startedRef.current = true;
    handleStartAdventure();
  }, [state, teamSync.session, teamSync.team]);

  const handleRegistrationComplete = async (name: string, mode: 'solo' | 'team', code?: string, action?: 'create' | 'join') => {
    console.log('[page.tsx] handleRegistrationComplete - attempting audio unlock on user gesture');

    // --- FIX: Await Unlock First ---
    // We must ensure the context is unlocked BEFORE calling playBackgroundAudio.
    // Otherwise playBackgroundAudio just queues it if locked.
    try {
      await unlockBackgroundAudio();
      console.log('[page.tsx] Audio Context explicitly unlocked');
    } catch (e) {
      console.warn('[page.tsx] Explicit unlock failed (continuing anyway)', e);
    }

    // Detect Safari (iOS or macOS)
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    console.log('[page.tsx] Browser detection:', { isSafari, userAgent: navigator.userAgent });

    // Safari-specific unlock strategy: Use hosted silence file
    if (isSafari) {
      try {
        console.log('[page.tsx] Safari detected - unlocking with hosted silence file');
        await playBackgroundAudio({
          url: SILENT_AUDIO_URL,
          loop: false,
          volume: 50, // Audible volume to ensure Safari loads it
          continueIfAlreadyPlaying: false,
        });
        console.log('[page.tsx] Silent audio unlock successful');

        // Small delay to allow silence to complete (Safari needs this)
        await new Promise(resolve => setTimeout(resolve, 100));

        // Now switch to the actual background music at audible volume
        console.log('[page.tsx] Switching to background music at volume 100');
        await playBackgroundAudio({
          url: STREAMING_AUDIO_URL,
          loop: true,
          volume: 100, // Higher initial volume forces Safari to load metadata
          continueIfAlreadyPlaying: false,
        });
        console.log('[page.tsx] Background music started');
      } catch (e) {
        console.warn('[page.tsx] Safari audio unlock/prime failed', e);
      }
    } else {
      // Non-Safari: Direct playback at audible volume
      try {
        console.log('[page.tsx] Non-Safari - starting background music directly at volume 100');
        await playBackgroundAudio({
          url: STREAMING_AUDIO_URL,
          loop: true,
          volume: 100, // Higher initial volume ensures proper loading
          continueIfAlreadyPlaying: false,
        });
        console.log('[page.tsx] Background music started');
      } catch (e) {
        console.warn('[page.tsx] Audio prime failed', e);
      }
    }
    console.log('[page.tsx] handleRegistrationComplete START', { name, mode, code, action });
    setPlayerName(name);
    setIsTeam(mode === 'team');
    // setIsTeam(mode === 'team'); // Duplicate removed
    if (code) setAccessCode(code);

    try {
      const questId = data?.quest?.id;
      console.log('[page.tsx] questId from data:', questId);
      if (!questId) {
        throw new Error('Quest data missing quest.id (questId required for registration)');
      }

      if (mode === 'solo') {
        console.log('[page.tsx] Solo mode - calling createSession', { name, questId });
        const session = await createSession(name, questId);
        console.log('[page.tsx] createSession returned:', session);
        if (session.sessionId) {
          console.log('[page.tsx] Session created successfully, calling handleStartAdventure');
          handleStartAdventure(name);
        } else {
          throw new Error('Session creation failed (no sessionId)');
        }
      } else if (mode === 'team') {
        console.log('[page.tsx] Team mode', { action });
        if (action === 'create') {
          if (!code) throw new Error('Missing team code (generate a code first)');
          setAccessCode(code);
        } else if (action === 'join' && code) {
          console.log('[page.tsx] Joining team with code:', code);
          const result = await joinTeam(code, name, questId);
          console.log('[page.tsx] joinTeam returned:', result);
          setAccessCode(result.teamCode);
        }
      }
    } catch (e: any) {
      console.error('[page.tsx] Registration failed', e);
    }
  };

  const handleCreateTeamCode = async (name: string) => {
    const questId = data?.quest?.id;
    if (!questId) throw new Error('Quest data missing quest.id (questId required for team creation)');
    const expectedPlayers = Number(teamSize) || 2;
    const team = await createTeam(name, questId, expectedPlayers, `${name}'s Team`);
    setAccessCode(team.teamCode);
    return team.teamCode;
  };

  // const skipIntro = () => {
  //   router.push('/map');
  // };
  // The skipIntro function is no longer used as the INTRO button now routes directly to /map
  // const skipIntro = () => {
  //   router.push('/map');
  // };

  if (!data) return null;

  // --- RENDERERS ---

  if (state === 'INTRO') {
    return (
      <Introduction
        playerName={playerName}
        onComplete={() => {
          unlockBackgroundAudio().catch(() => { });
          router.push('/map');
        }}
        unlockAudio={unlockBackgroundAudio}
        audioUrl={STREAMING_AUDIO_URL}
      />
    );
  }

  return (
    <main className="fixed inset-0 min-h-screen bg-black overflow-hidden bg-cover bg-center" style={{ backgroundImage: LANDING_BACKGROUND_IMAGE_CSS }}>
      <Script
        src={STREAM_SDK_SRC}
        strategy="afterInteractive"
        onLoad={handleSdkLoad}
      />

      {/* INITIAL INTRO IMAGE */}
      {state === 'INITIAL_IMAGE' && (
        <div
          className={`absolute inset-0 z-[100] flex items-center justify-center bg-black transition-opacity ${isIntroImageFading ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          style={{
            transitionDuration: `${INITIAL_IMAGE_FADE_MS}ms`,
            transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)'
          }}
        >
          <img
            src={INITIAL_INTRO_IMAGE_URL}
            alt="Intro"
            className={`
              w-auto h-auto max-w-[95vw] max-h-[80vh] object-contain
              sm:max-w-[90vw] sm:max-h-[90vh]
              md:max-w-[85vw] md:max-h-[85vh]
              lg:max-w-[80vw] lg:max-h-[80vh]
              xl:max-w-[75vw] xl:max-h-[75vh]
              transition-[transform,filter] ${isIntroImageFading ? 'scale-[0.985] blur-[1.5px]' : 'scale-100 blur-0'
              }`}
            style={{
              transitionDuration: `${INITIAL_IMAGE_FADE_MS}ms`,
              transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)'
            }}
          />
          {!isIntroImageFading && (
            <button
              type="button"
              onClick={() => {
                unlockBackgroundAudio().catch(() => { });
                startIntroImageExit();
              }}
              className="absolute bottom-10 right-6 z-[110] bg-white/10 hover:bg-white/20 backdrop-blur-md text-white/90 px-5 py-2.5 rounded-full text-sm font-medium transition-all border border-white/10 hover:scale-[1.03] active:scale-[0.98] shadow-lg"
            >
              Next →
            </button>
          )}
        </div>
      )}

      {/* Dark Overlay */}
      <div className="absolute inset-0 bg-black/40 z-10 transition-opacity duration-1000 pointer-events-none" style={{ opacity: state === 'VIDEO' ? 0.3 : 0.7 }} />

      {/* TITLE OVERLAY */}
      {(state === 'SPLASH' || state === 'VIDEO' || state === 'REGISTRATION') && (
        <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none transition-all duration-[1500ms] ease-in-out transform ${isTitleLeaving ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}
          style={{ display: (state === 'REGISTRATION' && showForm && isTitleLeaving) ? 'none' : 'flex' }}
        >
          <div className="text-center space-y-4 drop-shadow-2xl px-4">
            <h1 className="text-5xl md:text-7xl font-bold tracking-wider font-serif text-white">The Oath of Two Villages</h1>
            <p className="text-2xl md:text-3xl font-light tracking-[0.5em] uppercase text-gray-100">Esino Lario</p>
          </div>
        </div>
      )}

      {/* VIDEO 1 (Loop) */}
      {state === 'VIDEO' && (
        <div className="absolute inset-0 z-0 flex items-center justify-center animate-fade-in">
          <iframe
            ref={iframeRef}
            src={buildStreamIframeSrc(VIDEO_ID, { muted: false })}
            className="border-none w-full h-full object-cover"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
            allowFullScreen={true}
          ></iframe>
        </div>
      )}

      {/* Skip Video 1 Button */}
      {state === 'VIDEO' && (
        <>
          {!videoSoundEnabled && (
            <button
              onClick={() => void enableSoundForVideo()}
              className="absolute bottom-12 left-8 z-[60] bg-white/10 hover:bg-white/20 backdrop-blur-md text-white/80 px-4 py-2 rounded-full text-sm font-medium transition-all border border-white/10 hover:scale-105 active:scale-95"
            >
              Enable Sound
            </button>
          )}
          <button
            onClick={handleVideoEnded}
            className="absolute bottom-12 right-8 z-[60] bg-white/10 hover:bg-white/20 backdrop-blur-md text-white/80 px-4 py-2 rounded-full text-sm font-medium transition-all border border-white/10 hover:scale-105 active:scale-95"
          >
            Skip Video →
          </button>
        </>
      )}

      {/* REGISTRATION FORM */}
      {state === 'REGISTRATION' && (
        <div className={`absolute inset-0 z-40 transition-all duration-1000 transform ${showForm ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'}`}>
          <RegistrationView onStart={handleRegistrationComplete} onCreateTeamCode={handleCreateTeamCode} />
        </div>
      )}
    </main>
  );
}
