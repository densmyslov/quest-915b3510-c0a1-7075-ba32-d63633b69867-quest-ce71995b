'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { getQuestApiUrl } from '@/utils/apiConfig';
import { DEFAULT_OVERLAYS, PhotoWithOverlay, type TowerBox } from '@/components/ar/overlays';
import type { TimelineArOverlayState } from './types';

type TimelineArOverlayPalette = {
  gold: string;
  goldLight: string;
  parchment: string;
};

type TimelineArOverlayProps = {
  overlay: TimelineArOverlayState | null;
  onComplete: (evidence: Record<string, unknown>) => void;
  onCancel: () => void;
  palette: TimelineArOverlayPalette;
};

type FlorenceResponse = {
  '<OD>'?: {
    bboxes: [number, number, number, number][];
    labels: string[];
  };
  '<REFERRING_EXPRESSION_SEGMENTATION>'?: {
    polygons: number[][][];
    labels: string[];
  };
};

type VlmMatchResponse = {
  objects_same?: 'YES' | 'NO';
  probability?: string | number;
  is_match?: boolean;
  message?: string;
};

function stripDataUrlHeader(dataUrl: string): string {
  const idx = dataUrl.indexOf(',');
  if (idx === -1) return dataUrl;
  return dataUrl.slice(idx + 1);
}

