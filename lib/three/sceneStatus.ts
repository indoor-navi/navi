/**
 * Tiny status store for the background 3D preload.
 * It deliberately does NOT import `three`, so any page can read it without pulling the 3D engine into its bundle.
 */
export type SceneLoadPhase = 'idle' | 'loading' | 'preparing' | 'ready' | 'error';

export interface SceneLoadStatus {
  phase: SceneLoadPhase;
  /** 0..1 overall progress (model download/parse is ~0–0.6, interior preparation ~0.6–1) */
  progress: number;
  error: string;
}

let status: SceneLoadStatus = { phase: 'idle', progress: 0, error: '' };
const listeners = new Set<() => void>();

export const getSceneStatus = () => status;
const serverStatus: SceneLoadStatus = { phase: 'idle', progress: 0, error: '' };
export const getServerSceneStatus = () => serverStatus;

export function setSceneStatus(next: Partial<SceneLoadStatus>) {
  const merged = { ...status, ...next };
  if (merged.phase === status.phase && merged.error === status.error && Math.abs(merged.progress - status.progress) < 0.01) return;
  status = merged;
  for (const l of listeners) l();
}

export function subscribeSceneStatus(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
