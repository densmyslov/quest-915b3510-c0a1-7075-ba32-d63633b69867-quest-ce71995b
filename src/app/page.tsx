'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuest } from '@/context/QuestContext';
import { useTeamSync } from '@/context/TeamSyncContext';
import { useQuestSession } from '@/lib/useQuestSession';
import { useQuestAudio } from '@/context/QuestAudioContext';
import Script from 'next/script';
import RegistrationView from '../components/RegistrationView';

// Configuration
const VIDEO_ID = '5927e58c7d91e46b39f8b3a80fbaa363';
const VIDEO_2_ID = '5cfadee7a3c914547ac08a0d73677ec6';
const STREAMING_AUDIO_URL =
  'https://pub-877f23628132452cb9b12cf3cf618c69.r2.dev/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20260107-144449-cb354a4c.mp3';
const SILENT_AUDIO_URL = '/audio/silence.mp3'; // Hosted silence file for Safari unlock
const CUSTOMER_CODE = 'customer-yshabc4ttf2nlnnu';

const STREAM_SDK_SRC = 'https://embed.cloudflarestream.com/embed/sdk.latest.js';
const FONT_CORMORANT_GARAMOND_IMPORT_SRC =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&display=swap';

const LANDING_BACKGROUND_IMAGE_URL =
  'https://imagedelivery.net/PLjImLTp3_--j_ey0SPDBA/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20251206-170129-f585b661.jpg/public';
const LANDING_BACKGROUND_IMAGE_CSS = `url('${LANDING_BACKGROUND_IMAGE_URL}')`;

const INITIAL_INTRO_IMAGE_URL =
  'https://imagedelivery.net/PLjImLTp3_--j_ey0SPDBA/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20260104-151658-6bd79ee8.webp/public';

const INTRO_BACKGROUND_IMAGE_URL =
  'https://imagedelivery.net/PLjImLTp3_--j_ey0SPDBA/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20251227-174758-06ec1ee1.jpg/public';

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

type PageState = 'INITIAL_IMAGE' | 'SPLASH' | 'VIDEO' | 'REGISTRATION' | 'TRANSITION_VIDEO' | 'INTRO' | 'MISSION_BRIEF';

