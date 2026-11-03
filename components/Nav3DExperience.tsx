/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, CornerUpLeft, CornerUpRight, Flag, List, MapPin,
  Pause, Play, RotateCcw, Send, Square, Volume2, VolumeX, X,
} from 'lucide-react';
import type { Cue, GuideState, PoseUpdate } from '@/lib/three/floorScene';
import { attachScene, getScene, prepareScene, preloadScene, startPose } from '@/lib/three/sceneStore';
import { getSceneStatus, getServerSceneStatus, subscribeSceneStatus } from '@/lib/three/sceneStatus';
import { buildRoute } from '@/lib/three/route';
import { findPath, nearestNode, pickStartNode, type GEdge, type GNode } from '@/lib/wayfinding/graph';
import { ARRIVED_LINE, PAUSED_LINE, type RouteStop } from '@/lib/wayfinding/describe';
import { analyseStops, requestGuidance, speechSeconds, takePlan, type AnalysedLeg } from '@/lib/wayfinding/plan';
import { speak, stopSpeaking } from '@/lib/voice/speak';

interface Msg { role: 'user' | 'assistant'; content: string; }
type Status = 'idle' | 'routing' | 'paused' | 'done';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const SPEEDS = [0.7, 1, 1.5, 2];

const CUE_UI: Record<Cue, { label: string; Icon: typeof ArrowUp }> = {
  straight: { label: 'Go straight', Icon: ArrowUp },
  left: { label: 'Turn left', Icon: CornerUpLeft },
  right: { label: 'Turn right', Icon: CornerUpRight },
  uturn: { label: 'Turn around', Icon: RotateCcw },
  arrive: { label: 'Arriving', Icon: Flag },
};

/* ───────────── on-screen controls ───────────── */

function Joystick({ onChange }: { onChange: (fwd: number, strafe: number, run: boolean) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const activeId = useRef<number | null>(null);
  const RADIUS = 46;

  const update = (e: React.PointerEvent) => {
    const r = baseRef.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx = (dx / len) * RADIUS; dy = (dy / len) * RADIUS; }
    setKnob({ x: dx, y: dy });
    const nx = dx / RADIUS; const ny = dy / RADIUS;
    const mag = Math.hypot(nx, ny);
    if (mag < 0.12) { onChange(0, 0, false); return; }
    onChange(-ny, nx, mag > 0.95);
  };
  const end = () => { activeId.current = null; setKnob({ x: 0, y: 0 }); onChange(0, 0, false); };

  return (
    <div
      ref={baseRef}
      role="application"
      aria-label="Movement joystick"
      className="relative size-[116px] rounded-full bg-black/35 border border-white/20 backdrop-blur-sm touch-none select-none"
      onPointerDown={(e) => { activeId.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); update(e); }}
      onPointerMove={(e) => { if (activeId.current === e.pointerId) update(e); }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span className="absolute left-1/2 top-1.5 -translate-x-1/2 text-[10px] text-white/50">▲</span>
      <span className="absolute left-1/2 bottom-1.5 -translate-x-1/2 text-[10px] text-white/50">▼</span>
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white/50">◀</span>
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/50">▶</span>
      <div
        className="absolute left-1/2 top-1/2 size-12 rounded-full bg-blue-500/80 border border-white/40 shadow-lg"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}

function HoldButton({ onHold, label, children }: { onHold: (down: boolean) => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="size-14 rounded-full bg-black/40 border border-white/20 backdrop-blur-sm flex items-center justify-center active:bg-blue-600/80 touch-none select-none"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onHold(true); }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
    >
      {children}
    </button>
  );
}

/* ───────────── main component ───────────── */

