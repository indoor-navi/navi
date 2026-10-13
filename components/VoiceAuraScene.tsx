'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { AgentState } from './types';

interface VoiceAuraSceneProps {
  agentState: AgentState;
  isStreaming: boolean;
  isOrbSpeaking: boolean;
  isThinking: boolean;
  speakingAmplitude: number;
  auraColorA?: string;
  auraColorB?: string;
}

type AuraMode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'navigating';

const palettes: Record<AuraMode, [string, string]> = {
  idle: ['#52e4d1', '#648cff'],
  listening: ['#5cf0d0', '#5db7ff'],
  thinking: ['#ffd16a', '#ff815c'],
  speaking: ['#ffb45e', '#ff5e9d'],
  navigating: ['#77e9c0', '#67a5ff'],
};

function getMode({ agentState, isStreaming, isOrbSpeaking, isThinking }: Pick<VoiceAuraSceneProps, 'agentState' | 'isStreaming' | 'isOrbSpeaking' | 'isThinking'>): AuraMode {
  if (isOrbSpeaking || agentState === 'speaking') return 'speaking';
  if (isThinking || agentState === 'thinking') return 'thinking';
  if (agentState === 'navigating') return 'navigating';
  if (isStreaming || agentState === 'listening') return 'listening';
  return 'idle';
}

