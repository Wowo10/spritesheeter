import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/rng';
import { randomUnit } from '../src/unit/params';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b));
  });

  it('randomUnit gives the same unit for the same seed', () => {
    expect(randomUnit(1234)).toEqual(randomUnit(1234));
    expect(randomUnit(1234)).not.toEqual(randomUnit(1235));
  });

  it('gives some units beards, and tusks mostly to the green-skinned', () => {
    const units = Array.from({ length: 300 }, (_, seed) => randomUnit(seed));
    expect(units.some((u) => u.beard !== 'none')).toBe(true);
    const tusked = units.filter((u) => u.teeth === 'tusks');
    expect(tusked.length).toBeGreaterThan(0);
    expect(tusked.every((u) => u.skin === 'greenSkin')).toBe(true);
  });

  it('gives archers an empty draw hand', () => {
    let archers = 0;
    for (let seed = 0; seed < 200; seed++) {
      const u = randomUnit(seed);
      if (u.leftHand === 'bow') {
        archers++;
        expect(u.rightHand).toBe('none');
      }
      expect(u.rightHand).not.toBe('bow');
    }
    expect(archers).toBeGreaterThan(0);
  });

  it('gives some archers a crossbow, the other hand free to steady it', () => {
    let crossbows = 0;
    for (let seed = 0; seed < 200; seed++) {
      const u = randomUnit(seed);
      if (u.rightHand === 'crossbow') {
        crossbows++;
        expect(u.leftHand).toBe('none');
      }
      expect(u.leftHand).not.toBe('crossbow');
    }
    expect(crossbows).toBeGreaterThan(0);
  });

  it('gives some units a two-handed weapon, the other hand empty', () => {
    let heavy = 0;
    for (let seed = 0; seed < 300; seed++) {
      const u = randomUnit(seed);
      if (['greatsword', 'maul', 'greataxe'].includes(u.rightHand)) {
        heavy++;
        expect(u.leftHand).toBe('none');
      }
    }
    expect(heavy).toBeGreaterThan(0);
  });

  it('gives some units a throwing weapon', () => {
    const thrown = Array.from({ length: 300 }, (_, seed) => randomUnit(seed)).filter((u) => ['javelin', 'bomb', 'throwingAxe'].includes(u.rightHand));
    expect(thrown.length).toBeGreaterThan(0);
  });
});
