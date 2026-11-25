/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

/**
 * One shared, long-lived 3D scene.
 *
 * The building model is downloaded, parsed, shader-compiled and "interior-prepared" ONCE, in the background,
 * as soon as the app opens (see components/ScenePreloader.tsx). The directions page then just moves the
 * already-built canvas into view, so asking for directions never waits for the model.
 */
import { createFloorScene, MODEL_URL } from './floorScene';
import { setSceneStatus } from './sceneStatus';
import { nearestNode, pickStartNode, type GNode } from '@/lib/wayfinding/graph';

type FloorScene = Awaited<ReturnType<typeof createFloorScene>>;

let scenePromise: Promise<FloorScene> | null = null;
let scene: FloorScene | null = null;
let parkEl: HTMLDivElement | null = null;
let preparedKey = '';
let preparing: Promise<void> | null = null;

/** Off-screen element the canvas lives in while no page is showing the scene. */
function getPark(): HTMLDivElement {
  if (parkEl && document.body.contains(parkEl)) return parkEl;
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:720px;overflow:hidden;pointer-events:none;visibility:hidden;';
  document.body.appendChild(el);
  parkEl = el;
  return el;
}

/** Start building the scene (safe to call many times — only the first call does any work). */
export function preloadScene(): Promise<FloorScene> {
  if (scenePromise) return scenePromise;
  setSceneStatus({ phase: 'loading', progress: 0.05, error: '' });
  scenePromise = (async () => {
    const fs = await createFloorScene(getPark(), MODEL_URL, { role: 'visitor' });
    fs.setViewMode('inside');            // visitors are ALWAYS inside — the outside is never shown
    fs.compileShaders();                 // pay the shader-compile cost now, not on the first visible frame
    fs.renderNow();
    fs.detach(getPark());                // nothing is looking at it yet: stop rendering until a page attaches it
    scene = fs;
    void import('./pins');               // warm the destination-pin module too, so the first route has nothing left to fetch
    setSceneStatus({ phase: 'preparing', progress: 0.6 });
    return fs;
  })().catch((error) => {
    scenePromise = null;
    setSceneStatus({ phase: 'error', error: error instanceof Error ? error.message : 'Unknown model loading error' });
    throw error;
  });
  return scenePromise;
}

export const getScene = () => scene;

/**
 * Feed the published map (from the database) into the scene: movement settings, material overrides and the
 * list of "outside-only" meshes to hide. Runs in the background right after the model is parsed.
 */
export function prepareScene(mapData: any): Promise<void> {
  if (!mapData) return Promise.resolve();
  const key = JSON.stringify([
    mapData.viewSettings?.hiddenMeshes?.length ?? 0,
    mapData.overrides?.length ?? 0,
    mapData.viewSettings ?? null,
  ]);
  if (preparing && key === preparedKey) return preparing;
  preparedKey = key;
  preparing = (async () => {
    const fs = await preloadScene();
    fs.applyOverrides(mapData.overrides ?? []);
    const s = mapData.viewSettings;
    if (s) fs.setSettings({
      eyeHeight: s.eyeHeight, walkSpeed: s.walkSpeed, runSpeed: s.runSpeed, turnSpeed: s.turnSpeed,
      fov: s.fov, headBob: s.headBob, collisions: s.collisions, guideSpeed: s.guideSpeed,
    });

    const baked: string[] = s?.hiddenMeshes ?? [];
    if (baked.length) {
      fs.setHiddenMeshes(baked);
    } else {
      const cacheKey = `navi-hidden-v1:${MODEL_URL}:${fs.meshNames().length}`;
      let cached: string[] | null = null;
      try { const raw = window.localStorage.getItem(cacheKey); if (raw) cached = JSON.parse(raw); } catch { /* storage unavailable — just compute */ }
      if (cached) {
        fs.setHiddenMeshes(cached);
      } else {
        const names: string[] = await fs.computeHiddenMeshes((p: number) => setSceneStatus({ phase: 'preparing', progress: 0.6 + p * 0.4 }));
        fs.setHiddenMeshes(names);
        try { window.localStorage.setItem(cacheKey, JSON.stringify(names)); } catch { /* ignore */ }
      }
    }
    fs.renderNow();
    setSceneStatus({ phase: 'ready', progress: 1 });
  })().catch((error) => {
    preparing = null;
    preparedKey = '';
    // Never leave the visitor on a black screen: show the building even if preparation failed.
    if (scene) setSceneStatus({ phase: 'ready', progress: 1 });
    else setSceneStatus({ phase: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
  });
  return preparing;
}

/** Show the shared scene inside `container`. Returns a function that parks it again. */
export function attachScene(container: HTMLElement): () => void {
  const fs = scene;
  if (!fs) return () => {};
  fs.attach(container);
  return () => { fs.detach(getPark()); };
}

/** Where the visitor starts: the entrance node (or the model's own entrance), facing into the building. */
export function startPose(mapData: any, fs: FloorScene) {
  const ns: GNode[] = (mapData?.nodes ?? []).map((n: any) => ({ id: n._id, label: n.label, position: n.position }));
  const s = mapData?.viewSettings;
  const startId = ns.length ? pickStartNode(ns) : null;
  const startNode = startId ? (mapData.nodes as any[]).find((n) => n._id === startId) : null;
  const pos = s?.startPosition ?? startNode?.position ?? fs.entranceStart;
  let yaw = 0;
  if (typeof startNode?.yaw === 'number') yaw = startNode.yaw;
  else if (typeof s?.startYaw === 'number') yaw = s.startYaw;
  else if (startNode) {
    const conn = (mapData.connections ?? []).find((c: any) => c.fromNodeId === startId || c.toNodeId === startId);
    const otherId = conn ? (conn.fromNodeId === startId ? conn.toNodeId : conn.fromNodeId) : null;
    const other = otherId ? ns.find((n) => n.id === otherId) : null;
    if (other) yaw = Math.atan2(-(other.position.x - startNode.position.x), -(other.position.z - startNode.position.z));
  }
  return { pos, yaw, startNode: startNode as any | null, nearest: (p: any) => nearestNode(ns, p) };
}
