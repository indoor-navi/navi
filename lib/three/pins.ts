/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function makeLabel(text: string, opts: { bg?: string | number; fg?: string } = {}) {
  const THREE = await import('three');
  const pad = 20, fs = 34;
  const c = document.createElement('canvas');
  const mctx = c.getContext('2d')!;
  mctx.font = `600 ${fs}px system-ui, sans-serif`;
  c.width = Math.ceil(mctx.measureText(text).width) + pad * 2;
  c.height = fs + pad * 1.4;
  const ctx = c.getContext('2d')!;
  const col = typeof opts.bg === 'number' ? '#' + opts.bg.toString(16).padStart(6, '0') : (opts.bg ?? '#111827');
  ctx.fillStyle = col;
  roundRect(ctx, 0, 0, c.width, c.height, 14);
  ctx.fill();
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  ctx.fillStyle = opts.fg ?? '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const H = 0.42;
  sp.scale.set((H * c.width) / c.height, H, 1);
  sp.renderOrder = 999;
  return sp;
}

export async function makePin(color: string | number, label?: string) {
  const THREE = await import('three');
  const g = new THREE.Group();
  const col = typeof color === 'string' ? new THREE.Color(color).getHex() : color;
  const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.55, roughness: 0.35 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 24), mat);
  head.position.y = 0.42;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 24), mat);
  tip.rotation.x = Math.PI;
  tip.position.y = 0.13;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.3, 32),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(head, tip, ring);
  g.userData.ring = ring;
  if (label) {
    const sp = await makeLabel(label, { bg: col });
    sp.position.y = 1.0;
    g.add(sp);
  }
  return g;
}