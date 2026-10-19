/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export const MODEL_URL = '/floor/ODeL_Building.glb';

type MapOverride = {
  meshKey: string;
  color?: string;
  textureUrl?: string;
  tiling?: number;
};

type FrameCallback = (time: number, deltaTime: number) => void;

export type ViewMode = '2d' | '3d' | 'inside';
/** 'admin' = free camera tools + gizmos. 'visitor' = locked inside the building, walk only. */
export type SceneRole = 'admin' | 'visitor';
export type CameraPreset = 'iso' | 'top' | 'front' | 'back' | 'left' | 'right';
export type MoveDir = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down';
export type GizmoMode = 'translate' | 'rotate';
export type Cue = 'straight' | 'left' | 'right' | 'uturn' | 'arrive';

export interface MoveSettings {
  eyeHeight: number;
  walkSpeed: number;
  runSpeed: number;
  turnSpeed: number;
  fov: number;
  headBob: boolean;
  collisions: boolean;
  guideSpeed: number;
}

export const DEFAULT_MOVE_SETTINGS: MoveSettings = {
  eyeHeight: 1.6,
  walkSpeed: 2.2,
  runSpeed: 4.5,
  turnSpeed: 1.8,
  fov: 70,
  headBob: true,
  collisions: true,
  guideSpeed: 1.7,
};

export interface GuideState {
  active: boolean;
  paused: boolean;
  /** 0..1 along the route */
  progress: number;
  /** metres still to walk */
  remaining: number;
  cue: Cue;
  /** metres until the upcoming turn (null when there is none in sight) */
  turnIn: number | null;
}

export interface PoseUpdate {
  x: number;
  y: number;
  z: number;
  /** 0 = looking toward -Z, positive = turning left */
  yaw: number;
  pitch: number;
  moving: boolean;
  guide: GuideState | null;
}

type SceneOptions = {
  /** Hide all Ceiling_* meshes so the floor plan is visible from above (admin roof removal). */
  hideRoof?: boolean;
  /** Defaults to 'admin'. 'visitor' never exposes orbit / free-fly camera: you can only walk inside. */
  role?: SceneRole;
  settings?: Partial<MoveSettings>;
};

type PickOptions = { floorsOnly?: boolean };
type ClickCallback = (clientX: number, clientY: number, event: PointerEvent) => void;

