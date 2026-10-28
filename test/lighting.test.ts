import { describe, expect, it } from 'vitest';
import { lightDirection } from '../src/render/materials';

describe('lightDirection', () => {
  const close = (v: { x: number; y: number; z: number }, x: number, y: number, z: number) => {
    expect(v.x).toBeCloseTo(x);
    expect(v.y).toBeCloseTo(y);
    expect(v.z).toBeCloseTo(z);
  };

  it('points at the camera, the left, the right and straight up', () => {
    close(lightDirection(0, 0), 0, 0, 1);
    close(lightDirection(-90, 0), -1, 0, 0);
    close(lightDirection(90, 0), 1, 0, 0);
    close(lightDirection(0, 90), 0, 1, 0);
  });

  it('is unit length', () => {
    expect(lightDirection(-35, 27).length()).toBeCloseTo(1);
  });
});
