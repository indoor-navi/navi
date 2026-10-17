'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { AlertTriangle, CheckCircle2, LocateFixed, Trash2 } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { MapEditorData } from '@/components/MapEditor3D';
import { connectedComponents, findEntranceNode, findPath, pathLength, type GEdge, type GNode } from '@/lib/wayfinding/graph';

const inputCls = 'rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-blue-500';
const card = 'rounded-xl border border-white/10 bg-[#0d1526] p-4';

function useMap() {
  const [token] = useState(() => typeof window === 'undefined' ? '' : window.localStorage.getItem('navi_admin_session') || '');
  const data = useQuery(api.mapAdmin.listMapData, { token }) as MapEditorData | undefined;
  return { token, data };
}

function graphOf(data: MapEditorData) {
  const nodes: GNode[] = data.nodes.filter((n) => n.position).map((n) => ({ id: n._id, label: n.label, position: n.position! }));
  const edges: GEdge[] = data.connections.map((c) => ({ from: c.fromNodeId, to: c.toNodeId }));
  return { nodes, edges };
}

function Loading() { return <div className="p-8 text-sm text-slate-400">Loading…</div>; }

/* ───────────────────────── Dashboard ───────────────────────── */
export function DashboardPanel({ onOpenMap }: { onOpenMap: () => void }) {
  const { data } = useMap();
  if (!data) return <Loading />;
  const { nodes, edges } = graphOf(data);
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const orphans = nodes.filter((n) => !linked.has(n.id));
  const parts = connectedComponents(nodes, edges);
  const entrance = findEntranceNode(nodes);
  const unplaced = data.nodes.filter((n) => !n.position);
  const checks: Array<{ ok: boolean; text: string }> = [
    { ok: Boolean(entrance), text: entrance ? `Main entrance node found (“${entrance.label}”).` : 'No “Main Entrance” node — routes have no starting point. Add one in Building Maps.' },
    { ok: parts.length <= 1, text: parts.length <= 1 ? 'All nodes are connected into one walkable network.' : `Map is split into ${parts.length} disconnected parts — visitors cannot route between them.` },
    { ok: orphans.length === 0, text: orphans.length === 0 ? 'No isolated nodes.' : `${orphans.length} node(s) have no connection: ${orphans.map((o) => o.label).join(', ')}.` },
    { ok: unplaced.length === 0, text: unplaced.length === 0 ? 'Every node has x, y, z coordinates.' : `${unplaced.length} node(s) have no coordinates.` },
    { ok: data.destinations.length > 0, text: data.destinations.length ? `${data.destinations.length} room(s) searchable by visitors.` : 'No rooms yet — visitors have nothing to search for.' },
  ];
  const stats = [
    ['Floors', data.floors.length], ['Nodes', data.nodes.length], ['Rooms', data.destinations.length], ['Connections', data.connections.length],
  ] as const;
  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(([k, v]) => (
          <div key={k} className={card}><p className="text-xs text-slate-400">{k}</p><p className="text-3xl font-bold mt-1">{v}</p></div>
        ))}
      </div>
      <div className={card}>
        <h3 className="font-semibold mb-3">Map health</h3>
        <ul className="space-y-2 text-sm">
          {checks.map((c) => (
            <li key={c.text} className="flex gap-2 items-start">
              {c.ok ? <CheckCircle2 className="size-4 text-green-400 mt-0.5 shrink-0" /> : <AlertTriangle className="size-4 text-amber-400 mt-0.5 shrink-0" />}
              <span className={c.ok ? 'text-slate-300' : 'text-amber-200'}>{c.text}</span>
            </li>
          ))}
        </ul>
        <button onClick={onOpenMap} className="mt-4 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-semibold">Open Building Maps</button>
      </div>
    </div>
  );
}

