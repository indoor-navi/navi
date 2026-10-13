'use client';

import React, { useState, useRef, useEffect, useCallback, useEffectEvent, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Mic, MicOff, MapPin, Landmark, Volume2, ArrowRight, MessageSquare, Navigation, Bot, User, Compass, Sparkles } from 'lucide-react';
import VoicePanel from '@/components/VoicePanel';
import type { BuildingContext } from '@/components/types';

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
const subscribeToNothing = () => () => {};
const getHydratedSnapshot = () => true;
const getServerSnapshot = () => false;
const getCurrentTimestamp = () => Date.now();

type WindowWithWebkitAudioContext = Window & { webkitAudioContext?: typeof AudioContext };

const getSpeechPauseDelay = (transcript: string) => {
  const text = transcript.trim();
  const soundsIncomplete = /(?:^|\s)(?:and|or|but|because|so|if|when|while|to|at|in|on|the|a|an|with|for|from|of|uh|um|er|ndipo|koma|chifukwa|ku|pa|ndi|ndikufuna|ndikupita|nditengereni|ndingapite|ndingapeze)(?:[.!?,;:]*)$/i.test(text);
  if (soundsIncomplete) return 4000;
  return /[.!?]["')\]]?$/.test(text) ? 1800 : 2600;
};

export default function ConversationalWayfindingUI() {
  const router = useRouter();
  const hasMounted = useSyncExternalStore(subscribeToNothing, getHydratedSnapshot, getServerSnapshot);
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentState, setAgentState] = useState<AgentState>('offline');
  const [appMode, setAppMode] = useState<AppMode>('idle');
  
  // Chat & conversation state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<Array<{role: string; content: string}>>([]);
  const [currentSystemMessage, setCurrentSystemMessage] = useState<string>("");
  const [liveTranscript, setLiveTranscript] = useState("");
  
  // Navigation state
  const [voiceIntentQuery, setVoiceIntentQuery] = useState<string>("");
  const [spokenDestinationName, setSpokenDestinationName] = useState<string>("");
  const [currentNodeIndex, setCurrentNodeIndex] = useState<number>(-1);
  const [rewrittenDirection, setRewrittenDirection] = useState<string>("");
  
  // Visual state
  const [isOrbSpeaking, setIsOrbSpeaking] = useState<boolean>(false);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [speakingAmplitude, setSpeakingAmplitude] = useState(0);

  // Data queries
  const buildingContext = useQuery(api.routes.getBuildingContext) as BuildingContext | undefined;
  const liveConvexRoute = useQuery(api.routes.getWayfindingSequence, {
    transcriptInput: voiceIntentQuery
  });
  const activeNavigationSlideId = liveConvexRoute?.slides?.[currentNodeIndex]?.id;

  // Refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const dgSocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const explicitDisconnectRef = useRef<boolean>(false);
  const keepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const accumulatedSpeechRef = useRef<string>("");
  const interimSpeechRef = useRef<string>("");
  const speechRunRef = useRef(0);
  const navigationSpeechStepRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const speakingAmplitudeIntervalRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockAudioProcessingRef = useRef<boolean>(false);
  const isStreamingRef = useRef(isStreaming);
  const handleUserSilenceEndpointRef = useRef<(submittedText?: string) => Promise<void>>(async () => {});
  const stopWebRtcStreamRef = useRef<() => void>(() => {});
  const chatScrollRef = useRef<HTMLDivElement>(null);

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

  // ─── Groq LLM Integration ───
  const buildSystemPrompt = useCallback(() => {
    if (!buildingContext) return "";
    
    const destList = buildingContext.destinations
      .map((d) => `- ${d.name} (also called: ${d.aliases.join(", ")})`)
      .join("\n");
    
    const floorList = buildingContext.floors
      .map((f) => `- ${f.name} (Level ${f.level})`)
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
- Understand English and Chichewa/Chewa/Nyanja, including code-switching, varied spelling, and imperfect speech-recognition transcripts.
- Understand Chichewa requests such as "nditengereni ku...", "ndikufuna kupita ku...", "... ili kuti?", and "ndingapeze kuti..." as navigation requests.
- Treat the user message as a speech-recognition transcript: tolerate missing punctuation, repeated words, and phonetic spellings without changing the likely intent.
- Respond in the same language as the user's latest message, following their language when they code-switch; do not translate Chichewa into English unless asked.
- When speaking English to a Malawian visitor, use warm, clear Malawian phrasing and spell out directions naturally. Do not caricature an accent or add slang unnecessarily.
- Use natural, concise language that is easy to understand when heard aloud.
- Speak like an attentive human guide: acknowledge the visitor's request briefly, use natural phrasing and contractions, and avoid repetitive greetings or formal/robotic wording.
- Keep spoken answers easy to follow; avoid markdown, lists, or symbol-heavy wording unless the user asks for details.
- If a destination or request is unclear, ask one short clarifying question instead of guessing.
- If unsure about building information, be honest and helpful.
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
        temperature: 0.4,
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
            temperature: 0.4,
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
    speechRunRef.current += 1;
    if (speakingAmplitudeIntervalRef.current !== null) {
      window.clearInterval(speakingAmplitudeIntervalRef.current);
      speakingAmplitudeIntervalRef.current = null;
    }
    setSpeakingAmplitude(0);
    if (currentAudioSourceRef.current) {
      try { currentAudioSourceRef.current.stop(); } catch (e) {}
      try { currentAudioSourceRef.current.disconnect(); } catch (e) {}
      currentAudioSourceRef.current = null;
    }
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  };

  const speakText = async (text: string): Promise<void> => {
    const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY || "";
    const chichewaText = /\b(?:nditengereni|ndikufuna|muli bwanji|zikomo|chonde|ili kuti|ndingapeze|kumene|chipinda|pafupi|ndingapite|ndikufuna kupita)\b/i.test(text);

    stopDeepgramTTS();
    const speechRun = speechRunRef.current;
    setIsOrbSpeaking(true);
    setSpeakingAmplitude(0);
    setAgentState('speaking');
    clearSilenceTimer();

    const playAudioBuffer = (audioContext: AudioContext, audioBuffer: AudioBuffer) => new Promise<void>((resolve) => {
      const source = audioContext.createBufferSource();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const samples = new Float32Array(analyser.fftSize);
      source.buffer = audioBuffer;
      source.connect(analyser);
      analyser.connect(audioContext.destination);
      currentAudioSourceRef.current = source;
      speakingAmplitudeIntervalRef.current = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        setSpeakingAmplitude(Math.min(1, rms * 12));
      }, 40);
      source.onended = () => {
        if (speakingAmplitudeIntervalRef.current !== null) {
          window.clearInterval(speakingAmplitudeIntervalRef.current);
          speakingAmplitudeIntervalRef.current = null;
        }
        analyser.disconnect();
        if (currentAudioSourceRef.current === source) currentAudioSourceRef.current = null;
        setSpeakingAmplitude(0);
        resolve();
      };
      source.start(0);
    });

    try {
      try {
        const malawianVoiceResponse = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (speechRun !== speechRunRef.current) return;
        if (malawianVoiceResponse.ok) {
          const audioContext = audioContextRef.current || new AudioContext();
          audioContextRef.current = audioContext;
          if (audioContext.state === 'suspended') await audioContext.resume();
          const audioBuffer = await audioContext.decodeAudioData(await malawianVoiceResponse.arrayBuffer());
          if (speechRun !== speechRunRef.current) return;
          await playAudioBuffer(audioContext, audioBuffer);
          return;
        }

        if (apiKey && !chichewaText) {
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
            if (speechRun !== speechRunRef.current) return;
            await playAudioBuffer(audioContext, audioBuffer);
            return;
          }
          console.warn(`Deepgram TTS returned ${response.status}; using browser speech.`);
        }
      } catch (err) {
        console.warn('Deepgram TTS failed; using browser speech.', err);
      }

      if (speechRun !== speechRunRef.current) return;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        await new Promise<void>((resolve) => {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = chichewaText ? 'ny-MW' : 'en-US';
          utterance.rate = 0.95;
          utterance.pitch = 1;
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        });
      }
    } finally {
      if (isStreamingRef.current && !explicitDisconnectRef.current && dgSocketRef.current?.readyState === WebSocket.OPEN) {
        setAgentState('listening');
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
    setLiveTranscript("");
    accumulatedSpeechRef.current = "";
    interimSpeechRef.current = "";

    const userMsg: ChatMessage = { role: 'user', content: cleanText, timestamp: getCurrentTimestamp() };
    setChatMessages(prev => [...prev, userMsg]);
    setConversationHistory(prev => [...prev, { role: 'user', content: cleanText }]);

    try {
      const groqResult = await processWithGroq(cleanText);
      
      const assistantMsg: ChatMessage = { role: 'assistant', content: groqResult.response, timestamp: getCurrentTimestamp() };
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

        stopWebRtcStreamRef.current();
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
  useEffect(() => {
    handleUserSilenceEndpointRef.current = handleUserSilenceEndpoint;
  });

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
    blockAudioProcessingRef.current = false;
    setIsOrbSpeaking(false);
    setIsThinking(false);
    setAgentState(isStreamingRef.current ? 'listening' : 'offline');
  };

  // ─── Navigation Auto-Advance Effect ───
  const runNavigationStep = useEffectEvent((slideId: string | undefined) => {
    const activeSlide = liveConvexRoute?.slides?.[currentNodeIndex];
    if (appMode !== 'navigation' || currentNodeIndex < 0 || !activeSlide || activeSlide.id !== slideId) {
      navigationSpeechStepRef.current = null;
      return undefined;
    }

    const stepKey = `${currentNodeIndex}:${activeSlide.id}`;
    if (navigationSpeechStepRef.current === stepKey) return undefined;
    navigationSpeechStepRef.current = stepKey;
    let cancelled = false;

    setAgentState('thinking');
    setIsThinking(true);

    rewriteDirection(activeSlide).then(async (clearText) => {
      if (cancelled) return false;
      setRewrittenDirection(clearText);
      setCurrentSystemMessage(clearText);
      setAgentState('navigating');
      setIsThinking(false);

      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (cancelled) return false;
      await speakText(clearText);
      return !cancelled;
    }).then((spoken) => {
      if (spoken && !cancelled) handleNavigationStepComplete();
    }).catch(() => {
      if (!cancelled) handleSpeechErrorFallback();
    });

    return () => {
      cancelled = true;
      if (navigationSpeechStepRef.current === stepKey) navigationSpeechStepRef.current = null;
      stopDeepgramTTS();
    };
  });

  useEffect(() => {
    return runNavigationStep(activeNavigationSlideId);
  }, [appMode, currentNodeIndex, activeNavigationSlideId]);

  // ─── Deepgram STT Connection ───
  const connectToDeepgram = (stream: MediaStream) => {
    if (dgSocketRef.current?.readyState === WebSocket.OPEN || dgSocketRef.current?.readyState === WebSocket.CONNECTING) return;
    const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY || "";
    if (!apiKey) {
      setAgentState('offline');
      setCurrentSystemMessage('Speech recognition is not configured. Add the Deepgram API key to enable voice conversations.');
      return;
    }

    setAgentState('listening');

    try {
      const dgSocket = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-2&language=multi&interim_results=true&smart_format=true`, 
        ['token', apiKey.trim()]
      );
      dgSocketRef.current = dgSocket;

      dgSocket.onopen = () => {
        if (explicitDisconnectRef.current || dgSocketRef.current !== dgSocket) {
          dgSocket.close();
          return;
        }
        if (keepAliveIntervalRef.current) clearInterval(keepAliveIntervalRef.current);
        keepAliveIntervalRef.current = setInterval(() => {
          if (dgSocket.readyState === WebSocket.OPEN) {
            dgSocket.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 7000);

        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.ondataavailable = null;
          mediaRecorderRef.current.stop();
        }
        const audioOnlyStream = new MediaStream(stream.getAudioTracks());
        const recorder = new MediaRecorder(audioOnlyStream);
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (blockAudioProcessingRef.current || dgSocketRef.current !== dgSocket) return;
          if (event.data?.size > 0 && dgSocket.readyState === WebSocket.OPEN) {
            dgSocket.send(event.data);
          }
        };
        recorder.start(250);
        setAgentState(blockAudioProcessingRef.current ? 'thinking' : 'listening');
      };

      dgSocket.onmessage = (message) => {
        if (blockAudioProcessingRef.current || dgSocketRef.current !== dgSocket) return;

        try {
          const receivedData = JSON.parse(message.data);
          const transcript = receivedData.channel?.alternatives[0]?.transcript;

          if (transcript?.trim()) {
            if (receivedData.is_final) {
              accumulatedSpeechRef.current = [accumulatedSpeechRef.current, transcript.trim()].filter(Boolean).join(' ');
              interimSpeechRef.current = "";
            } else {
              interimSpeechRef.current = transcript.trim();
            }

            const visibleTranscript = [accumulatedSpeechRef.current, interimSpeechRef.current].filter(Boolean).join(' ');
            setLiveTranscript(visibleTranscript);
            
            clearSilenceTimer();
            silenceTimerRef.current = setTimeout(() => {
              const completeTranscript = [accumulatedSpeechRef.current, interimSpeechRef.current].filter(Boolean).join(' ');
              void handleUserSilenceEndpointRef.current(completeTranscript);
            }, getSpeechPauseDelay(visibleTranscript));
          }
        } catch (parseErr) {
          console.error('Unable to parse speech recognition response.', parseErr);
        }
      };

      dgSocket.onclose = (event) => {
        if (dgSocketRef.current !== dgSocket) return;
        if (keepAliveIntervalRef.current) clearInterval(keepAliveIntervalRef.current);
        keepAliveIntervalRef.current = null;
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
          recorder.ondataavailable = null;
          recorder.stop();
        }
        mediaRecorderRef.current = null;
        dgSocketRef.current = null;
        
        if (!explicitDisconnectRef.current) {
          setAgentState('offline');
          if (event.code === 1008) {
            setCurrentSystemMessage('Speech recognition rejected the connection. Check the Deepgram API key and microphone configuration.');
            explicitDisconnectRef.current = true;
            localStreamRef.current?.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
            setIsStreaming(false);
            return;
          }
          
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

          if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            if (!explicitDisconnectRef.current && localStreamRef.current) {
              connectToDeepgram(localStreamRef.current);
            }
          }, 2000);
        }
      };
      dgSocket.onerror = () => {
        if (!explicitDisconnectRef.current && dgSocket.readyState !== WebSocket.CLOSED) dgSocket.close();
      };
    } catch (error) {
      console.error('Unable to establish speech recognition connection.', error);
      setAgentState('offline');
      setCurrentSystemMessage('Speech recognition connection failed. Reconnecting…');
      if (!explicitDisconnectRef.current && stream.active) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connectToDeepgram(stream);
        }, 2000);
      }
    }
  };

  // ─── Stream Controls ───
  const startWebRtcStream = async () => {
    try {
      if (!process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY?.trim()) {
        throw new Error('Speech recognition is not configured. Add the Deepgram API key to enable voice conversations.');
      }
      explicitDisconnectRef.current = false;
      setIsStreaming(true);
      accumulatedSpeechRef.current = "";
      interimSpeechRef.current = "";
      setLiveTranscript("");
      
      if (typeof window !== 'undefined') {
        const AudioContextConstructor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
        if (AudioContextConstructor) audioContextRef.current = new AudioContextConstructor();
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      localStreamRef.current = stream;
      connectToDeepgram(stream);
    } catch (error) {
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setIsStreaming(false);
      setAgentState('offline');
      setCurrentSystemMessage(error instanceof Error ? error.message : 'Microphone access could not be started. Allow microphone access in your browser settings and try again.');
    }
  };

  const stopWebRtcStream = () => {
    explicitDisconnectRef.current = true;
    clearSilenceTimer();
    if (keepAliveIntervalRef.current) clearInterval(keepAliveIntervalRef.current);
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      try { recorder.stop(); } catch (error) {
        console.error('Unable to stop microphone recorder.', error);
      }
    }
    dgSocketRef.current?.close();
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaRecorderRef.current = null;
    localStreamRef.current = null;
    
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
    interimSpeechRef.current = "";
    setLiveTranscript("");
    setAppMode('idle');
    setCurrentSystemMessage("");
  };
  useEffect(() => {
    stopWebRtcStreamRef.current = stopWebRtcStream;
  });

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
    interimSpeechRef.current = "";
    setLiveTranscript("");
    setAgentState(isStreamingRef.current ? 'listening' : 'offline');
    setAppMode('chat');
    setCurrentSystemMessage("");
    stopDeepgramTTS();
  };

  useEffect(() => {
    return () => {
      explicitDisconnectRef.current = true;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (keepAliveIntervalRef.current) clearInterval(keepAliveIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.ondataavailable = null;
        recorder.stop();
      }
      dgSocketRef.current?.close();
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      if (speakingAmplitudeIntervalRef.current !== null) window.clearInterval(speakingAmplitudeIntervalRef.current);
      try { currentAudioSourceRef.current?.stop(); } catch (error) {
        console.error('Unable to stop audio playback during cleanup.', error);
      }
      window.speechSynthesis?.cancel();
    };
  }, []);

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

    const destinationMatch = buildingContext.qrCodes.find((code) => {
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
        chatMessages={chatMessages}
        liveTranscript={liveTranscript}
        rewrittenDirection={rewrittenDirection}
        isOrbSpeaking={isOrbSpeaking}
        isThinking={isThinking}
        isStreaming={isStreaming}
        speakingAmplitude={speakingAmplitude}
        destination={liveConvexRoute?.destination}
        assistantLogoUrl={buildingContext?.assistantLogoUrl}
        auraColorA={buildingContext?.assistantConfig?.auraColorA}
        auraColorB={buildingContext?.assistantConfig?.auraColorB}
        backgroundColor={buildingContext?.assistantConfig?.backgroundColor}
        onClearSequence={clearActiveSequence}
        onStartStream={startWebRtcStream}
        onStopStream={stopWebRtcStream}
        onSubmitText={(text) => { void handleUserSilenceEndpoint(text); }}
      />
    </div>
  );
}