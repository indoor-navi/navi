/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { MapPin, Plus, Route, Save, Send, Trash2 } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { createFloorScene, MODEL_URL } from '@/lib/three/floorScene';
import { buildRoute } from '@/lib/three/route';
import { makePin } from '@/lib/three/pins';
import { findPath, type GEdge, type GNode } from '@/lib/wayfinding/graph';

type Position = { x: number; y: number; z: number };
type Tool = 'select' | 'add-node' | 'connect' | 'destination';
type LandmarkType = 'corridor' | 'staircase' | 'elevator' | 'double-door';

interface MapEditorData {
  floors: Array<{ _id: Id<'floors'>; name: string; level: number }>;
  nodes: Array<{
    _id: Id<'nodes'>;
    floorId: Id<'floors'>;
    label: string;
    position?: Position;
    isLandmark: boolean;
    landmarkType?: LandmarkType;
  }>;
  connections: Array<{
    _id: Id<'connections'>;
    fromNodeId: Id<'nodes'>;
    toNodeId: Id<'nodes'>;
    textDirection: string;
    estimatedWalkingTime: number;
  }>;
  destinations: Array<{
    _id: Id<'destinations'>;
    name: string;
    floorId: Id<'floors'>;
    targetNodeId: Id<'nodes'>;
    description: string;
  }>;
  overrides: Array<{
    floorId: Id<'floors'>;
    meshKey: string;
    color?: string;
    textureUrl?: string;
    tiling?: number;
  }>;
}

const landmarkTypes: LandmarkType[] = ['corridor', 'staircase', 'elevator', 'double-door'];
const round1 = (n: number) => Math.round(n * 100) / 100;

function disposeObject(obj: any) {
  obj.removeFromParent();
  obj.traverse((o: any) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
  });
}

