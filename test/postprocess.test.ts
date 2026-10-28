import { describe, expect, it } from 'vitest';
import { OUTLINE_INDEX, paletteIndex } from '../src/render/palette';
import { downscaleFrame, mirrorFrame, outline, type IndexedFrame } from '../src/render/postprocess';

const STEP = 8;

/** Builds WebGL-style (bottom row first) id/light buffers from top-down per-sample descriptions. */
function buffers(rows: ([ramp: number, light: number] | null)[][]) {
  const h = rows.length;
  const w = rows[0].length;
  const id = new Uint8Array(w * h * 4);
  const light = new Uint8Array(w * h * 4);
  rows.forEach((row, y) =>
    row.forEach((s, x) => {
      if (!s) return;
      const i = ((h - 1 - y) * w + x) * 4;
      id.set([(s[0] + 1) * STEP, 0, 0, 255], i);
      light.set([Math.round(s[1] * 255), 0, 0, 255], i);
    }),
  );
  return { id, light };
}

const settings = { coverage: 0.5, thresholds: [0.25, 0.5, 0.75] as [number, number, number], outline: 'none' as const };

describe('downscaleFrame', () => {
  it('picks the majority ramp, shades from that ramp only, and flips rows', () => {
    // 2x1 output, supersample 2 -> 4x2 samples
    const { id, light } = buffers([
      [[3, 0.9], [3, 0.9], null, null],
      [[3, 0.9], [5, 0.1], null, [2, 0.6]],
    ]);
    const f = downscaleFrame(id, light, 2, 1, 2, STEP, settings);
    expect(f.data[0]).toBe(paletteIndex(3, 3));
    // right block is only 25% covered
    expect(f.data[1]).toBe(0);
  });

  it('maps light to shades by threshold', () => {
    const shades = [0.1, 0.3, 0.6, 0.9].map((l) => {
      const { id, light } = buffers([[[1, l]]]);
      return downscaleFrame(id, light, 1, 1, 1, STEP, settings).data[0];
    });
    expect(shades).toEqual([0, 1, 2, 3].map((s) => paletteIndex(1, s)));
  });

  it('puts the top sample row at the top of the frame', () => {
    const { id, light } = buffers([[[4, 0.9]], [null]]);
    const f = downscaleFrame(id, light, 1, 2, 1, STEP, settings);
    expect(Array.from(f.data)).toEqual([paletteIndex(4, 3), 0]);
  });
});

describe('outline & mirror', () => {
  const lit = paletteIndex(2, 3);
  const frame: IndexedFrame = { width: 3, height: 3, data: new Uint8Array([0, 0, 0, 0, lit, 0, 0, 0, 0]) };

  it('inner darkens edge pixels within their ramp', () => {
    expect(outline(frame, 'inner').data[4]).toBe(paletteIndex(2, 0));
  });

  it('outer surrounds the silhouette', () => {
    const d = outline(frame, 'outer').data;
    expect([d[1], d[3], d[5], d[7]]).toEqual(Array(4).fill(OUTLINE_INDEX));
    expect(d[0]).toBe(0);
    expect(d[4]).toBe(lit);
  });

  it('mirrors horizontally', () => {
    const f: IndexedFrame = { width: 3, height: 1, data: new Uint8Array([1, 2, 3]) };
    expect(Array.from(mirrorFrame(f).data)).toEqual([3, 2, 1]);
  });
});
