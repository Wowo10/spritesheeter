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

  it('never gives archers a shield', () => {
    for (let seed = 0; seed < 200; seed++) {
      const u = randomUnit(seed);
      if (u.weapon === 'bow') expect(u.shield).toBe('none');
    }
  });
});
