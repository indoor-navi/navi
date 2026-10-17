'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft, MapPin, Plus, Route, Save, Send, Trash2 } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { createFloorScene, MODEL_URL } from '@/lib/three/floorScene';
import { buildRoute } from '@/lib/three/route';
import { makePin } from '@/lib/three/pins';

type Position = { x: number; y: number; z: number };
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

function roundPosition(position: Position): Position {
  return {
    x: Math.round(position.x * 100) / 100,
    y: Math.round(position.y * 100) / 100,
    z: Math.round(position.z * 100) / 100,
  };
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
  const floorSceneRef = useRef<Awaited<ReturnType<typeof createFloorScene>> | null>(null);
  const pinGroupsRef = useRef<Awaited<ReturnType<typeof makePin>>[]>([]);
  const routeGroupsRef = useRef<ReturnType<typeof buildRoute>[]>([]);
  const [sceneReady, setSceneReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [floorId, setFloorId] = useState<Id<'floors'> | ''>('');
  const [selectedNodeId, setSelectedNodeId] = useState<Id<'nodes'> | null>(null);
  const [label, setLabel] = useState('');
  const [position, setPosition] = useState<Position | null>(null);
  const [isLandmark, setIsLandmark] = useState(false);
  const [landmarkType, setLandmarkType] = useState<LandmarkType>('corridor');
  const [fromNodeId, setFromNodeId] = useState<Id<'nodes'> | ''>('');
  const [toNodeId, setToNodeId] = useState<Id<'nodes'> | ''>('');
  const [destinationName, setDestinationName] = useState('');
  const [destinationNodeId, setDestinationNodeId] = useState<Id<'nodes'> | ''>('');
  const [saving, setSaving] = useState(false);

  const activeFloorId = floorId || data?.floors[0]?._id || '';
  const floorNodes = (data?.nodes ?? []).filter((node) => node.floorId === activeFloorId);

  useEffect(() => {
    let cancelled = false;
    let removeFrameListener: (() => void) | undefined;
    let onCanvasPointerDown: ((event: PointerEvent) => void) | undefined;

    const init = async () => {
      try {
        const container = containerRef.current;
        if (!container) return;
        const floorScene = await createFloorScene(container, MODEL_URL);
        if (cancelled) {
          floorScene.dispose();
          return;
        }
        floorSceneRef.current = floorScene;
        removeFrameListener = floorScene.onFrame((_time, deltaTime) => {
          for (const route of routeGroupsRef.current) route.update(deltaTime);
        });
        onCanvasPointerDown = (event) => {
          const point = floorScene.pickFloor(event.clientX, event.clientY);
          if (point) setPosition(roundPosition(point));
        };
        floorScene.renderer?.domElement?.addEventListener('pointerdown', onCanvasPointerDown);
        setSceneReady(true);
      } catch (sceneError) {
        setLoadError(sceneError instanceof Error ? sceneError.message : 'The 3D map could not be loaded.');
      }
    };

    void init();
    return () => {
      cancelled = true;
      removeFrameListener?.();
      if (onCanvasPointerDown) {
        floorSceneRef.current?.renderer?.domElement?.removeEventListener('pointerdown', onCanvasPointerDown);
      }
      floorSceneRef.current?.dispose();
      floorSceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sceneReady) return;
    floorSceneRef.current?.applyOverrides((data?.overrides ?? []).filter((override) => override.floorId === activeFloorId));
  }, [activeFloorId, data?.overrides, sceneReady]);

  useEffect(() => {
    const floorScene = floorSceneRef.current;
    if (!floorScene || !data) return;

    let cancelled = false;
    for (const group of pinGroupsRef.current) {
      group.removeFromParent();
      group.traverse((object) => {
        if (object instanceof floorScene.THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (material.map) material.map.dispose();
            material.dispose();
          }
        } else if (object instanceof floorScene.THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
    }
    pinGroupsRef.current = [];
    for (const route of routeGroupsRef.current) route.dispose();
    routeGroupsRef.current = [];

    const nodes = (data.nodes ?? [])
      .filter((node) => node.floorId === activeFloorId && Boolean(node.position))
      .filter((node): node is typeof node & { position: Position } => Boolean(node.position));
    void Promise.all(nodes.map(async (node) => {
      const pin = await makePin(node._id === selectedNodeId ? 0xf59e0b : 0x38bdf8, node.label);
      pin.position.set(node.position.x, node.position.y, node.position.z);
      pin.userData.baseY = node.position.y;
      return pin;
    })).then((pins) => {
      if (cancelled) {
        for (const pin of pins) pin.removeFromParent();
        return;
      }
      pinGroupsRef.current = pins;
      for (const pin of pins) floorScene.scene.add(pin);
    });

    const nodeById = new Map(nodes.map((node) => [node._id, node]));
    for (const connection of data.connections) {
      const from = nodeById.get(connection.fromNodeId);
      const to = nodeById.get(connection.toNodeId);
      if (!from || !to) continue;
      const route = buildRoute(floorScene.THREE, [from.position, to.position]);
      floorScene.scene.add(route.group);
      routeGroupsRef.current.push(route);
    }

    return () => {
      cancelled = true;
    };
  }, [activeFloorId, data, selectedNodeId]);

  const selectNode = (nodeId: Id<'nodes'>) => {
    const node = floorNodes.find((item) => item._id === nodeId);
    setSelectedNodeId(nodeId);
    setLabel(node?.label ?? '');
    setPosition(node?.position ? roundPosition(node.position) : null);
    setIsLandmark(node?.isLandmark ?? false);
    setLandmarkType(node?.landmarkType ?? 'corridor');
    setError('');
  };

  const resetNodeForm = () => {
    setSelectedNodeId(null);
    setLabel('');
    setPosition(null);
    setIsLandmark(false);
    setLandmarkType('corridor');
  };

  const saveNode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeFloorId) return setError('Add or select a floor before creating map nodes.');
    if (!position) return setError('Click a point on the 3D map to set the node position.');
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (selectedNodeId) {
        await updateNode({
          token,
          _id: selectedNodeId,
          label: label.trim(),
          position,
          isLandmark,
          landmarkType: isLandmark ? landmarkType : undefined,
        });
        setNotice('Map node updated.');
      } else {
        const newNodeId = await addNode({
          token,
          floorId: activeFloorId,
          label: label.trim(),
          position,
          isLandmark,
          landmarkType: isLandmark ? landmarkType : undefined,
        });
        setSelectedNodeId(newNodeId);
        setNotice('Map node added.');
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the map node.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteNode = async (nodeId: Id<'nodes'>) => {
    setError('');
    try {
      await deleteNode({ token, _id: nodeId });
      if (selectedNodeId === nodeId) resetNodeForm();
      setNotice('Map node deleted.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete the map node.');
    }
  };

  const handleAddConnection = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) {
      return setError('Choose two different nodes to connect.');
    }
    setError('');
    try {
      await addConnection({ token, fromNodeId, toNodeId });
      setNotice('3D route connection added.');
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : 'Unable to add this route connection.');
    }
  };

  const handleAddDestination = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeFloorId || !destinationNodeId || !destinationName.trim()) {
      return setError('Enter a destination name and choose its map node.');
    }
    setError('');
    try {
      await addDestination({
        token,
        name: destinationName.trim(),
        floorId: activeFloorId,
        targetNodeId: destinationNodeId,
      });
      setDestinationName('');
      setNotice('Destination added to the AI assistant.');
    } catch (destinationError) {
      setError(destinationError instanceof Error ? destinationError.message : 'Unable to add this destination.');
    }
  };

  const handlePublish = async () => {
    setError('');
    try {
      await publishMap({ token });
      setNotice('3D map published for navigation.');
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Unable to publish the map.');
    }
  };

  const handleDeleteConnection = async (connectionId: Id<'connections'>) => {
    setError('');
    try {
      await deleteConnection({ token, _id: connectionId });
      setNotice('3D route connection deleted.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete this route connection.');
    }
  };

  return (
    <main className="relative h-dvh overflow-hidden bg-[#0b1220] text-white">
      <div ref={containerRef} className="absolute inset-0" />
      {loadError && (
        <div role="alert" className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/95 p-8 text-center">
          <div className="max-w-lg space-y-3">
            <p className="text-lg font-bold text-red-400">3D model could not be loaded</p>
            <p className="text-sm text-zinc-300">{loadError}</p>
          </div>
        </div>
      )}

      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent p-4">
        <div className="flex items-center gap-3">
          <Link href="/admin" aria-label="Back to admin" className="rounded-lg p-2 text-zinc-300 hover:bg-white/10 hover:text-white">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <h1 className="font-bold">3D Map Editor</h1>
            <p className="text-xs text-zinc-400">Click the model to place route nodes</p>
          </div>
        </div>
        <button type="button" onClick={() => void handlePublish()} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-bold hover:bg-cyan-500">
          Publish map
        </button>
      </header>

      <aside className="absolute bottom-4 left-4 top-20 z-10 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <label className="space-y-1 text-xs font-semibold text-zinc-300">
          Floor
          <select
            value={activeFloorId}
            onChange={(event) => { setFloorId(event.target.value as Id<'floors'>); resetNodeForm(); }}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
          >
            {(data?.floors ?? []).map((floor) => <option key={floor._id} value={floor._id}>{floor.name}</option>)}
          </select>
        </label>

        <form onSubmit={saveNode} className="space-y-2 border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-cyan-300">{selectedNodeId ? 'Edit map node' : 'Add map node'}</h2>
            {selectedNodeId && <button type="button" onClick={resetNodeForm} className="text-[11px] text-zinc-400 hover:text-white">New</button>}
          </div>
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Node label" required className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
          {position ? (
            <div className="grid grid-cols-3 gap-2 text-[10px] text-zinc-400">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <label key={axis} className="space-y-1 uppercase">{axis}
                  <input type="number" step="0.01" value={position[axis]} onChange={(event) => setPosition({ ...position, [axis]: Number(event.target.value) })} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white" />
                </label>
              ))}
            </div>
          ) : <p className="text-[11px] text-amber-300">Click the model to choose this node&apos;s position.</p>}
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={isLandmark} onChange={(event) => setIsLandmark(event.target.checked)} />
            Mark as a landmark
          </label>
          {isLandmark && (
            <select value={landmarkType} onChange={(event) => setLandmarkType(event.target.value as LandmarkType)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
              {landmarkTypes.map((type) => <option key={type} value={type}>{type.replace('-', ' ')}</option>)}
            </select>
          )}
          <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-bold hover:bg-cyan-500 disabled:opacity-50">
            {selectedNodeId ? <Save className="size-4" /> : <Plus className="size-4" />}
            {saving ? 'Saving...' : selectedNodeId ? 'Save node' : 'Add node'}
          </button>
        </form>

        <section className="space-y-2 border-t border-slate-800 pt-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-cyan-300">Nodes on this floor</h2>
          {floorNodes.length === 0 && <p className="text-xs text-zinc-500">No positioned nodes on this floor yet.</p>}
          <div className="space-y-1">
            {floorNodes.map((node) => (
              <div key={node._id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${selectedNodeId === node._id ? 'border-cyan-500/50 bg-cyan-950/40' : 'border-slate-800 bg-slate-900/70'}`}>
                <button type="button" onClick={() => selectNode(node._id)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs">
                  <MapPin className="size-3.5 shrink-0 text-cyan-300" />
                  <span className="truncate">{node.label}</span>
                  {!node.position && <span className="text-amber-300">needs position</span>}
                </button>
                <button type="button" aria-label={`Delete ${node.label}`} onClick={() => void handleDeleteNode(node._id)} className="p-1 text-zinc-500 hover:text-red-400"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
        </section>

        <form onSubmit={handleAddConnection} className="space-y-2 border-t border-slate-800 pt-3">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300"><Route className="size-3.5" /> Connect route nodes</h2>
          <select value={fromNodeId} onChange={(event) => setFromNodeId(event.target.value as Id<'nodes'>)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-white">
            <option value="">From node</option>
            {floorNodes.map((node) => <option key={node._id} value={node._id}>{node.label}</option>)}
          </select>
          <select value={toNodeId} onChange={(event) => setToNodeId(event.target.value as Id<'nodes'>)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-white">
            <option value="">To node</option>
            {floorNodes.map((node) => <option key={node._id} value={node._id}>{node.label}</option>)}
          </select>
          <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold hover:border-cyan-500"><Plus className="size-3.5" /> Add connection</button>
          <div className="space-y-1">
            {(data?.connections ?? []).map((connection) => {
              const from = data?.nodes.find((node) => node._id === connection.fromNodeId);
              const to = data?.nodes.find((node) => node._id === connection.toNodeId);
              if (!from || !to || from.floorId !== activeFloorId || to.floorId !== activeFloorId) return null;
              return (
                <div key={connection._id} className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span className="truncate">{from.label} → {to.label}</span>
                  <button type="button" aria-label={`Delete connection from ${from.label} to ${to.label}`} onClick={() => void handleDeleteConnection(connection._id)} className="p-1 hover:text-red-400"><Trash2 className="size-3" /></button>
                </div>
              );
            })}
          </div>
        </form>

        <form onSubmit={handleAddDestination} className="space-y-2 border-t border-slate-800 pt-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-cyan-300">AI destinations</h2>
          <input value={destinationName} onChange={(event) => setDestinationName(event.target.value)} placeholder="Destination name" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
          <select value={destinationNodeId} onChange={(event) => setDestinationNodeId(event.target.value as Id<'nodes'>)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-white">
            <option value="">Target node</option>
            {floorNodes.filter((node) => node.position).map((node) => <option key={node._id} value={node._id}>{node.label}</option>)}
          </select>
          <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold hover:border-cyan-500"><Send className="size-3.5" /> Add destination</button>
          <div className="space-y-1">
            {(data?.destinations ?? []).filter((destination) => destination.floorId === activeFloorId).map((destination) => (
              <p key={destination._id} className="text-[11px] text-zinc-400">{destination.name}</p>
            ))}
          </div>
        </form>

        {error && <p role="alert" className="rounded-lg border border-red-900/70 bg-red-950/40 p-2 text-xs text-red-300">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-emerald-900/70 bg-emerald-950/40 p-2 text-xs text-emerald-300">{notice}</p>}
        {!data && !loadError && <p className="text-xs text-zinc-500">Loading map data...</p>}
      </aside>
    </main>
  );
}
