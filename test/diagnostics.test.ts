import { describe, expect, it } from 'vitest';
import {
  ADDED_RGB,
  APPEARED_RGB,
  COMPARED,
  COMPARISONS,
  compactRaw,
  coverageToRgba,
  diffToRgba,
  DISAPPEARED_RGB,
  edgeContrast,
  frameDiff,
  frameStats,
  LOST_CONTRAST,
  purityToRgba,
  rampToRgba,
  rawToRgba,
  RECOLOURED_RGB,
  rowStats,
} from '../src/render/diagnostics';
import { OUTLINE_INDEX, PALETTE, paletteIndex } from '../src/render/palette';
import { NO_RAMP, sampleFrame, type PostprocessSettings } from '../src/render/postprocess';
import { DEFAULT_SPRITE_SETTINGS } from '../src/render/spriteRenderer';
import { art, frameOf, linePass, randomPass, STEP } from './passes';

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
    const data = coverageToRgba(f, { coverage: 0.5 });
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

describe('comparing configurations', () => {
  const s: PostprocessSettings = { coverage: 0.3, thresholds: [0.25, 0.5, 0.75], outline: 'outer' };

  it('compares the original downsampling and outer outline with the ridge and colored ones, in all four pairings', () => {
    expect(COMPARED.map((c) => `${c.downsample} ${c.outline}`)).toEqual(['classic outer', 'ridge outer', 'classic colored', 'ridge colored']);
  });

  it('compares the outer outlines that keep gaps open with the plain one, over classic coverage', () => {
    expect(COMPARED).toBe(COMPARISONS.downsample);
    expect(COMPARISONS.outline.map((c) => `${c.downsample} ${c.outline}`)).toEqual(['classic outer', 'classic colored', 'classic stableColored', 'classic gapBlack']);
  });

  it('defaults to Ridge + Gap Black, pinholes filled', () => {
    expect(DEFAULT_SPRITE_SETTINGS.outline).toBe('gapBlack');
    expect(DEFAULT_SPRITE_SETTINGS.downsample).toBe('ridge');
    expect(DEFAULT_SPRITE_SETTINGS.pinholes).toBe('fill');
  });

  it('counts drawn, thin and outline pixels, and the narrow gaps each outline leaves open', () => {
    // two 1 px wide bars 1 px apart, as tall as the frame, at 1x: outlined left, right and between
    const two = sampleFrame(art(['.A.A.', '.A.A.', '.A.A.', '.A.A.']), 5, 4, 1, STEP);
    const outer = rowStats([two], false, s);
    expect(outer).toMatchObject({ frames: 1, drawn: 8, thin: 8, gaps: 4, gapsOpen: 0, outline: 12, black: 12 });
    const colored = rowStats([two], false, { ...s, outline: 'colored' });
    expect(colored).toMatchObject({ gaps: 4, gapsOpen: 4, outline: 8 });
    expect(colored.black).toBeLessThan(colored.outline);
  });

  it('counts the gaps between separate parts, edges left bare, and outline filling a gap', () => {
    const two = sampleFrame(art(['.A.A.', '.A.A.', '.A.A.', '.A.A.']), 5, 4, 1, STEP);
    // the middle column is shut in by outline above and below in its two middle rows
    expect(rowStats([two], false, s)).toMatchObject({ partGaps: 4, partGapsOpen: 0, dents: 0, edges: 16, bare: 0, filled: 2 });
    for (const outline of ['colored', 'stableColored', 'gapBlack'] as const) {
      expect(rowStats([two], false, { ...s, outline })).toMatchObject({ partGaps: 4, partGapsOpen: 4, edges: 16, bare: 8, filled: 0 });
    }
  });

  it('counts dents, one-pixel notches, apart from gaps between parts', () => {
    const notch = sampleFrame(art(['.....', '.A.A.', '.AAA.', '.....']), 5, 4, 1, STEP);
    expect(rowStats([notch], false, s)).toMatchObject({ gaps: 1, dents: 1, dentsOpen: 0, partGaps: 0 });
    expect(rowStats([notch], false, { ...s, outline: 'colored' })).toMatchObject({ dents: 1, dentsOpen: 1 });
    expect(rowStats([notch], false, { ...s, outline: 'gapBlack' })).toMatchObject({ dents: 1, dentsOpen: 0 });
  });

  it('counts outline pixels that change colour as the light on the part beside them does', () => {
    // a 2 x 2 part, lit then in shadow
    const lit = sampleFrame(art(['....', '.AA.', '.AA.', '....']), 4, 4, 1, STEP);
    const dark = sampleFrame(art(['....', '.aa.', '.aa.', '....']), 4, 4, 1, STEP);
    expect(rowStats([lit, dark], false, { ...s, outline: 'colored' }).outlineRecoloured).toBe(8);
    for (const outline of ['outer', 'stableColored', 'gapBlack'] as const) expect(rowStats([lit, dark], false, { ...s, outline }).outlineRecoloured).toBe(0);
  });

  it("measures how far a sprite's edge stands out from the ground", () => {
    const f = { width: 3, height: 3, data: Uint8Array.from([0, 0, 0, 0, OUTLINE_INDEX, 0, 0, 0, 0]) };
    expect(edgeContrast(f, PALETTE, [255, 255, 255])).toEqual({ edge: 1, contrast: 1, lost: 0 });
    expect(edgeContrast(f, PALETTE, [10, 10, 10])).toMatchObject({ edge: 1, lost: 1 });
    expect(10 / 255).toBeLessThan(LOST_CONTRAST);
  });

  it('counts what changes from frame to frame, wrapping for loops', () => {
    const a = sampleFrame(art(['A..']), 3, 1, 1, STEP);
    const b = sampleFrame(art(['.A.']), 3, 1, 1, STEP);
    const none = { ...s, outline: 'none' as const };
    expect(rowStats([a, b], false, none)).toMatchObject({ disappeared: 1, changed: 2 });
    expect(rowStats([a, b], true, none)).toMatchObject({ disappeared: 1, changed: 2 });
    expect(rowStats([a, a], true, none)).toMatchObject({ disappeared: 0, changed: 0 });
  });

  it('tints pixels ridge-preserving coverage draws under the threshold', () => {
    const f = sampleFrame(linePass(16, 8, { cx: 8.5, cy: 8, angle: 90, length: 8, width: 0.25 }), 16, 16, 8, STEP);
    const data = coverageToRgba(f, { coverage: 0.3, downsample: 'ridge' });
    const added = Array.from({ length: 256 }, (_, i) => pixel(data, i)).filter(([r, g, b, a]) => a && b > r && g > r);
    expect(added.length).toBeGreaterThan(0);
    expect(ADDED_RGB[2]).toBeGreaterThan(ADDED_RGB[0]);
  });
});
