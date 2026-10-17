/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Camera, LocateFixed, MapPin, Plus, Route, Send, Trash2, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { createFloorScene, MODEL_URL, type ViewMode } from '@/lib/three/floorScene';
import { buildRoute } from '@/lib/three/route';
import { makePin } from '@/lib/three/pins';
import { findEntranceNode, findPath, pathLength, connectedComponents, type GEdge, type GNode } from '@/lib/wayfinding/graph';

type Position = { x: number; y: number; z: number };
type Tool = 'select' | 'add-node' | 'connect' | 'add-room';
type LandmarkType = 'corridor' | 'staircase' | 'elevator' | 'double-door';

export interface MapEditorData {
  floors: Array<{ _id: Id<'floors'>; name: string; level: number }>;
  nodes: Array<{
    _id: Id<'nodes'>; floorId: Id<'floors'>; label: string; position?: Position;
    isLandmark: boolean; landmarkType?: LandmarkType;
  }>;
  connections: Array<{
    _id: Id<'connections'>; fromNodeId: Id<'nodes'>; toNodeId: Id<'nodes'>;
    textDirection: string; estimatedWalkingTime: number;
  }>;
  destinations: Array<{
    _id: Id<'destinations'>; name: string; floorId: Id<'floors'>; targetNodeId: Id<'nodes'>; description: string;
  }>;
  overrides: Array<{ floorId: Id<'floors'>; meshKey: string; color?: string; textureUrl?: string; tiling?: number }>;
}

/** Point the admin just clicked on the floor, waiting for a name before it is saved. */
interface Draft {
  position: Position;
  name: string;
  isRoom: boolean;
  description: string;
  connectToId: Id<'nodes'> | null; // node it will be linked to (Dijkstra graph)
  connect: boolean;
}

const landmarkTypes: LandmarkType[] = ['corridor', 'staircase', 'elevator', 'double-door'];
const round2 = (n: number) => Math.round(n * 100) / 100;

function disposeObject(obj: any) {
  obj.removeFromParent();
  obj.traverse((o: any) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
  });
}

const isShown = (o: any) => { let p = o; while (p) { if (p.visible === false) return false; p = p.parent; } return true; };

