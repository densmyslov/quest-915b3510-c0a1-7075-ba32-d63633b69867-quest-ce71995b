'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKnockDetector, type KnockDetectionMode, type KnockSensitivity } from '@/hooks/useKnockDetector';
import { getQuestApiUrl } from '@/utils/apiConfig';
import type { TimelineActionOverlayState } from './types';

type TimelineActionOverlayPalette = {
  gold: string;
  goldLight: string;
  parchment: string;
};

type TimelineActionOverlayProps = {
  overlay: TimelineActionOverlayState | null;
  onComplete: (evidence: Record<string, unknown>) => void;
  onCancel: () => void;
  palette: TimelineActionOverlayPalette;
};

function coerceInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function coerceFloat(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000.0;
  const toRad = (deg: number) => (deg * Math.PI) / 180.0;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function isKnockSensitivity(value: unknown): value is KnockSensitivity {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isKnockDetectionMode(value: unknown): value is KnockDetectionMode {
  return value === 'accelerometer' || value === 'microphone' || value === 'both';
}

function normalizeMinProbability(value: unknown): number {
  const n = coerceFloat(value);
  if (n === null) return 0.7;
  if (n > 1 && n <= 100) return n / 100.0;
  return Math.max(0, Math.min(1, n));
}

function parseTenantFromImageKey(targetImageKey: unknown): { clientId: string; questId: string } | null {
  if (typeof targetImageKey !== 'string') return null;
  const trimmed = targetImageKey.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('/').filter(Boolean);
  const clientsIdx = parts.indexOf('clients');
  if (clientsIdx === -1) return null;
  const clientId = parts[clientsIdx + 1];
  const questId = parts[clientsIdx + 2];
  if (!clientId || !questId) return null;
  if (!/^[a-zA-Z0-9-]+$/.test(clientId)) return null;
  if (!/^[a-zA-Z0-9-]+$/.test(questId)) return null;
  return { clientId, questId };
}

async function tryGetGeolocation(timeoutMs: number): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return null;
  const geo = navigator.geolocation;
  return await new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, Math.max(0, timeoutMs));

    geo.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(null);
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: Math.max(1000, timeoutMs) },
    );
  });
}

// --- Icons ---

function IconChevronUp(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="m18 15-6-6-6 6" /></svg>
  );
}
function IconChevronDown(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="m6 9 6 6 6-6" /></svg>
  );
}

