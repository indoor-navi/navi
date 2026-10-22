/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

export function buildRoute(THREE: any, points: Array<{ x: number; y: number; z: number }>) {
  const pts = points.map((p) => new THREE.Vector3(p.x, p.y + 0.12, p.z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
  const length = curve.getLength();
  const group = new THREE.Group();

  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(32, pts.length * 8), 0.05, 8, false),
    new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.9 })
  );
  const lineGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(Math.max(64, pts.length * 16)));
  const dash = new THREE.Line(
    lineGeo,
    new THREE.LineDashedMaterial({ color: 0xbbf7d0, dashSize: 0.35, gapSize: 0.22, transparent: true, opacity: 0.95 })
  );
  dash.computeLineDistances();
  const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16), new THREE.MeshBasicMaterial({ color: 0x4ade80 }));
  group.add(tube, dash, pulse);

  let t = 0;
  return {
    group, curve, length,
    update(dt: number, speed = 1.4) {
      t = (t + (dt * speed) / Math.max(length, 0.01)) % 1;
      pulse.position.copy(curve.getPointAt(t));
      pulse.scale.setScalar(1 + 0.25 * Math.sin(t * 40));
    },
    dispose() {
      tube.geometry.dispose();
      lineGeo.dispose();
      group.removeFromParent();
    },
  };
}