import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_URL = '/floor/ODeL_Building.glb';

type MapOverride = {
  meshKey: string;
  color?: string;
  textureUrl?: string;
  tiling?: number;
};

type FrameCallback = (time: number, deltaTime: number) => void;
export type ViewMode = '2d' | '3d' | 'inside';

type SceneOptions = {
  /** Hide all Ceiling_* meshes so the floor plan is visible from above (admin roof removal). */
  hideRoof?: boolean;
};

type PickOptions = { floorsOnly?: boolean };
type ClickCallback = (clientX: number, clientY: number, event: PointerEvent) => void;

export async function createFloorScene(container: HTMLElement, modelUrl: string, opts: SceneOptions = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b1220');

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 2000);
  // Top-down orthographic camera used for the 2D plan view (same model, same world coords)
  const planCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  let viewMode: ViewMode = '3d';

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // Free camera: not locked to one centre. Left = orbit, right/middle = pan in ANY direction
  // (screen-space), wheel = zoom, WASD/arrows/Q/E = fly. No polar or distance clamps.
  controls.maxPolarAngle = Math.PI;
  controls.minDistance = 0.5;
  controls.maxDistance = 600;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 1.2;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  scene.add(new THREE.HemisphereLight(0xe5f3ff, 0x263244, 2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(12, 20, 10);
  scene.add(keyLight);

  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const model = gltf.scene;
  scene.add(model);

  // ── Roof removal: hide every ceiling mesh so the plan is visible from above ──
  let roofHidden = Boolean(opts.hideRoof);
  const applyRoof = () => {
    model.traverse((o) => {
      if (o instanceof THREE.Mesh && /^Ceiling/i.test(o.name)) o.visible = !roofHidden;
    });
  };
  applyRoof();

  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const viewDistance = Math.max(size.x, size.y, size.z, 1) * 1.35;
  const floorY = bounds.min.y + 0.02;
  camera.position.set(center.x + viewDistance * 0.8, center.y + viewDistance * 0.7, center.z + viewDistance);
  camera.near = Math.max(viewDistance / 1000, 0.01);
  camera.far = Math.max(viewDistance * 20, 100);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();

  const activeCamera = () => (viewMode === '2d' ? planCamera : camera);

  /* ───────────── main entrance + first-person ("inside") camera ───────────── */
  const entranceObj = model.getObjectByName('Main_Entrance');
  const entrance = entranceObj
    ? new THREE.Box3().setFromObject(entranceObj).getCenter(new THREE.Vector3())
    : new THREE.Vector3(0, 0, 0);
  entrance.y = bounds.min.y;
  // The model runs from the entrance toward -Z, so stepping 0.8 m in is "inside the lobby".
  const entranceStart = new THREE.Vector3(entrance.x, entrance.y, entrance.z - 0.8);

  const fpv = { pos: entranceStart.clone(), yaw: 0, pitch: 0, eye: 1.6, dragging: false, lastX: 0, lastY: 0 };
  const keys = new Set<string>();

  const wallColliders: THREE.Object3D[] = [];
  model.traverse((o) => { if (o instanceof THREE.Mesh && /^Wall_/i.test(o.name) && !/Header|Sill/i.test(o.name)) wallColliders.push(o); });

  const blocked = (from: THREE.Vector3, dir: THREE.Vector3, dist: number) => {
    const rc = new THREE.Raycaster(from, dir, 0, dist);
    return rc.intersectObjects(wallColliders, false).length > 0;
  };

  const syncFpvCamera = () => {
    camera.position.set(fpv.pos.x, fpv.pos.y + fpv.eye, fpv.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(fpv.pitch, fpv.yaw, 0);
  };

  /** Where the first-person camera is looking along the floor (yaw 0 = toward -Z). */
  const stepFpv = (dt: number) => {
    if (!dt) return;
    const fwd = new THREE.Vector3(-Math.sin(fpv.yaw), 0, -Math.cos(fpv.yaw));
    const right = new THREE.Vector3(Math.cos(fpv.yaw), 0, -Math.sin(fpv.yaw));
    const move = new THREE.Vector3();
    if (keys.has('w') || keys.has('arrowup')) move.add(fwd);
    if (keys.has('s') || keys.has('arrowdown')) move.sub(fwd);
    if (keys.has('d') || keys.has('arrowright')) move.add(right);
    if (keys.has('a') || keys.has('arrowleft')) move.sub(right);
    if (keys.has('q')) fpv.yaw += dt * 1.6;
    if (keys.has('e')) fpv.yaw -= dt * 1.6;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar((keys.has('shift') ? 4.5 : 2.2) * dt);
      // slide along walls: test each axis separately so you can't walk through them
      const chest = new THREE.Vector3(fpv.pos.x, fpv.pos.y + 0.9, fpv.pos.z);
      const pad = 0.35;
      if (move.x !== 0 && !blocked(chest, new THREE.Vector3(Math.sign(move.x), 0, 0), Math.abs(move.x) + pad)) fpv.pos.x += move.x;
      chest.set(fpv.pos.x, fpv.pos.y + 0.9, fpv.pos.z);
      if (move.z !== 0 && !blocked(chest, new THREE.Vector3(0, 0, Math.sign(move.z)), Math.abs(move.z) + pad)) fpv.pos.z += move.z;
    }
    syncFpvCamera();
  };

  /** Free-fly for the orbit (3D) and plan (2D) cameras — pan any direction with the keyboard. */
  const stepFly = (dt: number) => {
    if (!dt || !keys.size) return;
    const speed = (keys.has('shift') ? 18 : 7) * dt;
    const delta = new THREE.Vector3();
    if (viewMode === '3d') {
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      if (keys.has('w') || keys.has('arrowup')) delta.add(fwd);
      if (keys.has('s') || keys.has('arrowdown')) delta.sub(fwd);
      if (keys.has('d') || keys.has('arrowright')) delta.add(right);
      if (keys.has('a') || keys.has('arrowleft')) delta.sub(right);
      if (keys.has('e')) delta.y += 1;
      if (keys.has('q')) delta.y -= 1;
    } else if (viewMode === '2d') {
      if (keys.has('w') || keys.has('arrowup')) delta.z -= 1;
      if (keys.has('s') || keys.has('arrowdown')) delta.z += 1;
      if (keys.has('d') || keys.has('arrowright')) delta.x += 1;
      if (keys.has('a') || keys.has('arrowleft')) delta.x -= 1;
      delta.multiplyScalar(1 / Math.max(planCamera.zoom, 0.2));
    }
    if (delta.lengthSq() === 0) return;
    delta.normalize().multiplyScalar(speed);
    const cam = activeCamera();
    cam.position.add(delta);
    controls.target.add(delta);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      keys.add(k);
      if (k.startsWith('arrow')) e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => { keys.delete(e.key.toLowerCase()); };
  const onBlur = () => keys.clear();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const setViewMode = (mode: ViewMode) => {
    if (mode === viewMode) return;
    const previous = viewMode;
    viewMode = mode;
    keys.clear();
    controls.enabled = mode !== 'inside';
    if (mode === 'inside') {
      // Stand at the main entrance, ceilings visible, ray-cast visibility on.
      roofHidden = false; applyRoof();
      fpv.pos.copy(entranceStart); fpv.yaw = 0; fpv.pitch = 0;
      camera.fov = 70; camera.near = 0.05; camera.updateProjectionMatrix();
      controls.object = camera;
      syncFpvCamera();
      setCulling(true);
      return;
    }
    if (previous === 'inside') {
      setCulling(false);
      roofHidden = Boolean(opts.hideRoof); applyRoof();
      camera.fov = 48; camera.near = Math.max(viewDistance / 1000, 0.01); camera.updateProjectionMatrix();
      camera.rotation.order = 'XYZ';
    }
    if (mode === '2d') {
      // Straight above the building, north-up map orientation
      planCamera.position.set(center.x, bounds.max.y + 60, center.z);
      planCamera.up.set(0, 0, -1);
      planCamera.lookAt(center.x, 0, center.z);
      controls.object = planCamera as unknown as THREE.PerspectiveCamera;
      controls.enableRotate = false;      // map pan/zoom only
      controls.screenSpacePanning = true;
      controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      controls.minZoom = 0.2;
      controls.maxZoom = 20;
      fitPlanCamera();
    } else {
      controls.object = camera;
      controls.enableRotate = true;
      controls.screenSpacePanning = true;
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      controls.minZoom = 0;
      controls.maxZoom = Infinity;
      camera.position.set(center.x + viewDistance * 0.8, center.y + viewDistance * 0.7, center.z + viewDistance);
      controls.target.copy(center);
    }
    controls.update();
  };

  /** Put the first-person camera at a world point (e.g. a room's node) looking along `yaw`. */
  const goInside = (point?: { x: number; y: number; z: number }, yaw?: number) => {
    if (viewMode !== 'inside') setViewMode('inside');
    const p = point ?? entranceStart;
    fpv.pos.set(p.x, p.y, p.z);
    fpv.yaw = yaw ?? 0; fpv.pitch = 0;
    syncFpvCamera();
    forceCull = true;
  };

  const resetView = () => {
    if (viewMode === 'inside') { goInside(); return; }
    const m = viewMode; viewMode = m === '2d' ? '3d' : '2d'; setViewMode(m);
  };

  const fitPlanCamera = () => {
    const aspect = Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1);
    const halfH = (Math.max(size.x, size.z) / 2) * 1.12;
    planCamera.left = -halfH * aspect;
    planCamera.right = halfH * aspect;
    planCamera.top = halfH;
    planCamera.bottom = -halfH;
    planCamera.updateProjectionMatrix();
  };

  const resize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fitPlanCamera();
    renderer.setSize(width, height, false);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  /* ───────────── ray-traced visibility ("only show what you can see") ─────────────
     From the camera we fire a sphere of rays into the building. Only meshes a ray reaches
     (looking through glass) stay visible, so you see the room you are in and whatever
     is genuinely in line of sight through doors — nothing else. */
  const candidates: THREE.Mesh[] = [];
  model.traverse((o) => { if (o instanceof THREE.Mesh) candidates.push(o); });
  const RAY_COUNT = 520;
  const rayDirs: THREE.Vector3[] = [];
  for (let i = 0; i < RAY_COUNT; i++) {           // fibonacci sphere = even coverage
    const y = 1 - (2 * (i + 0.5)) / RAY_COUNT;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    rayDirs.push(new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r));
  }
  const seeThrough = (m: THREE.Mesh) => {
    if (/glass|window/i.test(m.name)) return true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    return mats.some((mt) => mt.transparent && mt.opacity < 0.9);
  };
  let cullEnabled = false;
  let forceCull = false;
  const lastCullPos = new THREE.Vector3(1e9, 1e9, 1e9);
  let lastCullTime = 0;
  const visibleUntil = new Map<THREE.Object3D, number>();
  const cullRaycaster = new THREE.Raycaster();
  cullRaycaster.far = 45;

  const runCull = (now: number) => {
    const origin = camera.position;
    const prevSides = candidates.map((m) => (Array.isArray(m.material) ? m.material[0].side : m.material.side));
    // rays must also hit the inner/back faces of ceilings, floors and walls
    candidates.forEach((m) => (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => { mt.side = THREE.DoubleSide; }));
    for (const dir of rayDirs) {
      cullRaycaster.set(origin, dir);
      const hits = cullRaycaster.intersectObjects(candidates, false);
      for (const h of hits) {
        visibleUntil.set(h.object, now + 500);        // short grace period prevents flicker
        if (!seeThrough(h.object as THREE.Mesh)) break;
      }
    }
    candidates.forEach((m, i) => (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => { mt.side = prevSides[i]; }));
    for (const m of candidates) m.visible = (visibleUntil.get(m) ?? 0) > now;
  };

  function setCulling(on: boolean) {
    cullEnabled = on;
    forceCull = on;
    visibleUntil.clear();
    lastCullPos.set(1e9, 1e9, 1e9);
    if (!on) applyRoof();
    if (!on) for (const m of candidates) if (!(roofHidden && /^Ceiling/i.test(m.name))) m.visible = true;
  }

  const updateCull = (now: number) => {
    if (!cullEnabled) return;
    if (forceCull || (now - lastCullTime > 120 && camera.position.distanceToSquared(lastCullPos) > 0.09)) {
      lastCullPos.copy(camera.position);
      lastCullTime = now;
      forceCull = false;
      runCull(now);
    } else {
      // expire stale entries without re-casting
      for (const m of candidates) if (m.visible && (visibleUntil.get(m) ?? 0) <= now) m.visible = false;
    }
  };

  /** Is `point` in direct line of sight of the camera? (used to hide pins behind walls) */
  const hasLineOfSight = (point: { x: number; y: number; z: number }) => {
    const from = camera.position;
    const to = new THREE.Vector3(point.x, point.y + 0.4, point.z);
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.5) return true;
    const rc = new THREE.Raycaster(from, dir.normalize(), 0, dist - 0.25);
    return !rc.intersectObjects(wallColliders, false).length;
  };

  /* ───────────── pointer: click vs drag, first-person look ───────────── */
  const clickCallbacks = new Set<ClickCallback>();
  const down = { x: 0, y: 0, t: 0, active: false };
  const el = renderer.domElement;
  el.style.touchAction = 'none';
  const onPointerDown = (e: PointerEvent) => {
    down.x = e.clientX; down.y = e.clientY; down.t = performance.now(); down.active = e.button === 0;
    if (viewMode === 'inside') { fpv.dragging = true; fpv.lastX = e.clientX; fpv.lastY = e.clientY; }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (viewMode !== 'inside' || !fpv.dragging) return;
    fpv.yaw -= (e.clientX - fpv.lastX) * 0.004;
    fpv.pitch = Math.max(-1.2, Math.min(1.2, fpv.pitch - (e.clientY - fpv.lastY) * 0.003));
    fpv.lastX = e.clientX; fpv.lastY = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    fpv.dragging = false;
    if (!down.active || e.target !== el) return;
    down.active = false;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 6 && performance.now() - down.t < 600) for (const cb of clickCallbacks) cb(e.clientX, e.clientY, e);
  };
  el.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  const onWheel = (e: WheelEvent) => {
    if (viewMode !== 'inside') return;
    e.preventDefault();
    camera.fov = Math.max(35, Math.min(95, camera.fov + e.deltaY * 0.02));
    camera.updateProjectionMatrix();
  };
  el.addEventListener('wheel', onWheel, { passive: false });

  const frameCallbacks = new Set<FrameCallback>();
  let animationFrame = 0;
  let previousTime = 0;
  const animate = (time: number) => {
    const deltaTime = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
    previousTime = time;
    if (viewMode === 'inside') stepFpv(deltaTime);
    else { stepFly(deltaTime); controls.update(); }
    updateCull(performance.now());
    for (const callback of frameCallbacks) callback(time / 1000, deltaTime);
    renderer.render(scene, activeCamera());
    animationFrame = window.requestAnimationFrame(animate);
  };
  animationFrame = window.requestAnimationFrame(animate);

  const textureLoader = new THREE.TextureLoader();
  const applyOverrides = (overrides: MapOverride[]) => {
    const byName = new Map(overrides.map((override) => [override.meshKey, override]));
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const override = byName.get(object.name);
      if (!override) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if ('color' in material && override.color) {
          (material as THREE.MeshStandardMaterial).color.set(override.color);
        }
        if (override.textureUrl && 'map' in material) {
          textureLoader.load(override.textureUrl, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(override.tiling || 1, override.tiling || 1);
            const mapMaterial = material as THREE.MeshStandardMaterial;
            mapMaterial.map = texture;
            mapMaterial.needsUpdate = true;
          });
        }
      }
    });
  };

  const setCamera = (mode: 'front' | 'default', target?: THREE.Vector3) => {
    const focus = target ?? center;
    controls.target.copy(focus);
    const distance = viewDistance * (mode === 'front' ? 0.75 : 1.35);
    camera.position.set(focus.x, focus.y + distance * 0.6, focus.z + distance);
    camera.lookAt(focus);
    controls.update();
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const setPointer = (clientX: number, clientY: number) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, activeCamera());
  };

  /** true if the mesh (or any ancestor) is visible — hidden ceilings must not block 2D picks. */
  const isVisible = (object: THREE.Object3D) => {
    let o: THREE.Object3D | null = object;
    while (o) { if (o.visible === false) return false; o = o.parent; }
    return true;
  };

  /** Legacy: intersect an infinite horizontal plane at floor level. */
  const pickFloor = (clientX: number, clientY: number) => {
    setPointer(clientX, clientY);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  };

  /**
   * Raycast the actual building model so clicked nodes land on real geometry.
   * In 2D plan mode, prefer Floor_* meshes so nodes land on the walkable floor,
   * not on desks/counters seen from above.
   */
  const pickSurface = (clientX: number, clientY: number, pickOpts?: PickOptions) => {
    setPointer(clientX, clientY);
    const hits = raycaster.intersectObjects(model.children, true)
      .filter((h) => h.face && isVisible(h.object));
    if (pickOpts?.floorsOnly) {
      // walkable floor only: Floor_* meshes, or any visible upward-facing surface (never a wall/desk side)
      const floorHit = hits.find((h) => /^Floor/i.test(h.object.name))
        ?? hits.find((h) => h.face!.normal.clone().transformDirection(h.object.matrixWorld).y > 0.85 && !/Ceiling/i.test(h.object.name));
      if (floorHit) return floorHit.point.clone();
      return null;
    }
    return hits[0]?.point.clone() ?? null;
  };

  return {
    THREE,
    scene,
    camera,
    controls,
    renderer,
    applyOverrides,
    setCamera,
    setViewMode,
    getViewMode: () => viewMode,
    getActiveCamera: () => activeCamera(),
    entrance: entrance.clone(),
    entranceStart: entranceStart.clone(),
    goInside,
    resetView,
    setCulling,
    hasLineOfSight,
    getFpv: () => ({ x: fpv.pos.x, y: fpv.pos.y, z: fpv.pos.z, yaw: fpv.yaw }),
    onClick(callback: ClickCallback) {
      clickCallbacks.add(callback);
      return () => clickCallbacks.delete(callback);
    },
    /** Smoothly-less jump of the orbit camera to look at a world point from any direction. */
    flyTo(point: { x: number; y: number; z: number }, distance = 8) {
      if (viewMode === 'inside') { goInside(point); return; }
      const target = new THREE.Vector3(point.x, point.y, point.z);
      if (viewMode === '2d') {
        planCamera.position.set(target.x, planCamera.position.y, target.z);
        controls.target.set(target.x, 0, target.z);
      } else {
        const dir = camera.position.clone().sub(controls.target).normalize();
        camera.position.copy(target).addScaledVector(dir, distance);
        controls.target.copy(target);
      }
      controls.update();
    },
    pickFloor,
    pickSurface,
    onFrame(callback: FrameCallback) {
      frameCallbacks.add(callback);
      return () => frameCallbacks.delete(callback);
    },
    dispose() {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('wheel', onWheel);
      controls.dispose();
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}