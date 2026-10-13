'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Bot, Landmark, Navigation, PlayCircle, Send, User, Volume2 } from 'lucide-react';
import VoiceAuraScene from './VoiceAuraScene';
import type { ActiveQrCode, AgentState, AppMode, ChatMessage, SlideData } from './types';

interface VoicePanelProps {
  activeQrCode: ActiveQrCode | null;
  agentState: AgentState;
  appMode: AppMode;
  activeSlideNode: SlideData | null;
  currentNodeIndex: number;
  routeSlideCount?: number;
  currentSystemMessage: string;
  chatMessages: ChatMessage[];
  liveTranscript: string;
  rewrittenDirection: string;
  isOrbSpeaking: boolean;
  isThinking: boolean;
  isStreaming: boolean;
  speakingAmplitude: number;
  destination?: string;
  assistantLogoUrl?: string | null;
  auraColorA?: string;
  auraColorB?: string;
  backgroundColor?: string;
  onClearSequence: () => void;
  onStartStream: () => void;
  onStopStream: () => void;
  onSubmitText: (text: string) => void;
}

export default function VoicePanel({
  activeQrCode,
  agentState,
  appMode,
  activeSlideNode,
  currentNodeIndex,
  routeSlideCount,
  currentSystemMessage,
  chatMessages,
  liveTranscript,
  rewrittenDirection,
  isOrbSpeaking,
  isThinking,
  isStreaming,
  speakingAmplitude,
  destination,
  assistantLogoUrl,
  auraColorA,
  auraColorB,
  backgroundColor,
  onClearSequence,
  onStartStream,
  onStopStream,
  onSubmitText,
}: VoicePanelProps) {
  const [typedMessage, setTypedMessage] = useState('');

  const submitTypedMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = typedMessage.trim();
    if (!message) return;
    onSubmitText(message);
    setTypedMessage('');
  };

  return (
    <div className="relative flex h-dvh w-full flex-col items-center overflow-hidden px-4 py-3 sm:px-8 sm:py-5 lg:px-10" style={{ backgroundColor: backgroundColor || '#09090b' }}>
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

      <header className="z-20 grid w-full max-w-6xl shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-2 sm:gap-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">{assistantLogoUrl ? <img src={assistantLogoUrl} alt="NaviSense logo" className="size-full object-contain" /> : <Bot className="size-5 text-white" />}</div>
          <div className="flex min-w-0 flex-col"><span className="truncate text-sm font-black tracking-tight uppercase sm:text-lg">NaviSense</span><span className="hidden font-mono text-[10px] tracking-widest text-zinc-500 sm:block">CONVERSATIONAL AI</span></div>
        </div>
        <form onSubmit={submitTypedMessage} className="mx-auto flex w-full min-w-0 max-w-md items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-1 shadow-xl shadow-black/20 backdrop-blur-sm sm:gap-2 sm:rounded-2xl sm:p-2">
          <input value={typedMessage} onChange={(event) => setTypedMessage(event.target.value)} disabled={isThinking || isStreaming} placeholder="Destination or question..." aria-label="Enter a destination or ask NaviSense a question" className="min-w-0 flex-1 bg-transparent px-2 py-2 text-xs text-white outline-none placeholder:text-zinc-600 sm:px-3 sm:text-sm" />
          <button type="submit" disabled={!typedMessage.trim() || isThinking || isStreaming} aria-label="Send destination or question" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500 text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-30 sm:size-9 sm:rounded-xl"><Send className="size-4" /></button>
        </form>
        <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
          <Link href={destination ? `/directions?destination=${encodeURIComponent(destination)}` : '/directions'} aria-label="Open video directions" className="flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 transition hover:border-cyan-500/50 hover:text-cyan-300 sm:px-3 sm:py-1.5">
            <PlayCircle className="size-3.5" /><span className="hidden sm:inline">Video directions</span>
          </Link>
          <div aria-label={`NaviSense ${agentState}`} className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider md:flex ${agentState === 'listening' ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400' : agentState === 'thinking' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : agentState === 'speaking' || agentState === 'navigating' ? 'border-purple-500/30 bg-purple-500/10 text-purple-400' : 'border-zinc-800 bg-zinc-900 text-zinc-600'}`}>
            <div className={`size-1.5 rounded-full ${agentState === 'listening' ? 'animate-pulse bg-cyan-400' : agentState === 'thinking' ? 'animate-thinking bg-amber-400' : agentState === 'speaking' || agentState === 'navigating' ? 'animate-pulse bg-purple-400' : 'bg-zinc-600'}`} />
            {agentState}
          </div>
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 w-full max-w-6xl flex-1 items-center justify-center">
        <button type="button" onClick={isStreaming ? onStopStream : onStartStream} aria-label={isStreaming ? 'Stop voice conversation' : 'Start voice conversation'} aria-pressed={isStreaming} className="flex h-[min(52dvh,440px)] max-h-full w-full max-w-[560px] items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-4 focus-visible:ring-offset-zinc-950">
          <VoiceAuraScene agentState={agentState} isStreaming={isStreaming} isOrbSpeaking={isOrbSpeaking} isThinking={isThinking} speakingAmplitude={speakingAmplitude} auraColorA={auraColorA} auraColorB={auraColorB} />
        </button>
      </div>

      <div className="relative z-20 flex max-h-[35dvh] w-full max-w-2xl shrink-0 flex-col items-center gap-2 overflow-hidden">
        {(chatMessages.length > 0 || liveTranscript) && <div aria-label="Conversation transcript" aria-live="polite" className="flex max-h-[19dvh] min-h-12 w-full max-w-lg flex-col justify-center gap-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/90 p-3 backdrop-blur-sm">
            {[...chatMessages.slice(-3)].reverse().map((message, index) => <div key={`${message.timestamp}-${index}`} className={`flex min-w-0 items-start gap-2 ${message.role === 'user' ? 'text-zinc-300' : 'text-white'}`}>
              {message.role === 'user' ? <User className="mt-0.5 size-3.5 shrink-0 text-zinc-500" /> : <Bot className="mt-0.5 size-3.5 shrink-0 text-cyan-400" />}
              <p className="line-clamp-2 min-w-0 text-xs leading-relaxed"><span className="mr-1.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">{message.role === 'user' ? 'You' : 'NaviSense'}</span>{message.content}</p>
            </div>)}
            {liveTranscript && <div className="flex min-w-0 items-start gap-2 text-zinc-400">
              <User className="mt-0.5 size-3.5 shrink-0 text-cyan-400" />
              <p className="line-clamp-2 min-w-0 text-xs leading-relaxed"><span className="mr-1.5 font-mono text-[9px] uppercase tracking-wider text-cyan-400">You · listening</span>{liveTranscript}</p>
            </div>}
        </div>}
        {currentSystemMessage && !chatMessages.some((message) => message.role === 'assistant' && message.content === currentSystemMessage) && <div className="message-enter flex w-full max-w-lg items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-cyan-100 backdrop-blur-sm"><Volume2 className="mt-0.5 size-4 shrink-0 text-cyan-400" /><p className="line-clamp-2 text-xs font-medium leading-relaxed text-white">{currentSystemMessage}</p></div>}
        {appMode === 'navigation' && activeSlideNode && <div className="message-enter flex w-full max-w-lg items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-cyan-100 backdrop-blur-sm"><Navigation className="mt-1 size-4 shrink-0 text-cyan-400" /><div className="min-w-0 flex-1"><div className="mb-1 flex items-center justify-between gap-2"><span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Step {currentNodeIndex + 1} of {routeSlideCount}</span><span className="shrink-0 rounded border border-cyan-900 bg-cyan-950/40 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-400">{activeSlideNode.walkingTime}s walk</span></div><p className="line-clamp-2 text-xs font-medium leading-relaxed text-white">&quot;{rewrittenDirection || activeSlideNode.textDirection || (currentNodeIndex === 0 ? `This is the starting point: ${activeSlideNode.targetNodeLabel}.` : '')}&quot;</p>{activeSlideNode.isLandmark && <span className="mt-1 inline-flex items-center gap-1 rounded border border-purple-500/20 bg-purple-500/10 px-1.5 py-0.5 font-mono text-[9px] text-purple-400"><Landmark className="size-3" /> {activeSlideNode.landmarkType || 'Structural Junction'}</span>}</div></div>}
        {appMode === 'navigation' && <div className="flex min-h-5 items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          <Navigation className="size-3" />Navigating to {destination || '...'}
          <button type="button" onClick={onClearSequence} className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono text-[10px] tracking-normal text-zinc-400 transition hover:border-zinc-600 hover:text-white">Stop Navigation</button>
        </div>}
      </div>
    </div>
  );
}
