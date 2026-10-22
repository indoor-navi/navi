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

/** Journeys always begin at the MAIN ENTRANCE; reception/lobby are only fallbacks. */
export function findEntranceNode(nodes: GNode[]): GNode | null {
  return (
    nodes.find((n) => /main\s*entr/i.test(n.label)) ??
    nodes.find((n) => /entrance|entry/i.test(n.label)) ??
    null
  );
}

export function pickStartNode(nodes: GNode[]): string | null {
  if (!nodes.length) return null;
  const preferred =
    findEntranceNode(nodes) ??
    nodes.find((n) => /reception|front\s*desk/i.test(n.label)) ??
    nodes.find((n) => /lobby/i.test(n.label));
  if (preferred) return preferred.id;
  return nearestNode(nodes, { x: 0, y: 0, z: 0 });
}

/** Total walking distance (metres) along a node-id path. */
export function pathLength(nodes: GNode[], path: string[]): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = byId.get(path[i - 1]); const b = byId.get(path[i]);
    if (a && b) total += dist(a.position, b.position);
  }
  return total;
}

/** Groups of mutually reachable nodes; more than one group means part of the map is cut off. */
export function connectedComponents(nodes: GNode[], edges: GEdge[]): string[][] {
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) { adj.get(e.from)?.push(e.to); adj.get(e.to)?.push(e.from); }
  const seen = new Set<string>(); const groups: string[][] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const group: string[] = []; const stack = [n.id]; seen.add(n.id);
    while (stack.length) {
      const u = stack.pop()!; group.push(u);
      for (const w of adj.get(u) ?? []) if (!seen.has(w)) { seen.add(w); stack.push(w); }
    }
    groups.push(group);
  }
  return groups;
}