export default function LandingPage() {
  const { data } = useQuest();
  const router = useRouter();
  const { createSession, createTeam, joinTeam } = useQuestSession();
  const teamSync = useTeamSync();
  const { unlockBackgroundAudio, playBackgroundAudio, stopBackgroundAudio } = useQuestAudio();

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
  const [hasCode, setHasCode] = useState(false);

  // Intro Logic
  const [introText, setIntroText] = useState('');
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [ancestorData, setAncestorData] = useState({ name: '', year: '' });
  const scrollRef = useRef<HTMLDivElement>(null);
  const introContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const video2IframeRef = useRef<HTMLIFrameElement>(null);

  // Video State
  const [isSdkLoaded, setIsSdkLoaded] = useState(false);
  // Track if Video 2 is loaded
  const [isVideo2SdkReady, setIsVideo2SdkReady] = useState(false);
  const videoPlayerRef = useRef<ReturnType<NonNullable<typeof window.Stream>> | null>(null);
  const transitionVideoPlayerRef = useRef<ReturnType<NonNullable<typeof window.Stream>> | null>(null);
  const [videoSoundEnabled, setVideoSoundEnabled] = useState(false);
  const [transitionVideoSoundEnabled, setTransitionVideoSoundEnabled] = useState(false);
  const transitionSoundAutoAttemptedRef = useRef(false);

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

  const enableSoundForVideo = (which: 'intro' | 'transition') => {
    const iframe = which === 'transition' ? video2IframeRef.current : iframeRef.current;
    if (!iframe || !window.Stream) return;

    const player =
      which === 'transition'
        ? (transitionVideoPlayerRef.current ?? window.Stream(iframe))
        : (videoPlayerRef.current ?? window.Stream(iframe));

    if (which === 'transition') transitionVideoPlayerRef.current = player;
    else videoPlayerRef.current = player;

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
      player.volume = 1;
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
          if (which === 'transition') setTransitionVideoSoundEnabled(isUnmuted);
          else setVideoSoundEnabled(isUnmuted);
        }, 50);
      },
      () => {
        if (which === 'transition') setTransitionVideoSoundEnabled(false);
        else setVideoSoundEnabled(false);
      },
    );
  };

  useEffect(() => {
    if (state === 'VIDEO') setVideoSoundEnabled(false);
    if (state === 'TRANSITION_VIDEO') {
      setTransitionVideoSoundEnabled(false);
      transitionSoundAutoAttemptedRef.current = false;
    }
  }, [state]);

  useEffect(() => {
    if (state !== 'TRANSITION_VIDEO') return;
    if (!isVideo2SdkReady) return;
    if (transitionVideoSoundEnabled) return;
    if (transitionSoundAutoAttemptedRef.current) return;
    transitionSoundAutoAttemptedRef.current = true;
    window.setTimeout(() => enableSoundForVideo('transition'), 0);
  }, [state, isVideo2SdkReady, transitionVideoSoundEnabled]);

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

  // Fallback for Transition Video
  useEffect(() => {
    if (state === 'TRANSITION_VIDEO') {
      const timer = setTimeout(() => {
        handleVideo2Ended();
      }, 15000); // Reduce to 15s fallback (was 3m)
      return () => clearTimeout(timer);
    }
  }, [state]);

  // Handle SDK Load
  const handleSdkLoad = () => {
    setIsSdkLoaded(true);
    setIsVideo2SdkReady(true);
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

  // Attach Listener for Transition Video
  useEffect(() => {
    if (state === 'TRANSITION_VIDEO' && isVideo2SdkReady && video2IframeRef.current && window.Stream) {
      try {
        const player = window.Stream(video2IframeRef.current);
        transitionVideoPlayerRef.current = player;

        const onEnded = () => {
          handleVideo2Ended();
        };

        const onError = (e?: any) => {
          console.error('[page.tsx] Transition video error:', e);
          // Fallback to Intro so we don't hang
          handleVideo2Ended();
        };

        player.addEventListener('ended', onEnded);
        player.addEventListener('error', onError);

        player.play().catch(e => {
          console.warn('[page.tsx] Transition auto-play failed:', e);
        });

        return () => {
          try {
            player.removeEventListener?.('ended', onEnded);
            player.removeEventListener?.('error', onError);
          } catch { }
        };
      } catch (e) {
        console.error('[page.tsx] Stream SDK init failed for transition', e);
        handleVideo2Ended();
      }
    }
  }, [state, isVideo2SdkReady]);

  // --- ANCESTORS DATA ---
  const ANCESTORS = [
    { name: 'Nasazzi', year: '1740', country: 'Uruguay', occupation: 'dominazione austriaca' },
    { name: 'Pensa', year: '1674', country: 'America', occupation: 'dominazione spagnola' },
    { name: 'Barindelli', year: '1700', country: 'Australia', occupation: 'dominazione austriaca' },
    { name: 'Maglia', year: '1620', country: 'Cina', occupation: 'dominazione spagnola' },
    { name: 'Bertarini', year: '1703', country: 'Russia', occupation: 'dominazione austriaca' },
    { name: 'Ferraroli', year: '1717', country: 'Grecia', occupation: 'dominazione spagnola' },
    { name: 'Viglienghi', year: '1790', country: 'Francia', occupation: 'dominazione austriaca' },
    { name: 'Acquistapace', year: '1720', country: 'Sud America', occupation: 'dominazione spagnola' },
    { name: 'Carissimo', year: '1750', country: 'Europa', occupation: 'dominazione austriaca' }, // Fallback/Extra
  ];

  /*
   * Determines the ancestor based on the player's position in the team (join order).
   * - Creator (first member) -> Index 0 -> Nasazzi
   * - Joiner 1 -> Index 1 -> Pensa
   * - ...
   */
  const getAncestor = (currentSessionId: string | undefined, members: any[]) => {
    if (!currentSessionId || !members || members.length === 0) return ANCESTORS[0]; // Default to Nasazzi

    // Sort members by joinedAt to ensure consistent order
    const sortedMembers = [...members].sort((a, b) =>
      new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
    );

    const index = sortedMembers.findIndex(m => m.sessionId === currentSessionId);

    // Safety check: if not found, default to 0
    if (index === -1) return ANCESTORS[0];

    // Modulo to cycle if more than 9 players (unlikely but safe)
    return ANCESTORS[index % ANCESTORS.length];
  };

  // --- TYPEWRITER ---
  useEffect(() => {
    if (!isTyping || !introText) return;
    let index = 0;
    const interval = setInterval(() => {
      setDisplayedText(introText.slice(0, index));
      index++;
      if (index > introText.length) {
        clearInterval(interval);
        setIsTyping(false);
      }
    }, 30);
    return () => clearInterval(interval);
  }, [isTyping, introText]);

  useEffect(() => {
    // Only auto-scroll if user is near the bottom (or if content fits)
    if (scrollRef.current && introContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = introContainerRef.current;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      // Threshold can be adjusted. 100px allows for some leeway.
      // Also scroll if the content is smaller than the container (distanceFromBottom is negative or zero-ish)
      if (distanceFromBottom < 150) {
        scrollRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    } else if (scrollRef.current) {
      // Fallback
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [displayedText]);

  // --- HANDLERS ---
  const handleVideoEnded = () => {
    setIsTitleLeaving(true);
    setTimeout(() => {
      setState('REGISTRATION');
      setTimeout(() => setShowForm(true), 200);
    }, 3000);
  };

  const handleVideo2Ended = () => {
    setState('INTRO');
    setIsTyping(true);
  };

  // Hook to handle INTRO state and ensure audio is playing
  const { isBackgroundPlaying, isBackgroundLocked } = useQuestAudio();
  useEffect(() => {
    if (state === 'INTRO') {
      console.log('[page.tsx] INTRO state - ramping up audio to volume 50');

      // Ensure audio is playing if it stopped or was missed
      if (!isBackgroundPlaying && !isBackgroundLocked) {
        console.log('[page.tsx] Intro check: Audio not playing, forcing play');
        void playBackgroundAudio({
          url: STREAMING_AUDIO_URL,
          loop: true,
          volume: 50,
          continueIfAlreadyPlaying: true,
        }).catch(e => console.warn('[page.tsx] Intro audio force play failed', e));
      } else {
        void playBackgroundAudio({
          url: STREAMING_AUDIO_URL,
          loop: true,
          volume: 50,
          continueIfAlreadyPlaying: true,
        });
      }
    } else if (state === 'MISSION_BRIEF') {
      console.log('[page.tsx] MISSION_BRIEF state - stopping background audio');
      stopBackgroundAudio();
    }
  }, [state, playBackgroundAudio, stopBackgroundAudio, isBackgroundPlaying, isBackgroundLocked]);

  const handleStartAdventure = (nameOverride?: string) => {
    const finalName = nameOverride || playerName;
    if (!finalName.trim()) return;

    // Split Full Name to get First Name (assuming "First Last" or just "First")
    // If only one name is provided, treat it as First Name.
    const nameParts = finalName.trim().split(' ');
    // We assume the user enters "FirstName Surname" or just "FirstName".
    // The prompt implies the user *indicated* a surname at registration, or we treat the whole input as their name?
    // "surname Viglienghi (the surname the player indicates at registration)"
    // So if I register as "Denis", my surname is "Denis"? Or should I ask for First and Last?
    // The current UI likely has one field "Name". Let's assume the last part is the surname if multiple parts,
    // or the whole thing is the surname if one part?
    // "Gentile Denis (nome) Nasazzi (cognome antenato)..."
    // "il suo antenato cambiò il cognome originale con quello che lei ha indicato..."

    const userFirstName = nameParts[0];
    const userSurname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : finalName;

    // Determine Ancestor
    // If solo, I am inevitable index 0 -> Nasazzi.
    // If team, check context.
    let ancestor = ANCESTORS[0]; // Default
    if (teamSync.team && teamSync.session) {
      ancestor = getAncestor(teamSync.session.sessionId, teamSync.team.members);
    } else {
      // Solo mode or before sync: We are effectively the "first" and only one known so far.
      // If we are in 'solo' mode, use index 0.
      ancestor = ANCESTORS[0];
    }

    setAncestorData({ name: ancestor.name, year: ancestor.year }); // Keep state sync if needed for other things, though we use local var now.

    const text = `Gentile ${userFirstName} ${ancestor.name} (${userSurname}),

Le è stato concesso l'accesso a un portale temporale unico — un fenomeno rarissimo scoperto dai ricercatori del Museo delle Grigne durante l'esplorazione delle grotte carsiche del sistema Releccio (la seconda per profondità in Italia).
In una zona della grotta chiamata "Porta di Prada" si è verificato un potente picco energetico, probabilmente causato da una forte ondata emotiva, cosa che apparentemente sta accadendo nelle ultime ore.
È sorprendente notare che, secondo le leggende locali, la Porta di Prada era considerata un passaggio verso il mondo sotterraneo. E sembra che non fosse solo una leggenda.

Questo portale si attiva solo per coloro le cui radici sono legate a Esino Lario.

I nostri sistemi hanno stabilito che lei è un discendente di Daniela ${ancestor.name}, che nel ${ancestor.year} fuggì in ${ancestor.country} per scappare dalla ${ancestor.occupation}, contro la quale aveva cercato di combattere a lungo.

Temendo ulteriori persecuzioni, il suo antenato cambiò il proprio cognome originale ${ancestor.name} con quello che lei ha indicato al momento della registrazione (${userSurname}).

Ora le viene offerta l'opportunità — e allo stesso tempo la responsabilità — di attraversare il portale temporale e trasportarsi nel 1926 per prevenire una tragedia che avrebbe potuto portare alla scomparsa del villaggio di Esino Lario.`;

    setIntroText(text);
    // Transition to Video 2 instead of straight to INTRO
    setState('TRANSITION_VIDEO');
  };

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    if (state !== 'REGISTRATION') return;
    if (!teamSync.session || !teamSync.team) return;
    if (!teamSync.team.startedAt) return;
    startedRef.current = true;
    handleStartAdventure(teamSync.session.playerName);
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
        console.log('[page.tsx] Switching to background music at volume 10');
        await playBackgroundAudio({
          url: STREAMING_AUDIO_URL,
          loop: true,
          volume: 10, // Higher initial volume forces Safari to load metadata
          continueIfAlreadyPlaying: false,
        });
        console.log('[page.tsx] Background music started');
      } catch (e) {
        console.warn('[page.tsx] Safari audio unlock/prime failed', e);
      }
    } else {
      // Non-Safari: Direct playback at audible volume
      try {
        console.log('[page.tsx] Non-Safari - starting background music directly at volume 10');
        await playBackgroundAudio({
          url: STREAMING_AUDIO_URL,
          loop: true,
          volume: 10, // Higher initial volume ensures proper loading
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

  const skipIntro = () => {
    router.push('/map');
  };
  // The skipIntro function is no longer used as the INTRO button now transitions to MISSION_BRIEF
  // const skipIntro = () => {
  //   router.push('/map');
  // };

  if (!data) return null;

  // --- RENDERERS ---

  if (state === 'INTRO') {
    return (
      <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black animate-fade-in">
        <img
          src={INTRO_BACKGROUND_IMAGE_URL}
          alt=""
          className="border-none w-full h-full object-cover"
        />
        <div ref={introContainerRef} className="absolute inset-0 flex flex-col items-center overflow-y-auto">
          <div className="w-1/2 my-auto py-24 space-y-8 font-mono leading-relaxed text-lg md:text-xl text-white">
            {displayedText.split('\n').map((line, i) => (
              <p key={i} className="min-h-[1em] drop-shadow-md">{line}</p>
            ))}
            <div ref={scrollRef} />
            {!isTyping && (
              <div className="pt-8 flex justify-center animate-fade-in">
                <button
                  onClick={() => {
                    unlockBackgroundAudio().catch(() => { });
                    setState('MISSION_BRIEF');
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
            unlockBackgroundAudio().catch(() => { });
            setIsTyping(false);
            setDisplayedText(introText);
          }} className="absolute bottom-8 right-8 z-[70] text-gray-500 hover:text-white text-sm bg-black/50 px-3 py-1 rounded">Skip Animation</button>
        )}
      </div>
    );
  }

  if (state === 'MISSION_BRIEF') {
    // Determine current month in Italian
    const months = [
      'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
      'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
    ];
    const currentMonth = months[new Date().getMonth()];

    return (
      <div style={{
        minHeight: '100vh',
        width: '100%',
        background: 'linear-gradient(180deg, #0a0a12 0%, #1a1a2e 30%, #16213e 60%, #0f3460 100%)',
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        overflow: 'hidden',
        fontFamily: '"Cormorant Garamond", "Times New Roman", serif'
      }}>

        {/* Visual Effects (Fixed) */}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, rgba(94, 53, 177, 0.15) 0%, transparent 70%)', animation: 'pulse 4s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(138, 43, 226, 0.1) 0%, rgba(75, 0, 130, 0.05) 40%, transparent 70%)', borderRadius: '50%', animation: 'portalPulse 3s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 400 400\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")', opacity: 0.03, mixBlendMode: 'overlay' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, 0.6) 100%)', pointerEvents: 'none' }} />

        {/* Scrollable Container */}
        <div style={{
          position: 'absolute',
          inset: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          {/* Centered Content Wrapper */}
          <div className="animate-fade-in" style={{
            margin: 'auto',
            width: '100%',
            maxWidth: '800px',
            paddingTop: '40px',
            paddingBottom: '120px',
            textAlign: 'center',
            position: 'relative',
            zIndex: 10
          }}>

            {/* Decorative top border */}
            <div style={{
              width: '200px',
              height: '2px',
              background: 'linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.6), transparent)',
              margin: '0 auto 30px',
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: '-4px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '10px',
                height: '10px',
                background: 'rgba(255, 215, 0, 0.8)',
                borderRadius: '50%',
                boxShadow: '0 0 15px rgba(255, 215, 0, 0.5)'
              }} />
            </div>

            {/* Year display */}
            <div style={{
              fontSize: '4rem',
              fontWeight: '300',
              color: '#ffd700',
              textShadow: '0 0 30px rgba(255, 215, 0, 0.4), 0 0 60px rgba(138, 43, 226, 0.3)',
              marginBottom: '20px',
              letterSpacing: '0.3em',
              animation: 'glow 2s ease-in-out infinite alternate'
            }}>
              1926
            </div>

            {/* Main text */}
            <div style={{
              background: 'linear-gradient(180deg, rgba(20, 20, 40, 0.8) 0%, rgba(30, 30, 60, 0.7) 100%)',
              border: '1px solid rgba(255, 215, 0, 0.2)',
              borderRadius: '8px',
              padding: '30px 40px',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 0 40px rgba(138, 43, 226, 0.2), inset 0 0 30px rgba(0, 0, 0, 0.3)'
            }}>
              <p style={{
                color: '#e8e8f0',
                fontSize: '1.25rem',
                lineHeight: '1.9',
                margin: '0 0 20px 0',
                textShadow: '0 2px 4px rgba(0, 0, 0, 0.5)'
              }}>
                Siete arrivati nel <span style={{ color: '#ffd700', fontWeight: '600' }}>{currentMonth} 1926</span>.
                Avete <span style={{ color: '#ff6b6b', fontWeight: '600' }}>due ore</span> finché
                il portale rimane aperto.
              </p>

              <p style={{
                color: '#c8c8d8',
                fontSize: '1.15rem',
                lineHeight: '1.9',
                margin: '0 0 20px 0',
                textShadow: '0 2px 4px rgba(0, 0, 0, 0.5)'
              }}>
                Il nostro sistema ha rilevato potenti oscillazioni energetiche nella zona di
                <span style={{ color: '#9d8cff', fontStyle: 'italic' }}> Esino Lario</span>,
                che a quanto pare hanno causato l&apos;apertura del portale.
              </p>

              <p style={{
                color: '#b8b8c8',
                fontSize: '1.1rem',
                lineHeight: '1.9',
                margin: 0,
                textShadow: '0 2px 4px rgba(0, 0, 0, 0.5)'
              }}>
                Qualcuno degli abitanti del paese si trova in pericolo. Nella disperazione è passato
                attraverso la cosiddetta <span style={{
                  color: '#ffd700',
                  fontStyle: 'italic',
                  borderBottom: '1px dotted rgba(255, 215, 0, 0.5)'
                }}>Porta di Prada</span> —
                «la porta verso l&apos;aldilà» (un arco carsico), e forse il sistema
                vi aiuterà a entrare in contatto con lui.
              </p>
            </div>

            {/* Decorative bottom element */}
            <div style={{
              marginTop: '30px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '15px'
            }}>
              <div style={{
                width: '60px',
                height: '1px',
                background: 'linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.5))'
              }} />
              <div style={{
                width: '8px',
                height: '8px',
                border: '1px solid rgba(255, 215, 0, 0.6)',
                transform: 'rotate(45deg)'
              }} />
              <div style={{
                width: '60px',
                height: '1px',
                background: 'linear-gradient(90deg, rgba(255, 215, 0, 0.5), transparent)'
              }} />
            </div>

            {/* Button */}
            <div className="mt-8">
              <button
                onClick={() => {
                  unlockBackgroundAudio().catch(() => { });
                  router.push('/map');
                }}
                className="text-white bg-purple-900/50 hover:bg-purple-800/80 px-8 py-3 rounded-full text-lg border border-purple-500/50 transition-all shadow-[0_0_15px_rgba(138,43,226,0.5)] hover:shadow-[0_0_25px_rgba(138,43,226,0.8)]"
              >
                Cerca il punto di concentrazione energetica
              </button>
            </div>
          </div>
        </div>

        {/* CSS Animations */}
        <style>{`
	          @import url('${FONT_CORMORANT_GARAMOND_IMPORT_SRC}');

	          @keyframes pulse {
	            0%, 100% { opacity: 0.3; }
	            50% { opacity: 0.6; }
          }
          @keyframes portalPulse {
            0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
            50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.8; }
          }
          @keyframes glow {
            from { text-shadow: 0 0 30px rgba(255, 215, 0, 0.4), 0 0 60px rgba(138, 43, 226, 0.3); }
            to { text-shadow: 0 0 40px rgba(255, 215, 0, 0.6), 0 0 80px rgba(138, 43, 226, 0.5); }
          }
        `}</style>
      </div>
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
      <div className="absolute inset-0 bg-black/40 z-10 transition-opacity duration-1000 pointer-events-none" style={{ opacity: state === 'VIDEO' || state === 'TRANSITION_VIDEO' ? 0.3 : 0.7 }} />

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

      {/* VIDEO 2 (Transition) */}
      {state === 'TRANSITION_VIDEO' && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black animate-fade-in">
          <iframe
            ref={video2IframeRef}
            src={buildStreamIframeSrc(VIDEO_2_ID, { muted: false })}
            className="border-none w-full h-full object-cover"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
            allowFullScreen={true}
          ></iframe>
          {!transitionVideoSoundEnabled && (
            <button
              onClick={() => void enableSoundForVideo('transition')}
              className="absolute bottom-12 left-8 z-[70] bg-white/10 hover:bg-white/20 backdrop-blur-md text-white/80 px-4 py-2 rounded-full text-sm font-medium transition-all border border-white/10 hover:scale-105 active:scale-95"
            >
              Enable Sound
            </button>
          )}
          {/* Skip Video 2 */}
          <button
            onClick={handleVideo2Ended}
            className="absolute bottom-12 right-8 z-[70] bg-white/10 hover:bg-white/20 backdrop-blur-md text-white/80 px-4 py-2 rounded-full text-sm font-medium transition-all border border-white/10 hover:scale-105 active:scale-95"
          >
            Skip →
          </button>
        </div>
      )}

      {/* Skip Video 1 Button */}
      {state === 'VIDEO' && (
        <>
          {!videoSoundEnabled && (
            <button
              onClick={() => void enableSoundForVideo('intro')}
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
