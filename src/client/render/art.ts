import type { TileKind } from '../../engine';

/**
 * Original procedural art for the board. Everything is drawn with Canvas 2D
 * primitives; no images, fonts or external assets. All helpers are pure with
 * respect to their inputs (they only draw on the given context).
 */

export const TILE_COLOURS: Record<TileKind, { fill: string; edge: string; icon: string }> = {
  start: { fill: '#d4a83a', edge: '#8a6a1c', icon: '#fff3c8' },
  plain: { fill: '#7d9277', edge: '#4f5f4b', icon: '#d7e3d2' },
  monster: { fill: '#b0303a', edge: '#6e1a21', icon: '#ffd9d4' },
  shop: { fill: '#2f9a96', edge: '#1b5f5c', icon: '#d9fffb' },
  town: { fill: '#7b55b8', edge: '#4a3275', icon: '#efe4ff' },
  event: { fill: '#e09a2b', edge: '#8f5f15', icon: '#fff0d2' },
  heal: { fill: '#5fcf9c', edge: '#2f7d5a', icon: '#f1fff8' },
  boss: { fill: '#2a0f12', edge: '#9e1b24', icon: '#ff5a4f' },
};

export const PALETTE = {
  background: '#14110f',
  backgroundEdge: '#0b0908',
  road: '#5a4632',
  roadLight: '#8a6d4c',
  highlight: '#ffe27a',
  currentGlow: '#fff6c9',
  text: '#e8dcc6',
};

/** Seat colours, indexed by the player's position in state.players. */
export const SEAT_COLOURS = ['#e0503c', '#3c8fe0', '#e6c13a', '#4dbb5f'];

export function seatColour(index: number): string {
  return SEAT_COLOURS[((index % SEAT_COLOURS.length) + SEAT_COLOURS.length) % SEAT_COLOURS.length];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Draws one tile centred on (x, y); size is the tile's full width. */
export function drawTile(ctx: CanvasRenderingContext2D, kind: TileKind, x: number, y: number, size: number): void {
  const c = TILE_COLOURS[kind];
  const half = size / 2;
  ctx.save();
  // Drop shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, x - half + size * 0.04, y - half + size * 0.07, size, size, size * 0.22);
  ctx.fill();
  // Body.
  ctx.fillStyle = c.fill;
  roundRect(ctx, x - half, y - half, size, size, size * 0.22);
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.strokeStyle = c.edge;
  ctx.stroke();
  // Top sheen.
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, x - half + size * 0.08, y - half + size * 0.07, size * 0.84, size * 0.3, size * 0.15);
  ctx.fill();
  drawTileIcon(ctx, kind, x, y, size * 0.5, c.icon, c.edge);
  ctx.restore();
}

