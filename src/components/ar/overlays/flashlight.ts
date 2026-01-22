"use client";

import type { OverlayRenderer } from "./index";

export const FlashlightOverlay: OverlayRenderer = {
  init: ({ settings }) => {
    const n = Math.max(1, Math.floor(Number(settings.n ?? 3)));
    const durationMs = Math.max(500, Number(settings.durationMs ?? 2400));

    const holdMs = Math.max(0, Number(settings.holdMs ?? 90));
    const fadeMs = Math.max(60, Number(settings.fadeMs ?? 220));

    const gap = durationMs / (n + 1);
    const flashStarts = Array.from({ length: n }, (_, i) => (i + 1) * gap);

    return {
      n,
      durationMs,
      holdMs,
      fadeMs,
      flashStarts,
      seed: Math.random() * 1000,
    };
  },

  frame: ({ ctx, fit, anchor, t, settings }, stateAny) => {
    const state = stateAny as {
      n: number;
      durationMs: number;
      holdMs: number;
      fadeMs: number;
      flashStarts: number[];
      seed: number;
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(fit.offsetX, fit.offsetY, fit.drawnW, fit.drawnH);
    ctx.clip();

    const beamWidthFrac = clamp01(Number(settings.beamWidth ?? 0.55));
    const jitterPx = Math.max(0, Number(settings.jitterPx ?? 10));
    const tint = String(settings.tint ?? "white");
    const origin = String(settings.origin ?? "top");

    let I = 0;
    for (const s of state.flashStarts) {
      I += flashEnvelope(t, s, state.holdMs, state.fadeMs);
    }
    I = clamp(I, 0, 1.25);

    if (I <= 0.001) {
      ctx.restore();
      return;
    }

    const wobble =
      Math.sin((t + state.seed) / 90) * jitterPx +
      Math.sin((t + state.seed) / 230) * (jitterPx * 0.7);
    const srcX = anchor.cx;
    const srcY = origin === "center" ? anchor.cy : anchor.topY;

    const viewY = fit.offsetY + fit.drawnH * 0.92;
    const viewX = anchor.cx + wobble;

    const baseW = Math.max(16, anchor.size * 0.18);
    const viewW = Math.max(140, fit.drawnW * beamWidthFrac);

    const c0 =
      tint === "warm"
        ? { r: 255, g: 240, b: 210 }
        : tint === "cool"
          ? { r: 210, g: 235, b: 255 }
          : { r: 255, g: 255, b: 255 };

    ctx.globalCompositeOperation = "lighter";

    drawCone(ctx, srcX, srcY, viewX, viewY, baseW * 1.8, viewW * 1.15, c0, 0.75 * I);
    drawCone(ctx, srcX, srcY, viewX, viewY, baseW, viewW * 0.75, c0, 0.95 * I);
    drawCone(
      ctx,
      srcX,
      srcY,
      viewX,
      viewY,
      baseW * 0.55,
      viewW * 0.35,
      { r: 255, g: 255, b: 255 },
      1.0 * I,
    );

    const glareR = Math.max(140, fit.drawnW * 0.38);
    const gx = viewX;
    const gy = viewY;
    const glare = ctx.createRadialGradient(gx, gy, 0, gx, gy, glareR);
    glare.addColorStop(0, `rgba(${c0.r},${c0.g},${c0.b},${0.95 * I})`);
    glare.addColorStop(0.25, `rgba(${c0.r},${c0.g},${c0.b},${0.35 * I})`);
    glare.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glare;
    ctx.beginPath();
    ctx.arc(gx, gy, glareR, 0, Math.PI * 2);
    ctx.fill();

    const srcR = Math.max(18, anchor.size * 0.35);
    const srcGlow = ctx.createRadialGradient(srcX, srcY, 0, srcX, srcY, srcR);
    srcGlow.addColorStop(0, `rgba(255,255,255,${0.95 * I})`);
    srcGlow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = srcGlow;
    ctx.beginPath();
    ctx.arc(srcX, srcY, srcR, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";
    const vignetteA = 0.28 * clamp01(I);
    if (vignetteA > 0.001) {
      const v = ctx.createRadialGradient(
        fit.offsetX + fit.drawnW / 2,
        fit.offsetY + fit.drawnH / 2,
        Math.min(fit.drawnW, fit.drawnH) * 0.25,
        fit.offsetX + fit.drawnW / 2,
        fit.offsetY + fit.drawnH / 2,
        Math.max(fit.drawnW, fit.drawnH) * 0.75,
      );
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, `rgba(0,0,0,${vignetteA})`);
      ctx.fillStyle = v;
      ctx.fillRect(fit.offsetX, fit.offsetY, fit.drawnW, fit.drawnH);
    }

    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  },
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
function clamp01(v: number) {
  return clamp(v, 0, 1);
}

function flashEnvelope(t: number, startMs: number, holdMs: number, fadeMs: number) {
  const rampIn = 60;
  const x = t - startMs;
  if (x < 0) return 0;

  if (x < rampIn) {
    const p = x / rampIn;
    return p * p;
  }

  if (x < rampIn + holdMs) return 1;

  const y = x - (rampIn + holdMs);
  if (y < fadeMs) {
    const p = 1 - y / fadeMs;
    return p * p;
  }

  return 0;
}

function drawCone(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  baseW: number,
  viewW: number,
  col: { r: number; g: number; b: number },
  alpha: number,
) {
  const grad = ctx.createLinearGradient(x1, y1, x2, y2);
  grad.addColorStop(0.0, `rgba(${col.r},${col.g},${col.b},${alpha})`);
  grad.addColorStop(0.15, `rgba(${col.r},${col.g},${col.b},${alpha * 0.85})`);
  grad.addColorStop(0.6, `rgba(${col.r},${col.g},${col.b},${alpha * 0.25})`);
  grad.addColorStop(1.0, "rgba(255,255,255,0)");

  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(x1 - baseW / 2, y1);
  ctx.lineTo(x2 - viewW / 2, y2);
  ctx.lineTo(x2 + viewW / 2, y2);
  ctx.lineTo(x1 + baseW / 2, y1);
  ctx.closePath();
  ctx.fill();
}
