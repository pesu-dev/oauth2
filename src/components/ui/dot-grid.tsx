'use client';

import * as React from 'react';

// Port of the interactive dot grid behind the pesu-auth API explorer.
const SPACING = 22;
const BASE_RADIUS = 1;
const ACTIVE_RADIUS = 2;
const HOVER_RADIUS = 140;
const MIN_ALPHA = 0.5;

function readColors(): { dot: string; active: string } {
  const styles = getComputedStyle(document.documentElement);
  return {
    dot: styles.getPropertyValue('--dot').trim() || 'rgba(0,0,0,0.08)',
    active: styles.getPropertyValue('--dot-active').trim() || 'rgba(0,0,0,0.16)',
  };
}

export function DotGrid() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const state = { w: 0, h: 0, mx: -9999, my: -9999, active: false, frame: 0, colors: readColors() };
    // Every dot at rest, rendered once; frames only repaint the dots near the pointer.
    const base = document.createElement('canvas');

    const eachDot = (visit: (x: number, y: number) => void) => {
      const ox = (state.w % SPACING) / 2;
      const oy = (state.h % SPACING) / 2;
      for (let x = ox; x <= state.w; x += SPACING) {
        for (let y = oy; y <= state.h; y += SPACING) visit(x, y);
      }
    };

    const renderBase = () => {
      const dpr = window.devicePixelRatio || 1;
      base.width = state.w * dpr;
      base.height = state.h * dpr;
      const baseCtx = base.getContext('2d');
      if (!baseCtx) return;
      baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      baseCtx.fillStyle = state.colors.dot;
      baseCtx.beginPath();
      eachDot((x, y) => {
        baseCtx.moveTo(x + BASE_RADIUS, y);
        baseCtx.arc(x, y, BASE_RADIUS, 0, Math.PI * 2);
      });
      baseCtx.fill();
    };

    const draw = () => {
      ctx.clearRect(0, 0, state.w, state.h);
      ctx.drawImage(base, 0, 0, state.w, state.h);
      if (!state.active) return;
      ctx.fillStyle = state.colors.active;
      eachDot((x, y) => {
        const d = Math.hypot(x - state.mx, y - state.my);
        if (d >= HOVER_RADIUS) return;
        const f = 1 - d / HOVER_RADIUS;
        ctx.clearRect(x - BASE_RADIUS - 1, y - BASE_RADIUS - 1, (BASE_RADIUS + 1) * 2, (BASE_RADIUS + 1) * 2);
        ctx.globalAlpha = MIN_ALPHA + (1 - MIN_ALPHA) * f;
        ctx.beginPath();
        ctx.arc(x, y, BASE_RADIUS + (ACTIVE_RADIUS - BASE_RADIUS) * f, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    };

    const queue = () => {
      if (state.frame) return;
      state.frame = requestAnimationFrame(() => {
        state.frame = 0;
        draw();
      });
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      state.w = window.innerWidth;
      state.h = window.innerHeight;
      canvas.width = state.w * dpr;
      canvas.height = state.h * dpr;
      canvas.style.width = `${state.w}px`;
      canvas.style.height = `${state.h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderBase();
      draw();
    };

    const onMove = (e: MouseEvent) => {
      state.mx = e.clientX;
      state.my = e.clientY;
      state.active = true;
      queue();
    };
    const onLeave = () => {
      state.active = false;
      queue();
    };

    // Redraw when the theme attribute flips so dot colors follow light/dark.
    const observer = new MutationObserver(() => {
      state.colors = readColors();
      renderBase();
      queue();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    window.addEventListener('resize', resize);
    if (!reducedMotion) {
      window.addEventListener('mousemove', onMove);
      document.addEventListener('mouseleave', onLeave);
    }
    resize();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      if (state.frame) cancelAnimationFrame(state.frame);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="dot-grid"
      className="fixed inset-0 z-0 pointer-events-none"
    />
  );
}