export default function TimelineActionOverlay({ overlay, onComplete, onCancel, palette }: TimelineActionOverlayProps) {
  const completedRef = useRef(false);
  const apiBaseUrl = useMemo(() => `${getQuestApiUrl()}/api/v1`, []);

  useEffect(() => {
    completedRef.current = false;
  }, [overlay]);

  const actionKind = overlay?.actionKind;
  const paramsRaw = overlay?.params;
  const params = useMemo(() => paramsRaw ?? {}, [paramsRaw]);

  const title = useMemo(() => {
    const t = overlay?.title;
    return typeof t === 'string' && t.trim().length ? t.trim() : 'Action';
  }, [overlay?.title]);

  const requiredKnocks = useMemo(() => {
    const raw = (params as any)?.requiredKnocks ?? (params as any)?.required_knocks;
    const n = coerceInt(raw, 3);
    return Math.max(2, Math.min(10, n));
  }, [params]);

  const maxIntervalMs = useMemo(() => {
    const raw = (params as any)?.maxIntervalMs ?? (params as any)?.max_interval_ms;
    const n = coerceInt(raw, 2000);
    return Math.max(0, n);
  }, [params]);

  const sensitivity: KnockSensitivity = useMemo(() => {
    const raw = (params as any)?.sensitivity;
    return isKnockSensitivity(raw) ? raw : 'medium';
  }, [params]);

  const detectionMode: KnockDetectionMode = useMemo(() => {
    const raw = (params as any)?.detectionMode ?? (params as any)?.detection_mode;
    return isKnockDetectionMode(raw) ? raw : 'accelerometer';
  }, [params]);

  const imageMatch = useMemo(() => {
    const targetImageKey =
      (params as any)?.targetImageKey ??
      (params as any)?.target_image_key ??
      (params as any)?.targetImagePath ??
      (params as any)?.target_image_path ??
      null;
    const targetImageUrl = (params as any)?.targetImageUrl ?? (params as any)?.target_image_url ?? null;
    const tenant = parseTenantFromImageKey(targetImageKey);

    return {
      targetImageKey: typeof targetImageKey === 'string' ? targetImageKey : null,
      targetImageUrl: typeof targetImageUrl === 'string' ? targetImageUrl : null,
      tenant,
      minProbability: normalizeMinProbability((params as any)?.minProbability ?? (params as any)?.min_probability),
      maxDistanceMeters: coerceFloat((params as any)?.maxDistanceMeters ?? (params as any)?.max_distance_meters),
      targetLatitude: coerceFloat((params as any)?.targetLatitude ?? (params as any)?.target_latitude),
      targetLongitude: coerceFloat((params as any)?.targetLongitude ?? (params as any)?.target_longitude),
    };
  }, [params]);

  const [started, setStarted] = useState(false);
  const [manualKnocks, setManualKnocks] = useState<number[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false); // Combined capture + upload + match state
  const [matchMetrics, setMatchMetrics] = useState<{
    probability: number | null;
    minProbability: number;
    distanceMeters: number | null;
    maxDistanceMeters: number | null;
    ok: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Target Image Overlay State
  const [targetExpanded, setTargetExpanded] = useState(false);

  // Close Confirmation State
  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const detector = useKnockDetector({
    requiredKnocks,
    maxIntervalMs,
    sensitivity,
    detectionMode,
    onKnockDetected: (timestamps) => {
      if (completedRef.current) return;
      completedRef.current = true;
      detector.stopListening();
      onComplete({ knockPattern: timestamps });
    },
  });
  const detectorReset = detector.reset;

  // Auto-start listening and auto-trigger knocks for knockknock action (Safari-safe)
  const autoKnockStartedRef = useRef(false);
  useEffect(() => {
    if (actionKind !== 'knockknock' || autoKnockStartedRef.current) return;
    autoKnockStartedRef.current = true;

    // Auto-start listening using requestAnimationFrame for Safari compatibility
    requestAnimationFrame(() => {
      detector.startListening().catch(console.error);
      setStarted(true);
    });

    // Auto-trigger manual knocks with Safari-safe timing
    const knockInterval = Math.floor(maxIntervalMs / (requiredKnocks + 1));
    const timeouts: NodeJS.Timeout[] = [];

    for (let i = 0; i < requiredKnocks; i++) {
      const timeout = setTimeout(() => {
        if (completedRef.current) return;
        const now = Date.now();
        setManualKnocks((prev) => {
          const next = [...prev, now].filter((t) => now - t <= maxIntervalMs).sort((a, b) => a - b);
          if (next.length >= requiredKnocks) {
            const first = next[0];
            const last = next[next.length - 1];
            if (last - first <= maxIntervalMs) {
              completedRef.current = true;
              onComplete({ knockPattern: next });
            }
          }
          return next;
        });
      }, knockInterval * (i + 1));
      timeouts.push(timeout);
    }

    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [actionKind, detector, maxIntervalMs, requiredKnocks, onComplete]);

  useEffect(() => {
    if (!overlay) return;
    autoKnockStartedRef.current = false;
    setStarted(false);
    setManualKnocks([]);
    setStream(null);
    setCapturedImage(null);
    setProcessing(false);
    setMatchMetrics(null);
    setError(null);
    setShowCloseConfirmation(false);
    setShowDebug(false);
    setCopyStatus(null);
    detectorReset();
  }, [detectorReset, overlay]);

  /* ------------------- Torch Logic State ------------------- */
  const brightnessIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const torchRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (brightnessIntervalRef.current) {
      clearInterval(brightnessIntervalRef.current);
      brightnessIntervalRef.current = null;
    }
    torchRef.current = false; // Reset torch state

    setStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
    if (videoRef.current) {
      try {
        (videoRef.current as any).srcObject = null;
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const buildKnockDebugInfo = useCallback(() => {
    const nowIso = new Date().toISOString();
    const timestamps = detector.knockTimestamps?.length ? detector.knockTimestamps : manualKnocks;
    const sorted = [...timestamps].sort((a, b) => a - b);
    const intervals = sorted.slice(1).map((t, i) => t - sorted[i]);

    return {
      ts: nowIso,
      overlay: {
        title,
        actionKind,
        params,
      },
      config: {
        requiredKnocks,
        maxIntervalMs,
        sensitivity,
        detectionMode,
      },
      detector: {
        isListening: detector.isListening,
        knockCount: detector.knockCount,
        knockTimestamps: detector.knockTimestamps,
        error: detector.error,
      },
      manual: {
        knockCount: manualKnocks.length,
        knockTimestamps: manualKnocks,
      },
      derived: {
        timestamps: sorted,
        intervals,
        totalDurationMs: sorted.length >= 2 ? sorted[sorted.length - 1] - sorted[0] : 0,
      },
      env: typeof window === 'undefined'
        ? { hasWindow: false }
        : {
          hasWindow: true,
          isSecureContext: (window as any).isSecureContext ?? null,
          userAgent: navigator.userAgent,
          hasDeviceMotionEvent: typeof (window as any).DeviceMotionEvent !== 'undefined',
          hasDeviceMotionRequestPermission:
            typeof (window as any).DeviceMotionEvent !== 'undefined' &&
            typeof (window as any).DeviceMotionEvent?.requestPermission === 'function',
          hasMediaDevices: !!navigator.mediaDevices?.getUserMedia,
          hasClipboardApi: !!navigator.clipboard?.writeText,
        },
    };
  }, [
    actionKind,
    detectionMode,
    detector.error,
    detector.isListening,
    detector.knockCount,
    detector.knockTimestamps,
    manualKnocks,
    maxIntervalMs,
    params,
    requiredKnocks,
    sensitivity,
    title,
  ]);

  const copyDebug = useCallback(async () => {
    const payload = JSON.stringify(buildKnockDebugInfo(), null, 2);
    setCopyStatus(null);

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        setCopyStatus('Copied to clipboard');
        window.setTimeout(() => setCopyStatus(null), 1500);
        return;
      }
    } catch {
      // fall through
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = payload;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopyStatus(ok ? 'Copied to clipboard' : 'Copy failed');
      window.setTimeout(() => setCopyStatus(null), 1500);
    } catch {
      setCopyStatus('Copy failed');
      window.setTimeout(() => setCopyStatus(null), 1500);
    }
  }, [buildKnockDebugInfo]);

  const startCamera = useCallback(async () => {
    setError(null);
    setMatchMetrics(null);
    setCapturedImage(null);

    // Stop existing stream first to be safe
    stopCamera();

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera not available.');
      return;
    }

    try {
      // Prefer rear camera
      const next = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 }, // Higher res for matching
          height: { ideal: 1080 },
        },
        audio: false,
      });
      setStream(next);
      if (videoRef.current) {
        (videoRef.current as any).srcObject = next;
        try {
          await videoRef.current.play();
        } catch {
          // Playback might need gesture
        }
      }

      // Start brightness detection loop to auto-enable torch in dark conditions
      try {
        const track = next.getVideoTracks()[0];
        if (track) {
          const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
          if (!capabilities.torch) return; // Exit if torch not supported

          // Cleanup previous interval if any (safety)
          if (brightnessIntervalRef.current) {
            clearInterval(brightnessIntervalRef.current);
          }

          const canvas = document.createElement('canvas');
          canvas.width = 64; // Small size for performance
          canvas.height = 64;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });

          if (!ctx || !videoRef.current) return;

          // Hysteresis thresholds (0-255)
          const DARK_THRESHOLD = 40; // Turn ON if avg brightness < 40
          const BRIGHT_THRESHOLD = 70; // Turn OFF if avg brightness > 70

          brightnessIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) return;

            try {
              ctx.drawImage(videoRef.current, 0, 0, 64, 64);
              const frame = ctx.getImageData(0, 0, 64, 64);
              const data = frame.data;
              let r, g, b, avg;
              let colorSum = 0;

              for (let i = 0; i < data.length; i += 4) {
                r = data[i];
                g = data[i + 1];
                b = data[i + 2];
                avg = Math.floor((r + g + b) / 3);
                colorSum += avg;
              }

              const brightness = Math.floor(colorSum / (64 * 64));
              const currentTorch = torchRef.current; // Need to add torchRef to component

              if (!currentTorch && brightness < DARK_THRESHOLD) {
                // Turn torch ON
                await track.applyConstraints({ advanced: [{ torch: true } as any] });
                torchRef.current = true;
              } else if (currentTorch && brightness > BRIGHT_THRESHOLD) {
                // Turn torch OFF
                await track.applyConstraints({ advanced: [{ torch: false } as any] });
                torchRef.current = false;
              }
            } catch (err) {
              console.warn('Error in brightness detection loop:', err);
            }
          }, 1000); // Check every 1s
        }
      } catch (err) {
        console.warn('Failed to init torch logic:', err);
      }
    } catch {
      setError('Could not access camera. Please check permissions.');
    }
  }, [stopCamera]);

  // Clean up stream binding
  useEffect(() => {
    if (!stream || !videoRef.current) return;
    try {
      if ((videoRef.current as any).srcObject !== stream) {
        (videoRef.current as any).srcObject = stream;
      }
    } catch {
      // ignore
    }
  }, [stream]);

  // Auto-start camera for image_match
  useEffect(() => {
    if (actionKind === 'image_match' && !stream && !capturedImage) {
      void startCamera();
    }
  }, [actionKind, startCamera, stream, capturedImage]);

  const performMatch = useCallback(async (base64Data: string) => {
    if (completedRef.current) return;

    const tenant = imageMatch.tenant;
    if (!tenant) {
      setError('System Error: Missing target configuration.');
      setProcessing(false);
      return;
    }

    try {
      const location = await tryGetGeolocation(4000); // 4s timeout for location

      // 1. Upload
      const uploadRes = await fetch(`${apiBaseUrl}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Data.includes(',') ? base64Data.split(',')[1] : base64Data,
          client_id: tenant.clientId,
          quest_id: tenant.questId,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
          is_query: true,
        }),
      });
      const uploadText = await uploadRes.text().catch(() => '');
      if (!uploadRes.ok) throw new Error('Upload failed. Please try again.');

      const uploadJson = JSON.parse(uploadText) as any;
      const queryPath = typeof uploadJson?.filename === 'string' ? uploadJson.filename : typeof uploadJson?.key === 'string' ? uploadJson.key : null;
      if (!queryPath) throw new Error('Upload invalid. Please try again.');

      type VlmMatchResult = {
        objects_same?: 'YES' | 'NO';
        probability?: string | number;
        is_match?: boolean;
        message?: string;
        query_image_path?: string;
        target_image_path?: string;
      };

      let outcomeOk = false;
      let distanceMeters: number | null = null;
      if (!imageMatch.targetImageKey || !imageMatch.targetImageKey.length) {
        throw new Error('System Error: Missing target image key for VLM matching.');
      }

      const vlmRes = await fetch(`${apiBaseUrl}/match-vlm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query_image_path: queryPath,
          target_image_path: imageMatch.targetImageKey,
        }),
      });
      const vlmText = await vlmRes.text().catch(() => '');
      if (!vlmRes.ok) throw new Error(vlmText || 'VLM match failed.');

      const vlmJson = JSON.parse(vlmText) as VlmMatchResult;
      const probability = typeof vlmJson?.probability === 'string' ? coerceFloat(vlmJson.probability) : coerceFloat(vlmJson?.probability);
      const backendIsMatch = typeof vlmJson?.is_match === 'boolean' ? vlmJson.is_match : null;
      const meetsProbability = probability !== null && probability >= imageMatch.minProbability;
      const derivedIsMatch = vlmJson?.objects_same === 'YES' && meetsProbability;

      outcomeOk = backendIsMatch ?? derivedIsMatch;

      // Check Distance if applicable
      if (location && typeof imageMatch.targetLatitude === 'number' && typeof imageMatch.targetLongitude === 'number') {
        distanceMeters = haversineMeters(location.latitude, location.longitude, imageMatch.targetLatitude, imageMatch.targetLongitude);

        const maxDist = imageMatch.maxDistanceMeters;
        if (maxDist !== null && distanceMeters !== null && distanceMeters > maxDist) {
          outcomeOk = false; // Too far
        }
      }

      setMatchMetrics({
        probability,
        minProbability: imageMatch.minProbability,
        distanceMeters,
        maxDistanceMeters: imageMatch.maxDistanceMeters,
        ok: outcomeOk,
      });

      if (outcomeOk) {
        completedRef.current = true;
        // Small delay to show success state
        setTimeout(() => {
          onComplete({
            query_image_path: queryPath,
            targetImageKey: imageMatch.targetImageKey ?? undefined,
            playerLatitude: location?.latitude ?? undefined,
            playerLongitude: location?.longitude ?? undefined,
          });
        }, 1500);
      } else {
        // Allow retry - keep processing=true so we show the "No Match" UI overlay
        // setProcessing(false);
      }

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setProcessing(false); // Stop generic loading, show error state
    }
  }, [apiBaseUrl, imageMatch, onComplete]);

  const captureAndSubmit = useCallback(() => {
    if (!videoRef.current || processing) return;

    setError(null);
    setProcessing(true); // Start "Scanning..." UI

    try {
      const video = videoRef.current;
      const MAX_DIMENSION = 1280;
      let width = video.videoWidth || 1280;
      let height = video.videoHeight || 720;

      // Calculate scale to fit within MAX_DIMENSION
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width *= scale;
        height *= scale;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas error');

      ctx.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

      // Freeze frame effect
      stopCamera();
      setCapturedImage(dataUrl);

      // Auto-submit
      void performMatch(dataUrl);

    } catch {
      setError('Failed to capture image');
      setProcessing(false);
    }
  }, [processing, stopCamera, performMatch]);


  // --- Render ---

  if (!overlay) return null;

  // 1. Full-Screen Camera (Image Match)
  if (actionKind === 'image_match') {
    return (
      <div
        className="fixed inset-0 z-[5000] bg-black text-white overflow-hidden flex flex-col"
        style={{ fontFamily: "'Cinzel', serif" }}
      >
        {/* Camera View / Captured Image */}
        <div className="absolute inset-0 z-0 bg-neutral-900">
          {/* If we have a captured image, show it (frozen), otherwise show video */}
          {capturedImage ? (
            <img
              src={capturedImage}
              alt="Captured"
              className="w-full h-full object-cover"
            />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="w-full h-full object-cover"
            />
          )}

          {/* Dark gradient overlay for text readability at top/bottom */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80 pointer-events-none" />
        </div>

        {/* Top Bar: Title & Close */}
        <div className="relative z-10 p-4 pt-safe-top flex justify-between items-start pointer-events-none">
          <div className="pointer-events-auto">
            {/* Could put something here, but keeping it clean */}
          </div>

          <button
            type="button"
            onClick={() => {
              // Instead of cancelling immediately, show confirmation
              setShowCloseConfirmation(true);
            }}
            className="pointer-events-auto w-10 h-10 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-md border border-white/20 text-white active:bg-white/20 transition-colors"
          >
            <span className="text-2xl leading-none">&times;</span>
          </button>
        </div>

        {/* Target Image Overlay (Foldable) */}
        {imageMatch.targetImageUrl && (
          <div
            className={`absolute left-4 top-24 z-20 transition-all duration-300 ease-spring ${targetExpanded
              ? "w-[85vw] max-w-sm"
              : "w-24 h-32"
              }`}
          >
            <div
              className="relative w-full h-full rounded-xl overflow-hidden border-2 border-white/30 shadow-2xl bg-black/50 backdrop-blur-sm cursor-pointer"
              onClick={() => setTargetExpanded(!targetExpanded)}
            >
              <img
                src={imageMatch.targetImageUrl}
                alt="Target"
                className="w-full h-full object-cover"
              />

              {/* Label Badge */}
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-md px-2 py-1 flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold tracking-widest text-[#d4b483]">
                  {targetExpanded ? "Target Reference" : "Target"}
                </span>
                {targetExpanded ? <IconChevronUp className="w-3 h-3 text-white/70" /> : <IconChevronDown className="w-3 h-3 text-white/70" />}
              </div>
            </div>
          </div>
        )}

        {/* Center Success/Fail/Scan Feedback Overlay */}
        {processing && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            {matchMetrics ? (
              // Result State
              <div className="flex flex-col items-center animate-in zoom-in-95 duration-200">
                {matchMetrics.ok ? (
                  <>
                    <div className="w-20 h-20 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(34,197,94,0.4)]">
                      <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <div className="text-2xl font-bold text-white drop-shadow-md">MATCH CONFIRMED</div>

                    {/* Debug Metrics (Success) */}
                    <div className="mt-4 p-3 rounded bg-black/50 border border-white/10 text-xs font-mono text-white/80 space-y-1 backdrop-blur-md">
                      <div className="flex justify-between gap-4">
                        <span>Conf:</span>
                        <span className={matchMetrics.probability !== null && matchMetrics.probability >= matchMetrics.minProbability ? "text-green-400" : "text-white"}>
                          {matchMetrics.probability?.toFixed(3) ?? "N/A"} / {matchMetrics.minProbability.toFixed(3)}
                        </span>
                      </div>
                      {matchMetrics.distanceMeters !== null && (
                        <div className="flex justify-between gap-4">
                          <span>Dist:</span>
                          <span className={matchMetrics.maxDistanceMeters !== null && matchMetrics.distanceMeters <= matchMetrics.maxDistanceMeters ? "text-green-400" : "text-yellow-400"}>
                            {Math.round(matchMetrics.distanceMeters)}m / {matchMetrics.maxDistanceMeters ? Math.round(matchMetrics.maxDistanceMeters) + "m" : "∞"}
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-20 h-20 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(239,68,68,0.4)]">
                      <span className="text-4xl text-red-500 select-none">&times;</span>
                    </div>
                    <div className="text-xl font-bold text-white drop-shadow-md mb-2">NO MATCH</div>
                    <div className="text-sm text-white/80 max-w-[240px] text-center mb-6">
                      {matchMetrics.distanceMeters !== null && matchMetrics.maxDistanceMeters !== null && matchMetrics.distanceMeters > matchMetrics.maxDistanceMeters
                        ? "Too far away from target location."
                        : "Image doesn't match the target pattern."}
                    </div>

                    {/* Debug Metrics (Failure) */}
                    <div className="mb-6 p-3 rounded bg-black/50 border border-white/10 text-xs font-mono text-white/80 space-y-1 backdrop-blur-md animate-in slide-in-from-bottom-2">
                      <div className="flex justify-between gap-4">
                        <span>Conf:</span>
                        <span className={matchMetrics.probability !== null && matchMetrics.probability < matchMetrics.minProbability ? "text-red-400" : "text-white"}>
                          {matchMetrics.probability?.toFixed(3) ?? "N/A"} / {matchMetrics.minProbability.toFixed(3)}
                        </span>
                      </div>
                      {matchMetrics.distanceMeters !== null && (
                        <div className="flex justify-between gap-4">
                          <span>Dist:</span>
                          <span className={matchMetrics.maxDistanceMeters !== null && matchMetrics.distanceMeters > matchMetrics.maxDistanceMeters ? "text-red-400" : "text-white"}>
                            {Math.round(matchMetrics.distanceMeters)}m / {matchMetrics.maxDistanceMeters ? Math.round(matchMetrics.maxDistanceMeters) + "m" : "∞"}
                          </span>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setProcessing(false);
                        setCapturedImage(null);
                        void startCamera();
                      }}
                      className="px-6 py-3 bg-white text-black font-bold uppercase tracking-widest rounded-full hover:bg-neutral-200 transition-colors shadow-lg hover:scale-105 active:scale-95 transform duration-100"
                    >
                      Retake
                    </button>
                  </>
                )}
              </div>
            ) : (
              // Scanning State
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 border-4 border-white/20 border-t-white rounded-full animate-spin mb-4" />
                <div className="text-lg font-bold tracking-widest text-white animate-pulse">VERIFYING...</div>
              </div>
            )}
          </div>
        )}

        {/* Error Toast */}
        {error && !processing && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 bg-red-900/90 text-white px-4 py-3 rounded-lg border border-red-500/50 shadow-lg z-40 max-w-[90vw] text-center text-sm">
            {error}
            <button className="ml-3 underline font-bold" onClick={() => void startCamera()}>Retry</button>
          </div>
        )}

        {/* Bottom Controls */}
        <div className="absolute bottom-0 left-0 right-0 z-20 pb-safe-bottom flex flex-col items-center pointer-events-none">
          {/* Hint Text */}
          {!processing && (
            <div className="mb-6 text-center px-6">
              <p className="text-white/90 text-shadow-sm font-medium text-lg leading-tight">{title}</p>
              <p className="text-white/60 text-xs mt-1 uppercase tracking-wider">Tap shutter to verify</p>
            </div>
          )}

          {/* Shutter Button */}
          {!processing && (
            <button
              onClick={captureAndSubmit}
              className="pointer-events-auto mb-10 group relative"
              aria-label="Capture"
            >
              {/* Outer Ring */}
              <div className="w-20 h-20 rounded-full border-4 border-white opacity-80 group-active:scale-95 transition-transform duration-150" />
              {/* Inner Circle */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-white rounded-full group-hover:bg-[#d4b483] transition-colors duration-300 shadow-lg" />
            </button>
          )}
        </div>

        {/* Confirmation Dialog for Close */}
        {showCloseConfirmation && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
            <div
              style={{
                background: `linear-gradient(135deg, ${palette.parchment} 0%, #e3dcd2 100%)`,
                borderColor: palette.gold,
                color: '#2c241c'
              }}
              className="w-[90%] max-w-[320px] border-2 rounded-sm p-6 text-center shadow-[0_10px_40px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-200"
            >
              <h3
                style={{ color: '#5c4033' }}
                className="text-lg font-bold mb-4 font-serif uppercase tracking-wider"
              >
                Chiudere l&apos;azione?
              </h3>
              <p className="text-base mb-6 font-serif leading-relaxed">
                Se confermi, l&apos;azione verrà segnata come completata e potrai proseguire.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowCloseConfirmation(false)}
                  style={{ borderColor: '#5c4033', color: '#5c4033' }}
                  className="px-5 py-2 rounded-none border bg-transparent font-bold font-serif hover:bg-[#5c4033]/10 transition-colors uppercase tracking-widest text-xs"
                >
                  Annulla
                </button>
                <button
                  onClick={() => {
                    stopCamera();
                    setShowCloseConfirmation(false);
                    // Completing with bypass: true signals the runtime to mark as done/skipped
                    onComplete({ bypass: true });
                  }}
                  style={{
                    background: `linear-gradient(135deg, ${palette.gold} 0%, #b8860b 100%)`,
                    boxShadow: '0 4px 10px rgba(0,0,0,0.2)'
                  }}
                  className="px-5 py-2 border-none text-white font-bold font-serif hover:brightness-110 transition-all uppercase tracking-widest text-xs"
                >
                  Conferma
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  // 2. Legacy/Knock UI (kept as fallback or separate mode, minimal changes but matching style)
  if (actionKind === 'knockknock') {

    const handleReset = () => {
      completedRef.current = false;
      setManualKnocks([]);
      detector.reset();
      setStarted(false);
      setCopyStatus(null);
    };

    const handleStart = async () => {
      setCopyStatus(null);
      setStarted(true);
      await detector.startListening();
    };

    const handleCancel = () => {
      detector.stopListening();
      onCancel();
    };

    const recordManualKnock = () => {
      if (completedRef.current) return;
      const now = Date.now();
      setManualKnocks((prev) => {
        const next = [...prev, now].filter((t) => now - t <= maxIntervalMs).sort((a, b) => a - b);
        if (next.length >= requiredKnocks) {
          const first = next[0];
          const last = next[next.length - 1];
          if (last - first <= maxIntervalMs) {
            completedRef.current = true;
            onComplete({ knockPattern: next });
          }
        }
        return next;
      });
    };

    return (
      <div className="fixed inset-0 z-[5000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div
          className="w-full max-w-md p-6 bg-gradient-to-br from-[#1a1510] to-[#2c241c] border-2 rounded-xl shadow-2xl flex flex-col gap-6"
          style={{ borderColor: palette.gold, color: palette.parchment }}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#d4b483] mb-1">{title}</h3>
              <p className="text-sm opacity-80">Knock {requiredKnocks} times quickly.</p>
              {detector.error ? (
                <p className="mt-2 text-xs text-red-300 break-words">
                  {detector.error}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDebug((v) => !v)}
                className="px-2 py-1 text-[10px] uppercase tracking-widest border border-[#d4b483]/60 text-[#d4b483] rounded-md"
                type="button"
              >
                {showDebug ? 'Hide Debug' : 'Debug'}
              </button>
              <button onClick={() => setShowCloseConfirmation(true)} className="text-[#d4b483] text-2xl leading-none" type="button">&times;</button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {!started ? (
              <button
                onClick={() => void handleStart()}
                className="w-full py-3 rounded-lg font-bold uppercase tracking-wider text-[#1b140b] bg-gradient-to-r from-[#d4b483] to-[#ebd5a0]"
              >
                Start Listening
              </button>
            ) : (
              <div className="flex flex-col gap-4 text-center">
                <div className="py-4 border border-white/10 rounded-lg bg-black/20 animate-pulse text-[#d4b483]">
                  Listening...
                </div>
                <button
                  onClick={handleReset}
                  className="text-xs uppercase tracking-wider opacity-60 hover:opacity-100"
                >
                  Reset
                </button>
              </div>
            )}

            <div className="my-2 border-t border-white/10" />

            <button
              onClick={recordManualKnock}
              className="w-full py-4 rounded-lg border border-[#d4b483] text-[#d4b483] font-bold uppercase active:bg-[#d4b483]/10"
            >
              Tap Manual Knock ({manualKnocks.length})
            </button>
          </div>

          {showDebug ? (
            <div className="border border-white/10 rounded-lg bg-black/20 p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] uppercase tracking-widest text-[#d4b483]">
                  Debug
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void copyDebug()}
                    className="px-2 py-1 text-[10px] uppercase tracking-widest bg-[#d4b483] text-[#1b140b] rounded-md"
                    type="button"
                  >
                    Copy
                  </button>
                </div>
              </div>
              {copyStatus ? (
                <div className="text-[11px] text-[#ebd5a0]">{copyStatus}</div>
              ) : null}
              <textarea
                className="w-full h-40 resize-none rounded-md bg-black/40 text-[#e3dcd2] font-mono text-[10px] p-2 border border-white/10"
                readOnly
                value={JSON.stringify(buildKnockDebugInfo(), null, 2)}
              />
            </div>
          ) : null}
        </div>


        {/* Confirmation Dialog for Close */}
        {/* Confirmation Dialog for Close */}
        {
          showCloseConfirmation && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
              <div
                style={{
                  background: `linear-gradient(135deg, ${palette.parchment} 0%, #e3dcd2 100%)`, // Approximate parchment gradient
                  borderColor: palette.gold,
                  color: '#2c241c' // Low contrast ink color
                }}
                className="w-[90%] max-w-[320px] border-2 rounded-sm p-6 text-center shadow-[0_10px_40px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-200"
              >
                <h3
                  style={{ color: '#5c4033' }}
                  className="text-lg font-bold mb-4 font-serif uppercase tracking-wider"
                >
                  Chiudere l&apos;azione?
                </h3>
                <p className="text-base mb-6 font-serif leading-relaxed">
                  Se confermi, l&apos;azione verrà segnata come completata e potrai proseguire.
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => setShowCloseConfirmation(false)}
                    style={{ borderColor: '#5c4033', color: '#5c4033' }}
                    className="px-5 py-2 rounded-none border bg-transparent font-bold font-serif hover:bg-[#5c4033]/10 transition-colors uppercase tracking-widest text-xs"
                  >
                    Annulla
                  </button>
                  <button
                    onClick={() => {
                      detector.stopListening();
                      setShowCloseConfirmation(false);
                      // Completing with bypass: true signals the runtime to mark as done/skipped
                      onComplete({ bypass: true });
                    }}
                    style={{
                      background: `linear-gradient(135deg, ${palette.gold} 0%, #b8860b 100%)`,
                      boxShadow: '0 4px 10px rgba(0,0,0,0.2)'
                    }}
                    className="px-5 py-2 border-none text-white font-bold font-serif hover:brightness-110 transition-all uppercase tracking-widest text-xs"
                  >
                    Conferma
                  </button>
                </div>
              </div>
            </div>
          )
        }
      </div >
    );
  }

  // 3. Fallback for unknown action kinds
  console.warn('[TimelineActionOverlay] Unknown action kind:', actionKind, overlay);
  return (
    <div className="fixed inset-0 z-[5000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-red-900/90 text-white p-6 rounded-xl border border-red-500 shadow-2xl max-w-md text-center">
        <h3 className="text-xl font-bold mb-2">Unknown Action</h3>
        <p className="mb-4">System received an action type that cannot be displayed.</p>
        <div className="font-mono text-xs bg-black/50 p-2 rounded mb-4 text-left overflow-auto max-h-40">
          <p>Kind: {JSON.stringify(actionKind)}</p>
          <p>Title: {title}</p>
          <pre>{JSON.stringify(params, null, 2)}</pre>
        </div>
        <button
          onClick={() => onCancel()}
          className="px-6 py-2 bg-white text-black font-bold rounded-full hover:bg-neutral-200"
        >
          Close
        </button>
      </div>
    </div>
  );
}
