import type { GameEvent, Tile } from '../../engine';
import type { PublicGameState } from '../../shared/protocol';
import type { ClientState, Store } from '../store';
import { type DiceAnim, type Point, type TokenTween, diceAnimation, runFrames, tweenTokens } from './animate';
import { PALETTE, drawDie, drawTile, drawToken, seatColour } from './art';

/** Board grid size in tiles (see src/engine/map.ts). */
export const GRID_COLS = 20;
export const GRID_ROWS = 12;
const BOSS_WEEK = 4;
const STEP_MS = 250;
/** CSS pixels kept clear at the top of the canvas for the HUD status bar. */
const TOP_INSET = 48;

type PathHandler = (tileId: string) => void;

interface Layout {
  width: number;
  height: number;
  cell: number;
  ox: number;
  oy: number;
}

interface BoardInstance {
  layout: Layout;
  tiles: Record<string, Tile>;
  destroy(): void;
}

let pathHandler: PathHandler | null = null;
let active: BoardInstance | null = null;

/** Register the callback fired when the local player clicks a highlighted path target. */
export function setPathHandler(fn: PathHandler | null): void {
  pathHandler = fn;
}

/** Tile id under canvas CSS-pixel coordinates (x, y), or null. */
export function tileAt(x: number, y: number): string | null {
  if (!active) return null;
  const { cell } = active.layout;
  const half = cell * 0.45;
  for (const t of Object.values(active.tiles)) {
    const c = toPx(active.layout, t);
    if (Math.abs(x - c.x) <= half && Math.abs(y - c.y) <= half) return t.id;
  }
  return null;
}

/** Centre of a tile in canvas CSS pixels, or null if unknown. */
export function tileCenter(tileId: string): Point | null {
  const t = active?.tiles[tileId];
  return active && t ? toPx(active.layout, t) : null;
}

function toPx(l: Layout, p: Point): Point {
  return { x: l.ox + (p.x + 0.5) * l.cell, y: l.oy + (p.y + 0.5) * l.cell };
}

/** Targets the local player may click: only on my turn in phase choose-path. */
export function pathTargets(s: ClientState): string[] {
  const g = s.state;
  if (!g || g.phase !== 'choose-path' || !s.playerId) return [];
  const me = g.players[g.turnIndex];
  if (!me || me.id !== s.playerId) return [];
  return [...(g.tiles[me.tileId]?.next ?? [])];
}

/** Shortest forward route from `from` to `to` (excluding `from`), or null. */
function route(tiles: Record<string, Tile>, from: string, to: string, maxDepth = 12): string[] | null {
  if (from === to) return [];
  const prev = new Map<string, string>([[from, '']]);
  let frontier = [from];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      for (const n of tiles[id]?.next ?? []) {
        if (prev.has(n)) continue;
        prev.set(n, id);
        if (n === to) {
          const out = [n];
          let cur = id;
          while (cur !== from) {
            out.unshift(cur);
            cur = prev.get(cur) as string;
          }
          return out;
        }
        nextFrontier.push(n);
      }
    }
    frontier = nextFrontier;
  }
  return null;
}

/** Tile ids each player walked through between two states, using 'move' events as waypoints. */
function movementPaths(
  prev: PublicGameState,
  next: PublicGameState,
  events: GameEvent[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of next.players) {
    const before = prev.players.find((q) => q.id === p.id)?.tileId;
    if (!before || before === p.tileId) continue;
    const waypoints = events
      .filter((e) => e.type === 'move' && e.playerId === p.id && typeof e.tileId === 'string')
      .map((e) => e.tileId as string);
    if (waypoints[waypoints.length - 1] !== p.tileId) waypoints.push(p.tileId);
    const path: string[] = [];
    let cur = before;
    let ok = true;
    for (const w of waypoints) {
      const leg = route(next.tiles, cur, w);
      if (!leg) {
        ok = false;
        break;
      }
      path.push(...leg);
      cur = w;
    }
    out[p.id] = ok && path.length ? path : [p.tileId];
  }
  return out;
}