function computeTowerFromResult(args: {
  result: FlorenceResponse;
  task_prompt: '<OD>' | '<REFERRING_EXPRESSION_SEGMENTATION>';
  imageWidth: number;
  imageHeight: number;
}): TowerBox | null {
  const { result, task_prompt, imageWidth, imageHeight } = args;

  if (task_prompt === '<OD>') {
    const bbox = result['<OD>']?.bboxes?.[0];
    if (!bbox) return null;
    const [x1, y1, x2, y2] = bbox;
    return { x1, y1, x2, y2, imgW: imageWidth, imgH: imageHeight };
  }

  const poly = result['<REFERRING_EXPRESSION_SEGMENTATION>']?.polygons?.[0];
  if (!poly || !poly.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // poly is expected to be an array of point arrays: [[x1,y1,x2,y2,...], ...]
  for (const points of poly) {
    if (!Array.isArray(points)) continue;
    for (let i = 0; i < points.length; i += 2) {
      const x = Number(points[i]);
      const y = Number(points[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { x1: minX, y1: minY, x2: maxX, y2: maxY, imgW: imageWidth, imgH: imageHeight };
}

export default function TimelineArOverlay({ overlay, onComplete, onCancel, palette }: TimelineArOverlayProps) {
  const apiBaseUrl = useMemo(() => `${getQuestApiUrl()}/api/v1`, []);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiResult, setApiResult] = useState<FlorenceResponse | null>(null);
  const [tower, setTower] = useState<TowerBox | null>(null);

  useEffect(() => {
    setCapturedImage(null);
    setProcessing(false);
    setError(null);
    setApiResult(null);
    setTower(null);
  }, [overlay]);

  useEffect(() => {
    if (!overlay) return;

    let cancelled = false;
    const start = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        if (cancelled) {
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(mediaStream);
      } catch (err: any) {
        setError(`Failed to access camera: ${err?.message ?? String(err)}`);
      }
    };
    void start();

    return () => {
      cancelled = true;
    };
  }, [overlay]);

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  if (!overlay) return null;

  const { task_prompt, text_input, overlay: effect, origin } = overlay.config;
  const matchTargetUrl = overlay.config.match_target_image_url;
  const matchTargetKey = overlay.config.match_target_image_key;
  const title = overlay.title || 'AR';

  const capturePhoto = () => {
    setError(null);
    setApiResult(null);
    setTower(null);

    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video.videoWidth || !video.videoHeight) return;

    const MAX_DIMENSION = 1280;
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
      width = Math.floor(width * scale);
      height = Math.floor(height * scale);
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setCapturedImage(dataUrl);
  };

  const retake = () => {
    setError(null);
    setApiResult(null);
    setTower(null);
    setCapturedImage(null);
  };

  const analyze = async () => {
    if (!capturedImage) return;
    if (task_prompt === '<REFERRING_EXPRESSION_SEGMENTATION>' && !text_input?.trim()) {
      setError('Missing text_input for segmentation. Fix the timeline configuration and try again.');
      return;
    }

    setProcessing(true);
    setError(null);
    setApiResult(null);
    setTower(null);

    try {
      if ((matchTargetUrl && matchTargetUrl.trim()) || (matchTargetKey && matchTargetKey.trim())) {
        const matchRes = await fetch(`${apiBaseUrl}/match-vlm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query_image_base64: stripDataUrlHeader(capturedImage),
            target_image_path: matchTargetKey || undefined,
            target_image_url: matchTargetUrl || undefined,
          }),
        });

        if (!matchRes.ok) {
          const text = await matchRes.text().catch(() => '');
          throw new Error(text || `Match API error ${matchRes.status}`);
        }

        const matchJson = (await matchRes.json()) as VlmMatchResponse;
        const ok = matchJson?.objects_same === 'YES' || matchJson?.is_match === true;
        if (!ok) {
          setError('Giev it another try');
          setProcessing(false);
          return;
        }
      }

      const payload = {
        task_prompt,
        image_input: stripDataUrlHeader(capturedImage),
        text_input: text_input || undefined,
      };

      const res = await fetch(`${apiBaseUrl}/ar/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`API Error ${res.status}: ${text}`);
      }

      const json = (await res.json()) as FlorenceResponse;
      setApiResult(json);

      const img = new Image();
      img.onload = () => {
        const nextTower = computeTowerFromResult({
          result: json,
          task_prompt,
          imageWidth: img.width,
          imageHeight: img.height,
        });
        setTower(nextTower);
      };
      img.src = capturedImage;
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setProcessing(false);
    }
  };

  const canComplete = !!capturedImage && !!apiResult;

  return (
    <div
      className="fixed inset-0 z-[5400] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-label="AR Analysis"
    >
      <div
        style={{
          width: 'min(980px, calc(100vw - 24px))',
          height: 'min(720px, calc(100vh - 24px))',
          background: 'linear-gradient(135deg, rgba(26, 21, 16, 0.98) 0%, rgba(44, 36, 28, 0.98) 100%)',
          border: `2px solid ${palette.gold}`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.55), inset 0 1px 0 rgba(201, 169, 97, 0.2)',
          color: palette.parchment,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 14px',
            borderBottom: `1px solid rgba(201, 169, 97, 0.25)`,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div
              style={{
                fontFamily: "'Cinzel', serif",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '1.2px',
                textTransform: 'uppercase',
                color: palette.goldLight,
              }}
            >
              {title}
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              {task_prompt === '<OD>' ? 'Object Detection' : 'Segmentation'}
              {task_prompt === '<REFERRING_EXPRESSION_SEGMENTATION>' && text_input ? ` — “${text_input}”` : null}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (stream) stream.getTracks().forEach((t) => t.stop());
              onCancel();
            }}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: `1px solid ${palette.gold}`,
              color: palette.gold,
              width: 32,
              height: 32,
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: "'Cinzel', serif",
              fontWeight: 900,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, padding: 12, flex: 1, minHeight: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, minHeight: 0 }}>
            {!capturedImage ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateRows: '1fr auto',
                  gap: 12,
                  height: '100%',
                  minHeight: 0,
                }}
              >
                <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', minHeight: 0 }}>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Capture a photo, then run analysis.</div>
                  <button
                    type="button"
                    onClick={capturePhoto}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: `1px solid ${palette.gold}`,
                      background: palette.gold,
                      color: '#1a1a2e',
                      fontWeight: 800,
                      cursor: 'pointer',
                      fontFamily: "'Cinzel', serif",
                      letterSpacing: '0.6px',
                    }}
                  >
                    Capture
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateRows: '1fr auto', gap: 12, height: '100%', minHeight: 0 }}>
                <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', minHeight: 0 }}>
                  {tower ? (
                    <PhotoWithOverlay
                      src={capturedImage}
                      tower={tower}
                      overlay={(effect || 'none') as any}
                      registry={DEFAULT_OVERLAYS}
                      settings={{ origin: origin ?? 'top' }}
                      overlayOpacity={1}
                      style={{ height: '100%' }}
                    />
                  ) : (
                    <img src={capturedImage} alt="Captured" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                  )}
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={retake}
                    disabled={processing}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: `1px solid rgba(201, 169, 97, 0.5)`,
                      background: 'transparent',
                      color: palette.parchment,
                      fontWeight: 700,
                      cursor: processing ? 'not-allowed' : 'pointer',
                      fontFamily: "'Cinzel', serif",
                    }}
                  >
                    Retake
                  </button>

                  <button
                    type="button"
                    onClick={() => void analyze()}
                    disabled={processing}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: `1px solid ${palette.gold}`,
                      background: processing ? 'rgba(201, 169, 97, 0.5)' : palette.gold,
                      color: '#1a1a2e',
                      fontWeight: 800,
                      cursor: processing ? 'not-allowed' : 'pointer',
                      fontFamily: "'Cinzel', serif",
                      letterSpacing: '0.6px',
                    }}
                  >
                    {processing ? 'Analyzing…' : 'Analyze'}
                  </button>

                  <div style={{ flex: '1 1 auto' }} />

                  <button
                    type="button"
                    onClick={() => {
                      if (stream) stream.getTracks().forEach((t) => t.stop());
                      onComplete({
                        task_prompt,
                        text_input: text_input ?? null,
                        overlay: effect ?? null,
                        origin: origin ?? null,
                        has_result: !!apiResult,
                      });
                    }}
                    disabled={!canComplete || processing}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: `1px solid rgba(201, 169, 97, 0.5)`,
                      background: canComplete ? 'rgba(201, 169, 97, 0.18)' : 'rgba(255,255,255,0.04)',
                      color: palette.parchment,
                      fontWeight: 800,
                      cursor: !canComplete || processing ? 'not-allowed' : 'pointer',
                      fontFamily: "'Cinzel', serif",
                      letterSpacing: '0.6px',
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {error ? (
              <div style={{ marginTop: 4, padding: 10, borderRadius: 10, background: 'rgba(220, 53, 69, 0.15)', border: '1px solid rgba(220, 53, 69, 0.35)', fontSize: 12 }}>
                {error}
              </div>
            ) : null}

            {capturedImage && apiResult && !tower ? (
              <div style={{ marginTop: 4, padding: 10, borderRadius: 10, background: 'rgba(201, 169, 97, 0.10)', border: '1px solid rgba(201, 169, 97, 0.25)', fontSize: 12 }}>
                Analysis returned no usable region to anchor the overlay.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
