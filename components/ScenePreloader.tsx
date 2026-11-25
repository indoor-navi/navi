/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { getSceneStatus, getServerSceneStatus, subscribeSceneStatus } from '@/lib/three/sceneStatus';

/**
 * Mounted once in the root layout. The moment the app opens it:
 *  1. subscribes to the published map (so the data is already in the Convex cache when directions are asked for),
 *  2. downloads + builds the 3D building and prepares its interior in the background.
 * Asking for directions later is then instant — nothing has to load.
 */
export default function ScenePreloader() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin') ?? false;
  const mapData = useQuery(api.mapAdmin.getPublishedMap, isAdmin ? 'skip' : {}) as any;
  const status = useSyncExternalStore(subscribeSceneStatus, getSceneStatus, getServerSceneStatus);

  // 1) start downloading + building the model right away (lazy chunk so it never blocks first paint)
  useEffect(() => {
    if (isAdmin) return;
    let cancelled = false;
    import('@/lib/three/sceneStore').then((m) => { if (!cancelled) m.preloadScene().catch(() => {}); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  // 2) as soon as the map data arrives, prepare the interior (hidden meshes, materials, movement settings)
  useEffect(() => {
    if (isAdmin || !mapData) return;
    import('@/lib/three/sceneStore').then((m) => { m.prepareScene(mapData).catch(() => {}); });
  }, [isAdmin, mapData]);

  // The directions page has its own full-screen loader; elsewhere show a small, unobtrusive progress pill.
  const onDirections = pathname?.startsWith('/directions') ?? false;
  const busy = status.phase === 'loading' || status.phase === 'preparing';
  if (isAdmin || onDirections || !busy) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/80 px-3 py-1.5 text-[11px] font-medium text-zinc-300 backdrop-blur-sm"
    >
      <span className="size-3 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-300" />
      Getting the building ready… {Math.round(status.progress * 100)}%
    </div>
  );
}
