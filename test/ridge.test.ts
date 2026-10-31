import { describe, expect, it } from 'vitest';
import { coverageMask, minCovered, sampleFrame, shadeFrame, type PostprocessSettings } from '../src/render/postprocess';
import { ridgeCoverage, THIN } from '../src/render/ridge';
import { art, linePass, randomPass, STEP, type Line } from './passes';

const SS = 8;
const SIZE = 16;
const MIN = minCovered(SS, 0.3);

const classicMask = (buf: Uint8Array, size = SIZE, ss = SS) => coverageMask(sampleFrame(buf, size, size, ss, STEP), { coverage: 0.3 });
const ridgeMask = (buf: Uint8Array, size = SIZE, ss = SS) => ridgeCoverage(sampleFrame(buf, size, size, ss, STEP), minCovered(ss, 0.3));

/** Drawn pixels per row (for a steep line) or column (for a shallow one), over the middle of a line. */
function slices(m: Uint8Array, l: Line, size = SIZE): number[] {
  const steep = Math.abs(Math.sin((l.angle * Math.PI) / 180)) > Math.abs(Math.cos((l.angle * Math.PI) / 180));
  const span = (l.length / 2) * 0.7 * Math.abs(steep ? Math.sin((l.angle * Math.PI) / 180) : Math.cos((l.angle * Math.PI) / 180));
  const centre = steep ? l.cy : l.cx;
  const out: number[] = [];
  for (let k = Math.ceil(centre - span); k < Math.floor(centre + span); k++) {
    let n = 0;
    for (let j = 0; j < size; j++) n += steep ? m[k * size + j] : m[j * size + k];
    out.push(n);
  }
  return out;
}

/** 8-connected pieces of a mask. */
function pieces(m: Uint8Array, size = SIZE): number {
  const seen = new Uint8Array(m.length);
  let n = 0;
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || seen[i]) continue;
    n++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [x, y] = [(p % size) + dx, Math.floor(p / size) + dy];
          const q = y * size + x;
          if (x >= 0 && y >= 0 && x < size && y < size && m[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
  }
  return n;
}

const OFFSETS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => k / 8);

describe('ridge-preserving coverage', () => {
  it('draws a vertical part under 1.5 px wide exactly 1 px wide wherever it falls between pixels', () => {
    for (const width of [0.25, 0.375, 0.5, 0.75, 1, 1.25]) {
      for (const off of OFFSETS) {
        const l: Line = { cx: 8 + off, cy: 8, angle: 90, length: 8, width };
        expect(slices(ridgeMask(linePass(SIZE, SS, l)), l), `width ${width}, offset ${off}`).toEqual(Array(slices(classicMask(linePass(SIZE, SS, l)), l).length).fill(1));
      }
    }
  });

  it('where the threshold alone drops or doubles the same part', () => {
    const widths = (width: number) => OFFSETS.map((off) => {
      const l: Line = { cx: 8 + off, cy: 8, angle: 90, length: 8, width };
      return Math.max(...slices(classicMask(linePass(SIZE, SS, l)), l));
    });
    expect(widths(1)).toContain(2);
    expect(widths(0.375)).toContain(0);
  });

  it('keeps a thin line at any angle in one piece, about a pixel thick', () => {
    for (let angle = 0; angle <= 90; angle += 7.5) {
      for (const width of [0.375, 0.75, 1]) {
        for (const [ox, oy] of [[0, 0], [0.3, 0.6], [0.55, 0.15], [0.8, 0.9]]) {
          const l: Line = { cx: 8 + ox, cy: 8 + oy, angle, length: 10, width };
          const m = ridgeMask(linePass(SIZE, SS, l));
          expect(pieces(m), `angle ${angle}, width ${width}`).toBe(1);
          const s = slices(m, l);
          expect(Math.min(...s)).toBeGreaterThanOrEqual(1);
          expect(Math.max(...s)).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('leaves parts 1.5 px wide or more to the threshold', () => {
    for (const width of [1.5, 2, 3]) {
      for (const off of OFFSETS) {
        const buf = linePass(SIZE, SS, { cx: 8 + off, cy: 8, angle: 90, length: 8, width });
        expect(ridgeMask(buf)).toEqual(classicMask(buf));
      }
    }
    expect(THIN).toBe(1.5);
  });

  it('leaves big shapes, partly covered edges included, to the threshold', () => {
    for (const seed of [1, 2, 3]) {
      // randomPass's ragged-edged blobs, at a size where they're thick everywhere
      const buf = randomPass(16, 4, seed);
      const f = sampleFrame(buf, 16, 16, 4, STEP);
      const ridge = ridgeCoverage(f, minCovered(4, 0.3));
      const classic = coverageMask(f, { coverage: 0.3 });
      expect(ridge.filter((v, i) => v !== classic[i]).length).toBeLessThanOrEqual(2);
    }
  });

  it("doesn't draw a lone speck the threshold drops", () => {
    // a quarter of one pixel's block, at ss 4: under coverage 0.3, and going nowhere
    const f = sampleFrame(art(['....', '.AA.', '.AA.', '....']), 1, 1, 4, STEP);
    expect(Array.from(ridgeCoverage(f, minCovered(4, 0.3)))).toEqual([0]);
  });

  it("keeps the partly covered last row of a 2 px wide part as the threshold has it", () => {
    // a 2 px wide leg at 4x whose bottom row is 6/16 covered in both pixels
    const leg = art([...Array(8).fill('AAAAAAAA'), 'AAAAAAAA', 'AA..AA..', '........', '........']);
    const f = sampleFrame(leg, 2, 3, 4, STEP);
    expect(Array.from(coverageMask(f, { coverage: 0.3 }))).toEqual([1, 1, 1, 1, 1, 1]);
    expect(Array.from(ridgeCoverage(f, minCovered(4, 0.3)))).toEqual(Array.from(coverageMask(f, { coverage: 0.3 })));
  });

  it('drops a line too faint to matter: under half the coverage threshold across', () => {
    // one sample wide at 8x is 1/8 px, under 0.3 / 2
    const l: Line = { cx: 8.06, cy: 8, angle: 90, length: 8, width: 1 / SS - 0.01 };
    expect(ridgeMask(linePass(SIZE, SS, l)).every((v) => v === 0)).toBe(true);
    expect(MIN).toBe(19);
  });
});

describe('downsample setting', () => {
  const s: PostprocessSettings = { coverage: 0.3, thresholds: [0.4, 0.62, 0.86], outline: 'outer' };

  it('is classic when absent', () => {
    for (const seed of [4, 5]) {
      const f = sampleFrame(randomPass(16, 8, seed), 16, 16, 8, STEP);
      expect(shadeFrame(f, { ...s, downsample: 'classic' }).data).toEqual(shadeFrame(f, s).data);
    }
  });

  it('only changes which pixels are drawn, not their colours', () => {
    const l: Line = { cx: 8.4, cy: 8, angle: 70, length: 10, width: 0.6 };
    const f = sampleFrame(linePass(SIZE, SS, l), SIZE, SIZE, SS, STEP);
    const ridge = shadeFrame(f, { ...s, outline: 'none', downsample: 'ridge' }).data;
    const all = shadeFrame(f, { ...s, outline: 'none', coverage: 0 }).data;
    ridge.forEach((v, i) => v && expect(v).toBe(all[i]));
  });
});