const wrapPi = (a: number) => {
  let r = (a + Math.PI) % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r - Math.PI;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const materialsOf = (m: THREE.Mesh): THREE.Material[] => (Array.isArray(m.material) ? m.material : [m.material]);

export async function createFloorScene(container: HTMLElement, modelUrl: string, opts: SceneOptions = {}) {
  const role: SceneRole = opts.role ?? 'admin';
  const visitor = role === 'visitor';
  const settings: MoveSettings = { ...DEFAULT_MOVE_SETTINGS, ...(opts.settings ?? {}) };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(visitor ? '#141b2b' : '#0b1220');

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
  controls.maxPolarAngle = Math.PI;
  controls.minDistance = 0.5;
  controls.maxDistance = 600;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 1.2;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  // Visitors never get the free orbit camera: the building must not move or float around.
  if (visitor) controls.enabled = false;

  scene.add(new THREE.HemisphereLight(0xe5f3ff, 0x263244, 2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(12, 20, 10);
  scene.add(keyLight);

  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const model = gltf.scene;
  scene.add(model);
  model.updateMatrixWorld(true);

  const candidates: THREE.Mesh[] = [];
  model.traverse((o) => { if (o instanceof THREE.Mesh) candidates.push(o); });

  /* ───────────── visibility: roof removal (admin) + hidden "outside" meshes ───────────── */
  let roofHidden = Boolean(opts.hideRoof);
  let hiddenSet = new Set<string>();
  let hideOn = false;
  const applyVisibility = () => {
    for (const m of candidates) {
      const roof = roofHidden && /^Ceiling/i.test(m.name);
      const outside = hideOn && hiddenSet.has(m.name);
      m.visible = !(roof || outside);
    }
  };
  applyVisibility();

  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const viewDistance = Math.max(size.x, size.y, size.z, 1) * 1.35;
  const floorY = bounds.min.y + 0.02;
  const defaultOrbitPosition = () => new THREE.Vector3(center.x + viewDistance * 0.8, center.y + viewDistance * 0.7, center.z + viewDistance);
  camera.position.copy(defaultOrbitPosition());
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

  const fpv = {
    pos: entranceStart.clone(),
    yaw: 0, pitch: 0,        // what the camera shows (smoothed)
    yawT: 0, pitchT: 0,      // where the player wants to look
    lookOff: 0,              // look-around offset while the guide walks
    lookIdle: 0,
    dragging: false, lastX: 0, lastY: 0,
    vel: new THREE.Vector3(),
    bobT: 0, bobAmp: 0,
    intro: 1,                // 0 → 1 "stand up and look forward" animation
    introYaw: 0,
  };
  const keys = new Set<string>();
  /** analog input from on-screen controls (joystick / buttons), each -1..1 */
  const input = { fwd: 0, strafe: 0, turn: 0, run: false };

  const wallColliders: THREE.Object3D[] = [];
  const walkables: THREE.Object3D[] = [];
  for (const m of candidates) {
    if (/^Wall_/i.test(m.name) && !/Header|Sill/i.test(m.name)) wallColliders.push(m);
    if (/^(Floor|Corridor_Steps|Steps|Accessible_Ramp)/i.test(m.name) && !/handrail|post|sign/i.test(m.name)) walkables.push(m);
  }

  const wallRay = new THREE.Raycaster();
  const groundRay = new THREE.Raycaster();
  const tmpV = new THREE.Vector3();
  const downDir = new THREE.Vector3(0, -1, 0);

  const blocked = (origin: THREE.Vector3, dir: THREE.Vector3, dist: number) => {
    // three rays (centre + both shoulders) so you cannot squeeze through a wall corner
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    for (const off of [0, -0.22, 0.22]) {
      tmpV.copy(origin).addScaledVector(perp, off);
      wallRay.set(tmpV, dir);
      wallRay.near = 0; wallRay.far = dist;
      if (wallRay.intersectObjects(wallColliders, false).length > 0) return true;
    }
    return false;
  };

  /** Height of the walkable surface under (x,z); null when nothing is there (keeps current height). */
  const groundAt = (x: number, z: number, fromY: number) => {
    if (!walkables.length) return null;
    groundRay.set(new THREE.Vector3(x, fromY + 0.7, z), downDir);
    groundRay.near = 0; groundRay.far = 2.2;
    const hit = groundRay.intersectObjects(walkables, false)[0];
    return hit ? hit.point.y : null;
  };

  /* ───────────── guided auto-walk (follows the green route line) ───────────── */
  const guide = {
    curve: null as THREE.Curve<THREE.Vector3> | null,
    length: 1,
    t: 0,
    active: false,
    paused: false,
    mult: 1,
    lastCue: 'straight' as Cue,
  };
  const arriveCallbacks = new Set<() => void>();
  const updateCallbacks = new Set<(p: PoseUpdate) => void>();

  const computeGuideState = (): GuideState | null => {
    if (!guide.curve) return null;
    const len = guide.length;
    const remaining = Math.max(0, (1 - guide.t) * len);
    let cue: Cue = 'straight';
    let turnIn: number | null = null;
    if (remaining < 1.8) cue = 'arrive';
    else {
      const heading = (tt: number) => {
        const tan = guide.curve!.getTangentAt(clamp(tt, 0, 1));
        return Math.atan2(-tan.x, -tan.z);
      };
      const h0 = heading(guide.t);
      for (let d = 1; d <= 9; d += 0.75) {
        const tt = guide.t + d / len;
        if (tt > 1) break;
        const diff = wrapPi(heading(tt) - h0);
        if (Math.abs(diff) > 0.6) {
          cue = Math.abs(diff) > 2.4 ? 'uturn' : diff > 0 ? 'left' : 'right';
          turnIn = d;
          break;
        }
      }
    }
    return { active: guide.active, paused: guide.paused, progress: guide.t, remaining, cue, turnIn };
  };

  const stepGuide = (dt: number) => {
    if (!guide.curve) return;
    guide.t = Math.min(1, guide.t + (dt * settings.guideSpeed * guide.mult) / Math.max(guide.length, 0.01));
    const p = guide.curve.getPointAt(guide.t);
    const k = 1 - Math.exp(-7 * dt);
    fpv.pos.x += (p.x - fpv.pos.x) * k;
    fpv.pos.z += (p.z - fpv.pos.z) * k;
    const gy = groundAt(fpv.pos.x, fpv.pos.z, fpv.pos.y);
    const targetY = gy ?? p.y - 0.12;
    fpv.pos.y += (targetY - fpv.pos.y) * (1 - Math.exp(-12 * dt));
    // look a little ahead along the line so corners are turned into smoothly
    const ahead = guide.curve.getPointAt(Math.min(1, guide.t + 1.6 / Math.max(guide.length, 0.01)));
    const dx = ahead.x - p.x; const dz = ahead.z - p.z;
    if (dx * dx + dz * dz > 0.0025) {
      const want = Math.atan2(-dx, -dz);
      fpv.yawT = fpv.yaw + wrapPi(want + fpv.lookOff - fpv.yaw);
    }
    fpv.pitchT = clamp(fpv.pitchT * Math.exp(-1.5 * dt), -0.6, 0.6);
    fpv.vel.set(-Math.sin(fpv.yaw) * settings.guideSpeed * guide.mult, 0, -Math.cos(fpv.yaw) * settings.guideSpeed * guide.mult);
    if (guide.t >= 1) {
      guide.active = false;
      fpv.vel.set(0, 0, 0);
      for (const cb of arriveCallbacks) cb();
    }
  };

  const syncFpvCamera = (bobY = 0, bobRoll = 0) => {
    camera.position.set(fpv.pos.x, fpv.pos.y + eyeNow() + bobY, fpv.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(fpv.pitch, fpv.yaw, bobRoll);
  };
  const eyeNow = () => {
    const k = 1 - Math.pow(1 - clamp(fpv.intro, 0, 1), 3);
    return settings.eyeHeight * (0.72 + 0.28 * k);
  };

  const stepFpv = (dt: number) => {
    if (!dt) return;
    const S = settings;

    // ── gather input (keyboard + on-screen controls) ──
    let fwdIn = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) + input.fwd;
    let strIn = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0) + input.strafe;
    let turnIn = (keys.has('q') || keys.has('arrowleft') ? 1 : 0) - (keys.has('e') || keys.has('arrowright') ? 1 : 0) + input.turn;
    fwdIn = clamp(fwdIn, -1, 1); strIn = clamp(strIn, -1, 1); turnIn = clamp(turnIn, -1, 1);
    const running = keys.has('shift') || input.run;
    const manual = Math.abs(fwdIn) > 0.05 || Math.abs(strIn) > 0.05;

    // taking the controls pauses the guided walk (visitor can resume it)
    if (guide.active && !guide.paused && manual) guide.paused = true;
    const steering = guide.active && !guide.paused;

    if (fpv.intro < 1) fpv.intro = Math.min(1, fpv.intro + dt / 1.4);

    // ── turning (smooth) ──
    if (Math.abs(turnIn) > 0.02) {
      fpv.lookIdle = 0;
      if (steering) fpv.lookOff = clamp(fpv.lookOff + turnIn * S.turnSpeed * dt, -1.6, 1.6);
      else fpv.yawT += turnIn * S.turnSpeed * dt;
    } else if (steering && !fpv.dragging) {
      fpv.lookIdle += dt;
      if (fpv.lookIdle > 1.2) fpv.lookOff *= Math.exp(-1.1 * dt);
    }

    if (steering) {
      stepGuide(dt);
    } else {
      // ── free walking with acceleration / deceleration ──
      const fwd = new THREE.Vector3(-Math.sin(fpv.yaw), 0, -Math.cos(fpv.yaw));
      const right = new THREE.Vector3(Math.cos(fpv.yaw), 0, -Math.sin(fpv.yaw));
      const want = new THREE.Vector3().addScaledVector(fwd, fwdIn).addScaledVector(right, strIn);
      if (want.lengthSq() > 1) want.normalize();
      want.multiplyScalar(running ? S.runSpeed : S.walkSpeed);
      const k = 1 - Math.exp(-(want.lengthSq() > 0 ? 9 : 13) * dt);
      fpv.vel.x += (want.x - fpv.vel.x) * k;
      fpv.vel.z += (want.z - fpv.vel.z) * k;
      const mx = fpv.vel.x * dt; const mz = fpv.vel.z * dt;
      if (Math.abs(mx) > 1e-5 || Math.abs(mz) > 1e-5) {
        const chest = new THREE.Vector3(fpv.pos.x, fpv.pos.y + 0.9, fpv.pos.z);
        const pad = 0.35;
        if (!S.collisions || Math.abs(mx) < 1e-5 || !blocked(chest, new THREE.Vector3(Math.sign(mx), 0, 0), Math.abs(mx) + pad)) fpv.pos.x += mx;
        else fpv.vel.x = 0;
        chest.set(fpv.pos.x, fpv.pos.y + 0.9, fpv.pos.z);
        if (!S.collisions || Math.abs(mz) < 1e-5 || !blocked(chest, new THREE.Vector3(0, 0, Math.sign(mz)), Math.abs(mz) + pad)) fpv.pos.z += mz;
        else fpv.vel.z = 0;
      }
      const gy = groundAt(fpv.pos.x, fpv.pos.z, fpv.pos.y);
      if (gy !== null) fpv.pos.y += (gy - fpv.pos.y) * (1 - Math.exp(-14 * dt));
    }

    // ── smooth look ──
    fpv.pitchT = clamp(fpv.pitchT, -1.2, 1.2);
    const lookK = 1 - Math.exp(-(steering ? 4.5 : 16) * dt);
    fpv.yaw += wrapPi(fpv.yawT - fpv.yaw) * lookK;
    fpv.pitch += (fpv.pitchT - fpv.pitch) * (1 - Math.exp(-14 * dt));

    // ── head bob while moving ──
    const speed = Math.hypot(fpv.vel.x, fpv.vel.z);
    const moving = speed > 0.25;
    const ampTarget = S.headBob && moving ? clamp(speed / S.runSpeed, 0.25, 1) : 0;
    fpv.bobAmp += (ampTarget - fpv.bobAmp) * (1 - Math.exp(-8 * dt));
    fpv.bobT += dt * speed * 2.6;
    syncFpvCamera(Math.sin(fpv.bobT * 2) * 0.032 * fpv.bobAmp, Math.cos(fpv.bobT) * 0.006 * fpv.bobAmp);
  };

  /** Free-fly for the orbit (3D) and plan (2D) cameras — pan any direction with the keyboard (admin only). */
  let flyScale = 1;
  const stepFly = (dt: number) => {
    if (visitor || !dt || !keys.size) return;
    const speed = (keys.has('shift') ? 18 : 7) * dt * flyScale;
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

  const MOVE_KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (MOVE_KEYS.includes(k)) {
      keys.add(k);
      if (k.startsWith('arrow')) e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => { keys.delete(e.key.toLowerCase()); };
  const onBlur = () => keys.clear();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  /* ───────────── transform gizmo (admin: move / rotate the selected node) ───────────── */
  let transform: any = null;
  let gizmoHelper: THREE.Object3D | null = null;
  let gizmoDragging = false;
  let gizmoEnd = 0;
  const gizmoChange = new Set<(o: THREE.Object3D) => void>();
  const gizmoCommit = new Set<(o: THREE.Object3D) => void>();
  if (!visitor) {
    transform = new TransformControls(camera, renderer.domElement);
    gizmoHelper = transform.getHelper();
    gizmoHelper!.visible = false;
    scene.add(gizmoHelper!);
    transform.setSize(0.9);
    transform.addEventListener('dragging-changed', (e: any) => {
      gizmoDragging = Boolean(e.value);
      if (!gizmoDragging) gizmoEnd = performance.now();
      controls.enabled = !gizmoDragging && viewMode !== 'inside';
      if (!gizmoDragging && transform.object) for (const cb of gizmoCommit) cb(transform.object);
    });
    transform.addEventListener('objectChange', () => { if (transform.object) for (const cb of gizmoChange) cb(transform.object); });
  }

  const setViewMode = (mode: ViewMode) => {
    if (visitor && mode !== 'inside') return;
    if (mode === viewMode) return;
    const previous = viewMode;
    viewMode = mode;
    keys.clear();
    controls.enabled = !visitor && mode !== 'inside';
    if (mode === 'inside') {
      // Stand at the main entrance, ceilings visible, outside meshes hidden.
      roofHidden = false; hideOn = true; applyVisibility();
      fpv.pos.copy(entranceStart); fpv.yaw = 0; fpv.yawT = 0; fpv.pitch = 0; fpv.pitchT = 0; fpv.lookOff = 0;
      fpv.vel.set(0, 0, 0);
      camera.fov = settings.fov; camera.near = 0.05; camera.updateProjectionMatrix();
      controls.object = camera;
      syncFpvCamera();
      return;
    }
    if (previous === 'inside') {
      hideOn = false;
      roofHidden = Boolean(opts.hideRoof); applyVisibility();
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
      camera.position.copy(defaultOrbitPosition());
      controls.target.copy(center);
    }
    controls.update();
  };

  /** Put the first-person camera at a world point (e.g. a room's node) looking along `yaw`. */
  const goInside = (point?: { x: number; y: number; z: number }, yaw?: number, pitch = 0) => {
    if (viewMode !== 'inside') setViewMode('inside');
    const p = point ?? entranceStart;
    fpv.pos.set(p.x, p.y, p.z);
    fpv.yaw = yaw ?? 0; fpv.yawT = fpv.yaw;
    fpv.pitch = pitch; fpv.pitchT = pitch;
    fpv.lookOff = 0;
    fpv.vel.set(0, 0, 0);
    syncFpvCamera();
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

  /* ───────────── pre-computed interior visibility ("outside is not shown") ─────────────
     Instead of casting rays every frame (which made walls and rooms pop in and, when you stood
     still, hid EVERYTHING → black screen), the building is analysed once: rays are fired from a
     grid of standing points on every floor, and any mesh that no ray from inside ever reaches is
     "outside only". That list is saved in the database (admin "Bake") and simply hidden for
     visitors — there is no per-frame work and nothing appears or disappears while walking. */
  const computeHiddenMeshes = async (onProgress?: (p: number) => void): Promise<string[]> => {
    model.updateMatrixWorld(true);
    const floors = candidates.filter((m) => /^Floor/i.test(m.name) && !/handrail|sign/i.test(m.name));
    if (!floors.length) return [];
    const savedSides = new Map<THREE.Material, THREE.Side>();
    for (const m of candidates) for (const mt of materialsOf(m)) { if (!savedSides.has(mt)) savedSides.set(mt, mt.side); mt.side = THREE.DoubleSide; }
    const marked = new Set<THREE.Object3D>();
    try {
      let spacing = 1.5;
      let pts: THREE.Vector3[] = [];
      const down = new THREE.Raycaster();
      for (let attempt = 0; attempt < 4; attempt++) {
        pts = [];
        for (let x = bounds.min.x + spacing / 2; x <= bounds.max.x; x += spacing) {
          for (let z = bounds.min.z + spacing / 2; z <= bounds.max.z; z += spacing) {
            down.set(new THREE.Vector3(x, bounds.max.y + 2, z), downDir);
            const hit = down.intersectObjects(floors, false)[0];
            if (hit) pts.push(new THREE.Vector3(x, hit.point.y + 1.5, z));
          }
        }
        if (pts.length <= 700) break;
        spacing *= 1.4;
      }
      const RAYS = 220;
      const dirs: THREE.Vector3[] = [];
      for (let i = 0; i < RAYS; i++) {      // fibonacci sphere = even coverage
        const y = 1 - (2 * (i + 0.5)) / RAYS;
        const r = Math.sqrt(1 - y * y);
        const phi = i * Math.PI * (3 - Math.sqrt(5));
        dirs.push(new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r));
      }
      const ray = new THREE.Raycaster();
      ray.far = 90;
      let sliceStart = performance.now();
      for (let pi = 0; pi < pts.length; pi++) {
        for (const d of dirs) {
          ray.set(pts[pi], d);
          const hit = ray.intersectObjects(candidates, false)[0];
          if (hit) marked.add(hit.object);
        }
        if (performance.now() - sliceStart > 14) {
          onProgress?.(pi / pts.length);
          await new Promise((r) => setTimeout(r, 0));
          sliceStart = performance.now();
        }
      }
      onProgress?.(1);
    } finally {
      for (const [mt, side] of savedSides) mt.side = side;
    }
    // Something went wrong (no floors hit, etc.) → hide nothing rather than risk a black screen.
    if (marked.size < candidates.length * 0.2) return [];
    return candidates.filter((m) => !marked.has(m)).map((m) => m.name);
  };

  const setHiddenMeshes = (names: string[]) => {
    hiddenSet = new Set(names);
    applyVisibility();
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
    if (viewMode === 'inside') { fpv.dragging = true; fpv.lastX = e.clientX; fpv.lastY = e.clientY; fpv.lookIdle = 0; }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (viewMode !== 'inside' || !fpv.dragging || gizmoDragging) return;
    const dx = e.clientX - fpv.lastX; const dy = e.clientY - fpv.lastY;
    const steering = guide.active && !guide.paused;
    if (steering) fpv.lookOff = clamp(fpv.lookOff - dx * 0.004, -1.6, 1.6);
    else fpv.yawT -= dx * 0.004;
    fpv.pitchT = clamp(fpv.pitchT - dy * 0.003, steering ? -0.6 : -1.2, steering ? 0.6 : 1.2);
    fpv.lastX = e.clientX; fpv.lastY = e.clientY; fpv.lookIdle = 0;
  };
  const onPointerUp = (e: PointerEvent) => {
    fpv.dragging = false;
    if (!down.active || e.target !== el) return;
    down.active = false;
    if (gizmoDragging || performance.now() - gizmoEnd < 250) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 6 && performance.now() - down.t < 600) for (const cb of clickCallbacks) cb(e.clientX, e.clientY, e);
  };
  el.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  const onWheel = (e: WheelEvent) => {
    if (viewMode !== 'inside') return;
    e.preventDefault();
    camera.fov = clamp(camera.fov + e.deltaY * 0.02, 40, 95);
    camera.updateProjectionMatrix();
  };
  el.addEventListener('wheel', onWheel, { passive: false });

  /* ───────────── frame loop ───────────── */
  const frameCallbacks = new Set<FrameCallback>();
  let animationFrame = 0;
  let previousTime = 0;
  let emitAcc = 0;
  const animate = (time: number) => {
    const deltaTime = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
    previousTime = time;
    if (viewMode === 'inside') {
      stepFpv(deltaTime);
      emitAcc += deltaTime;
      if (emitAcc > 0.066 && updateCallbacks.size) {
        emitAcc = 0;
        const pose: PoseUpdate = {
          x: fpv.pos.x, y: fpv.pos.y, z: fpv.pos.z, yaw: fpv.yaw, pitch: fpv.pitch,
          moving: Math.hypot(fpv.vel.x, fpv.vel.z) > 0.25,
          guide: guide.curve ? computeGuideState() : null,
        };
        for (const cb of updateCallbacks) cb(pose);
      }
    } else {
      stepFly(deltaTime);
      if (!visitor) controls.update();
    }
    if (transform && transform.camera !== activeCamera()) transform.camera = activeCamera();
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
      for (const material of materialsOf(object)) {
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
    if (visitor) return;
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
      const floorHit = hits.find((h) => /^Floor/i.test(h.object.name))
        ?? hits.find((h) => h.face!.normal.clone().transformDirection(h.object.matrixWorld).y > 0.85 && !/Ceiling/i.test(h.object.name));
      if (floorHit) return floorHit.point.clone();
      return null;
    }
    return hits[0]?.point.clone() ?? null;
  };

  /* ───────────── admin camera tools: move / rotate / zoom / presets ───────────── */
  const moveCamera = (dir: MoveDir, amount = 1) => {
    if (viewMode === 'inside') {
      const f = new THREE.Vector3(-Math.sin(fpv.yaw), 0, -Math.cos(fpv.yaw));
      const r = new THREE.Vector3(Math.cos(fpv.yaw), 0, -Math.sin(fpv.yaw));
      const d = new THREE.Vector3();
      if (dir === 'forward') d.copy(f); else if (dir === 'back') d.copy(f).negate();
      else if (dir === 'right') d.copy(r); else if (dir === 'left') d.copy(r).negate();
      else if (dir === 'up') d.y = 0.4; else d.y = -0.4;
      fpv.pos.addScaledVector(d, amount * 0.8 * flyScale);
      return;
    }
    const step = Math.max(viewDistance * 0.04, 0.5) * amount * flyScale;
    const d = new THREE.Vector3();
    if (viewMode === '2d') {
      const s = (Math.max(size.x, size.z) * 0.05 * amount * flyScale) / Math.max(planCamera.zoom, 0.2);
      if (dir === 'forward' || dir === 'up') d.z -= s; else if (dir === 'back' || dir === 'down') d.z += s;
      else if (dir === 'left') d.x -= s; else d.x += s;
    } else {
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      if (dir === 'forward') d.copy(fwd); else if (dir === 'back') d.copy(fwd).negate();
      else if (dir === 'right') d.copy(right); else if (dir === 'left') d.copy(right).negate();
      else if (dir === 'up') d.y = 1; else d.y = -1;
      d.multiplyScalar(step);
    }
    activeCamera().position.add(d);
    controls.target.add(d);
    controls.update();
  };

  const rotateCamera = (dyaw: number, dpitch = 0) => {
    if (viewMode === 'inside') {
      fpv.yawT += dyaw; fpv.pitchT = clamp(fpv.pitchT + dpitch, -1.2, 1.2);
      return;
    }
    if (viewMode === '2d') {
      planCamera.up.applyAxisAngle(new THREE.Vector3(0, 1, 0), dyaw);
      planCamera.lookAt(planCamera.position.x, 0, planCamera.position.z);
      controls.update();
      return;
    }
    const offset = camera.position.clone().sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta += dyaw;
    sph.phi = clamp(sph.phi + dpitch, 0.05, Math.PI - 0.05);
    offset.setFromSpherical(sph);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    controls.update();
  };

  const dollyCamera = (factor: number) => {
    if (viewMode === 'inside') {
      camera.fov = clamp(camera.fov * factor, 40, 95);
      camera.updateProjectionMatrix();
    } else if (viewMode === '2d') {
      planCamera.zoom = clamp(planCamera.zoom / factor, 0.2, 20);
      planCamera.updateProjectionMatrix();
    } else {
      const offset = camera.position.clone().sub(controls.target);
      const len = clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
      offset.setLength(len);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    }
  };

  const setPreset = (preset: CameraPreset) => {
    if (viewMode !== '3d') setViewMode('3d');
    const d = viewDistance;
    const c = center;
    const pos =
      preset === 'top' ? new THREE.Vector3(c.x, c.y + d * 1.4, c.z + 0.001) :
      preset === 'front' ? new THREE.Vector3(c.x, c.y + d * 0.12, c.z + d * 1.2) :
      preset === 'back' ? new THREE.Vector3(c.x, c.y + d * 0.12, c.z - d * 1.2) :
      preset === 'left' ? new THREE.Vector3(c.x - d * 1.2, c.y + d * 0.12, c.z) :
      preset === 'right' ? new THREE.Vector3(c.x + d * 1.2, c.y + d * 0.12, c.z) :
      defaultOrbitPosition();
    controls.target.copy(c);
    camera.position.copy(pos);
    camera.lookAt(c);
    controls.update();
  };

  /* ───────────── API ───────────── */
  return {
    THREE,
    scene,
    camera,
    controls,
    renderer,
    role,
    applyOverrides,
    setCamera,
    setViewMode,
    getViewMode: () => viewMode,
    getActiveCamera: () => activeCamera(),
    entrance: entrance.clone(),
    entranceStart: entranceStart.clone(),
    goInside,
    resetView,
    hasLineOfSight,
    getFpv: () => ({ x: fpv.pos.x, y: fpv.pos.y, z: fpv.pos.z, yaw: fpv.yaw, pitch: fpv.pitch }),
    meshNames: () => candidates.map((m) => m.name),

    /** Apply (true) or lift (false) the "outside meshes hidden" list. */
    setCulling(on: boolean) { hideOn = on; applyVisibility(); },
    setHiddenMeshes,
    computeHiddenMeshes,

    /** movement settings (from the database) */
    setSettings(next: Partial<MoveSettings>) {
      Object.assign(settings, next);
      if (viewMode === 'inside') { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
    },
    getSettings: () => ({ ...settings }),

    /** on-screen controls (joystick / pad / buttons) feed these every frame, values -1..1 */
    setMoveInput(next: Partial<typeof input>) { Object.assign(input, next); },
    /** instant look rotation in radians (used by touch buttons) */
    lookBy(dyaw: number, dpitch = 0) {
      if (guide.active && !guide.paused) fpv.lookOff = clamp(fpv.lookOff + dyaw, -1.6, 1.6);
      else fpv.yawT += dyaw;
      fpv.pitchT = clamp(fpv.pitchT + dpitch, -1.2, 1.2);
      fpv.lookIdle = 0;
    },
    /** brief "stand up and look forward" animation played when the visitor arrives */
    playIntro() { fpv.intro = 0; },

    /** guided auto-walk along a route curve */
    startGuide(curve: THREE.Curve<THREE.Vector3>, length: number, speedMult = 1) {
      if (viewMode !== 'inside') setViewMode('inside');
      guide.curve = curve; guide.length = Math.max(length, 0.01); guide.t = 0;
      guide.active = true; guide.paused = false; guide.mult = speedMult;
      fpv.lookOff = 0;
      const p = curve.getPointAt(0);
      if (Math.hypot(p.x - fpv.pos.x, p.z - fpv.pos.z) > 4) { fpv.pos.set(p.x, p.y - 0.12, p.z); }
    },
    pauseGuide() { if (guide.active) guide.paused = true; },
    resumeGuide() {
      if (!guide.curve || guide.t >= 1) return;
      // re-join the line at the closest point to where the visitor is standing
      let best = guide.t; let bd = Infinity;
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        const p = guide.curve.getPointAt(t);
        const d = (p.x - fpv.pos.x) ** 2 + (p.z - fpv.pos.z) ** 2;
        if (d < bd) { bd = d; best = t; }
      }
      guide.t = best; guide.active = true; guide.paused = false;
    },
    stopGuide() { guide.active = false; guide.paused = false; guide.curve = null; fpv.lookOff = 0; },
    setGuideSpeed(mult: number) { guide.mult = clamp(mult, 0.4, 3); },
    onArrive(cb: () => void) { arriveCallbacks.add(cb); return () => { arriveCallbacks.delete(cb); }; },
    onUpdate(cb: (p: PoseUpdate) => void) { updateCallbacks.add(cb); return () => { updateCallbacks.delete(cb); }; },

    /** admin camera tools */
    moveCamera,
    rotateCamera,
    dollyCamera,
    setPreset,
    setFlySpeed(multiplier: number) { flyScale = clamp(multiplier, 0.2, 5); },

    /** admin transform gizmo */
    attachGizmo(object: THREE.Object3D, mode: GizmoMode) {
      if (!transform || !gizmoHelper) return;
      transform.attach(object);
      transform.setMode(mode);
      transform.setSpace('world');
      transform.showX = mode === 'translate'; transform.showZ = mode === 'translate'; transform.showY = true;
      gizmoHelper.visible = true;
    },
    detachGizmo() { if (!transform || !gizmoHelper) return; transform.detach(); gizmoHelper.visible = false; },
    setGizmoMode(mode: GizmoMode) {
      if (!transform) return;
      transform.setMode(mode);
      transform.showX = mode === 'translate'; transform.showZ = mode === 'translate'; transform.showY = true;
    },
    setGizmoSnap(translate: number | null, rotateDeg: number | null) {
      if (!transform) return;
      transform.setTranslationSnap(translate);
      transform.setRotationSnap(rotateDeg === null ? null : (rotateDeg * Math.PI) / 180);
    },
    isGizmoDragging: () => gizmoDragging,
    onGizmoChange(cb: (o: THREE.Object3D) => void) { gizmoChange.add(cb); return () => { gizmoChange.delete(cb); }; },
    onGizmoCommit(cb: (o: THREE.Object3D) => void) { gizmoCommit.add(cb); return () => { gizmoCommit.delete(cb); }; },

    onClick(callback: ClickCallback) {
      clickCallbacks.add(callback);
      return () => { clickCallbacks.delete(callback); };
    },
    /** Jump of the orbit camera to look at a world point from any direction. */
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
      return () => { frameCallbacks.delete(callback); };
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
      transform?.dispose();
      controls.dispose();
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        for (const material of materialsOf(object)) {
          for (const value of Object.values(material as any)) {
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
