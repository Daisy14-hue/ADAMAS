'use client';

/**
 * Tiny retro/arcade sound engine — synthesized entirely in-code with the Web
 * Audio API. No files, no libraries, no network. Frontend-only.
 *
 * Browser autoplay policy: the AudioContext is created lazily and resumed on the
 * first user interaction (call unlockAudio() from a click handler). Mute state
 * lives here as a plain flag; React owns the source of truth and calls setMuted.
 */

let ctx = null;
let muted = false;

export function setMuted(m) { muted = !!m; }
export function isMuted() { return muted; }

function getCtx() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Create/resume the audio context — must run inside a user gesture. */
export function unlockAudio() {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

/** One oscillator note with a quick attack/decay envelope. */
function tone({ freq = 440, type = 'square', dur = 0.12, gain = 0.16, attack = 0.005, release = 0.06, when = 0, sweepTo = null }) {
  const c = getCtx();
  if (!c || muted) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + release + 0.02);
}

/** Play a little sequence of notes back-to-back. */
function seq(notes) {
  let t = 0;
  for (const n of notes) {
    tone({ ...n, when: t });
    t += n.gap ?? n.dur ?? 0.1;
  }
}

// ---- named arcade effects -------------------------------------------------

export function playClick() {
  tone({ freq: 660, type: 'square', dur: 0.04, gain: 0.07, release: 0.03 });
}
export function playCardSound() {
  // short upward "blip" for a card hitting the pile
  tone({ freq: 520, type: 'triangle', dur: 0.07, gain: 0.13, sweepTo: 780, release: 0.05 });
}
export function playYourTurn() {
  seq([
    { freq: 523, dur: 0.09, type: 'square', gain: 0.13, gap: 0.085 },
    { freq: 784, dur: 0.13, type: 'square', gain: 0.13 },
  ]);
}
export function playWin() {
  seq([
    { freq: 523, dur: 0.1, type: 'square', gain: 0.16, gap: 0.1 },
    { freq: 659, dur: 0.1, type: 'square', gain: 0.16, gap: 0.1 },
    { freq: 784, dur: 0.1, type: 'square', gain: 0.16, gap: 0.1 },
    { freq: 1047, dur: 0.24, type: 'square', gain: 0.18 },
  ]);
}
export function playWheelSpin() {
  // descending whirr that roughly matches the ~2.6s wheel deceleration
  tone({ freq: 1300, type: 'sawtooth', dur: 1.7, gain: 0.09, sweepTo: 170, release: 0.2 });
}
export function playError() {
  tone({ freq: 220, type: 'sawtooth', dur: 0.18, gain: 0.15, sweepTo: 110, release: 0.08 });
}
// EOF sound.js