export default function Nav3DExperience({ initialDestination = '' }: { initialDestination?: string }) {
  const mapData = useQuery(api.mapAdmin.getPublishedMap) as any;
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const fsRef = useRef<any>(null);
  const routeRef = useRef<any>(null);
  const routePtsRef = useRef<Array<{ x: number; y: number; z: number }>>([]);
  const pinsRef = useRef<any[]>([]);
  const destPinRef = useRef<any>(null);
  const placedRef = useRef(false);
  const startedRef = useRef(false);
  const poseRef = useRef<PoseUpdate | null>(null);
  const guideKeyRef = useRef('');
  const routeLabelRef = useRef('');
  const mapDataRef = useRef<any>(null);
  const mutedRef = useRef(false);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const queuedRef = useRef(0);
  const epochRef = useRef(0);
  const briefRef = useRef('');
  const legsRef = useRef<AnalysedLeg[]>([]);
  const stepsRef = useRef<string[]>([]);
  const spokenLegRef = useRef(-1);
  const routeLenRef = useRef(1);
  const paceRef = useRef(1);
  const userMultRef = useRef(1);
  const arrivalLineRef = useRef('');
  const routeSeqRef = useRef(0);
  const wasPausedRef = useRef(false);
  const userPausedRef = useRef(false);

  const loadStatus = useSyncExternalStore(subscribeSceneStatus, getSceneStatus, getServerSceneStatus);
  const [sceneReady, setSceneReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [muted, setMuted] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: 'Hi! Where would you like to go?' },
  ]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [routeLabel, setRouteLabel] = useState('');
  const [guide, setGuide] = useState<GuideState | null>(null);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [panel, setPanel] = useState<'none' | 'chat' | 'places'>('none');

  useEffect(() => { mapDataRef.current = mapData; }, [mapData]);

  const pushMsg = useCallback((role: Msg['role'], content: string) => {
    setMessages((m) => [...m.slice(-12), { role, content }]);
  }, []);

  /**
   * Narrator: lines are spoken one after another and are NEVER cut off by a newer line — they wait their turn.
   * (Only Stop / mute / leaving the page cancels what is queued.)
   */
  const say = useCallback((text: string): Promise<void> => {
    if (mutedRef.current || !text) return Promise.resolve();
    const epoch = epochRef.current;
    queuedRef.current += 1;
    const run = chainRef.current
      .then(async () => {
        if (epoch !== epochRef.current || mutedRef.current) return;
        try { await speak(text); } catch { /* voice is a nice-to-have — the text is always shown */ }
      })
      .then(() => { queuedRef.current -= 1; });
    chainRef.current = run;
    return run;
  }, []);
  const cancelSpeech = useCallback(() => { epochRef.current += 1; stopSpeaking(); }, []);

  /** Walking pace = the leg's own pace, matched to how long its sentence takes to say, times the visitor's speed button. */
  function applyPace() {
    fsRef.current?.setGuideSpeed(paceRef.current * userMultRef.current);
  }

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) { cancelSpeech(); fsRef.current?.setGuideHold(false); paceRef.current = 1; applyPace(); }
  };

  /* ───────────── minimap (2D, north-up, follows the visitor's heading) ───────────── */
  const drawMinimap = useCallback(() => {
    const canvas = minimapRef.current;
    const md = mapDataRef.current;
    if (!canvas || !md?.nodes?.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width; const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const ps = md.nodes.map((n: any) => n.position);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of ps) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const pose = poseRef.current;
    if (pose) { minX = Math.min(minX, pose.x); maxX = Math.max(maxX, pose.x); minZ = Math.min(minZ, pose.z); maxZ = Math.max(maxZ, pose.z); }
    const pad = 14;
    const sc = Math.min((W - pad * 2) / Math.max(maxX - minX, 1), (H - pad * 2) / Math.max(maxZ - minZ, 1));
    const ox = (W - (maxX - minX) * sc) / 2; const oz = (H - (maxZ - minZ) * sc) / 2;
    const X = (x: number) => ox + (x - minX) * sc;
    const Z = (z: number) => oz + (z - minZ) * sc;
    const byId = new Map<string, any>(md.nodes.map((n: any) => [n._id, n]));

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(148,163,184,0.45)'; ctx.lineWidth = 3;
    for (const c of md.connections ?? []) {
      const a = byId.get(c.fromNodeId); const b = byId.get(c.toNodeId);
      if (!a || !b) continue;
      ctx.beginPath(); ctx.moveTo(X(a.position.x), Z(a.position.z)); ctx.lineTo(X(b.position.x), Z(b.position.z)); ctx.stroke();
    }
    const destNodeIds = new Set((md.destinations ?? []).map((d: any) => d.targetNodeId));
    for (const n of md.nodes) {
      ctx.fillStyle = destNodeIds.has(n._id) ? '#a78bfa' : 'rgba(148,163,184,0.8)';
      ctx.beginPath(); ctx.arc(X(n.position.x), Z(n.position.z), destNodeIds.has(n._id) ? 3.5 : 2, 0, Math.PI * 2); ctx.fill();
    }
    const rp = routePtsRef.current;
    if (rp.length > 1) {
      ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3.5;
      ctx.beginPath(); rp.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Z(p.z)) : ctx.moveTo(X(p.x), Z(p.z)))); ctx.stroke();
      const last = rp[rp.length - 1];
      ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(X(last.x), Z(last.z), 5, 0, Math.PI * 2); ctx.fill();
    }
    if (pose) {
      ctx.save();
      ctx.translate(X(pose.x), Z(pose.z));
      ctx.rotate(-pose.yaw);           // yaw 0 = north (−Z), positive = turning left (counter-clockwise)
      ctx.fillStyle = 'rgba(56,189,248,0.25)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-13, -22); ctx.lineTo(13, -22); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#38bdf8'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }, []);

  /* ───────────── scene lifecycle ─────────────
     The 3D building is built ONCE at app start (ScenePreloader). Here we only move the finished canvas
     into view — normally instant — and hook up this page's listeners. */
  useEffect(() => {
    let cancelled = false;
    const offs: Array<() => void> = [];
    let park: () => void = () => {};
    (async () => {
      try {
        const fs = await preloadScene();   // already resolved when the app preloaded it
        if (cancelled || !containerRef.current) return;
        fsRef.current = fs;
        park = attachScene(containerRef.current);
        setSceneReady(true);

        offs.push(fs.onFrame((t: number, dt: number) => {
          routeRef.current?.update(dt);
          const pin = destPinRef.current;
          if (pin) {
            pin.userData.ring && pin.userData.ring.scale.setScalar(1 + 0.15 * Math.sin(t * 3));
            // only show the destination marker when it is in direct line of sight (never through walls)
            if (Math.floor(t * 6) % 2 === 0) pin.visible = fs.hasLineOfSight(pin.position);
          }
        }));
        offs.push(fs.onUpdate((pose: PoseUpdate) => {
          poseRef.current = pose;
          drawMinimap();
          const g = pose.guide;
          const key = g ? `${g.active}|${g.paused}|${g.cue}|${Math.round(g.remaining * 2)}|${g.turnIn === null ? '-' : Math.round(g.turnIn)}` : 'none';
          if (key !== guideKeyRef.current) { guideKeyRef.current = key; setGuide(g); }
          announceGuideRef.current(g);
        }));
        offs.push(fs.onArrive(() => {
          setStatus('done');
          const line = arrivalLineRef.current || ARRIVED_LINE(routeLabelRef.current);
          pushMsg('assistant', line);
          void say(line);        // queued: it starts only after the last step has been said in full
        }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown model loading error';
        setLoadError(`Could not load the 3D building: ${reason}`);
      }
    })();
    return () => {
      cancelled = true;
      offs.forEach((fn) => fn());
      cancelSpeech();
      // leave the shared scene clean for the next visit
      getScene()?.stopGuide();
      routeRef.current?.dispose();
      routeRef.current = null;
      for (const p of pinsRef.current) p.removeFromParent?.();
      pinsRef.current = [];
      destPinRef.current = null;
      park();
      fsRef.current = null;
    };
  }, [drawMinimap, pushMsg, say, cancelSpeech]);

  /* make sure the interior is prepared (normally already done in the background at app start) */
  useEffect(() => {
    if (mapData) void prepareScene(mapData);
  }, [mapData]);

  /**
   * Keeps the voice and the walk in step, every frame:
   *  • when the visitor starts a new stretch of the green line, the AI's line for that stretch is spoken,
   *    and the walking pace is set so the stretch takes about as long as the sentence;
   *  • if the sentence is still running when the end of the stretch (the bend / the destination) is about to
   *    be reached, the walk waits there until the sentence is finished — so nothing is cut off and nothing
   *    is said only after arriving.
   */
  const announceGuideRef = useRef<(g: GuideState | null) => void>(() => {});
  useEffect(() => {
    announceGuideRef.current = (g) => {
      const fs = fsRef.current;
      if (!g || !g.active) { wasPausedRef.current = false; fs?.setGuideHold(false); return; }
      if (g.paused) {
        // the visitor grabbed the controls: remind them how to stay on / rejoin the line
        if (!wasPausedRef.current && !userPausedRef.current) { pushMsg('assistant', PAUSED_LINE); void say(PAUSED_LINE); }
        wasPausedRef.current = true;
        return;
      }
      wasPausedRef.current = false;
      userPausedRef.current = false;
      const legs = legsRef.current;
      if (!fs || !legs.length) return;

      let i = legs.findIndex((l) => g.progress < l.endFrac - 1e-6);
      if (i < 0) i = legs.length - 1;
      if (i !== spokenLegRef.current) {
        spokenLegRef.current = i;
        const step = stepsRef.current[i] ?? '';
        const base = fs.getSettings().guideSpeed || 1.7;
        paceRef.current = mutedRef.current || !step ? 1 : Math.min(1.6, Math.max(0.55, legs[i].distance / (speechSeconds(step) * base)));
        applyPace();
        void say(step);
      }
      const metresToLegEnd = (legs[i].endFrac - g.progress) * routeLenRef.current;
      fs.setGuideHold(queuedRef.current > 0 && metresToLegEnd < 1.0);
    };
  }, [pushMsg, say]);

  /* Place the visitor INSIDE at the entrance / start point, facing into the building. */
  useEffect(() => {
    const fs = fsRef.current;
    if (!sceneReady || !fs || !mapData || placedRef.current) return;
    placedRef.current = true;
    const { pos, yaw, startNode } = startPose(mapData, fs);
    fs.goInside(pos, yaw);
    fs.playIntro();
    if (!initialDestination) {
      pushMsg('assistant', startNode
        ? `You're at ${startNode.label}. Use the joystick or W A S D to walk, drag to look around — or tell me where to go.`
        : "You're at the main entrance. Use the joystick or W A S D to walk, drag to look around.");
    }
    drawMinimap();
  }, [sceneReady, mapData, pushMsg, drawMinimap, initialDestination]);

  /* ───────────── routing ───────────── */
  function clearRoute() {
    routeSeqRef.current += 1;
    legsRef.current = [];
    stepsRef.current = [];
    spokenLegRef.current = -1;
    fsRef.current?.stopGuide();
    routeRef.current?.dispose();
    routeRef.current = null;
    for (const p of pinsRef.current) p.removeFromParent?.();
    pinsRef.current = [];
    destPinRef.current = null;
    routePtsRef.current = [];
    guideKeyRef.current = 'none';
    setGuide(null);
  }

  async function startRoute(query: string) {
    const fs = fsRef.current;
    if (!fs || !mapData) { pushMsg('assistant', 'Still loading the building, one moment…'); return; }
    const q = norm(query);
    const dest =
      mapData.destinations.find((d: any) => norm(d.name) === q) ??
      mapData.destinations.find((d: any) => [d.name, ...d.aliases].some((a: string) => {
        const na = norm(a);
        return na && (na.includes(q) || q.includes(na));
      }));
    if (!dest) { pushMsg('assistant', `I couldn't find "${query}". Try one of the places in the list.`); return; }

    const ns: GNode[] = mapData.nodes.map((n: any) => ({ id: n._id, label: n.label, position: n.position }));
    const es: GEdge[] = mapData.connections.map((c: any) => ({ from: c.fromNodeId, to: c.toNodeId }));
    // start from wherever the visitor is standing right now
    const me = fs.getFpv();
    const startId = nearestNode(ns, { x: me.x, y: me.y, z: me.z }) ?? pickStartNode(ns);
    const path = startId ? findPath(ns, es, startId, dest.targetNodeId) : null;
    clearRoute();
    const seq = routeSeqRef.current;
    if (!path?.length) { pushMsg('assistant', `No walking route is mapped to ${dest.name} yet.`); return; }
    if (path.length === 1) { pushMsg('assistant', `You are already at ${dest.name}.`); return; }

    const stops: RouteStop[] = path.map((id) => { const n = ns.find((x) => x.id === id)!; return { label: n.label, position: n.position }; });
    if (Math.hypot(stops[0].position.x - me.x, stops[0].position.z - me.z) > 1.2) stops.unshift({ label: '', position: { x: me.x, y: stops[0].position.y, z: me.z } });
    const pts: Array<{ x: number; y: number; z: number }> = stops.map((st) => st.position);
    routePtsRef.current = pts;

    const route = buildRoute(fs.THREE, pts);
    fs.scene.add(route.group);
    routeRef.current = route;

    const { makePin } = await import('@/lib/three/pins');
    const destPin = await makePin(0xef4444, dest.name);
    if (seq !== routeSeqRef.current) { destPin.removeFromParent?.(); return; }
    const last = pts[pts.length - 1];
    destPin.position.set(last.x, last.y, last.z);
    fs.scene.add(destPin);
    pinsRef.current = [destPin];
    destPinRef.current = destPin;

    routeLabelRef.current = dest.name;
    setRouteLabel(dest.name);
    setStatus('routing');
    setPanel('none');
    drawMinimap();

    // The AI analyses the route (points, distances, pace) and writes what to say. When the visitor asked from
    // the home screen this is already done (and the overview already spoken); otherwise it is done now, with the
    // green line already visible, and the overview is spoken IN FULL before the walk begins.
    const analysis = analyseStops(dest.name, stops, fs.getSettings().guideSpeed || 1.7);
    let plan = analysis ? takePlan(dest.name, analysis.legs.length) : null;
    if (analysis && !plan) {
      plan = await requestGuidance(analysis, { userText: query, apiKey: (process.env.NEXT_PUBLIC_GROQ_API_KEY || '').trim() });
      if (seq !== routeSeqRef.current) return;
    }
    if (analysis && plan) {
      legsRef.current = analysis.legs;
      stepsRef.current = plan.steps;
      arrivalLineRef.current = plan.arrival;
      routeLenRef.current = route.length;
      briefRef.current = [plan.overview, ...plan.steps].join(' ');
      pushMsg('assistant', plan.overview);
      if (!plan.overviewSpoken) {
        await say(plan.overview);
        if (seq !== routeSeqRef.current) return;
      }
    } else {
      arrivalLineRef.current = '';
    }

    spokenLegRef.current = -1;
    paceRef.current = 1;
    wasPausedRef.current = false;
    userPausedRef.current = false;
    fs.startGuide(route.curve, route.length, userMultRef.current);
  }

  function stopRoute(message = 'Navigation stopped. Where to next?') {
    cancelSpeech();
    clearRoute();
    setStatus('idle');
    pushMsg('assistant', message);
    drawMinimap();
  }

  function onSend(text?: string) {
    const q = (text ?? input).trim();
    if (!q) return;
    setInput('');
    pushMsg('user', q);
    if (/^(hi|hello|hey|moni|mulibwanji|good)\b/i.test(q)) {
      pushMsg('assistant', 'Hello! Tell me where you want to go — for example "Take me to the Cafe".');
      return;
    }
    if (/^(stop|cancel|end)\b/i.test(q)) { stopRoute(); return; }
    if (/^(pause|wait)\b/i.test(q)) { userPausedRef.current = true; fsRef.current?.pauseGuide(); return; }
    if (/^(repeat|again|say that again|explain|how do i (follow|get|find))/i.test(q) && briefRef.current && routing) { void say(briefRef.current); return; }
    if (/^(resume|continue|go on)\b/i.test(q)) { fsRef.current?.resumeGuide(); return; }
    if (/where am i|my location/i.test(q) && mapData?.nodes?.length && fsRef.current) {
      const me = fsRef.current.getFpv();
      const id = nearestNode(mapData.nodes.map((n: any) => ({ id: n._id, label: n.label, position: n.position })), me);
      const n = mapData.nodes.find((x: any) => x._id === id);
      pushMsg('assistant', n ? `You are near ${n.label}.` : 'I could not work out where you are.');
      return;
    }
    // "take me to the cafe" → "cafe"
    startRoute(q.replace(/^(please\s+)?(take me|bring me|guide me|navigate|directions?|go|walk me)\s+(to|towards)?\s*(the\s+)?/i, '') || q);
  }

  useEffect(() => {
    if (initialDestination && mapData && sceneReady && fsRef.current && placedRef.current && !startedRef.current) {
      startedRef.current = true;
      onSend(initialDestination);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDestination, mapData, sceneReady]);


  const setMove = useCallback((fwd: number, strafe: number, run: boolean) => {
    fsRef.current?.setMoveInput({ fwd, strafe, run });
  }, []);
  const setTurn = useCallback((turn: number) => { fsRef.current?.setMoveInput({ turn }); }, []);

  const goToViewpoint = (vp: any) => {
    const fs = fsRef.current;
    if (!fs) return;
    if (routing) fs.pauseGuide();
    fs.goInside(vp.position, vp.yaw, vp.pitch);
    setPanel('none');
    pushMsg('assistant', `You are now at ${vp.name}.`);
  };

  const places: any[] = mapData?.destinations ?? [];
  const viewpoints: any[] = mapData?.viewpoints ?? [];
  const cue = guide && guide.active && !guide.paused ? CUE_UI[guide.cue] : null;
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  // paused / walking is derived from what the scene reports, so the header can never get out of step
  const shownStatus: Status = status === 'routing' && guide?.active && guide.paused ? 'paused' : status;
  const routing = shownStatus === 'routing' || shownStatus === 'paused';

  return (
    <div className="h-[100dvh] w-screen bg-[#141b2b] text-white relative overflow-hidden select-none">
      <div ref={containerRef} className="absolute inset-0" />

      {loadError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0b1220] p-8 text-center">
          <div className="max-w-md space-y-3">
            <p className="text-lg font-semibold text-red-400">3D model not found</p>
            <p className="text-sm text-slate-400">{loadError}</p>
          </div>
        </div>
      )}

      {/* loading overlay: normally never seen, because the building is prepared when the app opens */}
      {!loadError && (!sceneReady || loadStatus.phase === 'loading' || loadStatus.phase === 'preparing') && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[#0b1220]/95">
          <div className="size-10 rounded-full border-4 border-blue-500/30 border-t-blue-400 animate-spin" />
          <p className="text-sm font-semibold">{loadStatus.phase === 'preparing' ? 'Preparing the interior…' : 'Loading the building…'}</p>
          <div className="w-56 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round(loadStatus.progress * 100)}%` }} />
          </div>
        </div>
      )}

      {/* header */}
      <header className="absolute top-0 left-0 right-0 h-14 flex items-center gap-3 px-3 bg-gradient-to-b from-black/70 to-transparent z-10 pointer-events-none">
        <Link href="/" className="pointer-events-auto p-2 rounded-lg hover:bg-white/10" aria-label="Back"><ArrowLeft className="size-5" /></Link>
        <div className="min-w-0">
          <p className="font-bold leading-tight truncate">ODeL Indoor Navigation</p>
          <p className="text-xs text-slate-300 truncate">
            {shownStatus === 'routing' && `Walking to ${routeLabel}`}
            {shownStatus === 'paused' && `Paused — heading to ${routeLabel}`}
            {shownStatus === 'done' && `Arrived at ${routeLabel}`}
            {shownStatus === 'idle' && 'Ground Floor'}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Turn voice guidance on' : 'Turn voice guidance off'}
          aria-pressed={muted}
          className="pointer-events-auto ml-auto mr-[140px] p-2 rounded-lg hover:bg-white/10"
        >
          {muted ? <VolumeX className="size-5 text-slate-400" /> : <Volume2 className="size-5" />}
        </button>
      </header>

      {/* minimap */}
      {mapData?.nodes?.length > 0 && (
        <canvas
          ref={minimapRef}
          width={320}
          height={320}
          className="absolute top-14 right-3 z-10 size-[132px] rounded-2xl bg-black/45 border border-white/15 backdrop-blur-sm pointer-events-none"
        />
      )}

      {/* direction cue: front / left / right */}
      {cue && guide && (
        <div className="absolute top-16 left-3 z-10 pointer-events-none" role="status" aria-live="polite">
          <div className="flex items-center gap-3 rounded-2xl bg-zinc-950/85 border border-amber-200/60 px-4 py-2.5 shadow-lg shadow-black/40 backdrop-blur-sm">
            <cue.Icon className={`size-9 shrink-0 text-amber-200 stroke-[2.5] ${guide.cue === 'straight' ? '' : 'animate-pulse'}`} />
            <div>
              <p className="font-mono text-xs font-bold tracking-wider text-amber-200 uppercase">{cue.label}</p>
              <p className="text-xs text-slate-300">
                {guide.cue === 'arrive'
                  ? `${Math.max(1, Math.round(guide.remaining))} m to ${routeLabel}`
                  : guide.turnIn !== null
                    ? `in ${Math.max(1, Math.round(guide.turnIn))} m · ${Math.round(guide.remaining)} m left`
                    : `${Math.round(guide.remaining)} m left`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* guide controls */}
      {routing && (
        <div className="absolute top-[7.5rem] left-3 z-10 flex items-center gap-2">
          {shownStatus === 'paused' ? (
            <button onClick={() => fsRef.current?.resumeGuide()} className="flex items-center gap-1.5 rounded-full bg-green-600 hover:bg-green-500 px-3.5 py-2 text-xs font-bold shadow-lg">
              <Play className="size-3.5" /> Resume
            </button>
          ) : (
            <button onClick={() => { userPausedRef.current = true; fsRef.current?.pauseGuide(); }} className="flex items-center gap-1.5 rounded-full bg-black/55 border border-white/20 hover:bg-black/70 px-3.5 py-2 text-xs font-bold backdrop-blur-sm">
              <Pause className="size-3.5" /> Pause
            </button>
          )}
          <button
            onClick={() => { const i = (speedIdx + 1) % SPEEDS.length; setSpeedIdx(i); userMultRef.current = SPEEDS[i]; applyPace(); }}
            className="rounded-full bg-black/55 border border-white/20 hover:bg-black/70 px-3 py-2 text-xs font-bold backdrop-blur-sm"
            aria-label="Change walking speed"
          >
            {SPEEDS[speedIdx]}×
          </button>
          <button onClick={() => stopRoute()} className="flex items-center gap-1.5 rounded-full bg-red-600/80 hover:bg-red-500 px-3 py-2 text-xs font-bold">
            <Square className="size-3" /> Stop
          </button>
        </div>
      )}

      {shownStatus === 'done' && (
        <div className="absolute top-16 left-3 z-10 flex items-center gap-3 rounded-2xl bg-green-950/85 border border-green-400/50 px-4 py-2.5 backdrop-blur-sm">
          <Flag className="size-7 text-green-300" />
          <div>
            <p className="text-sm font-bold text-green-200">You have arrived</p>
            <p className="text-xs text-slate-300">{routeLabel}</p>
          </div>
          <button onClick={() => { clearRoute(); setStatus('idle'); }} className="ml-2 p-1 rounded hover:bg-white/10" aria-label="Dismiss"><X className="size-4" /></button>
        </div>
      )}

      {/* hint (desktop) */}
      <p className="hidden md:block absolute bottom-[4.9rem] left-1/2 -translate-x-1/2 z-10 rounded-full bg-black/45 px-3 py-1 text-[11px] text-slate-300 pointer-events-none">
        W A S D walk · Shift run · Q / E or ← → turn · drag to look · scroll to zoom
      </p>

      {/* movement controls */}
      <div className="absolute bottom-[4.6rem] left-3 z-10"><Joystick onChange={setMove} /></div>
      <div className="absolute bottom-[4.6rem] right-3 z-10 flex items-center gap-2.5">
        <HoldButton label="Turn left" onHold={(d) => setTurn(d ? 1 : 0)}><ChevronLeft className="size-7" /></HoldButton>
        <HoldButton label="Turn right" onHold={(d) => setTurn(d ? -1 : 0)}><ChevronRight className="size-7" /></HoldButton>
      </div>

      {/* chat / places sheet */}
      {panel !== 'none' && (
        <div className="absolute bottom-[4.4rem] left-1/2 -translate-x-1/2 z-20 w-[min(26rem,calc(100vw-1.5rem))] max-h-[55dvh] overflow-y-auto rounded-2xl bg-[#0f1a30]/97 border border-white/10 shadow-2xl backdrop-blur">
          <div className="sticky top-0 flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-[#0f1a30] text-xs font-bold tracking-wide text-slate-300">
            {panel === 'chat' ? 'NAVI ASSISTANT' : 'PLACES'}
            <button onClick={() => setPanel('none')} aria-label="Close" className="p-1 rounded hover:bg-white/10"><X className="size-4" /></button>
          </div>
          {panel === 'chat' ? (
            <div className="px-4 py-3 space-y-2">
              {messages.map((msg, i) => (
                <div key={i} className={`text-sm leading-snug rounded-xl px-3 py-2 ${msg.role === 'user' ? 'bg-blue-600/80 ml-8' : 'bg-white/5 text-slate-200 mr-8'}`}>{msg.content}</div>
              ))}
            </div>
          ) : (
            <div className="p-3 space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-slate-400 mb-1.5">WALK ME TO…</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {places.map((d: any) => (
                    <button key={d._id} onClick={() => onSend(d.name)} className="flex items-center gap-2 rounded-xl bg-white/5 hover:bg-white/10 px-3 py-2 text-left text-sm">
                      <MapPin className="size-4 shrink-0 text-violet-300" /><span className="truncate">{d.name}</span>
                    </button>
                  ))}
                  {places.length === 0 && <p className="col-span-2 text-xs text-slate-500">No rooms have been added yet.</p>}
                </div>
              </div>
              {viewpoints.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 mb-1.5">JUMP TO A SPOT</p>
                  <div className="flex flex-wrap gap-1.5">
                    {viewpoints.map((vp: any) => (
                      <button key={vp._id} onClick={() => goToViewpoint(vp)} className="rounded-full bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 text-xs">{vp.name}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* bottom bar: ask for directions */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 w-[min(30rem,calc(100vw-1.5rem))]">
        {panel === 'none' && lastAssistant && (
          <button onClick={() => setPanel('chat')} className="mb-1.5 w-full text-left truncate rounded-xl bg-black/50 border border-white/10 px-3 py-1.5 text-xs text-slate-200 backdrop-blur-sm">
            {lastAssistant}
          </button>
        )}
        <form onSubmit={(e) => { e.preventDefault(); onSend(); }} className="flex items-center gap-2 rounded-2xl bg-[#0f1a30]/95 border border-white/10 p-2 shadow-2xl backdrop-blur">
          <button type="button" onClick={() => setPanel(panel === 'places' ? 'none' : 'places')} aria-label="Places" className={`p-2.5 rounded-xl ${panel === 'places' ? 'bg-blue-600' : 'bg-white/5 hover:bg-white/10'}`}>
            <List className="size-4" />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => fsRef.current?.setMoveInput({ fwd: 0, strafe: 0, turn: 0, run: false })}
            placeholder='Where to? e.g. "Take me to the Cafe"'
            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-500 placeholder:text-slate-500"
          />
          <button type="submit" className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors" aria-label="Send"><Send className="size-4" /></button>
        </form>
      </div>
    </div>
  );
}
