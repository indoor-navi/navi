/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ArrowLeft, Compass, Footprints, Orbit, PersonStanding, RotateCcw, Send } from 'lucide-react';
import { createFloorScene, MODEL_URL } from '@/lib/three/floorScene';
import { buildRoute } from '@/lib/three/route';
import { findPath, pickStartNode, type GEdge, type GNode } from '@/lib/wayfinding/graph';

interface Msg { role: 'user' | 'assistant'; content: string; }
type CamMode = 'orbit' | 'follow' | 'front' | 'walk' | 'explore';

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

  /** First-person auto-walk state: fly-in progress + drag look offsets. */
  const walkRef = useRef({
    intro: 0,
    yaw: 0,
    pitch: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    eyeHeight: 1.6,
    fromPos: null as any,
    standPos: null as any,
    baseYaw: 0,
  });

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
    const cleanups: Array<() => void> = [];
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
          const w = walkRef.current;
          const mode = camModeRef.current;

          // ── FREE EXPLORE: the scene runs the first-person camera (WASD + drag look + collisions) ──
          if (mode === 'explore') {
            if (routeRef.current && a.active) {
              a.progress = Math.min(1, a.progress + (dt * a.speed) / Math.max(routeRef.current.length, 1));
              const rp = routeRef.current.curve.getPointAt(a.progress);
              if (m) { m.position.set(rp.x, rp.y, rp.z); m.userData.baseY = rp.y; }
              if (a.progress >= 1) {
                a.active = false;
                setStatus('done');
                pushMsg('assistant', `You have arrived at ${routeLabelRef.current}.`);
              }
            }
            return;
          }

          // ── FIRST-PERSON AUTO-WALK ──
                    // ── FIRST-PERSON: stand inside (reception) + auto-walk ──
          if (mode === 'walk') {
            fs.controls.enabled = false; // no orbit / up-down in walk mode
            if (routeRef.current && a.active) {
              a.progress = Math.min(1, a.progress + (dt * a.speed) / Math.max(routeRef.current.length, 1));
            }
            // position: follow the route, or stand at the reception start point
            let p = null;
            if (routeRef.current) {
              p = routeRef.current.curve.getPointAt(a.progress);
            } else if (w.standPos) {
              p = w.standPos;
            } else {
              return;
            }
            const ahead = routeRef.current
              ? routeRef.current.curve.getPointAt(Math.min(1, a.progress + 0.02))
              : null;
            if (m && routeRef.current) { m.position.set(p.x, p.y, p.z); m.userData.baseY = p.y; }

            // zoom from the previous camera position down to eye level
            w.intro = Math.min(1, w.intro + dt * 0.9);
            const k = 1 - Math.pow(1 - w.intro, 3); // easeOutCubic
            const eye = new fs.THREE.Vector3(p.x, p.y + w.eyeHeight, p.z);
            const startPos = w.fromPos ?? eye;
            const camPos = new fs.THREE.Vector3().lerpVectors(startPos, eye, k);

            // heading follows the path tangent, or the reception facing direction, plus drag look
            const baseYaw = ahead
              ? Math.atan2(ahead.x - p.x, ahead.z - p.z)
              : w.baseYaw;
            const yaw = baseYaw + w.yaw;
            const pitch = Math.max(-0.35, Math.min(0.35, w.pitch)); // clamp: no big up/down
            const look = new fs.THREE.Vector3(
              camPos.x + Math.sin(yaw) * Math.cos(pitch),
              camPos.y + Math.sin(pitch),
              camPos.z + Math.cos(yaw) * Math.cos(pitch)
            );
            fs.camera.position.copy(camPos);
            fs.camera.lookAt(look);

            if (routeRef.current && a.progress >= 1 && a.active) {
              a.active = false;
              setStatus('done');
              pushMsg('assistant', `You have arrived at ${routeLabelRef.current}.`);
            }
            return;
          }

          // ── ORBIT MODES ──
          fs.controls.enabled = true;
          if (a.active && routeRef.current && m) {
            a.progress = Math.min(1, a.progress + (dt * a.speed) / Math.max(routeRef.current.length, 1));
            const p = routeRef.current.curve.getPointAt(a.progress);
            m.position.set(p.x, p.y, p.z);
            m.userData.baseY = p.y;
            if (mode === 'follow') {
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

        // drag-to-look while auto-walking
        const el = fs.renderer.domElement;
        const w = walkRef.current;
        const onDown = (e: PointerEvent) => {
          w.dragging = true; w.lastX = e.clientX; w.lastY = e.clientY;
        };
        const onUp = () => { w.dragging = false; };
        const onMove = (e: PointerEvent) => {
          if (!w.dragging || camModeRef.current !== 'walk') return;
          w.yaw -= (e.clientX - w.lastX) * 0.004;
          w.pitch -= (e.clientY - w.lastY) * 0.003;
          w.pitch = Math.max(-0.35, Math.min(0.35, w.pitch));
          w.lastX = e.clientX; w.lastY = e.clientY;
        };
        el.addEventListener('pointerdown', onDown);
        window.addEventListener('pointerup', onUp);
        el.addEventListener('pointermove', onMove);
        cleanups.push(() => {
          el.removeEventListener('pointerdown', onDown);
          window.removeEventListener('pointerup', onUp);
          el.removeEventListener('pointermove', onMove);
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown model loading error';
        setLoadError(`Could not load the 3D model at ${MODEL_URL}: ${reason}`);
      }
    })();
    return () => {
      cancelled = true;
      offFrame?.();
      cleanups.forEach((fn) => fn());
      fsRef.current?.dispose();
      fsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneReady) fsRef.current?.applyOverrides(mapData?.overrides ?? []);
  }, [mapData, sceneReady]);
    /* Start the visitor INSIDE the reception with a 360° stand view — not outside the building. */
  useEffect(() => {
    const fs = fsRef.current;
    if (!sceneReady || !fs || !mapData) return;
    if (!mapData.nodes?.length && !walkRef.current.standPos) {
      // nothing mapped yet: still start INSIDE at the main entrance, free to walk around
      walkRef.current.standPos = fs.entranceStart.clone();
      camModeRef.current = 'explore';
      queueMicrotask(() => setCamMode('explore'));
      pushMsg('assistant', "You're at the main entrance. Drag to look and use W A S D to walk around inside.");
      return;
    }
    if (!mapData.nodes?.length) return;
    if (walkRef.current.standPos) return;
    const ns: GNode[] = mapData.nodes.map((n: any) => ({ id: n._id, label: n.label, position: n.position }));
    const startId = pickStartNode(ns);
    const start = ns.find((n) => n.id === startId);
    if (!start) return;
    // face along the first connection so the visitor looks into the building
    const conn = (mapData.connections ?? []).find((c: any) => c.fromNodeId === startId || c.toNodeId === startId);
    const otherId = conn ? (conn.fromNodeId === startId ? conn.toNodeId : conn.fromNodeId) : null;
    const other = otherId ? ns.find((n) => n.id === otherId) : null;
    const w = walkRef.current;
    w.standPos = new fs.THREE.Vector3(start.position.x, start.position.y, start.position.z);
    w.baseYaw = other ? Math.atan2(other.position.x - start.position.x, other.position.z - start.position.z) : 0;
    w.fromPos = new fs.THREE.Vector3(start.position.x, start.position.y + 10, start.position.z + 6); // gentle drop-in
    w.intro = 0;
    camModeRef.current = 'walk';
    queueMicrotask(() => setCamMode('walk'));
    pushMsg('assistant', `You're at the ${start.label}. Drag to look around in 360°, or tell me where you want to go.`);
  }, [sceneReady, mapData]);

  /* Keep the scene in step with the chosen camera: inside modes only render what is in line of sight. */
  useEffect(() => {
    const fs = fsRef.current;
    if (!sceneReady || !fs) return;
    if (camMode === 'explore') {
      const sp = walkRef.current.standPos;
      const yaw = sp ? walkRef.current.baseYaw + Math.PI : 0;   // Nav3D yaw (atan2 dx,dz) → scene yaw (faces −Z at 0)
      fs.goInside(sp ?? fs.entranceStart, sp ? yaw : 0);
      return;
    }
    if (fs.getViewMode() === 'inside') {
      fs.setViewMode('3d');
      if (camMode === 'front') fs.setCamera('front', new fs.THREE.Vector3(0, 1.2, 0));
      else if (camMode === 'orbit') fs.setCamera('default', markerRef.current ? markerRef.current.position : undefined);
    }
    fs.setCulling(camMode === 'walk' || camMode === 'follow');
  }, [camMode, sceneReady]);

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
        walkRef.current.standPos = new fs.THREE.Vector3(pts[0].x, pts[0].y, pts[0].z);
    if (pts.length > 1) walkRef.current.baseYaw = Math.atan2(pts[1].x - pts[0].x, pts[1].z - pts[0].z);
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

    // ── start the first-person auto-walk right here ──
    walkRef.current.intro = 0;
    walkRef.current.yaw = 0;
    walkRef.current.pitch = 0;
    walkRef.current.fromPos = fs.camera.position.clone();
    setCamMode('walk');

    pushMsg('assistant', `Follow the green line — auto-walking to ${dest.name}. Drag to look around.`);
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
    if (mode === 'walk') {
      walkRef.current.fromPos = fs.camera.position.clone();
      walkRef.current.intro = 0;
      walkRef.current.yaw = 0;
      walkRef.current.pitch = 0;
    if (!walkRef.current.standPos) fs.setCamera('front', new fs.THREE.Vector3(0, 1.2, 0));
    } else if (mode === 'explore') {
      /* handled by the camMode effect (goInside at the main entrance) */
    } else if (mode === 'front') {
      fs.setCamera('front', new fs.THREE.Vector3(0, 1.2, 0));
    } else if (mode === 'orbit') {
      fs.setCamera('default', markerRef.current ? markerRef.current.position : undefined);
    }
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
            Auto-walking to {routeLabel}…
          </span>
        )}
        {status === 'done' && (
          <span className="ml-3 text-xs font-semibold px-3 py-1.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40">
            Arrived at {routeLabel}
          </span>
        )}
      </header>

      {camMode === 'explore' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 rounded-full bg-black/55 border border-white/10 px-4 py-1.5 text-xs text-slate-200">
          Drag to look · W A S D walk · Shift run · Q/E turn · scroll to zoom
        </div>
      )}
      {camMode === 'orbit' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 rounded-full bg-black/55 border border-white/10 px-4 py-1.5 text-xs text-slate-200">
          Left-drag rotate · right-drag pan · scroll zoom · W A S D fly
        </div>
      )}

      {/* view controls */}
      <div className="absolute bottom-5 right-5 flex flex-col gap-2 z-10">
        {([
          ['orbit', Orbit, 'Default view'],
          ['follow', Footprints, 'Walk view'],
          ['front', PersonStanding, 'Entrance view'],
          ['explore', Compass, 'Explore inside (free move)'],
          ['walk', RotateCcw, 'Auto-walk (first-person)'],
        ] as const).map(([mode, Icon, labelText]) => (
          <button
            key={mode}
            onClick={() => setView(mode)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg transition-colors ${
              camMode === mode
                ? 'bg-blue-600 text-white'
                : 'bg-[#111c33]/90 text-slate-200 border border-white/10 hover:bg-[#1a2a4a]'
            }`}
          >
            <Icon className="size-4" />
            {labelText}
          </button>
        ))}
      </div>

      {/* assistant chat */}
      <div className="absolute bottom-5 left-5 w-[min(24rem,calc(100vw-2.5rem))] z-10">
        <div className="rounded-2xl bg-[#0f1a30]/95 border border-white/10 shadow-2xl backdrop-blur">
          <div className="px-4 py-2.5 border-b border-white/10 text-xs font-bold tracking-wide text-slate-300">
            NAVI ASSISTANT — ASK FOR DIRECTIONS
          </div>
          <div className="px-4 py-3 space-y-2 max-h-44 overflow-y-auto">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`text-sm leading-snug rounded-xl px-3 py-2 ${
                  msg.role === 'user'
                    ? 'bg-blue-600/80 text-white ml-6'
                    : 'bg-white/5 text-slate-200 mr-6'
                }`}
              >
                {msg.content}
              </div>
            ))}
          </div>
          {suggestions.length > 0 && messages.length <= 2 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {suggestions.map((s: any) => (
                <button
                  key={s._id}
                  onClick={() => onSend(s.name)}
                  className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => { e.preventDefault(); onSend(); }}
            className="flex items-center gap-2 p-3 border-t border-white/10"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='e.g. "Take me to the Toilets"'
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-500 placeholder:text-slate-500"
            />
            <button
              type="submit"
              className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors"
              aria-label="Send"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