/** Pixel offsets so up to four tokens sharing a tile are all visible. */
function stackOffsets(n: number, spread: number): Point[] {
  if (n <= 1) return [{ x: 0, y: 0 }];
  if (n === 2) return [{ x: -spread, y: 0 }, { x: spread, y: 0 }];
  if (n === 3) return [{ x: -spread, y: -spread }, { x: spread, y: -spread }, { x: 0, y: spread }];
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * 0.75 + (i * Math.PI * 2) / n;
    out.push({ x: Math.cos(a) * spread * 1.3, y: Math.sin(a) * spread * 1.3 });
  }
  return out;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function mountBoard(canvas: HTMLCanvasElement, store: Store): void {
  active?.destroy();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const g2d: CanvasRenderingContext2D = ctx;

  const layout: Layout = { width: 0, height: 0, cell: 1, ox: 0, oy: 0 };
  let lastState: PublicGameState | null = null;
  let tween: TokenTween | null = null;
  let dice: DiceAnim | null = null;
  let targets: string[] = [];
  let stopLoop: (() => void) | null = null;

  const instance: BoardInstance = {
    layout,
    tiles: {},
    destroy,
  };
  active = instance;

  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Game board');

  function resize() {
    const w = canvas.clientWidth || window.innerWidth || 800;
    const h = canvas.clientHeight || window.innerHeight || 600;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout.width = w;
    layout.height = h;
    // Leave room for the HUD's top status bar; the grid is centred below it.
    const top = h > 400 ? TOP_INSET : 0;
    const avail = h - top;
    layout.cell = Math.max(4, Math.min(w / (GRID_COLS + 0.6), avail / (GRID_ROWS + 0.6)));
    layout.ox = (w - GRID_COLS * layout.cell) / 2;
    layout.oy = top + (avail - GRID_ROWS * layout.cell) / 2;
    draw(now());
  }

  function onStore(s: ClientState) {
    const g = s.state;
    if (g && g !== lastState) {
      instance.tiles = g.tiles;
      const t = now();
      if (lastState) {
        // Any running tween jumps to its end: it starts from lastState's tiles.
        const roll = s.lastEvents.find((e) => e.type === 'roll' && typeof e.value === 'number');
        if (roll) dice = diceAnimation(roll.value as number, t);
        const paths = movementPaths(lastState, g, s.lastEvents);
        const ids = Object.keys(paths);
        if (ids.length) {
          const prev: Record<string, Point> = {};
          const next: Record<string, Point[]> = {};
          for (const id of ids) {
            const from = lastState.players.find((p) => p.id === id);
            const fromTile = from && g.tiles[from.tileId];
            if (fromTile) prev[id] = { x: fromTile.x, y: fromTile.y };
            next[id] = paths[id].map((tid) => ({ x: g.tiles[tid].x, y: g.tiles[tid].y }));
          }
          tween = tweenTokens(prev, next, STEP_MS, roll ? dice!.settlesAt : t);
        } else {
          tween = null;
        }
      }
      lastState = g;
    }
    targets = pathTargets(s);
    kick();
  }

  function needsFrames(t: number): boolean {
    if (tween && !tween.done(t)) return true;
    if (dice && !dice.done(t)) return true;
    if (targets.length) return true;
    return lastState?.week === BOSS_WEEK;
  }

  function kick() {
    const t = now();
    draw(t);
    if (!stopLoop && needsFrames(t)) {
      stopLoop = runFrames((ft) => {
        draw(ft);
        if (needsFrames(ft)) return true;
        stopLoop = null;
        return false;
      });
    }
  }

  function draw(t: number) {
    const { width: w, height: h, cell } = layout;
    g2d.save();
    g2d.fillStyle = PALETTE.background;
    g2d.fillRect(0, 0, w, h);
    const vignette = g2d.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
    vignette.addColorStop(0, '#2a221b');
    vignette.addColorStop(1, PALETTE.backgroundEdge);
    g2d.fillStyle = vignette;
    g2d.fillRect(0, 0, w, h);
    g2d.restore();

    const g = lastState;
    if (!g) return;
    const tiles = Object.values(g.tiles);

    // Roads.
    g2d.save();
    g2d.lineCap = 'round';
    for (const [width, colour] of [
      [cell * 0.22, PALETTE.road],
      [cell * 0.07, PALETTE.roadLight],
    ] as const) {
      g2d.strokeStyle = colour;
      g2d.lineWidth = width;
      g2d.beginPath();
      for (const tile of tiles) {
        const a = toPx(layout, tile);
        for (const n of tile.next) {
          const nt = g.tiles[n];
          if (!nt) continue;
          const b = toPx(layout, nt);
          g2d.moveTo(a.x, a.y);
          g2d.lineTo(b.x, b.y);
        }
      }
      g2d.stroke();
    }
    // Direction chevrons at road midpoints.
    g2d.fillStyle = PALETTE.roadLight;
    for (const tile of tiles) {
      const a = toPx(layout, tile);
      for (const n of tile.next) {
        const nt = g.tiles[n];
        if (!nt) continue;
        const b = toPx(layout, nt);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const s = cell * 0.16;
        g2d.beginPath();
        g2d.moveTo(mx + Math.cos(ang) * s, my + Math.sin(ang) * s);
        g2d.lineTo(mx + Math.cos(ang + 2.4) * s, my + Math.sin(ang + 2.4) * s);
        g2d.lineTo(mx + Math.cos(ang - 2.4) * s, my + Math.sin(ang - 2.4) * s);
        g2d.closePath();
        g2d.fill();
      }
    }
    g2d.restore();

    // Tiles.
    const tileSize = cell * 0.8;
    const bossActive = g.week === BOSS_WEEK;
    const pulse = 0.5 + 0.5 * Math.sin(t / 260);
    for (const tile of tiles) {
      const c = toPx(layout, tile);
      if (tile.kind === 'boss' && bossActive) {
        g2d.save();
        g2d.globalAlpha = 0.35 + 0.45 * pulse;
        g2d.fillStyle = '#ff3b2f';
        g2d.beginPath();
        g2d.arc(c.x, c.y, tileSize * (0.62 + 0.14 * pulse), 0, Math.PI * 2);
        g2d.fill();
        g2d.restore();
      }
      drawTile(g2d, tile.kind, c.x, c.y, tileSize);
      if (tile.kind === 'boss' && !bossActive) {
        // Dormant until week 4.
        g2d.save();
        g2d.fillStyle = 'rgba(20,17,15,0.45)';
        g2d.fillRect(c.x - tileSize / 2, c.y - tileSize / 2, tileSize, tileSize);
        g2d.restore();
      }
      const town = g.towns[tile.id];
      if (town) drawTownMarks(c, tileSize, town.ownerId, town.level, g);
    }

    // Path targets.
    if (targets.length) {
      g2d.save();
      g2d.strokeStyle = PALETTE.highlight;
      g2d.lineWidth = Math.max(2, cell * 0.08);
      g2d.globalAlpha = 0.55 + 0.45 * pulse;
      for (const id of targets) {
        const tile = g.tiles[id];
        if (!tile) continue;
        const c = toPx(layout, tile);
        const r = tileSize * (0.62 + 0.06 * pulse);
        g2d.beginPath();
        g2d.arc(c.x, c.y, r, 0, Math.PI * 2);
        g2d.stroke();
      }
      g2d.restore();
    }

    // Tokens.
    if (tween?.done(t)) tween = null;
    const animPos = tween ? tween.positions(t) : {};
    const moving = tween ? tween.moving(t) : new Set<string>();
    const groups = new Map<string, string[]>();
    for (const p of g.players) {
      if (moving.has(p.id)) continue;
      const key = p.tileId;
      groups.set(key, [...(groups.get(key) ?? []), p.id]);
    }
    const tokenSize = cell * 0.56;
    const current = g.players[g.turnIndex];
    const order = [...g.players].sort((a, b) => (a.id === current?.id ? 1 : 0) - (b.id === current?.id ? 1 : 0));
    for (const p of order) {
      const seat = g.players.indexOf(p);
      let pos: Point;
      if (moving.has(p.id) && animPos[p.id]) {
        pos = toPx(layout, animPos[p.id]);
      } else {
        const tile = g.tiles[p.tileId];
        if (!tile) continue;
        const base = toPx(layout, tile);
        const group = groups.get(p.tileId) ?? [p.id];
        const off = stackOffsets(group.length, cell * 0.2)[Math.max(0, group.indexOf(p.id))];
        pos = { x: base.x + off.x, y: base.y + off.y };
      }
      const size = group1Size(groups.get(p.tileId)?.length ?? 1, tokenSize);
      g2d.save();
      if (p.defeated) g2d.globalAlpha = 0.4;
      if (current && p.id === current.id && g.phase !== 'game-over') {
        g2d.fillStyle = PALETTE.currentGlow;
        g2d.globalAlpha = 0.25 + 0.2 * pulse;
        g2d.beginPath();
        g2d.arc(pos.x, pos.y, size * 0.85, 0, Math.PI * 2);
        g2d.fill();
        g2d.globalAlpha = p.defeated ? 0.4 : 1;
        g2d.strokeStyle = PALETTE.currentGlow;
        g2d.lineWidth = Math.max(1.5, size * 0.08);
        g2d.stroke();
      }
      drawToken(g2d, seatColour(seat), p.classId.charAt(0).toUpperCase(), pos.x, pos.y, size);
      g2d.restore();
    }

    // Dice.
    if (dice) {
      if (dice.done(t)) {
        dice = null;
      } else {
        const c = toPx(layout, { x: (GRID_COLS - 1) / 2, y: (GRID_ROWS - 1) / 2 - 1 });
        g2d.save();
        g2d.globalAlpha = dice.alpha(t);
        drawDie(g2d, dice.face(t), c.x, c.y, cell * 1.4, dice.angle(t));
        g2d.restore();
      }
    }
  }

  function group1Size(count: number, base: number): number {
    return count >= 3 ? base * 0.8 : base;
  }

  function drawTownMarks(c: Point, size: number, ownerId: string | null, level: number, g: PublicGameState) {
    const half = size / 2;
    g2d.save();
    if (ownerId) {
      const seat = g.players.findIndex((p) => p.id === ownerId);
      g2d.strokeStyle = seat >= 0 ? seatColour(seat) : '#ffffff';
      g2d.lineWidth = Math.max(2, size * 0.1);
      g2d.beginPath();
      g2d.arc(c.x, c.y, half * 1.22, 0, Math.PI * 2);
      g2d.stroke();
    }
    const pipR = Math.max(1.5, size * 0.07);
    for (let i = 0; i < level; i++) {
      const px = c.x + (i - (level - 1) / 2) * pipR * 2.8;
      const py = c.y + half + pipR * 1.6;
      g2d.fillStyle = '#ffe9a8';
      g2d.strokeStyle = '#3a2a10';
      g2d.lineWidth = 1;
      g2d.beginPath();
      g2d.arc(px, py, pipR, 0, Math.PI * 2);
      g2d.fill();
      g2d.stroke();
    }
    g2d.restore();
  }

  function localPoint(e: MouseEvent): Point {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onClick(e: MouseEvent) {
    if (!targets.length) return;
    const p = localPoint(e);
    const id = tileAt(p.x, p.y);
    if (id && targets.includes(id)) pathHandler?.(id);
  }

  function onMove(e: MouseEvent) {
    if (!targets.length) {
      canvas.style.cursor = '';
      return;
    }
    const p = localPoint(e);
    const id = tileAt(p.x, p.y);
    canvas.style.cursor = id && targets.includes(id) ? 'pointer' : '';
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  ro?.observe(canvas);
  window.addEventListener('resize', resize);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('mousemove', onMove);
  const unsubscribe = store.subscribe(onStore);

  function destroy() {
    unsubscribe();
    ro?.disconnect();
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('mousemove', onMove);
    stopLoop?.();
    stopLoop = null;
    if (active === instance) active = null;
  }

  resize();
  onStore(store.get());
}
