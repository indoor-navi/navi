'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import { ArrowLeft, Bot, ChevronLeft, ChevronRight, Compass, Landmark, PlayCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { SlideData } from './types';

interface DirectionsExperienceProps {
  initialDestination: string;
}

function getAssetUrl(url: string) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  const baseUrl = (process.env.NEXT_PUBLIC_CONVEX_URL || '').replace(/\/$/, '');
  return `${baseUrl}/api/storage/${url.replace(/^\//, '')}`;
}

export default function DirectionsExperience({ initialDestination }: DirectionsExperienceProps) {
  const router = useRouter();
  const [destination, setDestination] = useState(initialDestination);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const route = useQuery(api.routes.getWayfindingSequence, { transcriptInput: destination });
  const slides = (route?.slides || []) as SlideData[];
  const activeSlide = slides[selectedIndex];

  const stopNarration = () => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch {}
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  };

  const speakDirection = async (text: string) => {
    stopNarration();
    const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY?.trim();

    if (apiKey) {
      try {
        const response = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en', {
          method: 'POST',
          headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (response.ok) {
          const audioContext = audioContextRef.current || new AudioContext();
          audioContextRef.current = audioContext;
          if (audioContext.state === 'suspended') await audioContext.resume();
          const audioBuffer = await audioContext.decodeAudioData(await response.arrayBuffer());
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContext.destination);
          audioSourceRef.current = source;
          await new Promise<void>((resolve) => {
            source.onended = () => resolve();
            source.start();
          });
          audioSourceRef.current = null;
          return;
        }
      } catch {
        // Fall through to browser speech if Deepgram is unavailable.
      }
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });
    }
  };

  useEffect(() => {
    if (!initialDestination || !route || !activeSlide) return;
    const narration = buildNarration(activeSlide);
    void speakDirection(narration);
    return stopNarration;
  }, [activeSlide, initialDestination, route, selectedIndex, slides.length]);

  useEffect(() => {
    if (!initialDestination || !route || slides.length === 0 || !activeSlide) return;

    const durationMs = Math.max((activeSlide.walkingTime || 3.5) * 1000, 3500);
    const timer = window.setTimeout(() => {
      if (selectedIndex < slides.length - 1) {
        setSelectedIndex((index) => index + 1);
      } else {
        stopNarration();
        router.push('/');
      }
    }, durationMs);

    return () => window.clearTimeout(timer);
  }, [activeSlide, initialDestination, route, router, selectedIndex, slides.length]);

  const selectDestination = (value: string) => {
    setDestination(value.trim());
    setSelectedIndex(0);
  };

  const buildNarration = (slide: SlideData) => {
    const cleanSentence = (value: string) => value.trim().replace(/[.!?]+$/, '');
    const origin = cleanSentence(slide.originNodeLabel || 'your current location');
    const target = cleanSentence(slide.targetNodeLabel || 'the destination');
    const direction = cleanSentence(slide.description || slide.textDirection);
    const isStartingPoint = origin === target;
    const routeLabel = isStartingPoint
      ? `You are at ${target}`
      : `From ${origin}, continue toward ${target}`;
    const action = direction
      ? cleanSentence(direction)
      : isStartingPoint
        ? 'This is your current location. Get ready to follow the next direction'
        : `Walk from ${origin} toward ${target}`;
    const landmark = slide.isLandmark && slide.landmarkType
      ? ` You will pass the ${slide.landmarkType.replace('-', ' ')}`
      : '';
    const walkingTime = slide.walkingTime > 0
      ? ` This part takes about ${slide.walkingTime} seconds`
      : '';

    return `${routeLabel}. ${action}.${landmark}.${walkingTime}.`
      .replace(/\.\./g, '.')
      .replace(/\s+/g, ' ')
      .trim();
  };

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-5 text-white sm:px-8 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-7xl flex-col gap-6 sm:min-h-[calc(100vh-4rem)]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-900 pb-5">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Back to NaviSense" className="flex size-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400 transition hover:border-cyan-500/50 hover:text-cyan-300">
              <ArrowLeft className="size-4" />
            </Link>
            <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600"><Bot className="size-5" /></div>
            <div><p className="text-sm font-black uppercase tracking-tight">Video directions</p><p className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">NaviSense route guide</p></div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-cyan-400"><PlayCircle className="size-3.5" /> Step-by-step view</div>
        </header>

        <section className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)]">
          <div className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-900/30">
            <div className="relative flex min-h-[320px] flex-1 items-center justify-center bg-black">
              {activeSlide?.video ? <video key={activeSlide.id} src={getAssetUrl(activeSlide.video)} className="h-full max-h-[68vh] w-full object-contain" autoPlay loop muted playsInline controls /> : <div className="flex flex-col items-center gap-3 p-8 text-center text-zinc-500"><Compass className="size-10 text-zinc-700" /><p>{destination ? 'No video clip is available for this step.' : 'Choose a destination to load video directions.'}</p></div>}
              {activeSlide?.isLandmark && <div className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-zinc-950/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-purple-300"><Landmark className="size-3" /> {activeSlide.landmarkType || 'Landmark'}</div>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-900 bg-zinc-950 p-4 sm:p-5">
              <div className="min-w-0"><p className="font-mono text-[10px] uppercase tracking-widest text-cyan-400">{activeSlide ? `Step ${selectedIndex + 1} of ${slides.length}` : 'Route preview'}</p><h1 className="mt-1 truncate text-lg font-bold">{activeSlide?.stepTitle || route?.destination || 'Video directions'}</h1></div>
              <div className="flex items-center gap-2"><button disabled={selectedIndex === 0} onClick={() => setSelectedIndex((index) => index - 1)} aria-label="Previous step" className="flex size-9 items-center justify-center rounded-full border border-zinc-800 text-zinc-400 transition hover:border-cyan-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft className="size-4" /></button><button disabled={selectedIndex >= slides.length - 1} onClick={() => setSelectedIndex((index) => index + 1)} aria-label="Next step" className="flex size-9 items-center justify-center rounded-full border border-zinc-800 text-zinc-400 transition hover:border-cyan-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"><ChevronRight className="size-4" /></button></div>
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <label className="flex flex-col gap-2"><span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Destination</span><input defaultValue={initialDestination} onKeyDown={(event) => { if (event.key === 'Enter') selectDestination(event.currentTarget.value); }} placeholder="Type a room or facility" className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-500/60" /></label>
            <div className="flex flex-1 flex-col gap-2 overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950/60 p-4"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Route steps</span><span className="font-mono text-[10px] text-zinc-600">{slides.length}</span></div>{slides.length > 0 ? <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">{slides.map((slide, index) => <button key={slide.id} onClick={() => setSelectedIndex(index)} className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${index === selectedIndex ? 'border-cyan-500/40 bg-cyan-500/10' : 'border-zinc-900 bg-zinc-900/40 hover:border-zinc-700'}`}><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 font-mono text-[10px] text-zinc-400">{index + 1}</span><span className="min-w-0"><span className="block truncate text-xs font-semibold text-white">{slide.stepTitle}</span><span className="mt-1 block text-[11px] leading-relaxed text-zinc-500">{slide.description}</span></span></button>)}</div> : <p className="py-8 text-center text-sm leading-relaxed text-zinc-600">Enter a destination and press Enter to load its route.</p>}</div>
          </aside>
        </section>
      </div>
    </main>
  );
}