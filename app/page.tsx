'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';
import { Mic, MicOff, MapPin, Landmark, Volume2, ArrowRight, MessageSquare, Navigation, Bot, User, Compass, Sparkles } from 'lucide-react';

// ─── Types ───
type AgentState = 'offline' | 'listening' | 'thinking' | 'speaking' | 'navigating';
type AppMode = 'idle' | 'chat' | 'navigation';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface GroqIntent {
  intent: 'navigate' | 'chat';
  destination: string | null;
  response: string;
}

interface SlideData {
  id: string;
  stepTitle: string;
  originNodeLabel: string;
  targetNodeLabel: string;
  textDirection: string;
  description: string;
  walkingTime: number;
  image: string;
  isLandmark: boolean;
  landmarkType?: string;
}

// ─── Model Config ───
// Groq has deprecated llama-3.3-70b-versatile.
// Recommended production replacement:  openai/gpt-oss-120b
// Preview multimodal alternative:      qwen/qwen3.6-27b
const GROQ_MODEL_ID = 'openai/gpt-oss-120b';

export default function ConversationalWayfindingUI() {
  const [hasMounted, setHasMounted] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentState, setAgentState] = useState<AgentState>('offline');
  const [appMode, setAppMode] = useState<AppMode>('idle');
  
  // Chat & conversation state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<Array<{role: string; content: string}>>([]);
  const [currentSystemMessage, setCurrentSystemMessage] = useState<string>("");
  
  // Navigation state
  const [voiceIntentQuery, setVoiceIntentQuery] = useState<string>("");
  const [spokenDestinationName, setSpokenDestinationName] = useState<string>("");
  const [currentNodeIndex, setCurrentNodeIndex] = useState<number>(-1);
  const [rewrittenDirection, setRewrittenDirection] = useState<string>("");
  
  // Visual state
  const [isOrbSpeaking, setIsOrbSpeaking] = useState<boolean>(false);
  const [isThinking, setIsThinking] = useState<boolean>(false);

  // Data queries
  const buildingContext = useQuery(api.routes.getBuildingContext);
  const ensureQrCodeRecords = useMutation(api.admin.ensureQrCodeRecords);
  const liveConvexRoute = useQuery(api.routes.getWayfindingSequence, {
    transcriptInput: voiceIntentQuery
  });

  useEffect(() => {
    if (buildingContext) {
      ensureQrCodeRecords().catch(() => {
        console.warn('Unable to ensure QR code records exist yet.');
      });
    }
  }, [buildingContext, ensureQrCodeRecords]);

  // Refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const dgSocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const explicitDisconnectRef = useRef<boolean>(false);
  const keepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const accumulatedSpeechRef = useRef<string>("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const blockAudioProcessingRef = useRef<boolean>(false);
  const isStreamingRef = useRef(isStreaming);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setHasMounted(true); }, []);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages]);

  const getGroqApiKey = useCallback(() => {
    return (process.env.NEXT_PUBLIC_GROQ_API_KEY || process.env.NEXT_PRIVATE_GROQ_API_KEY || '').trim();
  }, []);

  // ─── NEW: Groq Direction Rewriter ───
  const rewriteDirection = useCallback(async (slide: SlideData): Promise<string> => {
    const apiKey = getGroqApiKey();
    if (!apiKey) {
      console.warn('Groq API key not configured; using original direction text.');
      return slide.description;
    }

    const prompt = `You are a building navigation assistant. Rewrite the following direction to be crystal clear, natural, and easy to follow when spoken aloud.

CONTEXT:
• From: ${slide.originNodeLabel}
• To: ${slide.targetNodeLabel}
• Landmark: ${slide.isLandmark ? (slide.landmarkType || 'Yes') : 'No'}
• Walking time: ~${slide.walkingTime} seconds

ORIGINAL DIRECTION:
"${slide.description}"

RULES:
1. Keep the EXACT SAME LANGUAGE as the original (English OR Chichewa/Chewa/Nyanja).
2. Make it concise — 1 to 2 short sentences max.
3. Use simple, spoken-friendly words.
4. Do NOT add greetings like "Sure!" or "Okay!".
5. Output ONLY the rewritten direction text. No quotes, no explanations.`;

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: GROQ_MODEL_ID,
          messages: [
            { role: 'system', content: 'You rewrite building navigation directions for maximum clarity. Output only the rewritten text, nothing else.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 256
        })
      });

      if (!res.ok) throw new Error(`Groq rewrite error: ${res.status}`);
      const data = await res.json();
      const rewritten = data.choices?.[0]?.message?.content?.trim();
      
      if (rewritten && rewritten.length > 5) {
        console.log('%c[Direction Rewritten]', 'color: #10b981; font-weight: bold;', rewritten);
        return rewritten;
      }
      return slide.description;
    } catch (err) {
      console.error('Direction rewrite failed:', err);
      return slide.description;
    }
  }, []);

  // ─── Navigation Auto-Advance Effect ───
  useEffect(() => {
    if (appMode !== 'navigation') return;
    if (currentNodeIndex >= 0 && liveConvexRoute?.slides) {
      const activeSlide: SlideData = liveConvexRoute.slides[currentNodeIndex];
      if (activeSlide) {
        setAgentState('thinking');
        setIsThinking(true);
        
        rewriteDirection(activeSlide).then((clearText) => {
          setRewrittenDirection(clearText);
          setCurrentSystemMessage(clearText);
          setAgentState('navigating');
          setIsThinking(false);
          
          return speakText(clearText);
        }).then(() => {
          handleNavigationStepComplete();
        }).catch(() => {
          handleSpeechErrorFallback();
        });
      }
    }
  }, [currentNodeIndex, liveConvexRoute, appMode, rewriteDirection]);

  // ─── Groq LLM Integration ───
  const buildSystemPrompt = useCallback(() => {
    if (!buildingContext) return "";
    
    const destList = buildingContext.destinations
      .map((d: any) => `- ${d.name} (also called: ${d.aliases.join(", ")})`)
      .join("\n");
    
    const floorList = buildingContext.floors
      .map((f: any) => `- ${f.name} (Level ${f.level})`)
      .join("\n");

    return `You are NaviSense, a warm, friendly, and professional building navigation assistant. You help visitors find their way and can chat casually about the building.

BUILDING INFORMATION:
Floors:
${floorList}

Available Destinations/Rooms:
${destList}

PERSONALITY:
- Warm, welcoming, and conversational
- Concise but friendly (1-3 sentences)
- Respond in the SAME LANGUAGE the user is speaking (English OR Chichewa/Chewa/Nyanja)
- Use natural language, not robotic
- If unsure, be honest and helpful

TASK:
1. Determine if the user wants directions ("navigate") or is just chatting ("chat")
2. For "navigate": match their request to the closest destination name EXACTLY as listed above, and give a brief friendly confirmation
3. For "chat": respond naturally and conversationally
4. If they ask about building info, use the context above

RESPOND ONLY IN THIS JSON FORMAT:
{"intent":"navigate"|"chat","destination":"exact name or null","response":"your friendly response"}`;
  }, [buildingContext]);

  const processWithGroq = async (transcript: string): Promise<GroqIntent> => {
    const apiKey = getGroqApiKey();
    if (!apiKey) {
      console.warn('Groq API key not configured; falling back to a safe chat response.');
      return { intent: 'chat', destination: null, response: "I'm here to help! Need directions or have questions about the building?" };
    }

    const messages = [
      { role: "system", content: buildSystemPrompt() },
      ...conversationHistory.slice(-6),
      { role: "user", content: transcript }
    ];

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: GROQ_MODEL_ID,
          messages,
          temperature: 0.7,
          max_tokens: 512,
          response_format: { type: 'json_object' },
          // GPT OSS 120B is a reasoning model; hide reasoning tokens so they
          // don't leak into the JSON output. Remove this if you switch to a
          // non-reasoning model (e.g. qwen/qwen3.6-27b with reasoning_effort: 'none').
          reasoning_format: 'hidden'
        })
      });

      if (!response.ok) throw new Error(`Groq API error: ${response.status}`);

      const data = await response.json();
      const parsed: GroqIntent = JSON.parse(data.choices[0].message.content);
      
      if (!parsed.intent || !parsed.response) {
        return { intent: 'chat', destination: null, response: "I'm here to help! Need directions or have questions about the building?" };
      }
      
      return parsed;
    } catch (err) {
      console.error("Groq processing error:", err);
      return { intent: 'chat', destination: null, response: "I'm having trouble understanding. Could you say that again?" };
    }
  };

  // ─── Audio / TTS ───
  const stopDeepgramTTS = () => {
    if (currentAudioSourceRef.current) {
      try { currentAudioSourceRef.current.stop(); } catch (e) {}
      try { currentAudioSourceRef.current.disconnect(); } catch (e) {}
      currentAudioSourceRef.current = null;
    }
  };

  const speakText = async (text: string): Promise<void> => {
    const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY || "";
    if (!apiKey) {
      console.error("Deepgram API Key missing");
      return;
    }

    stopDeepgramTTS();
    setIsOrbSpeaking(true);
    setAgentState('speaking');
    clearSilenceTimer();

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
    }

    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    try {
      const response = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
      });

      if (!response.ok) throw new Error("TTS API error");

      const audioBuffer = await response.arrayBuffer();
      if (!audioContextRef.current) return;

      await new Promise<void>((resolve, reject) => {
        audioContextRef.current!.decodeAudioData(audioBuffer, (decodedBuffer) => {
          const source = audioContextRef.current!.createBufferSource();
          source.buffer = decodedBuffer;
          source.connect(audioContextRef.current!.destination);
          currentAudioSourceRef.current = source;

          source.onended = () => {
            currentAudioSourceRef.current = null;
            resolve();
          };
          source.start(0);
        }, (err) => reject(err));
      });

    } catch (err) {
      console.error("TTS error:", err);
      throw err;
    } finally {
      if (mediaRecorderRef.current?.state === "paused") {
        mediaRecorderRef.current.resume();
      }
    }
  };

  // ─── Silence & Conversation Handler ───
  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const handleUserSilenceEndpoint = async () => {
    if (blockAudioProcessingRef.current) return;

    const rawText = accumulatedSpeechRef.current.trim();
    if (!rawText || rawText.length < 2) return;

    const cleanText = rawText
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (cleanText.length < 2) return;

    clearSilenceTimer();
    blockAudioProcessingRef.current = true;
    setIsThinking(true);
    setAgentState('thinking');

    const userMsg: ChatMessage = { role: 'user', content: cleanText, timestamp: Date.now() };
    setChatMessages(prev => [...prev, userMsg]);
    setConversationHistory(prev => [...prev, { role: 'user', content: cleanText }]);

    try {
      const groqResult = await processWithGroq(cleanText);
      
      const assistantMsg: ChatMessage = { role: 'assistant', content: groqResult.response, timestamp: Date.now() };
      setChatMessages(prev => [...prev, assistantMsg]);
      setConversationHistory(prev => [...prev, { role: 'assistant', content: groqResult.response }]);
      setCurrentSystemMessage(groqResult.response);

      if (groqResult.intent === 'navigate' && groqResult.destination) {
        const destinationName = groqResult.destination.trim();
        setSpokenDestinationName(destinationName);
        setAppMode('navigation');
        setAgentState('navigating');
        setIsThinking(false);
        
        await speakText(groqResult.response);
        
        setVoiceIntentQuery(destinationName.toLowerCase());
        setCurrentNodeIndex(0);
        
      } else {
        setSpokenDestinationName("");
        setAppMode('chat');
        setIsThinking(false);
        
        await speakText(groqResult.response);
        
        blockAudioProcessingRef.current = false;
        setIsOrbSpeaking(false);
        setAgentState('listening');
        setCurrentSystemMessage("");
        accumulatedSpeechRef.current = "";
      }

    } catch (err) {
      console.error("Conversation error:", err);
      setIsThinking(false);
      blockAudioProcessingRef.current = false;
      setAgentState('listening');
    }
  };

  // ─── Navigation Flow Control ───
  const handleNavigationStepComplete = () => {
    if (!liveConvexRoute?.slides) return;
    const totalSlides = liveConvexRoute.slides.length;
    
    if (currentNodeIndex < totalSlides - 1) {
      setTimeout(() => {
        setCurrentNodeIndex(prev => prev + 1);
      }, 1200);
    } else {
      finishNavigation();
    }
  };

  const finishNavigation = async () => {
    const arrivalMsg = `You've arrived at ${liveConvexRoute?.destination || "your destination"}.`;
    setCurrentSystemMessage(arrivalMsg);
    
    await speakText(arrivalMsg);
    
    setSpokenDestinationName("");
    setAppMode('chat');
    setCurrentNodeIndex(-1);
    setVoiceIntentQuery("");
    setRewrittenDirection("");
    accumulatedSpeechRef.current = "";
    blockAudioProcessingRef.current = false;
    setIsOrbSpeaking(false);
    setAgentState('listening');
    setCurrentSystemMessage("");
  };

  const handleSpeechErrorFallback = () => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
    }
    blockAudioProcessingRef.current = false;
    setIsOrbSpeaking(false);
    setIsThinking(false);
    setAgentState(isStreamingRef.current ? 'listening' : 'offline');
  };

  // ─── Deepgram STT Connection ───
  const connectToDeepgram = (stream: MediaStream) => {
    if (dgSocketRef.current) return;
    const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY || "";
    if (!apiKey) return;

    setAgentState('listening');

    try {
      const dgSocket = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-2&interim_results=true&smart_format=true`, 
        ['token', apiKey.trim()]
      );
      dgSocketRef.current = dgSocket;

      dgSocket.onopen = () => {
        if (keepAliveIntervalRef.current) clearInterval(keepAliveIntervalRef.current);
        keepAliveIntervalRef.current = setInterval(() => {
          if (dgSocketRef.current?.readyState === WebSocket.OPEN) {
            dgSocketRef.current.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 7000);

        const audioOnlyStream = new MediaStream(stream.getAudioTracks());
        mediaRecorderRef.current = new MediaRecorder(audioOnlyStream);
        mediaRecorderRef.current.ondataavailable = (event) => {
          if (blockAudioProcessingRef.current) return;
          if (event.data?.size > 0 && dgSocketRef.current?.readyState === WebSocket.OPEN) {
            dgSocketRef.current.send(event.data);
          }
        };
        mediaRecorderRef.current.start(250);
      };

      dgSocket.onmessage = (message) => {
        if (blockAudioProcessingRef.current) return;

        try {
          const receivedData = JSON.parse(message.data);
          const transcript = receivedData.channel?.alternatives[0]?.transcript;

          if (transcript?.trim()) {
            accumulatedSpeechRef.current = transcript.trim();
            
            clearSilenceTimer();
            silenceTimerRef.current = setTimeout(() => {
              handleUserSilenceEndpoint();
            }, 1400);
          }
        } catch (parseErr) {}
      };

      dgSocket.onclose = () => {
        if (keepAliveIntervalRef.current) clearInterval(keepAliveIntervalRef.current);
        dgSocketRef.current = null;
        
        if (!explicitDisconnectRef.current) {
          setAgentState('offline');
          
          if (typeof window !== 'undefined' && !navigator.onLine) {
            const handleOnline = () => {
              if (!explicitDisconnectRef.current && localStreamRef.current) {
                connectToDeepgram(localStreamRef.current);
              }
              window.removeEventListener('online', handleOnline);
            };
            window.addEventListener('online', handleOnline);
            return;
          }

          setTimeout(() => {
            if (!explicitDisconnectRef.current && localStreamRef.current) {
              connectToDeepgram(localStreamRef.current);
            }
          }, 2000);
        }
      };
    } catch (e) {}
  };

  // ─── Stream Controls ───
  const startWebRtcStream = async () => {
    try {
      explicitDisconnectRef.current = false;
      setIsStreaming(true);
      accumulatedSpeechRef.current = "";
      
      if (typeof window !== 'undefined') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      localStreamRef.current = stream;
      connectToDeepgram(stream);
    } catch (err) {
      setIsStreaming(false);
      setAgentState('offline');
    }
  };

  const stopWebRtcStream = () => {
    explicitDisconnectRef.current = true;
    clearSilenceTimer();
    if (keepAliveIntervalRef.current) clearInterval(keepAliveIntervalRef.current);
    if (mediaRecorderRef.current?.state !== 'inactive') {
      try { mediaRecorderRef.current?.stop(); } catch(e){}
    }
    dgSocketRef.current?.close();
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    
    stopDeepgramTTS();

    setIsStreaming(false);
    setAgentState('offline');
    setCurrentNodeIndex(-1);
    setVoiceIntentQuery("");
    setIsOrbSpeaking(false);
    setIsThinking(false);
    setRewrittenDirection("");
    blockAudioProcessingRef.current = false;
    accumulatedSpeechRef.current = "";
    setAppMode('idle');
    setCurrentSystemMessage("");
  };

  const clearActiveSequence = () => {
    clearSilenceTimer();
    setCurrentNodeIndex(-1);
    setVoiceIntentQuery("");
    setSpokenDestinationName("");
    setIsOrbSpeaking(false);
    setIsThinking(false);
    setRewrittenDirection("");
    blockAudioProcessingRef.current = false;
    accumulatedSpeechRef.current = "";
    setAgentState(isStreamingRef.current ? 'listening' : 'offline');
    setAppMode('chat');
    setCurrentSystemMessage("");
    stopDeepgramTTS();
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
    }
  };

  // ─── Render Helpers ───
  const getCleanAssetUrl = (urlStr: string) => {
    if (!urlStr) return "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1200";
    if (urlStr.startsWith("http://") || urlStr.startsWith("https://") || urlStr.startsWith("data:")) return urlStr;
    
    let baseUrl = process.env.NEXT_PUBLIC_CONVEX_URL || "";
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
    
    const cleanStorageId = urlStr.startsWith("/") ? urlStr.slice(1) : urlStr;
    return `${baseUrl}/api/storage/${cleanStorageId}`;
  };

  const activeSlideNode = (liveConvexRoute && liveConvexRoute.slides && currentNodeIndex >= 0) 
    ? liveConvexRoute.slides[currentNodeIndex] 
    : null;

  const fallbackPlaceholder = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1200";

  const buildQrImageUrl = (content: string) => {
    if (!content) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(content)}&size=220x220&margin=1`;
  };

  const normalizeQrMatch = (value: string) => (value || '').trim().toLowerCase().replace(/\s+/g, ' ');

  const activeQrCode: { label: string; content: string; imageUrl: string } | null = (() => {
    if (!buildingContext?.qrCodes) return null;

    const hasActiveDestinationIntent = Boolean(spokenDestinationName || liveConvexRoute?.destination);
    if (!hasActiveDestinationIntent && appMode !== 'navigation') return null;

    const preferredDestination = spokenDestinationName || liveConvexRoute?.destination || "";

    const destinationMatch = buildingContext.qrCodes.find((code: any) => {
      if (code.entityType !== 'destination') return false;
      return normalizeQrMatch(code.label) === normalizeQrMatch(preferredDestination);
    });

    if (destinationMatch) {
      return {
        label: destinationMatch.label,
        content: destinationMatch.content,
        imageUrl: buildQrImageUrl(destinationMatch.content),
      };
    }

    if (activeSlideNode) {
      const nodeMatch = buildingContext.qrCodes.find((code: any) =>
        code.entityType === 'node' && normalizeQrMatch(code.label) === normalizeQrMatch(activeSlideNode.targetNodeLabel)
      );

      if (nodeMatch) {
        return {
          label: nodeMatch.label,
          content: nodeMatch.content,
          imageUrl: buildQrImageUrl(nodeMatch.content),
        };
      }
    }

    const fallback = buildingContext.qrCodes.find((code: any) => code.entityType === 'destination');
    if (!fallback) return null;

    return {
      label: fallback.label,
      content: fallback.content,
      imageUrl: buildQrImageUrl(fallback.content),
    };
  })();

  if (!hasMounted) return <div className="min-h-screen w-full bg-zinc-950" />;

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-white font-sans overflow-hidden">
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes sweep-clockwise { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes speaking-vocal-ball { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); filter: brightness(1.25); } }
        @keyframes thinking-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes message-slide-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-sweep-clockwise { animation: sweep-clockwise 12s linear infinite; }
        .animate-speaking-ball { animation: speaking-vocal-ball 0.35s ease-in-out infinite; }
        .animate-thinking { animation: thinking-pulse 1.5s ease-in-out infinite; }
        .message-enter { animation: message-slide-in 0.3s ease-out forwards; }
      `}} />

      {/* ════════════════════════════════════════
          LEFT PANEL: Voice Core + Controls
          ════════════════════════════════════════ */}
      <div className="w-1/2 h-full flex flex-col items-center justify-between p-10 bg-gradient-to-b from-zinc-950 to-zinc-900/40 border-r border-zinc-900 relative">
        {activeQrCode && (
          <div className="absolute bottom-4 left-4 z-30 flex items-end gap-3 rounded-2xl border border-cyan-500/20 bg-zinc-950/90 p-3 backdrop-blur-md shadow-2xl shadow-cyan-950/20">
            <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-zinc-800 bg-white p-2">
              <img
                src={activeQrCode.imageUrl || buildQrImageUrl(activeQrCode.content)}
                alt={`${activeQrCode.label} QR code`}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex max-w-[160px] flex-col gap-1">
              <span className="text-[9px] font-mono uppercase tracking-[0.24em] text-cyan-400">Scan to continue</span>
              <span className="text-xs font-semibold text-white">{activeQrCode.label}</span>
              <span className="text-[10px] text-zinc-500">Open on your phone and continue from here.</span>
            </div>
          </div>
        )}
        
        {/* Header */}
        <header className="w-full flex items-center justify-between z-20">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Bot className="size-5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-black tracking-tight uppercase">NaviSense</span>
              <span className="text-[10px] text-zinc-500 font-mono tracking-widest">CONVERSATIONAL AI</span>
            </div>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-mono font-bold tracking-wider uppercase ${
            agentState === 'listening' ? 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10' :
            agentState === 'thinking' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10' :
            agentState === 'speaking' || agentState === 'navigating' ? 'border-purple-500/30 text-purple-400 bg-purple-500/10' :
            'border-zinc-800 text-zinc-600 bg-zinc-900'
          }`}>
            <div className={`size-1.5 rounded-full ${
              agentState === 'listening' ? 'bg-cyan-400 animate-pulse' :
              agentState === 'thinking' ? 'bg-amber-400 animate-thinking' :
              agentState === 'speaking' || agentState === 'navigating' ? 'bg-purple-400 animate-pulse' :
              'bg-zinc-600'
            }`} />
            {agentState === 'listening' ? 'Listening' : 
             agentState === 'thinking' ? 'Thinking' : 
             agentState === 'speaking' ? 'Speaking' : 
             agentState === 'navigating' ? 'Navigating' : 'Offline'}
          </div>
        </header>

        {/* Voice Orb */}
        <div className="relative flex items-center justify-center w-full my-auto z-10">
          <div className="absolute rounded-full pointer-events-none blur-3xl opacity-20 bg-gradient-to-r from-blue-600 to-cyan-500 w-[240px] h-[240px]" />
          <div className={`absolute rounded-full pointer-events-none transition-all duration-300 animate-sweep-clockwise bg-gradient-to-tr from-blue-600 via-purple-500 to-cyan-400 w-[210px] h-[210px] ${isOrbSpeaking ? 'animate-speaking-ball' : ''}`} style={{ opacity: isStreaming || isOrbSpeaking ? 0.85 : 0.15 }} />
          
          <div className="absolute size-[160px] rounded-full bg-zinc-950 flex flex-col items-center justify-center border border-zinc-900 shadow-[inset_0_4px_20px_rgba(0,0,0,0.95)]">
            <div className="relative flex flex-col items-center justify-center">
              <div className="w-24 flex justify-between items-center px-2">
                <div className={`size-2.5 rounded-full bg-cyan-400 ${agentState === 'listening' ? 'animate-pulse' : isOrbSpeaking ? 'animate-bounce' : ''}`} />
                <div className={`size-2.5 rounded-full bg-cyan-400 ${agentState === 'listening' ? 'animate-pulse [animation-delay:0.2s]' : isOrbSpeaking ? 'animate-bounce [animation-delay:0.12s]' : ''}`} />
              </div>
              <div className="h-10 mt-4 flex items-center justify-center">
                {agentState === 'thinking' || isThinking ? (
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" />
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce [animation-delay:0.1s]" />
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                  </div>
                ) : isOrbSpeaking ? (
                  <div className="flex gap-1 items-center h-4">
                    <span className="w-1 bg-cyan-400 rounded-full h-4 animate-pulse" />
                    <span className="w-1 bg-indigo-400 rounded-full h-6 animate-pulse [animation-delay:0.1s]" />
                    <span className="w-1 bg-purple-400 rounded-full h-3 animate-pulse [animation-delay:0.2s]" />
                  </div>
                ) : (
                  <div className="w-6 h-[2.5px] bg-cyan-400/80 rounded-full animate-pulse" />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Status & Current Message Panel */}
        <div className="w-full relative min-h-[200px] flex flex-col items-center justify-end z-20 gap-3">
          
          {/* Current spoken message */}
          {currentSystemMessage && (
            <div className="w-full max-w-lg px-4 py-3 font-sans text-sm text-cyan-100 bg-zinc-900/80 p-4 rounded-xl border border-zinc-800 backdrop-blur-sm flex items-start gap-3 message-enter">
              <Volume2 className="size-4 mt-0.5 text-cyan-400 shrink-0" />
              <p className="text-white text-[13px] leading-relaxed font-medium">
                {currentSystemMessage}
              </p>
            </div>
          )}

          {/* Navigation Step Info */}
          {appMode === 'navigation' && activeSlideNode && (
            <div className="w-full max-w-lg px-4 pb-2 font-sans text-sm text-cyan-100 bg-zinc-900/60 p-4 rounded-xl border border-zinc-800 backdrop-blur-sm flex items-start gap-3 message-enter">
              <Navigation className="size-4 mt-1 text-cyan-400 shrink-0" />
              <div className="space-y-1.5 flex-1">
                <div className="flex justify-between items-center border-b border-zinc-800/80 pb-1">
                  <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">
                    Step {currentNodeIndex + 1} of {liveConvexRoute?.slides.length}
                  </span>
                  <div className="flex items-center gap-2">
                    {rewrittenDirection && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-mono text-emerald-400 bg-emerald-950/30 border border-emerald-900 px-1.5 py-0.5 rounded">
                        <Sparkles className="size-2.5" /> AI Clarified
                      </span>
                    )}
                    <span className="text-[10px] text-cyan-400 font-mono font-bold bg-cyan-950/40 border border-cyan-900 px-1.5 py-0.5 rounded">
                      {activeSlideNode.walkingTime}s walk
                    </span>
                  </div>
                </div>
                <span className="text-zinc-400 text-xs block font-mono bg-zinc-950 p-2 rounded border border-zinc-900 text-center font-bold">
                  {activeSlideNode.originNodeLabel} ➔ {activeSlideNode.targetNodeLabel}
                </span>
                
                {/* Show rewritten direction if available, else raw */}
                <p className="text-white text-[13px] leading-relaxed font-medium pt-1">
                  "{rewrittenDirection || activeSlideNode.textDirection}"
                </p>
                
                {/* Raw DB direction (subtle) */}
                {rewrittenDirection && rewrittenDirection !== activeSlideNode.description && (
                  <p className="text-zinc-600 text-[11px] italic border-l-2 border-zinc-800 pl-2">
                    Original: {activeSlideNode.description}
                  </p>
                )}

                {activeSlideNode.isLandmark && (
                  <span className="mt-1 inline-flex items-center gap-1.5 text-[9px] font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded">
                    <Landmark className="size-3" /> {activeSlideNode.landmarkType || "Structural Junction"}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Mode indicator */}
          <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
            {appMode === 'chat' && <MessageSquare className="size-3" />}
            {appMode === 'navigation' && <Navigation className="size-3" />}
            {appMode === 'idle' && 'Ready to listen'}
            {appMode === 'chat' && 'Conversation Mode'}
            {appMode === 'navigation' && `Navigating to ${liveConvexRoute?.destination || '...'}`}
          </div>

          {/* Mic Button */}
          <div className="w-full flex items-center justify-center relative min-h-[56px]">
            <div className="flex items-center justify-center h-20 z-30 gap-4">
              {appMode === 'navigation' && (
                <button 
                  onClick={clearActiveSequence} 
                  className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-full text-[11px] font-mono text-zinc-400 hover:text-white hover:border-zinc-600 transition-all"
                >
                  Stop Navigation
                </button>
              )}
              
              {!isStreaming ? (
                <button onClick={startWebRtcStream} className="p-4 bg-zinc-900 border border-zinc-800 rounded-full transition-all hover:border-cyan-500 hover:scale-105">
                  <MicOff className="size-5 text-zinc-500" />
                </button>
              ) : (
                <button onClick={stopWebRtcStream} className="p-4 bg-gradient-to-r from-blue-600 to-cyan-500 text-white rounded-full transition-all hover:scale-105 shadow-lg shadow-cyan-500/20">
                  <Mic className="size-5 text-white" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════
          RIGHT PANEL: Dynamic Content View
          ════════════════════════════════════════ */}
      <div className="w-1/2 h-full bg-zinc-950 relative flex items-center justify-center p-6 overflow-hidden">
        <div className="w-full h-full rounded-2xl border border-zinc-900 bg-zinc-950/80 overflow-hidden flex flex-col relative shadow-2xl">
          
          {/* ─── CHAT MODE ─── */}
          {appMode === 'chat' && (
            <div className="flex flex-col h-full">
              <div className="p-4 border-b border-zinc-900 flex items-center gap-2">
                <MessageSquare className="size-4 text-cyan-400" />
                <span className="text-xs font-mono text-zinc-400 uppercase tracking-widest">Conversation</span>
              </div>
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8">
                    <Bot className="size-12 text-zinc-800 mb-4" />
                    <p className="text-zinc-500 text-sm max-w-xs leading-relaxed">
                      Press the microphone and start talking. Ask me about rooms, facilities, or just chat!
                    </p>
                    <p className="text-zinc-700 text-xs mt-3 font-mono">
                      Try: "Where is the ICT Lab?" or "What's on the first floor?"
                    </p>
                  </div>
                ) : (
                  chatMessages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} message-enter`}>
                      <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${
                          msg.role === 'user' ? 'bg-cyan-600' : 'bg-zinc-800 border border-zinc-700'
                        }`}>
                          {msg.role === 'user' ? <User className="size-4 text-white" /> : <Bot className="size-4 text-cyan-400" />}
                        </div>
                        <div className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed ${
                          msg.role === 'user' 
                            ? 'bg-cyan-600/20 border border-cyan-600/30 text-cyan-100' 
                            : 'bg-zinc-900 border border-zinc-800 text-zinc-300'
                        }`}>
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ─── NAVIGATION MODE ─── */}
          {appMode === 'navigation' && (
            <div className="w-full h-full flex flex-col">
              <div className="w-full flex-1 bg-zinc-900/40 relative overflow-hidden flex items-center justify-center">
                {activeSlideNode ? (
                  <img 
                    src={getCleanAssetUrl(activeSlideNode.image) || fallbackPlaceholder} 
                    alt="Wayfinding View" 
                    className="w-full h-full object-cover transition-all duration-500 opacity-90"
                    onError={(e) => { e.currentTarget.src = fallbackPlaceholder; }}
                    key={`slide-frame-${currentNodeIndex}`}
                  />
                ) : (
                  <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center gap-3">
                    <div className="size-8 rounded-full border-4 border-cyan-500/30 border-t-cyan-400 animate-spin" />
                    <span className="text-xs font-mono text-zinc-400 tracking-wider">Calculating route...</span>
                  </div>
                )}

                {/* Navigation overlay */}
                <div className="absolute top-4 left-4 right-4 bg-zinc-950/90 backdrop-blur-md p-3 rounded-xl border border-zinc-800 flex items-center justify-between gap-4 shadow-xl">
                  <div className="flex flex-col gap-0.5 truncate">
                    <span className="text-[9px] font-mono tracking-widest text-cyan-400 uppercase flex items-center gap-1.5 font-bold">
                      <Compass className="size-2.5 text-cyan-400 animate-pulse" /> Active Navigation
                    </span>
                    <span className="text-xs font-bold font-sans text-white truncate">
                      {activeSlideNode ? activeSlideNode.stepTitle : `Heading to ${liveConvexRoute?.destination || '...'}`}
                    </span>
                  </div>
                  
                  {activeSlideNode?.isLandmark && (
                    <div className="bg-purple-500/10 border border-purple-500/30 text-purple-400 text-[10px] px-2.5 py-1 rounded-lg font-mono flex items-center gap-1 shrink-0">
                      <Landmark className="size-3" /> {activeSlideNode.landmarkType?.toUpperCase() || "LANDMARK"}
                    </div>
                  )}
                </div>
              </div>

              {/* Progress dots */}
              {liveConvexRoute && liveConvexRoute.slides && currentNodeIndex >= 0 && (
                <div className="w-full border-t border-zinc-900 bg-zinc-950 px-6 py-4 flex items-center justify-between shadow-2xl">
                  <div className="flex flex-col max-w-[40%] truncate">
                    <span className="text-[10px] font-mono tracking-wider text-zinc-500 uppercase font-bold">Destination</span>
                    <span className="text-xs font-bold text-zinc-300 truncate">{liveConvexRoute.destination}</span>
                  </div>
                  
                  <div className="flex items-center gap-1.5 overflow-x-auto max-w-[60%] py-1 pl-2">
                    {liveConvexRoute.slides.map((slide, idx) => (
                      <div key={slide.id || idx} className="flex items-center shrink-0">
                        <div 
                          title={slide.stepTitle}
                          className={`size-3 rounded-full transition-all duration-300 cursor-help ${
                            idx === currentNodeIndex ? 'bg-cyan-400 ring-4 ring-cyan-500/20 scale-125' : 
                            idx < currentNodeIndex ? 'bg-emerald-500' : 'bg-zinc-800'
                          }`} 
                        />
                        {idx < liveConvexRoute.slides.length - 1 && <ArrowRight className="size-3 mx-1 text-zinc-700 shrink-0" />}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── IDLE MODE ─── */}
          {appMode === 'idle' && (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center">
              <div className="size-20 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6">
                <Compass className="size-10 text-zinc-700" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Welcome to NaviSense</h2>
              <p className="text-zinc-500 text-sm max-w-sm leading-relaxed mb-6">
                I'm your conversational building guide. Tap the microphone and speak naturally — ask for directions, building info, or just say hello!
              </p>
              <div className="flex flex-col gap-2 text-xs text-zinc-600 font-mono">
                <span>"Take me to the ICT Lab"</span>
                <span>"What rooms are on the first floor?"</span>
                <span>"Tell me about this building"</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}