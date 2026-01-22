"use client";

import type { OverlayRenderer } from "./index";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export const LightOverlay: OverlayRenderer = {
  init: () => ({
    particles: [] as Array<{ x: number; y: number; vx: number; vy: number; life: number; size: number }>,
  }),
  frame: ({ ctx, fit, anchor, t, settings }, stateAny) => {
    const state = stateAny as {
      particles: Array<{ x: number; y: number; vx: number; vy: number; life: number; size: number }>;
    };
    const intensity = clamp(Number(settings.intensity ?? 1.1), 0, 2.5);
    const origin = String(settings.origin ?? "top");

    ctx.save();
    ctx.beginPath();
    ctx.rect(fit.offsetX, fit.offsetY, fit.drawnW, fit.drawnH);
    ctx.clip();

    const wobble = Math.sin(t / 600) * 10;
    const beamCenterX = anchor.cx + wobble;

    const startY = origin === "center" ? anchor.cy : anchor.topY;

    const beamTopY = fit.offsetY + 0.08 * fit.drawnH;
    const height = Math.max(80, startY - beamTopY);
    const baseWidth = 26 * intensity;
    const topWidth = 210 * intensity;

    const grad = ctx.createLinearGradient(beamCenterX, startY, beamCenterX, beamTopY);
    grad.addColorStop(0.0, `rgba(255, 240, 190, ${0.55 * intensity})`);
    grad.addColorStop(0.2, `rgba(190, 235, 255, ${0.38 * intensity})`);
    grad.addColorStop(1.0, "rgba(120, 180, 255, 0)");

    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(beamCenterX - baseWidth / 2, startY);
    ctx.lineTo(beamCenterX - topWidth / 2, startY - height);
    ctx.lineTo(beamCenterX + topWidth / 2, startY - height);
    ctx.lineTo(beamCenterX + baseWidth / 2, startY);
    ctx.closePath();
    ctx.fill();

    ctx.globalCompositeOperation = "lighter";
    const glowR = 22 * intensity;
    const glow = ctx.createRadialGradient(anchor.cx, startY, 0, anchor.cx, startY, glowR);
    glow.addColorStop(0, `rgba(255, 255, 220, ${0.9 * intensity})`);
    glow.addColorStop(1, "rgba(255, 255, 220, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(anchor.cx, startY, glowR, 0, Math.PI * 2);
    ctx.fill();

    const spawnCount = Math.floor(2 + intensity * 4);
    for (let i = 0; i < spawnCount; i++) {
      const spread = 28;
      const x = anchor.cx + (Math.random() * 2 - 1) * spread;
      const y = startY + Math.random() * 30;
      const vx = (Math.random() * 2 - 1) * 0.15;
      const vy = -(0.6 + Math.random() * 1.2);
      const life = 900 + Math.random() * 800;
      const size = 1 + Math.random() * 2.5;
      state.particles.push({ x, y, vx, vy, life, size });
    }

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx * 16;
      p.y += p.vy * 16;
      p.life -= 16;

      const pull = (beamCenterX - p.x) * 0.0025;
      p.x += pull * 16;

      if (p.life <= 0 || p.y < beamTopY - 30) {
        state.particles.splice(i, 1);
        continue;
      }

      const a = Math.min(1, p.life / 700);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.35 * a * intensity})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  },
};
