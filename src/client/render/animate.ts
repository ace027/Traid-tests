/**
 * Time-based animations for the board. Tweens are pure functions of time so a
 * resize mid-animation only changes how grid points map to pixels; the board
 * drives frames with requestAnimationFrame via runFrames().
 */

export interface Point {
  x: number;
  y: number;
}

export interface TokenTween {
  /** Interpolated grid positions for every token at time `now`. */
  positions(now: number): Record<string, Point>;
  /** Final grid positions (used to jump to the end). */
  final(): Record<string, Point>;
  done(now: number): boolean;
  /** Ids of tokens that are still moving at `now`. */
  moving(now: number): Set<string>;
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Tween each token from its prev position along its path in `next`.
 * `next[id]` is either a single target point or the list of points visited in
 * order; each step takes `durationMs`. Tokens absent from `prev` appear at
 * their final point. `startAt` lets the caller delay movement (e.g. behind the
 * dice roll).
 */
export function tweenTokens(
  prev: Record<string, Point>,
  next: Record<string, Point | Point[]>,
  durationMs = 250,
  startAt = now(),
): TokenTween {
  const paths: Record<string, Point[]> = {};
  for (const [id, target] of Object.entries(next)) {
    const steps = Array.isArray(target) ? target : [target];
    const from = prev[id];
    paths[id] = from ? [from, ...steps] : steps.length ? [steps[steps.length - 1]] : [];
  }
  const stepMs = Math.max(1, durationMs);
  const endOf = (id: string) => startAt + Math.max(0, paths[id].length - 1) * stepMs;
  const endAll = Math.max(startAt, ...Object.keys(paths).map(endOf));

  const at = (id: string, t: number): Point => {
    const path = paths[id];
    if (path.length === 0) return { x: 0, y: 0 };
    if (path.length === 1 || t <= startAt) return path[0];
    const elapsed = (t - startAt) / stepMs;
    const i = Math.floor(elapsed);
    if (i >= path.length - 1) return path[path.length - 1];
    const k = ease(elapsed - i);
    const a = path[i];
    const b = path[i + 1];
    // Small hop between tiles so steps read as discrete moves.
    const hop = Math.sin(k * Math.PI) * 0.25;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - hop };
  };

  return {
    positions(t) {
      const out: Record<string, Point> = {};
      for (const id of Object.keys(paths)) if (paths[id].length) out[id] = at(id, t);
      return out;
    },
    final() {
      const out: Record<string, Point> = {};
      for (const [id, p] of Object.entries(paths)) if (p.length) out[id] = p[p.length - 1];
      return out;
    },
    done(t) {
      return t >= endAll;
    },
    moving(t) {
      const ids = new Set<string>();
      for (const id of Object.keys(paths)) {
        if (paths[id].length > 1 && t < endOf(id)) ids.add(id);
      }
      return ids;
    },
  };
}

export interface DiceAnim {
  value: number;
  /** Face to draw at `now` (tumbling faces until it settles on value). */
  face(now: number): number;
  /** Rotation in radians at `now`. */
  angle(now: number): number;
  /** Opacity 0..1 at `now`; 0 once the die has faded out. */
  alpha(now: number): number;
  /** Time at which the die settles on its value. */
  settlesAt: number;
  done(now: number): boolean;
}

export const DICE_ROLL_MS = 650;
export const DICE_HOLD_MS = 1100;
const DICE_FADE_MS = 300;

/** Dice roll animation: tumbles for DICE_ROLL_MS, shows value, then fades. */
export function diceAnimation(value: number, startAt = now()): DiceAnim {
  const settlesAt = startAt + DICE_ROLL_MS;
  const fadeAt = settlesAt + DICE_HOLD_MS;
  const endAt = fadeAt + DICE_FADE_MS;
  const v = Math.min(6, Math.max(1, Math.round(value)));
  return {
    value: v,
    settlesAt,
    face(t) {
      if (t >= settlesAt) return v;
      const tick = Math.floor((t - startAt) / 70);
      // Deterministic tumbling that never shows the final face early twice in a row.
      return ((tick * 5 + v) % 6) + 1;
    },
    angle(t) {
      if (t >= settlesAt) return 0;
      const k = Math.max(0, (settlesAt - t) / DICE_ROLL_MS);
      return k * k * Math.PI * 3;
    },
    alpha(t) {
      if (t < fadeAt) return 1;
      return Math.max(0, 1 - (t - fadeAt) / DICE_FADE_MS);
    },
    done(t) {
      return t >= endAt;
    },
  };
}

/**
 * Run `frame` on every animation frame until it returns false. Returns a
 * cancel function. Falls back to timers where requestAnimationFrame is absent.
 */
export function runFrames(frame: (now: number) => boolean): () => void {
  let cancelled = false;
  let handle: number | ReturnType<typeof setTimeout> = 0;
  const hasRaf = typeof requestAnimationFrame === 'function';
  const schedule = () => {
    handle = hasRaf
      ? requestAnimationFrame(tick)
      : setTimeout(() => tick(now()), 16);
  };
  const tick = (t: number) => {
    if (cancelled) return;
    if (frame(t)) schedule();
  };
  schedule();
  return () => {
    cancelled = true;
    if (hasRaf) cancelAnimationFrame(handle as number);
    else clearTimeout(handle as ReturnType<typeof setTimeout>);
  };
}
