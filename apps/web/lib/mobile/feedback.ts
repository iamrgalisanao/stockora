/**
 * Audible + haptic scan/submit feedback (2D.6D, ADR 0014 warehouse UX). Feature-detected — silent where the
 * device has no Web Audio or Vibration API. A distinct success vs error signal lets a gloved operator work
 * without watching the screen.
 */

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return null;
    ctx = ctx ?? new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, ms: number): void {
  const ac = audio();
  if (!ac) return;
  try {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.value = 0.05; // quiet — a confirmation blip, not an alarm
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + ms / 1000);
  } catch {
    /* ignore */
  }
}

function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

/** A short high blip + light tap — a scan/step accepted. */
export function feedbackSuccess(): void {
  tone(880, 60);
  vibrate(25);
}

/** A low buzz + double tap — rejected/duplicate/conflict; the operator should look. */
export function feedbackError(): void {
  tone(220, 180);
  vibrate([40, 40, 40]);
}
