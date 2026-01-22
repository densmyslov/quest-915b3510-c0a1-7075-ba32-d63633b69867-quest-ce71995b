"use client";

import type { OverlayRenderer } from "./index";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export const SmokeOverlay: OverlayRenderer = {
  init: () => ({
    puffs: [] as Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      r0: number;
      r1: number;
      life: number;
      age: number;
      swirl: number;
      alpha: number;
      shade: number;
    }>,
    acc: 0,
  }),
  frame: ({ ctx, fit, anchor, t, dt, settings }, stateAny) => {
    const state = stateAny as {
      puffs: Array<{
        x: number;
        y: number;
        vx: number;
        vy: number;
        r0: number;
        r1: number;
        life: number;
        age: number;
        swirl: number;
        alpha: number;
        shade: number;
      }>;
      acc: number;
    };

    const rate = clamp(Number(settings.smokeRate ?? 0.7), 0, 1);
    const wind = clamp(Number(settings.wind ?? 0.15), -1, 1);
    const origin = String(settings.origin ?? "top");
    const windPx = wind * 35;

    ctx.save();
    ctx.beginPath();
    ctx.rect(fit.offsetX, fit.offsetY, fit.drawnW, fit.drawnH);
    ctx.clip();

    const spawnsPerSec = 18 + rate * 55;
    state.acc += (spawnsPerSec * dt) / 1000;
    const n = Math.floor(state.acc);
    state.acc -= n;

    for (let i = 0; i < n; i++) {
      const spread = anchor.size * 0.25;
      const startY = origin === "center" ? anchor.cy : anchor.topY;
      const x = anchor.cx + (Math.random() * 2 - 1) * spread;
      const y = startY + (Math.random() * 2 - 1) * spread * 0.4;

      const up = 18 + Math.random() * 22;
      const side = (Math.random() * 2 - 1) * 10 + windPx * 0.35;

      const life = 1600 + Math.random() * 1400;
      const r0 = anchor.size * (0.1 + Math.random() * 0.1);
      const r1 = anchor.size * (0.55 + Math.random() * 0.65);

      state.puffs.push({
        x,
        y,
        vx: side,
        vy: -up,
        r0,
        r1,
        life,
        age: 0,
        swirl: (Math.random() * 2 - 1) * 0.9,
        alpha: 0.75 + Math.random() * 0.25,
        shade: Math.random() * 0.15,
      });
    }

    ctx.globalCompositeOperation = "source-over";

    for (let i = state.puffs.length - 1; i >= 0; i--) {
      const p = state.puffs[i];
      p.age += dt;

      const tt = p.age / p.life;
      if (tt >= 1) {
        state.puffs.splice(i, 1);
        continue;
      }

      const wobble = Math.sin(t / 220 + p.swirl * 10) * 6;
      p.x += ((p.vx + windPx) * dt) / 1000 + (wobble * dt) / 1000;
      p.y += (p.vy * dt) / 1000;

      const r = p.r0 + (p.r1 - p.r0) * easeInOut(tt);
      const fadeIn = clamp(tt / 0.15, 0, 1);
      const fadeOut = clamp((1 - tt) / 0.35, 0, 1);
      const a = p.alpha * Math.min(fadeIn, fadeOut);

      const shade = Math.floor(255 * p.shade);
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `rgba(${shade}, ${shade}, ${shade}, ${a})`);
      grad.addColorStop(0.6, `rgba(${shade}, ${shade}, ${shade}, ${a * 0.6})`);
      grad.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const startY = origin === "center" ? anchor.cy : anchor.topY;
    const pulse = 0.5 + 0.5 * Math.sin(t / 700);
    const glowR = anchor.size * (0.25 + pulse * 0.08);
    const g = ctx.createRadialGradient(anchor.cx, startY, 0, anchor.cx, startY, glowR);
    g.addColorStop(0, `rgba(255,255,255,${0.10 + rate * 0.08})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(anchor.cx, startY, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  },
};
