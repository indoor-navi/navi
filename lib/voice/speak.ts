'use client';

/**
 * Shared text-to-speech for the 3D directions screen.
 * Order: ElevenLabs Malawian voice (/api/speak) → Deepgram (English only) → the browser's own voice.
 * Calling speak() again, or stopSpeaking(), cuts off whatever is currently being said.
 */

type WindowWithWebkitAudioContext = Window & { webkitAudioContext?: typeof AudioContext };

let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let run = 0;

const CHICHEWA = /\b(?:nditengereni|ndikufuna|muli bwanji|zikomo|chonde|ili kuti|ndingapeze|kumene|chipinda|pafupi|ndingapite)\b/i;

function getContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const Ctor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
  if (!Ctor) return null;
  audioContext = new Ctor();
  return audioContext;
}

export function stopSpeaking() {
  run += 1;
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    try { currentSource.disconnect(); } catch { /* already disconnected */ }
    currentSource = null;
  }
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
}

async function playBuffer(ctx: AudioContext, data: ArrayBuffer, myRun: number) {
  const buffer = await ctx.decodeAudioData(data);
  if (myRun !== run) return;
  await new Promise<void>((resolve) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    currentSource = source;
    source.onended = () => { if (currentSource === source) currentSource = null; resolve(); };
    source.start(0);
  });
}

/** Resolves when the speech has finished (or was cut off / could not be played). */
export async function speak(text: string): Promise<void> {
  if (typeof window === 'undefined' || !text.trim()) return;
  stopSpeaking();
  const myRun = run;
  const chichewa = CHICHEWA.test(text);

  try {
    const ctx = getContext();
    if (ctx) {
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (myRun !== run) return;
      if (res.ok) { await playBuffer(ctx, await res.arrayBuffer(), myRun); return; }

      const dgKey = (process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY || '').trim();
      if (dgKey && !chichewa) {
        const dg = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en', {
          method: 'POST',
          headers: { Authorization: `Token ${dgKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (myRun !== run) return;
        if (dg.ok) { await playBuffer(ctx, await dg.arrayBuffer(), myRun); return; }
      }
    }
  } catch (err) {
    console.warn('Cloud voice failed; using the browser voice.', err);
  }

  if (myRun !== run) return;
  if ('speechSynthesis' in window) {
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = chichewa ? 'ny-MW' : 'en-US';
      u.rate = 0.95;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    });
  }
}

/** True while something is being said. */
export const isSpeaking = () => currentSource !== null || (typeof window !== 'undefined' && !!window.speechSynthesis?.speaking);
