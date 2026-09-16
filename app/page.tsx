'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Mic, MicOff, MapPin, Landmark, Volume2, ArrowRight, MessageSquare, Navigation, Bot, User, Compass, Sparkles } from 'lucide-react';
import VoicePanel from '@/components/VoicePanel';

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
  video: string;
  isLandmark: boolean;
  landmarkType?: string;
}

// ─── Model Config ───
// Groq has deprecated llama-3.3-70b-versatile.
// Recommended production replacement:  openai/gpt-oss-120b
// Preview multimodal alternative:      qwen/qwen3.6-27b
const GROQ_MODEL_ID = 'openai/gpt-oss-120b';

export default function ConversationalWayfindingUI() {
  const router = useRouter();
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
  const liveConvexRoute = useQuery(api.routes.getWayfindingSequence, {
    transcriptInput: voiceIntentQuery
  });

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

  const NAVIGATION_STEP_HOLD_MS = 3500;

  // ─── Navigation Auto-Advance Effect ───
  useEffect(() => {
    if (appMode !== 'navigation') return;
    if (currentNodeIndex >= 0 && liveConvexRoute?.slides) {
      const activeSlide: SlideData = liveConvexRoute.slides[currentNodeIndex];
      if (activeSlide) {
        setAgentState('thinking');
        setIsThinking(true);
        
        rewriteDirection(activeSlide).then(async (clearText) => {
          setRewrittenDirection(clearText);
          setCurrentSystemMessage(clearText);
          setAgentState('navigating');
          setIsThinking(false);

          await new Promise((resolve) => setTimeout(resolve, 1200));
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

    const assistantName = buildingContext.assistantConfig?.assistantName || 'NaviSense';
    const personality = buildingContext.assistantConfig?.personality || 'Warm, welcoming, and conversational. Be concise but friendly.';
    const task = buildingContext.assistantConfig?.task || 'Help visitors find their way and answer questions about the building.';

    return `You are ${assistantName}, a building navigation assistant.

  PERSONALITY:
  ${personality}

  TASK:
  ${task}

BUILDING INFORMATION:
Floors:
${floorList}

Available Destinations/Rooms:
${destList}

ADDITIONAL RESPONSE RULES:
- Respond in the SAME LANGUAGE the user is speaking (English OR Chichewa/Chewa/Nyanja)
- Use natural language, not robotic
- If unsure, be honest and helpful
- Keep responses concise, usually 1-3 sentences
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
      const requestBody = {
        model: GROQ_MODEL_ID,
        messages,
        temperature: 0.7,
        max_tokens: 512,
        response_format: { type: 'json_object' },
        reasoning_format: 'hidden'
      };

      let response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok && response.status === 400) {
        // Keep the voice interaction usable if Groq rejects optional model controls.
        response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey.trim()}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: GROQ_MODEL_ID,
            messages,
            temperature: 0.7,
            max_tokens: 512
          })
        });
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Groq API error: ${response.status}${errorBody ? ` - ${errorBody.slice(0, 300)}` : ''}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('Groq response did not contain message content');
      let parsed: GroqIntent;
      try {
        parsed = JSON.parse(content);
      } catch {
        // The compatibility request may return normal prose instead of JSON.
        return { intent: 'chat', destination: null, response: content.trim() };
      }
      
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

    stopDeepgramTTS();
    setIsOrbSpeaking(true);
    setAgentState('speaking');
    clearSilenceTimer();

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
    }

    try {
      if (apiKey) {
        const response = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en', {
          method: 'POST',
          headers: {
            'Authorization': `Token ${apiKey.trim()}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text })
        });

        if (response.ok) {
          const audioContext = audioContextRef.current || new AudioContext();
          audioContextRef.current = audioContext;
          if (audioContext.state === 'suspended') await audioContext.resume();
          const audioBuffer = await audioContext.decodeAudioData(await response.arrayBuffer());

          await new Promise<void>((resolve) => {
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            currentAudioSourceRef.current = source;
            source.onended = () => {
              currentAudioSourceRef.current = null;
              resolve();
            };
            source.start(0);
          });
          return;
        }
        console.warn(`Deepgram TTS returned ${response.status}; using browser speech.`);
      }
    } catch (err) {
      console.warn('Deepgram TTS failed; using browser speech.', err);
    } finally {
      if (mediaRecorderRef.current?.state === "paused") {
        mediaRecorderRef.current.resume();
      }
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      });
    }
  };

  // ─── Silence & Conversation Handler ───
  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const handleUserSilenceEndpoint = async (submittedText?: string) => {
    if (blockAudioProcessingRef.current) return;

    const rawText = (submittedText ?? accumulatedSpeechRef.current).trim();
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
        
        await new Promise((resolve) => setTimeout(resolve, 600));
        await speakText(groqResult.response);

        stopWebRtcStream();
        router.push(`/directions?destination=${encodeURIComponent(destinationName)}`);
        
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
      }, NAVIGATION_STEP_HOLD_MS);
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
    if (!urlStr) return "";
    if (urlStr.startsWith("http://") || urlStr.startsWith("https://") || urlStr.startsWith("data:")) return urlStr;

    let baseUrl = process.env.NEXT_PUBLIC_CONVEX_URL || "";
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);

    const cleanStorageId = urlStr.startsWith("/") ? urlStr.slice(1) : urlStr;
    if (!baseUrl) return `/api/storage/${cleanStorageId}`;
    return `${baseUrl}/api/storage/${cleanStorageId}`;
  };

  const activeSlideNode = (liveConvexRoute && liveConvexRoute.slides && currentNodeIndex >= 0) 
    ? liveConvexRoute.slides[currentNodeIndex] 
    : null;

  const fallbackPlaceholder = "";

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
      return normalizeQrMatch(code.label) === normalizeQrMatch(preferredDestination);
    });

    if (destinationMatch) {
      return {
        label: destinationMatch.label,
        content: destinationMatch.content,
        imageUrl: buildQrImageUrl(destinationMatch.content),
      };
    }

    const fallback = buildingContext.qrCodes[0];
    if (!fallback) return null;

    return {
      label: fallback.label,
      content: fallback.content,
      imageUrl: buildQrImageUrl(fallback.content),
    };
  })();

  if (!hasMounted) return <div className="min-h-screen w-full bg-zinc-950" />;

  return (
    <div className="min-h-screen w-full overflow-hidden bg-zinc-950 font-sans text-white">
      <VoicePanel
        activeQrCode={activeQrCode}
        agentState={agentState}
        appMode={appMode}
        activeSlideNode={activeSlideNode}
        currentNodeIndex={currentNodeIndex}
        routeSlideCount={liveConvexRoute?.slides.length}
        currentSystemMessage={currentSystemMessage}
        rewrittenDirection={rewrittenDirection}
        isOrbSpeaking={isOrbSpeaking}
        isThinking={isThinking}
        isStreaming={isStreaming}
        destination={liveConvexRoute?.destination}
        onClearSequence={clearActiveSequence}
        onStartStream={startWebRtcStream}
        onStopStream={stopWebRtcStream}
        onSubmitText={(text) => { void handleUserSilenceEndpoint(text); }}
      />
    </div>
  );
}