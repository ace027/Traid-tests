import { describe, expect, it } from 'vitest';
import { DICE_HOLD_MS, DICE_ROLL_MS, diceAnimation, tweenTokens } from '../../src/client/render/animate';

describe('tweenTokens', () => {
  const prev = { a: { x: 0, y: 0 } };
  it('starts at prev and ends at target', () => {
    const t = tweenTokens(prev, { a: { x: 4, y: 0 } }, 100, 1000);
    expect(t.positions(1000).a).toEqual({ x: 0, y: 0 });
    expect(t.positions(1100).a).toEqual({ x: 4, y: 0 });
    expect(t.final().a).toEqual({ x: 4, y: 0 });
    expect(t.done(1099)).toBe(false);
    expect(t.done(1100)).toBe(true);
  });
  it('reports moving tokens until finished', () => {
    const t = tweenTokens(prev, { a: { x: 4, y: 0 } }, 100, 0);
    expect(t.moving(50).has('a')).toBe(true);
    expect(t.moving(100).has('a')).toBe(false);
  });
  it('interpolates midway with a hop and honours multi-step paths', () => {
    const t = tweenTokens(prev, { a: [{ x: 2, y: 0 }, { x: 2, y: 2 }] }, 100, 0);
    const mid = t.positions(50).a;
    expect(mid.x).toBeCloseTo(1);
    expect(mid.y).toBeLessThan(0);
    expect(t.positions(100).a).toEqual({ x: 2, y: 0 });
    expect(t.done(199)).toBe(false);
    expect(t.done(200)).toBe(true);
    expect(t.positions(500).a).toEqual({ x: 2, y: 2 });
  });
  it('new tokens appear at their final point and do not move', () => {
    const t = tweenTokens({}, { b: [{ x: 1, y: 1 }, { x: 3, y: 3 }] }, 100, 0);
    expect(t.positions(0).b).toEqual({ x: 3, y: 3 });
    expect(t.moving(0).size).toBe(0);
  });
});

describe('diceAnimation', () => {
  it('settles on the value, then fades and finishes', () => {
    const d = diceAnimation(5, 0);
    expect(d.settlesAt).toBe(DICE_ROLL_MS);
    expect(d.face(DICE_ROLL_MS)).toBe(5);
    expect(d.angle(DICE_ROLL_MS)).toBe(0);
    expect(d.alpha(DICE_ROLL_MS)).toBe(1);
    expect(d.done(DICE_ROLL_MS)).toBe(false);
    const fadeAt = DICE_ROLL_MS + DICE_HOLD_MS;
    expect(d.alpha(fadeAt + 150)).toBeCloseTo(0.5);
    expect(d.alpha(fadeAt + 300)).toBe(0);
    expect(d.done(fadeAt + 300)).toBe(true);
  });
  it('tumbles through valid faces and clamps value', () => {
    const d = diceAnimation(9, 0);
    expect(d.value).toBe(6);
    for (let t = 0; t < DICE_ROLL_MS; t += 35) {
      const f = d.face(t);
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThanOrEqual(6);
    }
    expect(d.angle(0)).toBeGreaterThan(0);
  });
});
