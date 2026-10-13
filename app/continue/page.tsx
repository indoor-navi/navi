'use client';

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { BuildingContext } from '@/components/types';
import { ArrowRight, Camera, MapPin, Navigation, Sparkles } from 'lucide-react';

interface BrowserBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>;
}

type BrowserBarcodeDetectorConstructor = new (options: { formats: string[] }) => BrowserBarcodeDetector;
type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: BrowserBarcodeDetectorConstructor;
  barcodeDetector?: BrowserBarcodeDetectorConstructor;
};

const subscribeToNothing = () => () => {};
const getHydratedSnapshot = () => true;
const getServerSnapshot = () => false;

function getQueryParam(name: string) {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return params.get(name) || '';
}

export default function ContinueRoutePage() {
  const mounted = useSyncExternalStore(subscribeToNothing, getHydratedSnapshot, getServerSnapshot);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState('Scanning white QR markers...');
  const [scannerReady, setScannerReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const barcodeDetectorRef = useRef<BrowserBarcodeDetector | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const entityType = getQueryParam('entityType');
  const entityId = getQueryParam('entityId');
  const label = getQueryParam('label');

  const buildingContext = useQuery(api.routes.getBuildingContext) as BuildingContext | undefined;
  const destinationName = useMemo(() => {
    if (!buildingContext) return label || 'Destination';
    if (entityType === 'destination' && entityId) {
      const match = buildingContext.destinations.find((destination) => destination._id === entityId);
      if (match) return match.name;
    }
    if (entityType === 'node' && entityId) {
      const match = buildingContext.nodes.find((node) => node._id === entityId);
      if (match) return match.label;
    }
    return label || 'Destination';
  }, [buildingContext, entityId, entityType, label]);

  const route = useQuery(api.routes.getWayfindingSequence, {
    transcriptInput: destinationName || label || 'destination',
  });

  useEffect(() => {
    if (!mounted || typeof navigator === 'undefined') return;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const browserWindow = window as WindowWithBarcodeDetector;
        const BarcodeDetectorCtor = browserWindow.BarcodeDetector || browserWindow.barcodeDetector;
        if (BarcodeDetectorCtor) {
          try {
            barcodeDetectorRef.current = new BarcodeDetectorCtor({ formats: ['qr_code'] });
            setScannerReady(true);
            setScanStatus('QR anchor detected. Preparing route guidance...');
          } catch (detectorError) {
            console.warn('BarcodeDetector init failed:', detectorError);
            setScannerReady(false);
            setScanStatus('Camera ready. Route guidance is available while the QR marker is detected.');
          }
        } else {
          setScannerReady(false);
          setScanStatus('Camera ready. Route guidance is available while the QR marker is detected.');
        }
      } catch (error) {
        console.error('Camera access failed:', error);
        setCameraError('Camera permission is blocked. Please allow camera access to continue.');
      }
    };

    startCamera();

    return () => {
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [mounted]);

  useEffect(() => {
    const video = videoRef.current;
    const detector = barcodeDetectorRef.current;
    if (!video || !scannerReady || !detector) return;

    let cancelled = false;

    const detectQr = async () => {
      if (cancelled || !video.videoWidth || !video.videoHeight) return;

      try {
        const codes = await detector.detect(video);
        if (!codes?.length) return;

        const code = codes[0];
        const raw = String(code.rawValue || '');
        if (!raw) return;

        const params = new URL(raw).searchParams;
        const detectedEntityType = params.get('entityType');
        const detectedEntityId = params.get('entityId');
        const detectedLabel = params.get('label');

        if (detectedEntityType && detectedEntityId) {
          setScanStatus(`QR matched: ${detectedLabel || 'destination'}`);
          if (detectedLabel && detectedLabel !== destinationName) {
            console.log('[QR Scan] detected destination from live camera:', detectedLabel);
          }
        }
      } catch (error) {
        console.warn('Barcode detection failed in browser:', error);
      }
    };

    const intervalId = window.setInterval(detectQr, 1400);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [destinationName, scannerReady]);

  const nextStep = route?.slides?.[0];
  const progressText = route?.slides?.length
    ? `Route ready · ${route.slides.length} steps`
    : 'Calculating best path...';

  const voiceText = nextStep?.textDirection || nextStep?.description || `Continue toward ${destinationName}.`;
  const voiceCue = voiceText;

  const arrowRotation = nextStep?.textDirection?.toLowerCase().includes('left')
    ? '-45deg'
    : nextStep?.textDirection?.toLowerCase().includes('right')
      ? '45deg'
      : '0deg';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!voiceCue || !('speechSynthesis' in window)) return;

    const utterance = new SpeechSynthesisUtterance(voiceCue);
    utterance.lang = 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1.1;
    utterance.volume = 0.7;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);

    return () => {
      window.speechSynthesis.cancel();
    };
  }, [voiceCue]);

  if (!mounted) {
    return <div className="min-h-screen bg-zinc-950" />;
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-zinc-950 text-white">
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-slate-950 to-black" />

      <div className="relative z-10 flex h-screen w-full flex-col">
        <div className="relative flex-1 overflow-hidden bg-zinc-900">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
            autoPlay
          />

          {!cameraError && (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-[radial-gradient(circle,_rgba(0,0,0,0)_0%,_rgba(0,0,0,0.26)_52%,_rgba(0,0,0,0.74)_100%)]" />
              <div className="absolute left-1/2 top-[52%] h-[38vh] w-[38vh] max-h-[300px] max-w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] border-2 border-cyan-400/80 bg-cyan-400/5 shadow-[0_0_24px_rgba(34,211,238,0.4)]" />
              <div className="absolute left-1/2 top-[52%] flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/20 bg-white/5 backdrop-blur-sm">
                  <div className="h-7 w-7 rounded-full border-4 border-cyan-400/80" />
                </div>
              </div>
            </div>
          )}

          <div className="absolute left-3 top-3 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 backdrop-blur-md">
            <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.26em] text-cyan-300">
              <Camera className="h-3.5 w-3.5" />
              Live
            </div>
          </div>

          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
            <div className="relative flex h-24 w-24 items-center justify-center sm:h-28 sm:w-28">
              <div className="absolute h-20 w-20 rounded-full border border-cyan-500/40 bg-cyan-500/10 sm:h-24 sm:w-24" />
              <div
                className="absolute h-14 w-3 rounded-full bg-cyan-400 shadow-[0_0_18px_rgba(34,211,238,0.8)] sm:h-16 sm:w-4"
                style={{ transform: `rotate(${arrowRotation})` }}
              />
              <div
                className="absolute h-9 w-9 border-l-4 border-b-4 border-cyan-400 sm:h-11 sm:w-11"
                style={{ transform: `rotate(${arrowRotation}) translateY(-4px)` }}
              />
              <div
                className="absolute h-6 w-6 border-b-4 border-cyan-300 sm:h-7 sm:w-7"
                style={{ transform: `rotate(${arrowRotation})` }}
              />
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
            <div className="rounded-2xl border border-white/10 bg-black/55 p-3 shadow-2xl backdrop-blur-md sm:p-4">
              <div className="mb-2 flex items-center justify-between gap-2 text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-300">
                <span>{entityType === 'destination' ? 'Destination' : 'Waypoint'}</span>
                <span>{progressText}</span>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-300 sm:size-12">
                  <MapPin className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xl font-black text-white sm:text-2xl">{destinationName}</p>
                  <p className="mt-1 text-xs text-zinc-300 sm:text-sm">
                    {nextStep ? `Next: ${nextStep.targetNodeLabel}` : 'Route is being calculated'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 sm:p-4">
          <div className="rounded-2xl border border-cyan-400/30 bg-black/45 p-3 shadow-[0_0_30px_rgba(34,211,238,0.18)] backdrop-blur-md sm:p-4">
            <div className="mb-2 flex items-center justify-between gap-2 text-[8px] font-mono uppercase tracking-[0.2em] text-cyan-300 sm:text-[10px]">
              <span>Scanner</span>
              <span>{scannerReady ? 'Live' : 'Waiting'}</span>
            </div>
            <p className="text-xs text-zinc-100 sm:text-sm">{scanStatus}</p>
            <p className="mt-1 text-[11px] text-cyan-200 sm:text-xs">AI voice: {voiceCue}</p>
          </div>
        </div>

        {cameraError && (
          <div className="absolute inset-x-3 bottom-24 rounded-xl border border-amber-500/30 bg-amber-500/15 p-2.5 text-xs text-amber-100 backdrop-blur-sm sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[320px]">
            {cameraError}
          </div>
        )}
      </div>
    </div>
  );
}