export default function VoiceAuraScene(props: VoiceAuraSceneProps) {
  const { agentState, isStreaming, isOrbSpeaking, isThinking } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<AuraMode>(getMode(props));
  const colorARef = useRef(props.auraColorA);
  const colorBRef = useRef(props.auraColorB);
  const amplitudeRef = useRef(props.speakingAmplitude);

  useEffect(() => {
    modeRef.current = getMode({ agentState, isStreaming, isOrbSpeaking, isThinking });
    colorARef.current = props.auraColorA;
    colorBRef.current = props.auraColorB;
    amplitudeRef.current = props.speakingAmplitude;
  }, [agentState, isStreaming, isOrbSpeaking, isThinking, props.auraColorA, props.auraColorB, props.speakingAmplitude]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
    camera.position.set(0, 0, 5.2);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.className = 'absolute inset-0 size-full';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x8edbd7, 1.5));
    const keyLight = new THREE.PointLight(palettes.idle[0], 16, 8);
    keyLight.position.set(-2.5, 2.4, 3.5);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(palettes.idle[1], 12, 8);
    rimLight.position.set(2.5, -1.5, -2);
    scene.add(rimLight);

    const auraMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0.24 },
        uColorA: { value: new THREE.Color(palettes.idle[0]) },
        uColorB: { value: new THREE.Color(palettes.idle[1]) },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uEnergy;
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;
        void main() {
          float ripple = sin(position.x * 4.2 + uTime * 0.8)
            * sin(position.y * 3.6 - uTime * 0.65)
            * cos(position.z * 4.5 + uTime * 0.55);
          vec3 displaced = position + normal * ripple * (0.025 + uEnergy * 0.085);
          vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
          vWorldPosition = worldPosition.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;
        void main() {
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float fresnel = pow(1.0 - abs(dot(normalize(vWorldNormal), viewDirection)), 2.1);
          float colorWave = 0.5 + 0.5 * sin(vWorldPosition.y * 4.0 + vWorldPosition.x * 2.5 + uTime * 0.45);
          vec3 color = mix(uColorA, uColorB, colorWave);
          float alpha = 0.13 + fresnel * 0.78;
          gl_FragColor = vec4(color * (0.72 + fresnel * 1.2), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    const aura = new THREE.Mesh(new THREE.IcosahedronGeometry(1.12, 5), auraMaterial);
    scene.add(aura);

    const coreMaterial = new THREE.MeshStandardMaterial({
      color: palettes.idle[0],
      emissive: palettes.idle[0],
      emissiveIntensity: 0.44,
      roughness: 0.22,
      metalness: 0.08,
    });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 5), coreMaterial);
    scene.add(core);

    const wireMaterial = new THREE.MeshBasicMaterial({
      color: palettes.idle[1],
      wireframe: true,
      transparent: true,
      opacity: 0.18,
    });
    const wireShell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.18, 2), wireMaterial);
    scene.add(wireShell);

    const rings = [
      { mesh: new THREE.Mesh(new THREE.TorusGeometry(1.44, 0.009, 8, 180), new THREE.MeshBasicMaterial({ color: palettes.idle[0], transparent: true, opacity: 0.62 })), speed: 0.13, tilt: [0.85, 0.22, -0.35] },
      { mesh: new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.006, 8, 180), new THREE.MeshBasicMaterial({ color: palettes.idle[1], transparent: true, opacity: 0.42 })), speed: -0.09, tilt: [1.18, -0.48, 0.24] },
      { mesh: new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.005, 8, 180), new THREE.MeshBasicMaterial({ color: palettes.idle[0], transparent: true, opacity: 0.38 })), speed: 0.18, tilt: [0.32, 0.88, 1.02] },
    ];
    rings.forEach(({ mesh, tilt }) => {
      mesh.rotation.set(tilt[0], tilt[1], tilt[2]);
      scene.add(mesh);
    });

    const particlePositions = new Float32Array(360 * 3);
    for (let index = 0; index < 360; index += 1) {
      const y = 1 - (index / 359) * 2;
      const radius = Math.sqrt(1 - y * y);
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const distance = 1.62 + ((index * 37) % 43) / 100;
      particlePositions[index * 3] = Math.cos(angle) * radius * distance;
      particlePositions[index * 3 + 1] = y * distance;
      particlePositions[index * 3 + 2] = Math.sin(angle) * radius * distance;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({ color: palettes.idle[1], size: 0.018, transparent: true, opacity: 0.64, sizeAttenuation: true }),
    );
    scene.add(particles);

    const resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.position.z = width < 420 ? 5.7 : 5.2;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    resizeObserver.observe(container);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clock = new THREE.Clock();
    const currentColorA = new THREE.Color(palettes.idle[0]);
    const currentColorB = new THREE.Color(palettes.idle[1]);
    const targetColorA = new THREE.Color();
    const targetColorB = new THREE.Color();
    let frameId = 0;
    let elapsed = 0;

    const animate = () => {
      frameId = window.requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      elapsed += delta * (reducedMotion ? 0.12 : 1);
      const mode = modeRef.current;
      const speakingAmplitude = mode === 'speaking' ? amplitudeRef.current : 0;
      targetColorA.set(colorARef.current || palettes[mode][0]);
      targetColorB.set(colorBRef.current || palettes[mode][1]);
      currentColorA.lerp(targetColorA, 0.04);
      currentColorB.lerp(targetColorB, 0.04);
      auraMaterial.uniforms.uTime.value = elapsed;
      auraMaterial.uniforms.uEnergy.value = THREE.MathUtils.damp(
        auraMaterial.uniforms.uEnergy.value,
        mode === 'speaking' ? 0.38 + speakingAmplitude * 1.15 : mode === 'thinking' ? 0.72 : mode === 'listening' ? 0.52 : 0.24,
        mode === 'speaking' ? 8 : 2.4,
        delta,
      );
      auraMaterial.uniforms.uColorA.value.copy(currentColorA);
      auraMaterial.uniforms.uColorB.value.copy(currentColorB);
      coreMaterial.color.copy(currentColorA);
      coreMaterial.emissive.copy(currentColorA);
      wireMaterial.color.copy(currentColorB);
      keyLight.color.copy(currentColorA);
      rimLight.color.copy(currentColorB);
      particles.material.color.copy(currentColorB);
      rings.forEach(({ mesh }, index) => {
        mesh.material.color.copy(index === 1 ? currentColorB : currentColorA);
        mesh.material.opacity = (index === 0 ? 0.62 : index === 1 ? 0.42 : 0.38) + speakingAmplitude * 0.22;
        mesh.scale.setScalar(1 + speakingAmplitude * 0.12);
      });
      rings.forEach(({ mesh, speed }) => { mesh.rotation.y += delta * speed * (reducedMotion ? 0.1 : 1); });
      aura.rotation.y += delta * 0.12 * (reducedMotion ? 0.1 : 1);
      aura.rotation.x = Math.sin(elapsed * 0.22) * 0.13;
      core.rotation.y -= delta * 0.08 * (reducedMotion ? 0.1 : 1);
      wireShell.rotation.y = -aura.rotation.y * 0.7;
      wireShell.rotation.x = aura.rotation.x * -0.6;
      particles.rotation.y -= delta * 0.018 * (reducedMotion ? 0.1 : 1);
      const pulse = 1 + Math.sin(elapsed * (mode === 'speaking' ? 2.7 : 1.2)) * (mode === 'speaking' ? 0.025 + speakingAmplitude * 0.14 : 0.012)
        + speakingAmplitude * 0.09;
      aura.scale.setScalar(pulse);
      core.scale.setScalar(1 + (pulse - 1) * 0.72);
      coreMaterial.emissiveIntensity = 0.44 + speakingAmplitude * 1.4;
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const mode = getMode(props);
  const modeLabel = mode === 'idle' ? 'READY WHEN YOU ARE' : mode.toUpperCase();

  return (
    <div className="relative h-full w-full max-w-[560px]" aria-label={`NaviSense is ${modeLabel.toLowerCase()}`} role="img">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <span className="rounded-full border border-white/10 bg-zinc-950/70 px-4 py-2 font-mono text-[10px] font-semibold tracking-[0.18em] text-white/75 backdrop-blur-sm">
          {modeLabel}
        </span>
      </div>
    </div>
  );
}