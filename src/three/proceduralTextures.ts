import * as THREE from 'three';

/**
 * Generates a high-detail 4-lane asphalt road texture with rumble strips,
 * shoulder lines, dashed lane dividers, and asphalt micro-grain.
 */
export function createHighwayRoadTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // Base dark asphalt
  ctx.fillStyle = '#181c24';
  ctx.fillRect(0, 0, 1024, 1024);

  // Subtle asphalt aggregate speckles
  for (let i = 0; i < 18000; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const shade = 20 + Math.floor(Math.random() * 22);
    ctx.fillStyle = `rgb(${shade}, ${shade + 3}, ${shade + 8})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Slight tire wear dark tracks in the 4 lanes
  const laneCenters = [190, 395, 629, 834];
  for (const cx of laneCenters) {
    const grad = ctx.createLinearGradient(cx - 70, 0, cx + 70, 0);
    grad.addColorStop(0, 'rgba(10, 12, 16, 0)');
    grad.addColorStop(0.3, 'rgba(8, 10, 14, 0.35)');
    grad.addColorStop(0.5, 'rgba(18, 22, 28, 0.1)');
    grad.addColorStop(0.7, 'rgba(8, 10, 14, 0.35)');
    grad.addColorStop(1, 'rgba(10, 12, 16, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - 70, 0, 140, 1024);
  }

  // Left & Right Racing Curbs (Red / White alternating rumble strips)
  const curbWidth = 44;
  const stripeHeight = 128;
  for (let i = 0; i < 8; i++) {
    const isRed = i % 2 === 0;
    ctx.fillStyle = isRed ? '#dc2626' : '#f1f5f9';
    ctx.fillRect(16, i * stripeHeight, curbWidth, stripeHeight);
    ctx.fillRect(1024 - 16 - curbWidth, i * stripeHeight, curbWidth, stripeHeight);
  }

  // Outer continuous shoulder lines (amber/white high-contrast)
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(68, 0, 10, 1024);
  ctx.fillRect(1024 - 78, 0, 10, 1024);

  // Center double amber line
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(504, 0, 6, 1024);
  ctx.fillRect(514, 0, 6, 1024);

  // Dashed lane dividers for left and right carriageways
  ctx.fillStyle = '#cbd5e1';
  const dashCount = 4;
  const segment = 1024 / dashCount;
  for (let i = 0; i < dashCount; i++) {
    const y = i * segment + 36;
    ctx.fillRect(290, y, 8, segment * 0.52);
    ctx.fillRect(726, y, 8, segment * 0.52);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Generates a carbon-fiber weave texture for aerodynamic wings and splitters.
 */
export function createCarbonFiberTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 0, 128, 128);

  const step = 16;
  for (let y = 0; y < 128; y += step) {
    for (let x = 0; x < 128; x += step) {
      const offset = (y / step) % 2 === 0 ? 0 : step / 2;
      ctx.fillStyle = '#1e232d';
      ctx.fillRect((x + offset) % 128, y, step / 2 - 1, step / 2 - 1);
      ctx.fillStyle = '#0b0d11';
      ctx.fillRect((x + offset + step / 2) % 128, y + step / 2, step / 2 - 1, step / 2 - 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Soft radial contact shadow texture placed beneath vehicles to ground them.
 */
export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 256, 512);
  const grad = ctx.createRadialGradient(128, 256, 20, 128, 256, 124);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.48)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');

  ctx.save();
  ctx.scale(1, 1.9);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(128, 134, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Luminous cyan/amber boost chevron pad texture placed on the highway surface.
 */
export function createBoostPadTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(6, 182, 212, 0.14)';
  ctx.fillRect(0, 0, 256, 512);

  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 240, 496);

  // Draw glowing forward chevrons
  for (let i = 0; i < 3; i++) {
    const yOffset = 130 + i * 130;
    ctx.beginPath();
    ctx.moveTo(44, yOffset + 50);
    ctx.lineTo(128, yOffset - 20);
    ctx.lineTo(212, yOffset + 50);
    ctx.strokeStyle = i === 0 ? '#f59e0b' : '#22d3ee';
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}