export default function MapEditor3D({
  focusNodeId = null,
  onFocusDone,
}: { focusNodeId?: string | null; onFocusDone?: () => void }) {
  const [token] = useState(() => typeof window === 'undefined' ? '' : window.localStorage.getItem('navi_admin_session') || '');
  const data = useQuery(api.mapAdmin.listMapData, { token }) as MapEditorData | undefined;
  const addNodeWithRoom = useMutation(api.mapAdmin.addNodeWithRoom);
  const updateNode = useMutation(api.mapAdmin.updateNode3D);
  const deleteNode = useMutation(api.mapAdmin.deleteNode3D);
  const addConnection = useMutation(api.mapAdmin.addConnection3D);
  const deleteConnection = useMutation(api.mapAdmin.deleteConnection3D);
  const addDestination = useMutation(api.mapAdmin.addDestination3D);
  const ensureFloor = useMutation(api.mapAdmin.ensureDefaultFloor);
  const publishMap = useMutation(api.mapAdmin.publishMap);

  const containerRef = useRef<HTMLDivElement>(null);
  const fsRef = useRef<any>(null);
  const pinsRef = useRef<Map<string, any>>(new Map());
  const routesRef = useRef<Array<{ r: any; a: Position; b: Position }>>([]);
  const ghostRef = useRef<any>(null);
  const connectFromRef = useRef<Id<'nodes'> | null>(null);
  const lastAddedRef = useRef<Id<'nodes'> | null>(null);
  const clickRef = useRef<(x: number, y: number) => void>(() => {});
  const liveRef = useRef({ showNodes: true, showPaths: true, viewMode: '3d' as ViewMode });

  const [sceneReady, setSceneReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [tool, setTool] = useState<Tool>('select');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [floorId, setFloorId] = useState<Id<'floors'> | ''>('');
  const [selectedId, setSelectedId] = useState<Id<'nodes'> | null>(null);
  const [label, setLabel] = useState('');
  const [pos, setPos] = useState<Position>({ x: 0, y: 0, z: 0 });
  const [isLandmark, setIsLandmark] = useState(false);
  const [landmarkType, setLandmarkType] = useState<LandmarkType>('corridor');
  const [destName, setDestName] = useState('');
  const [destDesc, setDestDesc] = useState('');
  const [showNodes, setShowNodes] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tick, setTick] = useState(0);
  const [routeInfo, setRouteInfo] = useState('');

  const activeFloorId: Id<'floors'> = (floorId || data?.floors?.[0]?._id || '') as Id<'floors'>;
  const allNodes = data?.nodes ?? [];
  const floorNodes = allNodes.filter((n) => n.floorId === activeFloorId);
  const selected = floorNodes.find((n) => n._id === selectedId);
  const selectedConns = (data?.connections ?? []).filter((c) => c.fromNodeId === selectedId || c.toNodeId === selectedId);
  const selectedDest = (data?.destinations ?? []).find((d) => d.targetNodeId === selectedId);
  const roomNodeIds = new Set((data?.destinations ?? []).map((d) => String(d.targetNodeId)));
  const entranceNode = findEntranceNode(floorNodes.filter((n) => n.position).map((n) => ({ id: n._id, label: n.label, position: n.position! })));

  liveRef.current = { showNodes, showPaths, viewMode };

  /* toasts fade on their own */
  useEffect(() => {
    if (!notice && !error) return;
    const t = setTimeout(() => { setNotice(''); setError(''); }, 5000);
    return () => clearTimeout(t);
  }, [notice, error]);

  /* a building with no floor row would make every tool silently do nothing — create it */
  useEffect(() => {
    if (data && data.floors.length === 0 && token) ensureFloor({ token }).catch((e) => setError(e instanceof Error ? e.message : 'Could not create the default floor.'));
  }, [data, token, ensureFloor]);

  /* ───────────────────── 3D scene lifecycle ───────────────────── */
  useEffect(() => {
    let cancelled = false;
    let offFrame: any; let offClick: any;
    (async () => {
      try {
        const fs = await createFloorScene(containerRef.current!, MODEL_URL, { hideRoof: true });
        if (cancelled) { fs.dispose(); return; }
        fsRef.current = fs;
        setSceneReady(true);

        let lastLos = 0;
        offFrame = fs.onFrame((_t: number, dt: number) => {
          for (const { r } of routesRef.current) r.update(dt);
          const now = performance.now();
          if (now - lastLos < 150) return;
          lastLos = now;
          // in the inside view only pins / paths in line of sight are shown (no seeing through walls)
          const inside = liveRef.current.viewMode === 'inside';
          for (const pin of pinsRef.current.values()) {
            pin.visible = liveRef.current.showNodes && (!inside || fs.hasLineOfSight(pin.position));
          }
          for (const { r, a, b } of routesRef.current) {
            r.group.visible = liveRef.current.showPaths && (!inside || fs.hasLineOfSight(a) || fs.hasLineOfSight(b));
          }
        });
        // click (not drag) → always goes through the ref so it sees the CURRENT tool / floor / selection
        offClick = fs.onClick((x: number, y: number) => clickRef.current(x, y));
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'The 3D map could not be loaded.');
      }
    })();
    return () => {
      cancelled = true;
      offFrame?.(); offClick?.();
      fsRef.current?.dispose();
      fsRef.current = null;
    };
  }, []);

  useEffect(() => { if (sceneReady) fsRef.current?.setViewMode(viewMode); }, [viewMode, sceneReady]);

  /* ───────────────────── picking + click handling ───────────────────── */
  function pickPin(fs: any, clientX: number, clientY: number): Id<'nodes'> | null {
    const rect = fs.renderer.domElement.getBoundingClientRect();
    const pointer = new fs.THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const rc = new fs.THREE.Raycaster();
    rc.setFromCamera(pointer, fs.getActiveCamera());
    const hits = rc.intersectObjects([...pinsRef.current.values()], true).filter((h: any) => isShown(h.object));
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !o.userData.nodeId) o = o.parent;
    return (o?.userData.nodeId ?? null) as Id<'nodes'> | null;
  }

  function chooseConnectTarget(position: Position): Id<'nodes'> | null {
    if (selectedId && floorNodes.some((n) => n._id === selectedId)) return selectedId;
    if (lastAddedRef.current && floorNodes.some((n) => n._id === lastAddedRef.current)) return lastAddedRef.current;
    let best: Id<'nodes'> | null = null; let bd = Infinity;
    for (const n of floorNodes) {
      if (!n.position) continue;
      const d = Math.hypot(n.position.x - position.x, n.position.z - position.z);
      if (d < bd) { bd = d; best = n._id; }
    }
    return best;
  }

  clickRef.current = (clientX: number, clientY: number) => {
    const fs = fsRef.current;
    if (!fs) return;
    setError('');
    const hitNode = pickPin(fs, clientX, clientY);
    if (hitNode) { void handleNodeClick(hitNode); return; }

    if (tool === 'add-node' || tool === 'add-room') {
      if (!activeFloorId) return setError('No floor exists yet — one is being created, try again in a moment.');
      const p = fs.pickSurface(clientX, clientY, { floorsOnly: true });
      if (!p) return setError('Click directly on the floor of a room (not a wall, ceiling or empty space).');
      const position = { x: round2(p.x), y: round2(p.y), z: round2(p.z) };
      const target = chooseConnectTarget(position);
      setDraft({ position, name: '', isRoom: tool === 'add-room', description: '', connectToId: target, connect: Boolean(target) });
      setNotice('');
    } else if (tool === 'connect') {
      setNotice('Click a node pin first, then a second node to connect.');
    }
  };

  async function handleNodeClick(nodeId: Id<'nodes'>) {
    setError('');
    if (tool === 'connect') {
      if (!connectFromRef.current) {
        connectFromRef.current = nodeId;
        setNotice('Connection started — now click the second node.');
        setTick((t) => t + 1);
      } else if (connectFromRef.current !== nodeId) {
        try {
          await addConnection({ token, fromNodeId: connectFromRef.current, toNodeId: nodeId });
          setNotice('Nodes connected.');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not connect nodes.');
        }
        connectFromRef.current = null;
        setTick((t) => t + 1);
      }
      return;
    }
    selectNode(nodeId);
  }

  function selectNode(nodeId: Id<'nodes'>) {
    const n = allNodes.find((x) => x._id === nodeId);
    setSelectedId(nodeId);
    setLabel(n?.label ?? '');
    if (n?.position) setPos({ x: n.position.x, y: n.position.y, z: n.position.z });
    setIsLandmark(n?.isLandmark ?? false);
    setLandmarkType(n?.landmarkType ?? 'corridor');
    const d = (data?.destinations ?? []).find((dd) => dd.targetNodeId === nodeId);
    setDestName(d?.name ?? '');
    setDestDesc(d?.description ?? '');
  }

  /* Esc cancels whatever is in progress */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setDraft(null); connectFromRef.current = null; setTick((t) => t + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ───────────────────── pins + path lines mirror the database ───────────────────── */
  useEffect(() => {
    const fs = fsRef.current;
    if (!fs || !data || !sceneReady) return;
    let cancelled = false;

    for (const g of pinsRef.current.values()) disposeObject(g);
    pinsRef.current.clear();
    for (const { r } of routesRef.current) r.dispose();
    routesRef.current = [];
    if (ghostRef.current) { disposeObject(ghostRef.current); ghostRef.current = null; }

    const withPos = floorNodes.filter((n): n is typeof n & { position: Position } => Boolean(n.position));
    void Promise.all(withPos.map(async (n) => {
      const color =
        n._id === connectFromRef.current ? 0xf59e0b :
        n._id === selectedId ? 0x22c55e :
        roomNodeIds.has(String(n._id)) ? 0xa78bfa : 0x38bdf8;
      const pin = await makePin(color, n.label);
      pin.position.set(n.position.x, n.position.y, n.position.z);
      pin.userData.nodeId = n._id;
      pin.visible = showNodes;
      pin.traverse((o: any) => { if (o.isSprite) o.visible = showLabels; });
      return [String(n._id), pin] as const;
    })).then(async (entries) => {
      if (cancelled) { entries.forEach(([, p]) => disposeObject(p)); return; }
      for (const [id, pin] of entries) { fs.scene.add(pin); pinsRef.current.set(id, pin); }
      if (draft) {
        const ghost = await makePin(0xf59e0b, draft.name || 'New point');
        if (cancelled) { disposeObject(ghost); return; }
        ghost.position.set(draft.position.x, draft.position.y, draft.position.z);
        fs.scene.add(ghost);
        ghostRef.current = ghost;
      }
    });

    const byId = new Map(withPos.map((n) => [String(n._id), n]));
    for (const c of data.connections) {
      const a = byId.get(String(c.fromNodeId));
      const b = byId.get(String(c.toNodeId));
      if (!a || !b) continue;
      const r = buildRoute(fs.THREE, [a.position, b.position]);
      r.group.visible = showPaths;
      fs.scene.add(r.group);
      routesRef.current.push({ r, a: a.position, b: b.position });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, activeFloorId, sceneReady, selectedId, showNodes, showPaths, showLabels, tick, draft?.position.x, draft?.position.z]);

  useEffect(() => {
    if (sceneReady) fsRef.current?.applyOverrides((data?.overrides ?? []).filter((o) => o.floorId === activeFloorId));
  }, [data?.overrides, activeFloorId, sceneReady]);

  /* "Locate" from the Destinations / Routes tabs */
  useEffect(() => {
    if (!focusNodeId || !sceneReady || !data) return;
    const n = data.nodes.find((x) => x._id === focusNodeId);
    queueMicrotask(() => {
      if (n?.position) {
        setFloorId(n.floorId);
        selectNode(n._id);
        fsRef.current?.flyTo(n.position, 7);
      }
      onFocusDone?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId, sceneReady, data]);

  /* ───────────────────── actions ───────────────────── */
  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return setError('Please type a name for this point first.');
    setSaving(true); setError('');
    try {
      const res = await addNodeWithRoom({
        token, floorId: activeFloorId, label: name, position: draft.position,
        isRoom: draft.isRoom, description: draft.description.trim() || undefined,
        connectToNodeId: draft.connect && draft.connectToId ? draft.connectToId : undefined,
      });
      lastAddedRef.current = res.nodeId;
      setSelectedId(res.nodeId);
      setLabel(name); setPos(draft.position); setIsLandmark(false);
      setDestName(draft.isRoom ? name : ''); setDestDesc(draft.description);
      setNotice(
        `Saved “${name}” at (${draft.position.x}, ${draft.position.y}, ${draft.position.z})` +
        (res.connectionId ? ' and connected it to the path network.' : '.')
      );
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this point.');
    } finally { setSaving(false); }
  };

  const saveNode = async () => {
    if (!selectedId) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await updateNode({ token, _id: selectedId, label: label.trim(), position: pos, isLandmark, landmarkType: isLandmark ? landmarkType : undefined });
      setNotice('Node saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the node.');
    } finally { setSaving(false); }
  };

  const removeNode = async () => {
    if (!selectedId) return;
    if (!window.confirm(`Delete “${selected?.label ?? 'this node'}” and its connections?`)) return;
    try {
      await deleteNode({ token, _id: selectedId });
      if (lastAddedRef.current === selectedId) lastAddedRef.current = null;
      setSelectedId(null);
      setNotice('Node deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete the node.');
    }
  };

  const saveDestination = async () => {
    if (!selectedId || !destName.trim()) return setError('Enter a room name first.');
    try {
      await addDestination({ token, name: destName.trim(), floorId: activeFloorId, targetNodeId: selectedId, description: destDesc.trim() });
      setLabel(destName.trim());
      setNotice(`Room “${destName.trim()}” saved to the database.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the room.');
    }
  };

  const addEntranceNode = async () => {
    const fs = fsRef.current;
    if (!fs || !activeFloorId) return;
    const p = fs.entranceStart;
    try {
      const res = await addNodeWithRoom({
        token, floorId: activeFloorId, label: 'Main Entrance',
        position: { x: round2(p.x), y: round2(p.y), z: round2(p.z) }, isRoom: true,
        description: 'Main entrance — every route starts here.',
        connectToNodeId: undefined,
      });
      lastAddedRef.current = res.nodeId;
      setSelectedId(res.nodeId);
      setNotice('“Main Entrance” node added. Click the floor to add points leading in from here.');
      setTool('add-node');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the entrance node.');
    }
  };

  const testRoute = () => {
    const fs = fsRef.current;
    if (!fs || !selected?.position) return setError('Select a destination node first.');
    const withPos = floorNodes.filter((n): n is typeof n & { position: Position } => Boolean(n.position));
    const ns: GNode[] = withPos.map((n) => ({ id: n._id, label: n.label, position: n.position }));
    const es: GEdge[] = (data?.connections ?? []).map((c) => ({ from: c.fromNodeId, to: c.toNodeId }));
    const entrance = findEntranceNode(ns) ?? ns.find((n) => n.id !== selected._id);
    if (!entrance) return setError('Add at least one more node to test a route.');
    if (entrance.id === selected._id) return setError('This is the start node — pick another node to test the route to.');
    const path = findPath(ns, es, entrance.id, selected._id);
    if (!path) {
      const parts = connectedComponents(ns, es).length;
      return setError(`No route — the map has ${parts} disconnected parts. Connect “${entrance.label}” to “${selected.label}”.`);
    }
    for (const { r } of routesRef.current) r.dispose();
    routesRef.current = [];
    const r = buildRoute(fs.THREE, path.map((id) => ns.find((n) => n.id === id)!.position));
    fs.scene.add(r.group);
    routesRef.current.push({ r, a: ns.find((n) => n.id === path[0])!.position, b: selected.position });
    const metres = pathLength(ns, path);
    setRouteInfo(`${entrance.label} → ${selected.label}: ${path.length} nodes, ${metres.toFixed(1)} m (Dijkstra shortest path)`);
    setNotice('Route OK — shortest path drawn in green.');
  };

  const doPublish = async () => {
    try {
      await publishMap({ token });
      setNotice('Map published — live in the navigation app.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed.');
    }
  };

  /** Jump the camera inside the building (first-person, ray-traced view) at the entrance or a room. */
  const jumpCamera = useCallback((value: string) => {
    const fs = fsRef.current;
    if (!fs || !value) return;
    setViewMode('inside');
    if (value === '__entrance__') { fs.goInside(entranceNode?.position ?? undefined, 0); return; }
    const n = floorNodes.find((x) => x._id === value);
    if (!n?.position) return;
    const link = (data?.connections ?? []).find((c) => c.fromNodeId === n._id || c.toNodeId === n._id);
    const otherId = link ? (link.fromNodeId === n._id ? link.toNodeId : link.fromNodeId) : null;
    const other = otherId ? floorNodes.find((x) => x._id === otherId)?.position : undefined;
    // yaw 0 faces −Z; face the neighbouring node so the camera "looks down the path"
    const yaw = other ? Math.atan2(-(other.x - n.position.x), -(other.z - n.position.z)) : 0;
    fs.goInside(n.position, yaw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorNodes, data, entranceNode]);

  /* ───────────────────── UI ───────────────────── */
  const tools: Array<{ id: Tool; name: string; hint: string }> = [
    { id: 'select', name: 'Select', hint: 'Click a node pin to edit it' },
    { id: 'add-node', name: 'Add Node', hint: 'Click the floor → name the point → it is saved with x, y, z' },
    { id: 'add-room', name: 'Add Room', hint: 'Click the floor inside a room → name the room → saved as a destination' },
    { id: 'connect', name: 'Connect Nodes', hint: 'Click node A, then node B' },
  ];
  const activeTool = tools.find((t) => t.id === tool)!;
  const insideHint = 'Drag to look · W A S D walk · Shift run · Q/E turn · wheel = zoom';
  const orbitHint = '3D: left-drag rotate · right-drag pan · wheel zoom · W A S D fly · Q/E down/up';
  const planHint = '2D: drag to pan in any direction · wheel zoom · W A S D / arrows pan';

  return (
    <div className="flex h-full min-h-0 bg-[#0a0f1c] text-slate-200">
      {/* ── LEFT toolbar ── */}
      <aside className="w-56 shrink-0 border-r border-white/10 bg-[#0d1526] p-3 space-y-4 overflow-y-auto">
        <div>
          <label className="text-xs text-slate-400">Building</label>
          <select className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 p-2 text-sm">
            <option>ODeL Building</option>
          </select>
          <label className="mt-2 block text-xs text-slate-400">Floor</label>
          <select
            value={activeFloorId}
            onChange={(e) => { setFloorId(e.target.value as Id<'floors'>); setSelectedId(null); }}
            className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 p-2 text-sm"
          >
            {(data?.floors ?? []).map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}
          </select>
        </div>

        <div>
          <p className="text-xs text-slate-400 mb-2">Tools</p>
          {tools.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTool(t.id); setError(''); setNotice(t.hint); connectFromRef.current = null; setDraft(null); setTick((n) => n + 1); }}
              className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm mb-1 transition-colors ${tool === t.id ? 'bg-blue-600 text-white' : 'hover:bg-white/5'}`}
            >
              {t.id === 'add-node' ? <Plus className="size-4" /> :
               t.id === 'connect' ? <Route className="size-4" /> :
               t.id === 'add-room' ? <MapPin className="size-4" /> :
               <span className="size-4 inline-block rounded border border-current" />}
              {t.name}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-xs text-slate-400">View</p>
          <div className="flex rounded-lg bg-white/5 border border-white/10 p-1 text-xs">
            {([['3d', '3D'], ['2d', '2D'], ['inside', 'Inside']] as const).map(([m, name]) => (
              <button key={m} onClick={() => setViewMode(m)} className={`flex-1 py-1 rounded-md ${viewMode === m ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>{name}</button>
            ))}
          </div>
          <label className="block text-xs text-slate-400 pt-1">Camera position</label>
          <select
            value=""
            onChange={(e) => jumpCamera(e.target.value)}
            className="w-full rounded-lg bg-white/5 border border-white/10 p-2 text-xs"
          >
            <option value="">Jump camera to…</option>
            <option value="__entrance__">📍 Main Entrance</option>
            {floorNodes.filter((n) => n.position).map((n) => <option key={n._id} value={n._id}>{n.label}</option>)}
          </select>
          <button onClick={() => fsRef.current?.resetView()} className="w-full flex items-center justify-center gap-2 rounded-lg border border-white/10 hover:bg-white/5 py-1.5 text-xs">
            <LocateFixed className="size-3.5" /> Reset camera
          </button>
        </div>

        <div className="space-y-2 text-sm">
          {([
            ['Show Nodes', showNodes, setShowNodes],
            ['Show Paths', showPaths, setShowPaths],
            ['Show Room Labels', showLabels, setShowLabels],
          ] as const).map(([name, val, set]) => (
            <button key={name} onClick={() => set(!val)} className="w-full flex items-center justify-between">
              <span>{name}</span>
              <span className={`w-8 h-4 rounded-full relative transition-colors ${val ? 'bg-blue-500' : 'bg-white/15'}`}>
                <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${val ? 'left-[18px]' : 'left-0.5'}`} />
              </span>
            </button>
          ))}
        </div>

        {!entranceNode && sceneReady && data && (
          <button onClick={addEntranceNode} className="w-full rounded-lg border border-amber-500/50 text-amber-300 hover:bg-amber-500/10 py-2 text-xs font-semibold">
            ＋ Add “Main Entrance” node<br /><span className="font-normal text-amber-200/70">routes start here</span>
          </button>
        )}

        <button onClick={testRoute} className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 py-2 text-sm font-semibold">
          ▶ Test Route
        </button>
        {routeInfo && <p className="text-[11px] text-green-300 leading-snug">{routeInfo}</p>}
      </aside>

      {/* ── CENTER viewport ── */}
      <main className="relative flex-1 min-w-0">
        <div ref={containerRef} className="absolute inset-0" />

        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0f1c] p-8 text-center">
            <div className="max-w-md space-y-3">
              <p className="text-lg font-semibold text-red-400">3D model not found</p>
              <p className="text-sm text-slate-400">{loadError}</p>
            </div>
          </div>
        )}

        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-2 z-10">
          <div className="flex rounded-lg border border-white/10 bg-[#0d1526]/90 overflow-hidden">
            {([['3d', '3D'], ['2d', '2D Plan'], ['inside', 'Inside']] as const).map(([m, name]) => (
              <button key={m} onClick={() => setViewMode(m)}
                className={`px-4 py-2 text-sm font-semibold transition-colors ${viewMode === m ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/10'}`}>
                {m === 'inside' && <Camera className="inline size-3.5 mr-1 -mt-0.5" />}{name}
              </button>
            ))}
          </div>
          <button onClick={doPublish} className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 px-5 py-2 text-sm font-semibold">
            <Send className="size-4" /> Publish
          </button>
        </div>

        {/* ── name-the-point dialog: appears right after a floor click ── */}
        {draft && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
            <form
              onSubmit={(e) => { e.preventDefault(); void saveDraft(); }}
              className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d1526] p-5 shadow-2xl space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{draft.isRoom ? 'Name this room' : 'Name this point'}</h3>
                <button type="button" onClick={() => setDraft(null)} aria-label="Cancel" className="p-1 rounded hover:bg-white/10"><X className="size-4" /></button>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Coordinates picked from the floor (metres)</p>
                <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                  {(['x', 'y', 'z'] as const).map((a) => (
                    <div key={a} className="rounded-lg bg-white/5 border border-white/10 px-2 py-1.5"><span className="text-slate-500">{a.toUpperCase()} </span>{draft.position[a]}</div>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400">Label / room name *</label>
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Cafe, Room 101, Corridor bend"
                  maxLength={80}
                  className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.isRoom} onChange={(e) => setDraft({ ...draft, isRoom: e.target.checked })} />
                This is a room (visitors can ask to go here)
              </label>
              {draft.isRoom && (
                <input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Short description (optional)"
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              )}
              {draft.connectToId ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={draft.connect} onChange={(e) => setDraft({ ...draft, connect: e.target.checked })} />
                  Connect to “{allNodes.find((n) => n._id === draft.connectToId)?.label ?? 'previous node'}”
                </label>
              ) : (
                <p className="text-xs text-slate-500">First point on this floor — nothing to connect to yet.</p>
              )}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setDraft(null)} className="flex-1 rounded-lg border border-white/10 hover:bg-white/5 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={saving || !draft.name.trim()} className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-2 text-sm font-semibold">
                  {saving ? 'Saving…' : 'Save to database'}
                </button>
              </div>
            </form>
          </div>
        )}

        {(notice || error) && (
          <div className={`absolute bottom-10 left-1/2 -translate-x-1/2 z-10 max-w-[90%] rounded-lg px-4 py-2 text-sm border ${error ? 'bg-red-500/15 border-red-500/40 text-red-300' : 'bg-green-500/15 border-green-500/40 text-green-300'}`}>
            {error || notice}
          </div>
        )}

        <p className="absolute bottom-3 left-3 right-3 text-center text-xs text-slate-500 z-10 pointer-events-none">
          {viewMode === 'inside' ? insideHint : viewMode === '2d' ? planHint : orbitHint} · <span className="text-slate-400">{activeTool.hint}</span>
        </p>
      </main>

      {/* ── RIGHT node details ── */}
      <aside className="w-72 shrink-0 border-l border-white/10 bg-[#0d1526] p-4 space-y-4 overflow-y-auto">
        <h3 className="flex items-center gap-2 font-semibold">
          <MapPin className="size-4 text-blue-400" /> Node Details
        </h3>

        {!selected ? (
          <p className="text-sm text-slate-400">
            Select a node on the model, or choose <b>Add Node</b> / <b>Add Room</b> and click the floor — you will be asked to name it.
          </p>
        ) : (
          <>
            <div className="text-sm space-y-3">
              <div>
                <label className="text-xs text-slate-400">Node ID</label>
                <div className="mt-1 rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 font-mono text-xs">{String(selected._id).slice(-6).toUpperCase()}</div>
              </div>
              <div>
                <label className="text-xs text-slate-400">Label</label>
                <input value={label} onChange={(e) => setLabel(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400">Position (x, y, z) — metres</label>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <input key={axis} type="number" step="0.1" value={pos[axis]}
                      onChange={(e) => setPos({ ...pos, [axis]: Number(e.target.value) })}
                      className="rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isLandmark} onChange={(e) => setIsLandmark(e.target.checked)} />
                Landmark (gives voice cues)
              </label>
              {isLandmark && (
                <select value={landmarkType} onChange={(e) => setLandmarkType(e.target.value as LandmarkType)}
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm">
                  {landmarkTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
            </div>

            <button onClick={saveNode} disabled={saving} className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-2 text-sm font-semibold">
              {saving ? 'Saving…' : 'Save Node'}
            </button>
            <button onClick={() => selected.position && fsRef.current?.flyTo(selected.position, 6)}
              className="w-full rounded-lg border border-white/10 hover:bg-white/5 py-1.5 text-sm">Focus camera here</button>

            <div className="rounded-lg border border-white/10 p-3 space-y-2">
              <p className="text-xs text-slate-400 font-semibold">ROOM INFO</p>
              <input value={destName} onChange={(e) => setDestName(e.target.value)} placeholder="Room name e.g. Classroom A (102)"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
              <input value={destDesc} onChange={(e) => setDestDesc(e.target.value)} placeholder="Short description (optional)"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
              <button onClick={saveDestination} className="w-full rounded-lg border border-blue-500/50 text-blue-300 hover:bg-blue-500/10 py-1.5 text-sm">
                {selectedDest ? 'Update Room / Destination' : 'Save as Room / Destination'}
              </button>
              {selectedDest && <p className="text-[11px] text-slate-500">Currently bound as “{selectedDest.name}”</p>}
            </div>

            <div>
              <p className="text-xs text-slate-400 font-semibold mb-2">CONNECTED NODES ({selectedConns.length})</p>
              {selectedConns.length === 0 && <p className="text-xs text-slate-500">None — use the Connect Nodes tool on the left.</p>}
              {selectedConns.map((c) => {
                const otherId = (c.fromNodeId === selectedId ? c.toNodeId : c.fromNodeId) as Id<'nodes'>;
                const other = allNodes.find((n) => n._id === otherId);
                return (
                  <div key={c._id} className="flex items-center justify-between rounded-lg bg-white/5 px-2 py-1.5 mb-1 text-sm">
                    <span className="truncate">{other?.label ?? String(otherId).slice(-6)}</span>
                    <button onClick={() => deleteConnection({ token, _id: c._id }).then(() => setNotice('Connection removed.')).catch((e) => setError(e.message))}
                      className="text-red-400 hover:text-red-300 ml-2" aria-label="Delete connection">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <button onClick={removeNode} className="w-full flex items-center justify-center gap-2 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 py-2 text-sm">
              <Trash2 className="size-4" /> Delete Node
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
