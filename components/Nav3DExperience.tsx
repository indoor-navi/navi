/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ArrowLeft, Footprints, Orbit, PersonStanding, RotateCcw, Send } from 'lucide-react';
import { createFloorScene, MODEL_URL } from '@/lib/three/floorScene';
import { buildRoute } from '@/lib/three/route';
import { findPath, pickStartNode, type GEdge, type GNode } from '@/lib/wayfinding/graph';

interface Msg { role: 'user' | 'assistant'; content: string; }
type CamMode = 'orbit' | 'follow' | 'front';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export default function Nav3DExperience({ initialDestination = '' }: { initialDestination?: string }) {
  const mapData = useQuery(api.mapAdmin.getPublishedMap) as any;
  const containerRef = useRef<HTMLDivElement>(null);
  const fsRef = useRef<any>(null);
  const routeRef = useRef<any>(null);
  const routeLabelRef = useRef('');
  const markerRef = useRef<any>(null);
  const pinsRef = useRef<any[]>([]);
  const animRef = useRef({ progress: 0, active: false, speed: 1.7 });
  const startedRef = useRef(false);
  const camModeRef = useRef<CamMode>('orbit');
  const [sceneReady, setSceneReady] = useState(false);
  const [camMode, setCamMode] = useState<CamMode>('orbit');
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: 'Hi! Where would you like to go on the Ground Floor?' },
  ]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'routing' | 'done'>('idle');
  const [routeLabel, setRouteLabel] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => { camModeRef.current = camMode; }, [camMode]);

  useEffect(() => {
    let cancelled = false;
    let offFrame: any = null;
    (async () => {
      try {
        const fs = await createFloorScene(containerRef.current!, MODEL_URL);
        if (cancelled) { fs.dispose(); return; }
        fsRef.current = fs;
        setSceneReady(true);
        offFrame = fs.onFrame((t: number, dt: number) => {
          routeRef.current?.update(dt);
          const m = markerRef.current;
          if (m) {
            m.userData.ring.scale.setScalar(1 + 0.15 * Math.sin(t * 3));
            m.position.y = m.userData.baseY + 0.04 * Math.sin(t * 2.2);
          }
          const a = animRef.current;
          if (a.active && routeRef.current && m) {
            a.progress = Math.min(1, a.progress + (dt * a.speed) / Math.max(routeRef.current.length, 1));
            const p = routeRef.current.curve.getPointAt(a.progress);
            m.position.set(p.x, p.y, p.z);
            m.userData.baseY = p.y;
            if (camModeRef.current === 'follow') {
              const ahead = routeRef.current.curve.getPointAt(Math.min(1, a.progress + 0.05));
              fs.camera.position.lerp(new fs.THREE.Vector3(p.x, p.y + 1.6, p.z), 0.12);
              fs.controls.target.set(ahead.x, ahead.y + 1.35, ahead.z);
              fs.camera.lookAt(ahead.x, ahead.y + 1.35, ahead.z);
            }
            if (a.progress >= 1) {
              a.active = false;
              setStatus('done');
              pushMsg('assistant', `You have arrived at ${routeLabelRef.current}.`);
            }
          }
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown model loading error';
        setLoadError(`Could not load the 3D model at ${MODEL_URL}: ${reason}`);
      }
    })();
    return () => {
      cancelled = true;
      offFrame?.();
      fsRef.current?.dispose();
      fsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneReady) fsRef.current?.applyOverrides(mapData?.overrides ?? []);
  }, [mapData, sceneReady]);

  function pushMsg(role: Msg['role'], content: string) {
    setMessages((m) => [...m.slice(-12), { role, content }]);
  }

  function clearRoute() {
    routeRef.current?.dispose();
    routeRef.current = null;
    for (const p of pinsRef.current) p.removeFromParent?.();
    pinsRef.current = [];
    markerRef.current?.removeFromParent?.();
    markerRef.current = null;
  }

  async function startRoute(query: string) {
    const fs = fsRef.current;
    if (!fs || !mapData) { pushMsg('assistant', 'Still loading the building, one moment…'); return; }
    const q = norm(query);
    const dest =
      mapData.destinations.find((d: any) => norm(d.name) === q) ??
      mapData.destinations.find((d: any) => [d.name, ...d.aliases].some((a: string) => {
        const na = norm(a);
        return na.includes(q) || q.includes(na);
      }));
    if (!dest) {
      pushMsg('assistant', `I couldn't find "${query}". Try one of the places below.`);
      return;
    }
    const ns: GNode[] = mapData.nodes.map((n: any) => ({ id: n._id, label: n.label, position: n.position }));
    const es: GEdge[] = mapData.connections.map((c: any) => ({ from: c.fromNodeId, to: c.toNodeId }));
    const startId = pickStartNode(ns);
    const path = startId ? findPath(ns, es, startId, dest.targetNodeId) : null;
    clearRoute();
    if (!path?.length) {
      pushMsg('assistant', `No walking route is mapped to ${dest.name} yet.`);
      return;
    }
    const pts = path.map((id) => ns.find((n) => n.id === id)!.position);
    const route = buildRoute(fs.THREE, pts);
    fs.scene.add(route.group);
    routeRef.current = route;

    const { makePin } = await import('@/lib/three/pins');
    const startPin = await makePin(0x22c55e, 'Start');
    startPin.position.set(pts[0].x, pts[0].y, pts[0].z);
    startPin.userData.baseY = pts[0].y;
    const destPin = await makePin(0xef4444, dest.name);
    const last = pts[pts.length - 1];
    destPin.position.set(last.x, last.y, last.z);
    destPin.userData.baseY = last.y;

    const person = new fs.THREE.Group();
    const body = new fs.THREE.Mesh(
      new fs.THREE.CapsuleGeometry(0.16, 0.7, 6, 12),
      new fs.THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.4 })
    );
    body.position.y = 0.75;
    const halo = new fs.THREE.Mesh(
      new fs.THREE.RingGeometry(0.26, 0.34, 32),
      new fs.THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8, side: fs.THREE.DoubleSide })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.03;
    person.add(body, halo);
    person.userData.ring = halo;
    person.position.set(pts[0].x, pts[0].y, pts[0].z);
    person.userData.baseY = pts[0].y;

    fs.scene.add(startPin, destPin, person);
    pinsRef.current = [startPin, destPin];
    markerRef.current = person;

    animRef.current = { ...animRef.current, progress: 0, active: true };
    setStatus('routing');
    setRouteLabel(dest.name);
    routeLabelRef.current = dest.name;
    if (camModeRef.current === 'front') fs.setCamera('front', new fs.THREE.Vector3(0, 1.2, 0));
    pushMsg('assistant', `Follow the green line — heading to ${dest.name}.`);
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
    startRoute(q);
  }

  useEffect(() => {
    if (initialDestination && mapData && sceneReady && fsRef.current && !startedRef.current) {
      startedRef.current = true;
      onSend(initialDestination);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDestination, mapData, sceneReady]);

  function setView(mode: CamMode) {
    setCamMode(mode);
    const fs = fsRef.current;
    if (!fs) return;
    if (mode === 'front') fs.setCamera('front', new fs.THREE.Vector3(0, 1.2, 0));
    else if (mode === 'orbit') fs.setCamera('default', markerRef.current ? markerRef.current.position : undefined);
  }

  const suggestions = (mapData?.destinations ?? []).slice(0, 6);

  return (
    <div className="h-screen w-screen bg-[#0b1220] text-white relative overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />

      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0b1220] p-8 text-center">
          <div className="max-w-md space-y-3">
            <p className="text-lg font-semibold text-red-400">3D model not found</p>
            <p className="text-sm text-slate-400">{loadError}</p>
          </div>
        </div>
      )}

      {/* header */}
      <header className="absolute top-0 left-0 right-0 h-14 flex items-center gap-3 px-4 bg-gradient-to-b from-black/60 to-transparent z-10">
        <Link href="/" className="p-2 rounded-lg hover:bg-white/10"><ArrowLeft className="size-5" /></Link>
        <div>
          <p className="font-bold leading-tight">ODeL Wayfinding</p>
          <p className="text-xs text-slate-300">Ground Floor — Indoor 3D</p>
        </div>
        {status === 'routing' && (
          <span className="ml-3 text-xs font-semibold px-3 py-1.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/40">
            Walking to {routeLabel}…
          </span>
        )}
        {status === 'done' && (
          <span className="ml-3 text-xs font-semibold px-3 py-1.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40">
            Arrived at {routeLabel}
          </span>
        )}
      </header>

      {/* view controls */}
      <div className="absolute bottom-5 right-5 flex flex-col gap-2 z-10">
        {([
          ['orbit', Orbit, 'Default view'],
          ['follow', Footprints, 'Walk view'],
          ['front', PersonStanding, 'Entrance view'],
        ] as const).map(([mode, Icon, label]) => (
          <button
            key={mode}
            onClick={() => setView(mode as CamMode)}
            title={label}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
              camMode === mode
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-slate-900/80 border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
        {status !== 'idle' && (
          <button
            onClick={() => { animRef.current = { ...animRef.current, progress: 0, active: true }; setStatus('routing'); }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border bg-slate-900/80 border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <RotateCcw className="size-4" /> Replay
          </button>
        )}
      </div>

      {/* AI direction chat */}
      <div className="absolute bottom-5 left-5 w-80 max-w-[calc(100vw-2.5rem)] bg-slate-900/90 backdrop-blur border border-slate-700 rounded-2xl z-10 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-700/60 text-xs font-bold tracking-wide text-slate-300">
          NAVI ASSISTANT — ASK FOR DIRECTIONS
        </div>
        <div className="max-h-44 overflow-y-auto px-3 py-2 space-y-2">
          {messages.map((m, i) => (
            <div key={i} className={`text-[13px] leading-snug rounded-lg px-3 py-2 ${
              m.role === 'user' ? 'bg-blue-600/30 text-blue-100 ml-6' : 'bg-slate-800 text-slate-200 mr-6'
            }`}>
              {m.content}
            </div>
          ))}
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {suggestions.map((d: any) => (
              <button
                key={d._id}
                onClick={() => onSend(d.name)}
                className="text-[11px] px-2 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              >
                {d.name}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); onSend(); }}
          className="flex items-center gap-2 px-3 py-2.5 border-t border-slate-700/60"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='e.g. "Take me to the Toilets"'
            className="flex-1 bg-slate-800 rounded-lg px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:ring-1 ring-blue-500"
          />
          <button type="submit" className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500">
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}