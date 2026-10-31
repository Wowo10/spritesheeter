import { describe, expect, it } from 'vitest';
import {
  APPEARED_RGB,
  compactRaw,
  coverageToRgba,
  diffToRgba,
  DISAPPEARED_RGB,
  frameDiff,
  frameStats,
  purityToRgba,
  rampToRgba,
  rawToRgba,
  RECOLOURED_RGB,
} from '../src/render/diagnostics';
import { PALETTE, paletteIndex } from '../src/render/palette';
import { NO_RAMP, sampleFrame } from '../src/render/postprocess';
import { art, frameOf, randomPass, STEP } from './passes';

const pixel = (data: Uint8ClampedArray, i: number) => Array.from(data.subarray(i * 4, i * 4 + 4));

// 4 pixels at 4x: all A; 9 A and 5 B; 6 A; nothing
const MIXED = art([
  'AAAA' + 'AAAA' + 'AAA.' + '....',
  'AAAA' + 'AAAA' + 'AAA.' + '....',
  'AAAA' + 'ABBB' + '....' + '....',
  'AAAA' + 'BB..' + '....' + '....',
]);

describe('compactRaw', () => {
  it('puts the top row first, and decodes ramps as sampleFrame does', () => {
    const raw = compactRaw(art(['A.', '.c']), 1, 1, 2, STEP);
    expect(Array.from(raw.ramp)).toEqual([0, NO_RAMP, NO_RAMP, 2]);
    expect(raw.light[0]).toBe(Math.round(0.9 * 255));
    expect(raw.light[3]).toBe(Math.round(0.3 * 255));
  });

  it("holds what sampleFrame gathered: each pixel's covered samples and its ramp's count", () => {
    const [size, ss] = [16, 4];
    const buf = randomPass(size, ss, 3);
    const raw = compactRaw(buf, size, size, ss, STEP);
    const f = sampleFrame(buf, size, size, ss, STEP);
    for (let o = 0; o < size * size; o++) {
      const [ox, oy] = [o % size, Math.floor(o / size)];
      let covered = 0;
      let count = 0;
      for (let y = oy * ss; y < (oy + 1) * ss; y++) {
        for (let x = ox * ss; x < (ox + 1) * ss; x++) {
          const r = raw.ramp[y * raw.width + x];
          if (r !== NO_RAMP) covered++;
          if (r === f.ramp[o] && r !== NO_RAMP) count++;
        }
      }
      expect([covered, count]).toEqual([f.covered[o], f.count[o]]);
    }
  });

  it('draws samples posterised to their shades', () => {
    const data = rawToRgba(compactRaw(art(['Ab']), 2, 1, 1, STEP), [0.25, 0.5, 0.75], PALETTE);
    expect(pixel(data, 0)).toEqual([...PALETTE[paletteIndex(0, 3)], 255]);
    expect(pixel(data, 1)).toEqual([...PALETTE[paletteIndex(1, 1)], 255]);
  });
});

describe('frameStats', () => {
  it('counts touched, drawn, dropped and mixed pixels, and the samples the losing ramps had', () => {
    const f = sampleFrame(MIXED, 4, 1, 4, STEP);
    // coverage 0.5 of 16 samples is 8: the 6-sample pixel is dropped
    expect(frameStats(f, { coverage: 0.5 })).toEqual({ touched: 3, opaque: 2, dropped: 1, mixed: 1, lostSamples: 5 / 30 });
    expect(frameStats(f, { coverage: 0.1 })).toMatchObject({ opaque: 3, dropped: 0 });
  });
});

describe('stage images', () => {
  const f = sampleFrame(MIXED, 4, 1, 4, STEP);

  it('tints the pixels the coverage setting drops, greys the rest, and leaves empty ones clear', () => {
    const data = coverageToRgba(f, 0.5);
    const [r, g, b, a] = pixel(data, 2);
    expect(r).toBeGreaterThan(g);
    expect(a).toBe(255);
    expect(b).toBeGreaterThan(g);
    const [kr, kg, kb] = pixel(data, 0);
    expect(kr).toBe(255);
    expect([kg, kb]).toEqual([255, 255]);
    expect(pixel(data, 3)[3]).toBe(0);
  });

  it("draws each pixel's ramp, and how much of its block that ramp had", () => {
    expect(pixel(rampToRgba(f, PALETTE), 1)).toEqual([...PALETTE[paletteIndex(0, 2)], 255]);
    const purity = purityToRgba(f);
    expect(pixel(purity, 0)).toEqual([255, 255, 255, 255]);
    // 9 of 14 samples
    expect(pixel(purity, 1)[2]).toBeLessThan(255);
    expect(pixel(purity, 3)[3]).toBe(0);
  });
});

describe('frameDiff', () => {
  const prev = frameOf(['AA.B']);
  const cur = frameOf(['A.CB']);

  it('counts pixels that appeared, disappeared and changed colour', () => {
    expect(frameDiff(prev, cur)).toEqual({ appeared: 1, disappeared: 1, recoloured: 0 });
    expect(frameDiff(frameOf(['AB']), frameOf(['AC']))).toEqual({ appeared: 0, disappeared: 0, recoloured: 1 });
  });

  it('marks them over the unchanged pixels', () => {
    const data = diffToRgba(frameOf(['A.CC']), frameOf(['AA.B']), PALETTE);
    expect(pixel(data, 1)).toEqual([...DISAPPEARED_RGB, 255]);
    expect(pixel(data, 2)).toEqual([...APPEARED_RGB, 255]);
    expect(pixel(data, 3)).toEqual([...RECOLOURED_RGB, 255]);
    const [r, g, b] = pixel(data, 0);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
});
