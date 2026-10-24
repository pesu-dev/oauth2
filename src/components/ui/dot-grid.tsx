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
    const state = { w: 0, h: 0, mx: -9999, my: -9999, active: false, frame: 0 };

    const draw = () => {
      const colors = readColors();
      ctx.clearRect(0, 0, state.w, state.h);
      const ox = (state.w % SPACING) / 2;
      const oy = (state.h % SPACING) / 2;
      for (let x = ox; x <= state.w; x += SPACING) {
        for (let y = oy; y <= state.h; y += SPACING) {
          const d = Math.hypot(x - state.mx, y - state.my);
          let r = BASE_RADIUS;
          let color = colors.dot;
          let alpha = 1;
          if (state.active && d < HOVER_RADIUS) {
            const f = 1 - d / HOVER_RADIUS;
            r = BASE_RADIUS + (ACTIVE_RADIUS - BASE_RADIUS) * f;
            color = colors.active;
            alpha = MIN_ALPHA + (1 - MIN_ALPHA) * f;
          }
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
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
    const observer = new MutationObserver(queue);
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
