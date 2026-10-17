export interface Pos { x: number; y: number; z: number; }
export interface GNode { id: string; label: string; position: Pos; }
export interface GEdge { from: string; to: string; }

function dist(a: Pos, b: Pos) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Dijkstra shortest path over an undirected graph. Returns node-id sequence or null. */
export function findPath(nodes: GNode[], edges: GEdge[], startId: string, goalId: string): string[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(startId) || !byId.has(goalId)) return null;
  const adj = new Map<string, Array<{ to: string; w: number }>>();
  const add = (a: string, b: string) => {
    const na = byId.get(a); const nb = byId.get(b);
    if (!na || !nb) return;
    const w = dist(na.position, nb.position);
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, w });
  };
  for (const e of edges) { add(e.from, e.to); add(e.to, e.from); }

  const distTo = new Map<string, number>([[startId, 0]]);
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  for (;;) {
    let u: string | null = null; let best = Infinity;
    for (const [id, d] of distTo) if (!visited.has(id) && d < best) { best = d; u = id; }
    if (u === null) return null;
    if (u === goalId) break;
    visited.add(u);
    for (const { to, w } of adj.get(u) ?? []) {
      const nd = best + w;
      if (nd < (distTo.get(to) ?? Infinity)) { distTo.set(to, nd); prev.set(to, u); }
    }
  }
  const path = [goalId];
  while (path[0] !== startId) path.unshift(prev.get(path[0])!);
  return path;
}

export function nearestNode(nodes: GNode[], p: Pos): string | null {
  let best: string | null = null; let bestD = Infinity;
  for (const n of nodes) {
    const d = dist(n.position, p);
    if (d < bestD) { bestD = d; best = n.id; }
  }
  return best;
}

export function pickStartNode(nodes: GNode[]): string | null {
  if (!nodes.length) return null;
  const preferred =
    nodes.find((n) => /reception|front\s*desk/i.test(n.label)) ??
    nodes.find((n) => /entrance|main\s*entry|lobby/i.test(n.label));
  if (preferred) return preferred.id;
  return nearestNode(nodes, { x: 0, y: 0, z: 0 });
}