/* ───────────────────────── Destinations ───────────────────────── */
export function DestinationsPanel({ onLocate }: { onLocate: (nodeId: string) => void }) {
  const { token, data } = useMap();
  const update = useMutation(api.mapAdmin.updateDestination3D);
  const remove = useMutation(api.mapAdmin.deleteDestination3D);
  const [edits, setEdits] = useState<Record<string, { name: string; description: string }>>({});
  const [msg, setMsg] = useState('');
  if (!data) return <Loading />;
  const rows = data.destinations;
  const floorName = (id: Id<'floors'>) => data.floors.find((f) => f._id === id)?.name ?? '—';
  const save = async (id: Id<'destinations'>) => {
    const e = edits[id]; if (!e) return;
    try { await update({ token, _id: id, name: e.name, description: e.description }); setMsg('Room saved.'); setEdits(({ [id]: _, ...rest }) => rest); }
    catch (err) { setMsg(err instanceof Error ? err.message : 'Could not save.'); }
  };
  return (
    <div className="h-full overflow-y-auto p-6 space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-semibold">Rooms & destinations ({rows.length})</h2>{msg && <span className="text-xs text-slate-400">{msg}</span>}</div>
      {rows.length === 0 && <p className="text-sm text-slate-500">No rooms yet. In Building Maps choose <b>Add Room</b> and click the floor of a room.</p>}
      {rows.map((d) => {
        const node = data.nodes.find((n) => n._id === d.targetNodeId);
        const e = edits[d._id] ?? { name: d.name, description: d.description };
        const dirty = Boolean(edits[d._id]);
        return (
          <div key={d._id} className={`${card} flex flex-wrap items-center gap-3`}>
            <input className={`${inputCls} w-56`} value={e.name} onChange={(ev) => setEdits({ ...edits, [d._id]: { ...e, name: ev.target.value } })} />
            <input className={`${inputCls} flex-1 min-w-48`} value={e.description} placeholder="Description" onChange={(ev) => setEdits({ ...edits, [d._id]: { ...e, description: ev.target.value } })} />
            <span className="text-xs text-slate-500 font-mono">{floorName(d.floorId)} · {node?.position ? `(${node.position.x}, ${node.position.y}, ${node.position.z})` : 'no position'}</span>
            {dirty && <button onClick={() => save(d._id)} className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-sm font-semibold">Save</button>}
            <button onClick={() => onLocate(d.targetNodeId)} className="p-2 rounded-lg hover:bg-white/10" aria-label="Locate on map" title="Locate on map"><LocateFixed className="size-4" /></button>
            <button onClick={() => { if (window.confirm(`Remove room “${d.name}”? The node stays on the map.`)) remove({ token, _id: d._id }).then(() => setMsg('Room removed.')).catch((er) => setMsg(er.message)); }}
              className="p-2 rounded-lg hover:bg-red-500/10 text-red-400" aria-label="Delete room"><Trash2 className="size-4" /></button>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Routes ───────────────────────── */
export function RoutesPanel({ onLocate }: { onLocate: (nodeId: string) => void }) {
  const { token, data } = useMap();
  const connect = useMutation(api.mapAdmin.addConnection3D);
  const disconnect = useMutation(api.mapAdmin.deleteConnection3D);
  const [a, setA] = useState(''); const [b, setB] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  const graph = useMemo(() => (data ? graphOf(data) : null), [data]);
  if (!data || !graph) return <Loading />;
  const label = (id: string) => data.nodes.find((n) => n._id === id)?.label ?? id.slice(-6);
  const dist = (x: string, y: string) => { const p = graph.nodes.find((n) => n.id === x)?.position; const q = graph.nodes.find((n) => n.id === y)?.position; return p && q ? Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) : 0; };

  const path = from && to && from !== to ? findPath(graph.nodes, graph.edges, from, to) : null;
  const nodeOpts = graph.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div className={card}>
        <h3 className="font-semibold mb-3">Shortest-path tester (Dijkstra)</h3>
        <div className="flex flex-wrap gap-2 items-center">
          <select className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)}><option value="">From…</option>{nodeOpts}</select>
          <span className="text-slate-500">→</span>
          <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}><option value="">To…</option>{nodeOpts}</select>
        </div>
        {from && to && from !== to && (
          <p className={`mt-3 text-sm ${path ? 'text-green-300' : 'text-amber-300'}`}>
            {path ? `${path.map(label).join(' → ')} — ${pathLength(graph.nodes, path).toFixed(1)} m` : 'No route: these nodes are not connected.'}
          </p>
        )}
      </div>

      <div className={card}>
        <h3 className="font-semibold mb-3">Add connection</h3>
        <div className="flex flex-wrap gap-2 items-center">
          <select className={inputCls} value={a} onChange={(e) => setA(e.target.value)}><option value="">Node A…</option>{nodeOpts}</select>
          <select className={inputCls} value={b} onChange={(e) => setB(e.target.value)}><option value="">Node B…</option>{nodeOpts}</select>
          <button disabled={!a || !b || a === b}
            onClick={() => connect({ token, fromNodeId: a as Id<'nodes'>, toNodeId: b as Id<'nodes'> }).then(() => setMsg('Connected.')).catch((e) => setMsg(e.message))}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-4 py-1.5 text-sm font-semibold">Connect</button>
          {msg && <span className="text-xs text-slate-400">{msg}</span>}
        </div>
      </div>

      <div className={card}>
        <h3 className="font-semibold mb-3">All connections ({data.connections.length})</h3>
        {data.connections.length === 0 && <p className="text-sm text-slate-500">No connections yet.</p>}
        <div className="space-y-1">
          {data.connections.map((c) => (
            <div key={c._id} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2 text-sm">
              <button className="hover:underline" onClick={() => onLocate(c.fromNodeId)}>{label(c.fromNodeId)}</button>
              <span className="text-slate-500">↔</span>
              <button className="hover:underline" onClick={() => onLocate(c.toNodeId)}>{label(c.toNodeId)}</button>
              <span className="ml-auto text-xs text-slate-500">{dist(c.fromNodeId, c.toNodeId).toFixed(1)} m · ~{c.estimatedWalkingTime}s</span>
              <button onClick={() => disconnect({ token, _id: c._id }).catch((e) => setMsg(e.message))} className="text-red-400 hover:text-red-300" aria-label="Delete connection"><Trash2 className="size-4" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Analytics ───────────────────────── */
export function AnalyticsPanel() {
  const [token] = useState(() => typeof window === 'undefined' ? '' : window.localStorage.getItem('navi_admin_session') || '');
  const logs = useQuery(api.auth.listAuditLogs, { token }) as Array<{ _id: string; action: string; userEmail: string; details?: string; createdAt: number }> | undefined;
  if (!logs) return <Loading />;
  const counts = new Map<string, number>();
  for (const l of logs) counts.set(l.action, (counts.get(l.action) ?? 0) + 1);
  const rows = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div className={card}>
        <h3 className="font-semibold mb-3">Editor activity (last {logs.length} actions)</h3>
        {rows.length === 0 && <p className="text-sm text-slate-500">No activity recorded yet.</p>}
        <div className="space-y-2">
          {rows.map(([action, n]) => (
            <div key={action} className="flex items-center gap-3 text-sm">
              <span className="w-44 truncate text-slate-300">{action.replace(/_/g, ' ')}</span>
              <div className="flex-1 h-2 rounded-full bg-white/5"><div className="h-2 rounded-full bg-blue-500" style={{ width: `${(n / max) * 100}%` }} /></div>
              <span className="w-8 text-right text-slate-400">{n}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={card}>
        <h3 className="font-semibold mb-3">Recent changes</h3>
        <div className="space-y-1 text-sm">
          {logs.slice(0, 20).map((l) => (
            <div key={l._id} className="flex gap-3 rounded-lg bg-white/5 px-3 py-1.5">
              <span className="text-slate-500 w-40 shrink-0">{new Date(l.createdAt).toLocaleString()}</span>
              <span className="font-medium">{l.action.replace(/_/g, ' ')}</span>
              <span className="text-slate-400 truncate">{l.details ?? ''}</span>
              <span className="ml-auto text-slate-500 truncate">{l.userEmail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
