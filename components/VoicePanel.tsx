'use client';

import Link from 'next/link';
import { Bot, Landmark, MessageSquare, Mic, MicOff, Navigation, PlayCircle, Sparkles, Volume2 } from 'lucide-react';
import type { ActiveQrCode, AgentState, AppMode, SlideData } from './types';

interface VoicePanelProps {
  activeQrCode: ActiveQrCode | null;
  agentState: AgentState;
  appMode: AppMode;
  activeSlideNode: SlideData | null;
  currentNodeIndex: number;
  routeSlideCount?: number;
  currentSystemMessage: string;
  rewrittenDirection: string;
  isOrbSpeaking: boolean;
  isThinking: boolean;
  isStreaming: boolean;
  destination?: string;
  onClearSequence: () => void;
  onStartStream: () => void;
  onStopStream: () => void;
}

export default function VoicePanel({
  activeQrCode,
  agentState,
  appMode,
  activeSlideNode,
  currentNodeIndex,
  routeSlideCount,
  currentSystemMessage,
  rewrittenDirection,
  isOrbSpeaking,
  isThinking,
  isStreaming,
  destination,
  onClearSequence,
  onStartStream,
  onStopStream,
}: VoicePanelProps) {
  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-between overflow-hidden bg-gradient-to-b from-zinc-950 to-zinc-900/40 px-4 py-5 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
      {activeQrCode && (
        <div className="absolute bottom-4 left-4 z-30 flex items-end gap-3 rounded-2xl border border-cyan-500/20 bg-zinc-950/90 p-3 shadow-2xl shadow-cyan-950/20 backdrop-blur-md">
          <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-zinc-800 bg-white p-2">
            <img src={activeQrCode.imageUrl} alt={`${activeQrCode.label} QR code`} className="h-full w-full object-cover" />
          </div>
          <div className="flex max-w-[160px] flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-cyan-400">Scan to continue</span>
            <span className="text-xs font-semibold text-white">{activeQrCode.label}</span>
            <span className="text-[10px] text-zinc-500">Open on your phone and continue from here.</span>
          </div>
        </div>
      )}

      <header className="z-20 flex w-full max-w-6xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600"><Bot className="size-5 text-white" /></div>
          <div className="flex flex-col"><span className="text-lg font-black tracking-tight uppercase">NaviSense</span><span className="font-mono text-[10px] tracking-widest text-zinc-500">CONVERSATIONAL AI</span></div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={destination ? `/directions?destination=${encodeURIComponent(destination)}` : '/directions'} aria-label="Open video directions" className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 transition hover:border-cyan-500/50 hover:text-cyan-300">
            <PlayCircle className="size-3.5" /><span className="hidden sm:inline">Video directions</span>
          </Link>
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider ${agentState === 'listening' ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400' : agentState === 'thinking' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : agentState === 'speaking' || agentState === 'navigating' ? 'border-purple-500/30 bg-purple-500/10 text-purple-400' : 'border-zinc-800 bg-zinc-900 text-zinc-600'}`}>
          <div className={`size-1.5 rounded-full ${agentState === 'listening' ? 'animate-pulse bg-cyan-400' : agentState === 'thinking' ? 'animate-thinking bg-amber-400' : agentState === 'speaking' || agentState === 'navigating' ? 'animate-pulse bg-purple-400' : 'bg-zinc-600'}`} />
          {agentState === 'listening' ? 'Listening' : agentState === 'thinking' ? 'Thinking' : agentState === 'speaking' ? 'Speaking' : agentState === 'navigating' ? 'Navigating' : 'Offline'}
          </div>
        </div>
      </header>

      <div className="relative z-10 my-auto flex w-full max-w-6xl items-center justify-center py-10 sm:py-14">
        <div className="pointer-events-none absolute h-[240px] w-[240px] rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 opacity-20 blur-3xl" />
        <div className={`pointer-events-none absolute h-[210px] w-[210px] rounded-full bg-gradient-to-tr from-blue-600 via-purple-500 to-cyan-400 transition-all duration-300 animate-sweep-clockwise ${isOrbSpeaking ? 'animate-speaking-ball' : ''}`} style={{ opacity: isStreaming || isOrbSpeaking ? 0.85 : 0.15 }} />
        <div className="absolute flex size-[140px] flex-col items-center justify-center rounded-full border border-zinc-900 bg-zinc-950 shadow-[inset_0_4px_20px_rgba(0,0,0,0.95)] sm:size-[160px]">
          <div className="relative flex flex-col items-center justify-center"><div className="flex w-24 items-center justify-between px-2"><div className={`size-2.5 rounded-full bg-cyan-400 ${agentState === 'listening' ? 'animate-pulse' : isOrbSpeaking ? 'animate-bounce' : ''}`} /><div className={`size-2.5 rounded-full bg-cyan-400 ${agentState === 'listening' ? 'animate-pulse [animation-delay:0.2s]' : isOrbSpeaking ? 'animate-bounce [animation-delay:0.12s]' : ''}`} /></div><div className="mt-4 flex h-10 items-center justify-center">{agentState === 'thinking' || isThinking ? <div className="flex gap-1"><span className="size-1.5 animate-bounce rounded-full bg-amber-400" /><span className="size-1.5 animate-bounce rounded-full bg-amber-400 [animation-delay:0.1s]" /><span className="size-1.5 animate-bounce rounded-full bg-amber-400 [animation-delay:0.2s]" /></div> : isOrbSpeaking ? <div className="flex h-4 items-center gap-1"><span className="h-4 w-1 animate-pulse rounded-full bg-cyan-400" /><span className="h-6 w-1 animate-pulse rounded-full bg-indigo-400 [animation-delay:0.1s]" /><span className="h-3 w-1 animate-pulse rounded-full bg-purple-400 [animation-delay:0.2s]" /></div> : <div className="h-[2.5px] w-6 animate-pulse rounded-full bg-cyan-400/80" />}</div></div>
        </div>
      </div>

      <div className="relative z-20 flex min-h-[200px] w-full max-w-2xl flex-col items-center justify-end gap-3">
        {currentSystemMessage && <div className="message-enter flex w-full max-w-lg items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-4 text-sm text-cyan-100 backdrop-blur-sm"><Volume2 className="mt-0.5 size-4 shrink-0 text-cyan-400" /><p className="text-[13px] font-medium leading-relaxed text-white">{currentSystemMessage}</p></div>}
        {appMode === 'navigation' && activeSlideNode && <div className="message-enter flex w-full max-w-lg items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-cyan-100 backdrop-blur-sm"><Navigation className="mt-1 size-4 shrink-0 text-cyan-400" /><div className="flex-1 space-y-1.5"><div className="flex items-center justify-between border-b border-zinc-800/80 pb-1"><span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Step {currentNodeIndex + 1} of {routeSlideCount}</span><div className="flex items-center gap-2">{rewrittenDirection && <span className="inline-flex items-center gap-1 rounded border border-emerald-900 bg-emerald-950/30 px-1.5 py-0.5 font-mono text-[9px] text-emerald-400"><Sparkles className="size-2.5" /> AI Clarified</span>}<span className="rounded border border-cyan-900 bg-cyan-950/40 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-400">{activeSlideNode.walkingTime}s walk</span></div></div><span className="block rounded border border-zinc-900 bg-zinc-950 p-2 text-center font-mono text-xs font-bold text-zinc-400">{currentNodeIndex === 0 && activeSlideNode.originNodeLabel === activeSlideNode.targetNodeLabel ? `Start: ${activeSlideNode.targetNodeLabel}` : activeSlideNode.originNodeLabel === activeSlideNode.targetNodeLabel ? activeSlideNode.targetNodeLabel : `${activeSlideNode.originNodeLabel} ➔ ${activeSlideNode.targetNodeLabel}`}</span><p className="pt-1 text-[13px] font-medium leading-relaxed text-white">&quot;{rewrittenDirection || activeSlideNode.textDirection || (currentNodeIndex === 0 ? `This is the starting point: ${activeSlideNode.targetNodeLabel}.` : '')}&quot;</p>{rewrittenDirection && rewrittenDirection !== activeSlideNode.description && <p className="border-l-2 border-zinc-800 pl-2 text-[11px] italic text-zinc-600">Original: {activeSlideNode.description}</p>}{activeSlideNode.isLandmark && <span className="mt-1 inline-flex items-center gap-1.5 rounded border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 font-mono text-[9px] text-purple-400"><Landmark className="size-3" /> {activeSlideNode.landmarkType || 'Structural Junction'}</span>}</div></div>}
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-zinc-600">{appMode === 'chat' && <MessageSquare className="size-3" />}{appMode === 'navigation' && <Navigation className="size-3" />}{appMode === 'idle' && 'Ready to listen'}{appMode === 'chat' && 'Conversation Mode'}{appMode === 'navigation' && `Navigating to ${destination || '...'}`}</div>
        <div className="relative flex min-h-[56px] w-full items-center justify-center"><div className="z-30 flex h-20 items-center justify-center gap-4">{appMode === 'navigation' && <button onClick={onClearSequence} className="rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2 font-mono text-[11px] text-zinc-400 transition-all hover:border-zinc-600 hover:text-white">Stop Navigation</button>}{!isStreaming ? <button onClick={onStartStream} className="rounded-full border border-zinc-800 bg-zinc-900 p-4 transition-all hover:scale-105 hover:border-cyan-500"><MicOff className="size-5 text-zinc-500" /></button> : <button onClick={onStopStream} className="rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 p-4 text-white shadow-lg shadow-cyan-500/20 transition-all hover:scale-105"><Mic className="size-5 text-white" /></button>}</div></div>
      </div>
    </div>
  );
}
