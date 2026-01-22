"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlashlightOverlay } from "./flashlight";
import { LightOverlay } from "./light";
import { SmokeOverlay } from "./smoke";

export type TowerBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  imgW: number;
  imgH: number;
};

export type OverlayName = "light" | "smoke" | "flashlight" | (string & {});

export type FitMap = {
  scale: number;
  offsetX: number;
  offsetY: number;
  drawnW: number;
  drawnH: number;
};

export type TowerAnchor = {
  cx: number;
  cy: number;
  topY: number;
  size: number;
};

export type OverlayCtx = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  fit: FitMap;
  anchor: TowerAnchor;
  t: number;
  dt: number;
  settings: Record<string, unknown>;
};

export type OverlayRenderer = {
  init?: (args: {
    ctx: CanvasRenderingContext2D;
    w: number;
    h: number;
    fit: FitMap;
    anchor: TowerAnchor;
    settings: Record<string, unknown>;
  }) => unknown;
  frame: (ctx: OverlayCtx, state: unknown) => void;
  destroy?: (state: unknown) => void;
};

export type OverlayRegistry = Record<string, OverlayRenderer>;

export type PhotoWithOverlayProps = {
  src: string;
  tower: TowerBox;
  overlay: OverlayName;
  registry?: OverlayRegistry;
  settings?: Record<string, unknown>;
  className?: string;
  overlayOpacity?: number;
  style?: React.CSSProperties;
  onClick?: () => void;
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function mapContain(containerW: number, containerH: number, imgW: number, imgH: number): FitMap {
  const scale = Math.min(containerW / imgW, containerH / imgH);
  const drawnW = imgW * scale;
  const drawnH = imgH * scale;
  const offsetX = (containerW - drawnW) / 2;
  const offsetY = (containerH - drawnH) / 2;
  return { scale, offsetX, offsetY, drawnW, drawnH };
}

export function towerToAnchor(tower: TowerBox, fit: FitMap): TowerAnchor {
  const cxImg = (tower.x1 + tower.x2) / 2;
  const cyImg = (tower.y1 + tower.y2) / 2;

  const cx = fit.offsetX + cxImg * fit.scale;
  const cy = fit.offsetY + cyImg * fit.scale;
  const topY = fit.offsetY + tower.y1 * fit.scale;

  const bw = Math.max(1, tower.x2 - tower.x1);
  const bh = Math.max(1, tower.y2 - tower.y1);
  const size = clamp(Math.sqrt(bw * bh) * fit.scale, 18, 160);

  return { cx, cy, topY, size };
}

export const DEFAULT_OVERLAYS: OverlayRegistry = {
  light: LightOverlay,
  smoke: SmokeOverlay,
  flashlight: FlashlightOverlay,
};

export function PhotoWithOverlay({
  src,
  tower,
  overlay,
  registry,
  settings,
  className,
  overlayOpacity = 1,
  style,
  onClick,
}: PhotoWithOverlayProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 });

  const overlays = registry ?? DEFAULT_OVERLAYS;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setWrapSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });

    ro.observe(el);
    const r0 = el.getBoundingClientRect();
    setWrapSize({ w: Math.floor(r0.width), h: Math.floor(r0.height) });

    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => {
    if (!wrapSize.w || !wrapSize.h) return null;
    return mapContain(wrapSize.w, wrapSize.h, tower.imgW, tower.imgH);
  }, [wrapSize.w, wrapSize.h, tower.imgW, tower.imgH]);

  const anchor = useMemo(() => {
    if (!fit) return null;
    return towerToAnchor(tower, fit);
  }, [fit, tower]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fit || !anchor) return;

    const renderer = overlays[overlay];
    if (!renderer) {
      const ctx0 = canvas.getContext("2d");
      if (ctx0) ctx0.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

    canvas.width = wrapSize.w * dpr;
    canvas.height = wrapSize.h * dpr;
    canvas.style.width = `${wrapSize.w}px`;
    canvas.style.height = `${wrapSize.h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf = 0;
    let last = performance.now();
    const start = last;

    const st = renderer.init?.({
      ctx,
      w: wrapSize.w,
      h: wrapSize.h,
      fit,
      anchor,
      settings: settings ?? {},
    });

    const loop = (now: number) => {
      const dt = clamp(now - last, 0, 40);
      last = now;

      ctx.clearRect(0, 0, wrapSize.w, wrapSize.h);

      renderer.frame(
        {
          ctx,
          w: wrapSize.w,
          h: wrapSize.h,
          fit,
          anchor,
          t: now - start,
          dt,
          settings: settings ?? {},
        },
        st,
      );

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      renderer.destroy?.(st);
    };
  }, [overlay, overlays, fit, anchor, settings, wrapSize.w, wrapSize.h]);

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        ...style,
      }}
      onClick={onClick}
    >
      <img
        src={src}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
          userSelect: "none",
          pointerEvents: "none",
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: overlayOpacity,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