function drawTileIcon(
  ctx: CanvasRenderingContext2D,
  kind: TileKind,
  x: number,
  y: number,
  s: number,
  colour: string,
  dark: string,
): void {
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, s * 0.12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const h = s / 2;
  switch (kind) {
    case 'start': {
      // Banner on a pole.
      ctx.beginPath();
      ctx.moveTo(x - h * 0.6, y + h);
      ctx.lineTo(x - h * 0.6, y - h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - h * 0.6, y - h);
      ctx.lineTo(x + h * 0.9, y - h * 0.55);
      ctx.lineTo(x - h * 0.6, y - h * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'plain': {
      // Three grass tufts.
      for (const dx of [-0.6, 0, 0.6]) {
        ctx.beginPath();
        ctx.moveTo(x + dx * h - h * 0.25, y + h * 0.5);
        ctx.lineTo(x + dx * h, y - h * 0.3);
        ctx.lineTo(x + dx * h + h * 0.25, y + h * 0.5);
        ctx.stroke();
      }
      break;
    }
    case 'monster': {
      // Three claw slashes.
      for (const dx of [-0.55, 0, 0.55]) {
        ctx.beginPath();
        ctx.moveTo(x + dx * h + h * 0.35, y - h);
        ctx.quadraticCurveTo(x + dx * h + h * 0.05, y, x + dx * h - h * 0.35, y + h);
        ctx.stroke();
      }
      break;
    }
    case 'shop': {
      // Coin purse.
      ctx.beginPath();
      ctx.arc(x, y + h * 0.2, h * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - h * 0.4, y - h * 0.5);
      ctx.lineTo(x, y - h * 0.95);
      ctx.lineTo(x + h * 0.4, y - h * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(x, y + h * 0.2, h * 0.28, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'town': {
      // Keep with crenellations.
      ctx.beginPath();
      ctx.moveTo(x - h * 0.8, y + h);
      ctx.lineTo(x - h * 0.8, y - h * 0.6);
      ctx.lineTo(x - h * 0.45, y - h * 0.6);
      ctx.lineTo(x - h * 0.45, y - h * 0.25);
      ctx.lineTo(x - h * 0.15, y - h * 0.25);
      ctx.lineTo(x - h * 0.15, y - h);
      ctx.lineTo(x + h * 0.15, y - h);
      ctx.lineTo(x + h * 0.15, y - h * 0.25);
      ctx.lineTo(x + h * 0.45, y - h * 0.25);
      ctx.lineTo(x + h * 0.45, y - h * 0.6);
      ctx.lineTo(x + h * 0.8, y - h * 0.6);
      ctx.lineTo(x + h * 0.8, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(x, y + h * 0.65, h * 0.25, Math.PI, 0);
      ctx.lineTo(x + h * 0.25, y + h);
      ctx.lineTo(x - h * 0.25, y + h);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'event': {
      // Question mark built from an arc and a dot.
      ctx.beginPath();
      ctx.arc(x, y - h * 0.35, h * 0.45, Math.PI * 1.1, Math.PI * 2.35);
      ctx.lineTo(x, y + h * 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + h * 0.8, h * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'heal': {
      // Cross.
      const t = h * 0.32;
      ctx.beginPath();
      ctx.rect(x - t, y - h * 0.85, t * 2, h * 1.7);
      ctx.rect(x - h * 0.85, y - t, h * 1.7, t * 2);
      ctx.fill();
      break;
    }
    case 'boss': {
      // Horned crown.
      ctx.beginPath();
      ctx.moveTo(x - h, y + h * 0.6);
      ctx.lineTo(x - h, y - h * 0.9);
      ctx.lineTo(x - h * 0.45, y - h * 0.1);
      ctx.lineTo(x, y - h);
      ctx.lineTo(x + h * 0.45, y - h * 0.1);
      ctx.lineTo(x + h, y - h * 0.9);
      ctx.lineTo(x + h, y + h * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(x - h * 0.4, y + h * 0.2, h * 0.15, 0, Math.PI * 2);
      ctx.arc(x + h * 0.4, y + h * 0.2, h * 0.15, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/** A player crest: a shield in the seat colour with the class initial. */
export function drawToken(
  ctx: CanvasRenderingContext2D,
  colour: string,
  initial: string,
  x: number,
  y: number,
  size: number,
): void {
  const h = size / 2;
  ctx.save();
  const shield = () => {
    ctx.beginPath();
    ctx.moveTo(x - h * 0.85, y - h * 0.8);
    ctx.lineTo(x + h * 0.85, y - h * 0.8);
    ctx.lineTo(x + h * 0.85, y - h * 0.05);
    ctx.quadraticCurveTo(x + h * 0.8, y + h * 0.6, x, y + h);
    ctx.quadraticCurveTo(x - h * 0.8, y + h * 0.6, x - h * 0.85, y - h * 0.05);
    ctx.closePath();
  };
  ctx.translate(size * 0.04, size * 0.08);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  shield();
  ctx.fill();
  ctx.translate(-size * 0.04, -size * 0.08);
  ctx.fillStyle = colour;
  shield();
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, size * 0.09);
  ctx.strokeStyle = '#f7efe0';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.moveTo(x - h * 0.65, y - h * 0.62);
  ctx.lineTo(x, y - h * 0.62);
  ctx.lineTo(x - h * 0.65, y + h * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.font = `bold ${Math.round(size * 0.55)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(initial, x, y - h * 0.02);
  ctx.fillText(initial, x, y - h * 0.02);
  ctx.restore();
}

/** Small deterministic PRNG (mulberry32) seeded from a string id. */
function seededRandom(id: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A procedural monster blob; the same id always yields the same creature. */
export function drawMonster(ctx: CanvasRenderingContext2D, monsterId: string, x: number, y: number, size: number): void {
  const rnd = seededRandom(monsterId);
  const r = size * 0.38;
  const hue = Math.floor(rnd() * 360);
  const lobes = 5 + Math.floor(rnd() * 5);
  const wobble = 0.12 + rnd() * 0.2;
  const phases = Array.from({ length: 3 }, () => rnd() * Math.PI * 2);
  const eyes = 1 + Math.floor(rnd() * 3);
  const horns = rnd() < 0.5;
  const spikes = rnd() < 0.4;

  ctx.save();
  // Body outline.
  const steps = 48;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    let k = 1 + wobble * Math.sin(a * lobes + phases[0]) + wobble * 0.5 * Math.sin(a * 3 + phases[1]);
    if (spikes && i % 4 === 0) k += 0.18;
    const rr = r * k;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr * 0.9;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = `hsl(${hue}, 45%, 38%)`;
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.strokeStyle = `hsl(${hue}, 50%, 18%)`;
  ctx.stroke();

  if (horns) {
    ctx.fillStyle = '#e9e0cc';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * r * 0.35, y - r * 0.65);
      ctx.lineTo(x + side * r * 0.75, y - r * 1.25);
      ctx.lineTo(x + side * r * 0.6, y - r * 0.55);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Eyes.
  const eyeR = r * (0.12 + rnd() * 0.08);
  for (let i = 0; i < eyes; i++) {
    const ex = x + (eyes === 1 ? 0 : (i / (eyes - 1) - 0.5) * r * 0.9);
    const ey = y - r * 0.2;
    ctx.fillStyle = '#fff8e0';
    ctx.beginPath();
    ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0a0a';
    ctx.beginPath();
    ctx.arc(ex, ey + eyeR * 0.2, eyeR * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mouth with teeth.
  const mw = r * (0.5 + rnd() * 0.4);
  const my = y + r * 0.3;
  ctx.fillStyle = '#1a0a0a';
  ctx.beginPath();
  ctx.moveTo(x - mw / 2, my);
  ctx.quadraticCurveTo(x, my + r * 0.4, x + mw / 2, my);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f4ecd8';
  const teeth = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < teeth; i++) {
    const tx = x - mw / 2 + ((i + 0.5) / teeth) * mw;
    ctx.beginPath();
    ctx.moveTo(tx - mw / (teeth * 2.5), my);
    ctx.lineTo(tx, my + r * 0.12);
    ctx.lineTo(tx + mw / (teeth * 2.5), my);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

/** A six-sided die showing face 1..6, rotated by angle radians. */
export function drawDie(
  ctx: CanvasRenderingContext2D,
  face: number,
  x: number,
  y: number,
  size: number,
  angle = 0,
): void {
  const h = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, -h + size * 0.05, -h + size * 0.08, size, size, size * 0.18);
  ctx.fill();
  ctx.fillStyle = '#f6efe1';
  roundRect(ctx, -h, -h, size, size, size * 0.18);
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.strokeStyle = '#8a6d4c';
  ctx.stroke();
  ctx.fillStyle = face === 1 ? '#b0303a' : '#2a1d14';
  for (const [px, py] of PIPS[face] ?? PIPS[1]) {
    ctx.beginPath();
    ctx.arc(px * size * 0.26, py * size * 0.26, size * (face === 1 ? 0.12 : 0.085), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
