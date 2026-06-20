'use client';

import { useEffect, useRef } from 'react';

/**
 * Cyberpunk animated backdrop for the non-game screens.
 * Pure visual: layered DOM (grid / aurora / scanline / streaks) + a capped
 * particle canvas, plus desktop-only pointer interactivity (cursor spotlight,
 * parallax, tile/panel 3D tilt). Auto-reduces on mobile and under
 * prefers-reduced-motion; pauses when the tab is hidden. No props, no logic.
 */
export default function CyberBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const root = document.documentElement;
    const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mqFine = window.matchMedia('(pointer: fine)');
    const mqSmall = window.matchMedia('(max-width: 760px)');

    let raf = 0;
    let hidden = document.hidden;

    // ---- particle canvas (capped, GPU-light) ----
    const canvas = canvasRef.current;
    const ctx = canvas ? canvas.getContext('2d') : null;
    let particles = [];
    let W = 0;
    let H = 0;
    let dpr = 1;

    const wantCanvas = ctx && !mqReduce.matches;
    const resize = () => {
      if (!canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
    };
    const seed = () => {
      const count = mqSmall.matches ? 26 : 95;
      particles = Array.from({ length: count }).map(() => ({
        x: Math.random(),
        y: Math.random(),
        z: 0.4 + Math.random() * 0.6, // depth → speed/size/parallax
        r: 0.6 + Math.random() * 1.8,
        c: Math.random() < 0.5 ? [255, 80, 175] : [60, 235, 255],
      }));
    };

    let last = 0;
    const FRAME = 1000 / 40; // throttle ~40fps for the canvas
    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      if (hidden) return;
      if (t - last < FRAME) return;
      last = t;
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const px = parseFloat(root.style.getPropertyValue('--par-x')) || 0;
      const py = parseFloat(root.style.getPropertyValue('--par-y')) || 0;
      for (const p of particles) {
        p.y -= 0.0006 + p.z * 0.0014; // drift upward
        if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
        const sx = p.x * W + px * p.z * 2.2;
        const sy = p.y * H + py * p.z * 2.2;
        ctx.beginPath();
        ctx.arc(sx, sy, p.r * p.z * 1.9, 0, Math.PI * 2);
        ctx.shadowColor = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},0.9)`;
        ctx.shadowBlur = 8 * p.z;
        ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${0.35 + p.z * 0.55})`;
        ctx.fill();
      }
    };

    if (wantCanvas) { resize(); seed(); raf = requestAnimationFrame(draw); }

    // ---- pointer interactivity (desktop fine-pointer only) ----
    let pendingPointer = null;
    let tilted = null;
    const interactive = mqFine.matches && !mqReduce.matches;

    const applyPointer = () => {
      if (!pendingPointer) return;
      const { x, y } = pendingPointer;
      pendingPointer = null;
      root.style.setProperty('--mx', `${x}px`);
      root.style.setProperty('--my', `${y}px`);
      // parallax: shift layers opposite the cursor, normalized
      const nx = (x / window.innerWidth - 0.5) * 2;
      const ny = (y / window.innerHeight - 0.5) * 2;
      root.style.setProperty('--par-x', `${(-nx * 16).toFixed(2)}`);
      root.style.setProperty('--par-y', `${(-ny * 16).toFixed(2)}`);
    };

    const onMove = (e) => {
      if (!interactive) return;
      if (!pendingPointer) requestAnimationFrame(applyPointer);
      pendingPointer = { x: e.clientX, y: e.clientY };

      // 3D tilt for the element under the cursor
      const el = e.target.closest && e.target.closest('.tile, .card-panel');
      if (tilted && tilted !== el) { tilted.style.transform = ''; tilted.classList.remove('is-tilted'); tilted = null; }
      if (el) {
        const r = el.getBoundingClientRect();
        const rx = ((e.clientY - r.top) / r.height - 0.5) * -8;
        const ry = ((e.clientX - r.left) / r.width - 0.5) * 8;
        el.style.transform = `perspective(800px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-3px)`;
        el.classList.add('is-tilted');
        tilted = el;
      }
    };
    const onLeaveTilt = () => { if (tilted) { tilted.style.transform = ''; tilted.classList.remove('is-tilted'); tilted = null; } };

    if (interactive) {
      root.classList.add('cb-interactive');
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerdown', onMove, { passive: true });
      window.addEventListener('blur', onLeaveTilt);
    }

    const onVis = () => { hidden = document.hidden; };
    const onResize = () => { if (wantCanvas) { resize(); seed(); } };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
      if (interactive) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerdown', onMove);
        window.removeEventListener('blur', onLeaveTilt);
        root.classList.remove('cb-interactive');
      }
      if (tilted) { tilted.style.transform = ''; tilted.classList.remove('is-tilted'); }
      root.style.removeProperty('--mx'); root.style.removeProperty('--my');
      root.style.removeProperty('--par-x'); root.style.removeProperty('--par-y');
    };
  }, []);

  return (
    <div className="cyber-bg" aria-hidden="true">
      <div className="cb-par cb-grid-wrap"><div className="bg-grid cb-grid" /></div>
      <div className="cb-par cb-aurora-wrap">
        <div className="bg-aurora">
          <span className="blob b1" /><span className="blob b2" />
          <span className="blob b3" /><span className="blob b4" />
        </div>
      </div>
      <div className="stars cb-par cb-stars" />
      <div className="stars stars2 cb-par cb-stars2" />
      <canvas ref={canvasRef} className="cb-particles" />
      <div className="cb-streaks" />
      <div className="cb-scan" />
      <div className="cursor-glow" />
    </div>
  );
}
// EOF CyberBackground.js
