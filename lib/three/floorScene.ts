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

export async function createFloorScene(container: HTMLElement, modelUrl: string) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b1220');

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 1;

  scene.add(new THREE.HemisphereLight(0xe5f3ff, 0x263244, 2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(12, 20, 10);
  scene.add(keyLight);

  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const model = gltf.scene;
  scene.add(model);

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

  const resize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const frameCallbacks = new Set<FrameCallback>();
  let animationFrame = 0;
  let previousTime = 0;
  const animate = (time: number) => {
    const deltaTime = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
    previousTime = time;
    controls.update();
    for (const callback of frameCallbacks) callback(time / 1000, deltaTime);
    renderer.render(scene, camera);
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
  const pickFloor = (clientX: number, clientY: number) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  };

  return {
    THREE,
    scene,
    camera,
    controls,
    renderer,
    applyOverrides,
    setCamera,
    pickFloor,
    onFrame(callback: FrameCallback) {
      frameCallbacks.add(callback);
      return () => frameCallbacks.delete(callback);
    },
    dispose() {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
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