export default function MapEditor3D() {
  const [token] = useState(() => typeof window === 'undefined' ? '' : window.localStorage.getItem('navi_admin_session') || '');
  const data = useQuery(api.mapAdmin.listMapData, { token }) as MapEditorData | undefined;
  const addNode = useMutation(api.mapAdmin.addNode3D);
  const updateNode = useMutation(api.mapAdmin.updateNode3D);
  const deleteNode = useMutation(api.mapAdmin.deleteNode3D);
  const addConnection = useMutation(api.mapAdmin.addConnection3D);
  const deleteConnection = useMutation(api.mapAdmin.deleteConnection3D);
  const addDestination = useMutation(api.mapAdmin.addDestination3D);
  const publishMap = useMutation(api.mapAdmin.publishMap);

  const containerRef = useRef<HTMLDivElement>(null);
  const fsRef = useRef<any>(null);
  const pinsRef = useRef<Map<string, any>>(new Map());
  const routesRef = useRef<any[]>([]);
  const connectFromRef = useRef<Id<'nodes'> | null>(null);

  const [sceneReady, setSceneReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [tool, setTool] = useState<Tool>('select');
 const [viewMode, setViewMode] = useState<'2d' | '3d'>('3d');
useEffect(() => { toolRef.current = tool; }, [tool]);
useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
/* Switch between the 3D orbit view and the 2D top-down plan of the SAME model.
   Nodes/connections render from the DB in both, so anything added in 2D shows in 3D. */
useEffect(() => {
  if (sceneReady && fsRef.current) fsRef.current.setViewMode(viewMode);
}, [viewMode, sceneReady]);
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
  const viewModeRef = useRef<'2d' | '3d'>('3d');
  const toolRef = useRef<Tool>('select');

  const activeFloorId: Id<'floors'> = (floorId || data?.floors?.[0]?._id || '') as Id<'floors'>;
  const floorNodes = (data?.nodes ?? []).filter((n) => n.floorId === activeFloorId);
  const selected = floorNodes.find((n) => n._id === selectedId);
  const selectedConns = (data?.connections ?? []).filter(
    (c) => c.fromNodeId === selectedId || c.toNodeId === selectedId
  );
  const selectedDest = (data?.destinations ?? []).find((d) => d.targetNodeId === selectedId);

  /* ───────────────────── 3D scene lifecycle ───────────────────── */
  useEffect(() => {
    let cancelled = false;
    let offFrame: any;
    (async () => {
      try {
        const fs = await createFloorScene(containerRef.current!, MODEL_URL, { hideRoof: true });
        if (cancelled) { fs.dispose(); return; }
        fsRef.current = fs;
        setSceneReady(true);

        offFrame = fs.onFrame((_t: number, dt: number) => {
          for (const r of routesRef.current) r.update(dt);
        });

        fs.renderer.domElement.addEventListener('pointerdown', async (e) => {
          const hitNodeId = pickPin(fs, e.clientX, e.clientY) as Id<'nodes'> | null;
          if (hitNodeId) { handleNodeClick(hitNodeId); return; }

          // drop a node on the real building surface (model raycast)
          if (toolRef.current === 'add-node' && activeFloorId) {
            const is2d = fs.getViewMode() === '2d';
            const p = fs.pickSurface(e.clientX, e.clientY, is2d ? { floorsOnly: true } : undefined);
            if (p) {
              const position = { x: round1(p.x), y: round1(p.y), z: round1(p.z) };
              try {
                const id = await addNode({ token, floorId: activeFloorId, label: 'New Node', position });
                setSelectedId(id);
                setLabel('New Node');
                setPos(position);
                setIsLandmark(false);
                setDestName('');
                setNotice(`Node dropped at (${position.x}, ${position.y}, ${position.z}) — rename it on the right.`);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not add node.');
              }
            }
          } else if (tool === 'connect' && !hitNodeId) {
            setNotice('Click a node pin first, then a second node to connect.');
          }
        });
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'The 3D map could not be loaded.');
      }
    })();
    return () => {
      cancelled = true;
      offFrame?.();
      fsRef.current?.dispose();
      fsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* raycast helper: find which node pin was clicked */
  function pickPin(fs: any, clientX: number, clientY: number): string | null {
    const rect = fs.renderer.domElement.getBoundingClientRect();
    const pointer = new fs.THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const rc = new fs.THREE.Raycaster();
    rc.setFromCamera(pointer, fs.camera);
    const hits = rc.intersectObjects([...pinsRef.current.values()], true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !o.userData.nodeId) o = o.parent;
    return o?.userData.nodeId ?? null;
  }

  async function handleNodeClick(nodeId: Id<'nodes'>) {
    setError('');
    if (tool === 'connect') {
      if (!connectFromRef.current) {
        connectFromRef.current = nodeId;
        setNotice('Connection started — now click the second node.');
        refreshPins();
      } else if (connectFromRef.current !== nodeId) {
        try {
          await addConnection({ token, fromNodeId: connectFromRef.current, toNodeId: nodeId });
          setNotice('Nodes connected.');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not connect nodes.');
        }
        connectFromRef.current = null;
        refreshPins();
      }
      return;
    }
    // select / destination tool
    const n = floorNodes.find((x) => x._id === nodeId);
    setSelectedId(nodeId);
    setLabel(n?.label ?? '');
    if (n?.position) setPos({ x: n.position.x, y: n.position.y, z: n.position.z });
    setIsLandmark(n?.isLandmark ?? false);
    setLandmarkType(n?.landmarkType ?? 'corridor');
    const d = (data?.destinations ?? []).find((dd) => dd.targetNodeId === nodeId);
    setDestName(d?.name ?? '');
    setDestDesc(d?.description ?? '');
  }

  /* ───────────────────── pins + path lines mirror DB ───────────────────── */
  function refreshPins() { setTick((t) => t + 1); }
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const fs = fsRef.current;
    if (!fs || !data || !sceneReady) return;
    let cancelled = false;

    for (const g of pinsRef.current.values()) disposeObject(g);
    pinsRef.current.clear();
    for (const r of routesRef.current) r.dispose();
    routesRef.current = [];

    const withPos = floorNodes.filter((n): n is typeof n & { position: Position } => Boolean(n.position));
    void Promise.all(withPos.map(async (n) => {
      const color = n._id === connectFromRef.current ? 0xf59e0b : n._id === selectedId ? 0x22c55e : 0x38bdf8;
      const pin = await makePin(color, n.label);
      pin.position.set(n.position.x, n.position.y, n.position.z);
      pin.userData.nodeId = n._id;
      pin.visible = showNodes;
      pin.traverse((o: any) => { if (o.isSprite) o.visible = showLabels; });
      return [String(n._id), pin] as const;
    })).then((entries) => {
      if (cancelled) { entries.forEach(([, p]) => disposeObject(p)); return; }
      for (const [id, pin] of entries) { fs.scene.add(pin); pinsRef.current.set(id, pin); }
    });

    if (showPaths) {
      const byId = new Map(withPos.map((n) => [String(n._id), n]));
      for (const c of data.connections) {
        const a = byId.get(String(c.fromNodeId));
        const b = byId.get(String(c.toNodeId));
        if (!a || !b) continue;
        const r = buildRoute(fs.THREE, [a.position, b.position]);
        fs.scene.add(r.group);
        routesRef.current.push(r);
      }
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, activeFloorId, sceneReady, selectedId, showNodes, showPaths, showLabels, tick]);

  useEffect(() => {
    if (sceneReady) fsRef.current?.applyOverrides((data?.overrides ?? []).filter((o) => o.floorId === activeFloorId));
  }, [data?.overrides, activeFloorId, sceneReady]);

  /* ───────────────────── actions ───────────────────── */
  const saveNode = async () => {
    if (!selectedId) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await updateNode({
        token, _id: selectedId, label: label.trim(), position: pos,
        isLandmark, landmarkType: isLandmark ? landmarkType : undefined,
      });
      setNotice('Node saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the node.');
    } finally { setSaving(false); }
  };

  const removeNode = async () => {
    if (!selectedId) return;
    try {
      await deleteNode({ token, _id: selectedId });
      setSelectedId(null);
      setNotice('Node deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete the node.');
    }
  };

  const saveDestination = async () => {
    if (!selectedId || !destName.trim()) return setError('Enter a room name first.');
    try {
      await addDestination({
        token, name: destName.trim(), floorId: activeFloorId,
        targetNodeId: selectedId, description: destDesc.trim(),
      });
      setNotice(`Room "${destName.trim()}" bound to this node.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the room.');
    }
  };

  const testRoute = async () => {
    const fs = fsRef.current;
    if (!fs || !selected?.position) return setError('Select a destination node first.');
    const withPos = floorNodes.filter((n): n is typeof n & { position: Position } => Boolean(n.position));
    const others = withPos.filter((n) => n._id !== selectedId);
    if (!others.length) return setError('Add at least one more node to test a route.');
    const ns: GNode[] = withPos.map((n) => ({ id: n._id, label: n.label, position: n.position }));
    const es: GEdge[] = (data?.connections ?? []).map((c) => ({ from: c.fromNodeId, to: c.toNodeId }));
    const entrance = ns.find((n) => /entrance|main entry/i.test(n.label)) ?? ns[0];
    const path = findPath(ns, es, entrance.id, selected._id);
    if (!path) return setError('No route — connect the nodes first.');
    for (const r of routesRef.current) r.dispose();
    routesRef.current = [];
    const r = buildRoute(fs.THREE, path.map((id) => ns.find((n) => n.id === id)!.position));
    fs.scene.add(r.group);
    routesRef.current.push(r);
    setNotice(`Route OK: ${path.length} nodes from ${entrance.label} to ${selected.label}.`);
  };

  const doPublish = async () => {
    try {
      await publishMap({ token });
      setNotice('Map published — live in the navigation app.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed.');
    }
  };

  /* ───────────────────── UI ───────────────────── */
  const tools: Array<{ id: Tool; name: string; hint: string }> = [
    { id: 'select', name: 'Select', hint: 'Click a node pin to edit it' },
    { id: 'add-node', name: 'Add Node', hint: 'Click the building floor to drop a node' },
    { id: 'connect', name: 'Connect Nodes', hint: 'Click node A, then node B' },
    { id: 'destination', name: 'Add Room', hint: 'Select a node, then name the room' },
  ];
  const activeTool = tools.find((t) => t.id === tool)!;

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
              onClick={() => { setTool(t.id); setError(''); setNotice(t.hint); }}
              className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm mb-1 transition-colors ${
                tool === t.id ? 'bg-blue-600 text-white' : 'hover:bg-white/5'
              }`}
            >
              {t.id === 'add-node' ? <Plus className="size-4" /> :
               t.id === 'connect' ? <Route className="size-4" /> :
               t.id === 'destination' ? <MapPin className="size-4" /> :
               <span className="size-4 inline-block rounded border border-current" />}
              {t.name}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-xs text-slate-400">View</p>
          <div className="flex rounded-lg bg-white/5 border border-white/10 p-1 text-sm">
            <span className="flex-1 text-center py-1 rounded-md bg-blue-600 text-white">3D</span>
            <span className="flex-1 text-center py-1 rounded-md text-slate-500">2D</span>
          </div>
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

        <button
          onClick={testRoute}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 py-2 text-sm font-semibold"
        >
          ▶ Test Route
        </button>
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

        {/* floating action bar */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-2 z-10">
          <button
            onClick={() => setNotice('Draft saved.')}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0d1526]/90 px-4 py-2 text-sm hover:bg-white/10"
          >
            <Save className="size-4" /> Save Draft
          </button>
          <div className="flex rounded-lg border border-white/10 bg-[#0d1526]/90 overflow-hidden">
            {(['2d', '3d'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-4 py-2 text-sm font-semibold transition-colors ${
                  viewMode === m ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                {m === '2d' ? '2D Plan' : '3D'}
              </button>
            ))}
          </div>
          <button
            onClick={doPublish}
            className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 px-5 py-2 text-sm font-semibold"
          >
            <Send className="size-4" /> Publish
          </button>
        </div>

        {(notice || error) && (
          <div className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-lg px-4 py-2 text-sm border ${
            error ? 'bg-red-500/15 border-red-500/40 text-red-300' : 'bg-green-500/15 border-green-500/40 text-green-300'
          }`}>
            {error || notice}
          </div>
        )}

        <p className="absolute bottom-3 right-3 text-xs text-slate-500 z-10">{activeTool.hint}</p>
      </main>

      {/* ── RIGHT node details ── */}
      <aside className="w-72 shrink-0 border-l border-white/10 bg-[#0d1526] p-4 space-y-4 overflow-y-auto">
        <h3 className="flex items-center gap-2 font-semibold">
          <MapPin className="size-4 text-blue-400" /> Node Details
        </h3>

        {!selected ? (
          <p className="text-sm text-slate-400">
            Select a node on the model, or choose <b>Add Node</b> and click anywhere on the building.
          </p>
        ) : (
          <>
            <div className="text-sm space-y-3">
              <div>
                <label className="text-xs text-slate-400">Node ID</label>
                <div className="mt-1 rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 font-mono text-xs">
                  {String(selected._id).slice(-6).toUpperCase()}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400">Label</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Position (x, y, z) — metres</label>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <input
                      key={axis}
                      type="number"
                      step="0.1"
                      value={pos[axis]}
                      onChange={(e) => setPos({ ...pos, [axis]: Number(e.target.value) })}
                      className="rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                    />
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isLandmark} onChange={(e) => setIsLandmark(e.target.checked)} />
                Landmark (gives voice cues)
              </label>
              {isLandmark && (
                <select
                  value={landmarkType}
                  onChange={(e) => setLandmarkType(e.target.value as LandmarkType)}
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm"
                >
                  {landmarkTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
            </div>

            <button
              onClick={saveNode}
              disabled={saving}
              className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-2 text-sm font-semibold"
            >
              {saving ? 'Saving…' : 'Save Node'}
            </button>

            {/* Room info / destination binding */}
            <div className="rounded-lg border border-white/10 p-3 space-y-2">
              <p className="text-xs text-slate-400 font-semibold">ROOM INFO</p>
              <input
                value={destName}
                onChange={(e) => setDestName(e.target.value)}
                placeholder="Room name e.g. Classroom A (102)"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
              />
              <input
                value={destDesc}
                onChange={(e) => setDestDesc(e.target.value)}
                placeholder="Short description (optional)"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
              />
              <button
                onClick={saveDestination}
                className="w-full rounded-lg border border-blue-500/50 text-blue-300 hover:bg-blue-500/10 py-1.5 text-sm"
              >
                {selectedDest ? 'Update Room / Destination' : 'Save as Room / Destination'}
              </button>
              {selectedDest && (
                <p className="text-[11px] text-slate-500">Currently bound as “{selectedDest.name}”</p>
              )}
            </div>

            {/* Connected nodes */}
            <div>
              <p className="text-xs text-slate-400 font-semibold mb-2">CONNECTED NODES ({selectedConns.length})</p>
              {selectedConns.length === 0 && (
                <p className="text-xs text-slate-500">None — use the Connect Nodes tool on the left.</p>
              )}
              {selectedConns.map((c) => {
                const otherId = (c.fromNodeId === selectedId ? c.toNodeId : c.fromNodeId) as Id<'nodes'>;
                const other = floorNodes.find((n) => n._id === otherId);
                return (
                  <div key={c._id} className="flex items-center justify-between rounded-lg bg-white/5 px-2 py-1.5 mb-1 text-sm">
                    <span className="truncate">{other?.label ?? String(otherId).slice(-6)}</span>
                    <button
                      onClick={() => deleteConnection({ token, _id: c._id })}
                      className="text-red-400 hover:text-red-300 ml-2"
                      aria-label="Delete connection"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              onClick={removeNode}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 py-2 text-sm"
            >
              <Trash2 className="size-4" /> Delete Node
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
