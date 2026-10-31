import { describe, expect, it } from 'vitest';
import { OUTLINE_INDEX, paletteIndex, rampIndex, TEAM_INDICES } from '../src/render/palette';
import {
  BEVEL_DARK,
  BEVEL_LIGHT,
  dither,
  downscaleFrame,
  framePortrait,
  minCovered,
  mirrorFrame,
  outline,
  PORTRAIT_FILL,
  sampleFrame,
  shadeFrame,
  shadePixels,
  shadeStages,
  type IndexedFrame,
  type PostprocessSettings,
} from '../src/render/postprocess';
import { art, barPass, frameOf, pass, ramps, randomPass, shades, STEP } from './passes';

/** The first, straightforward downscale, kept to check faster ones against. */
function referenceDownscale(buf: Uint8Array, width: number, height: number, ss: number, settings: PostprocessSettings): IndexedFrame {
  const srcW = width * ss;
  const out = new Uint8Array(width * height);
  const counts = new Map<number, { n: number; light: number }>();
  const minCovered = Math.max(1, Math.round(ss * ss * settings.coverage));
  const [t0, t1, t2] = settings.thresholds;
  for (let oy = 0; oy < height; oy++) {
    const sy0 = (height - 1 - oy) * ss;
    for (let ox = 0; ox < width; ox++) {
      counts.clear();
      let covered = 0;
      for (let dy = 0; dy < ss; dy++) {
        let i = ((sy0 + dy) * srcW + ox * ss) * 4;
        for (let dx = 0; dx < ss; dx++, i += 4) {
          if (buf[i + 3] === 0) continue;
          const ramp = Math.round(buf[i] / STEP) - 1;
          if (ramp < 0) continue;
          covered++;
          const c = counts.get(ramp);
          if (c) {
            c.n++;
            c.light += buf[i + 1];
          } else counts.set(ramp, { n: 1, light: buf[i + 1] });
        }
      }
      if (covered < minCovered) continue;
      let best = -1;
      let bestN = 0;
      let bestLight = 0;
      for (const [ramp, c] of counts) {
        if (c.n > bestN) {
          best = ramp;
          bestN = c.n;
          bestLight = c.light;
        }
      }
      const light = bestLight / bestN / 255;
      out[oy * width + ox] = paletteIndex(best, light < t0 ? 0 : light < t1 ? 1 : light < t2 ? 2 : 3);
    }
  }
  const frame = { width, height, data: out };
  return settings.outline === 'none' ? frame : outline(frame, settings.outline);
}

const settings = { coverage: 0.5, thresholds: [0.25, 0.5, 0.75] as [number, number, number], outline: 'none' as const };

describe('downscaleFrame', () => {
  it('picks the majority ramp, shades from that ramp only, and flips rows', () => {
    // 2x1 output, supersample 2 -> 4x2 samples
    const buf = pass([
      [[3, 0.9], [3, 0.9], null, null],
      [[3, 0.9], [5, 0.1], null, [2, 0.6]],
    ]);
    const f = downscaleFrame(buf, 2, 1, 2, STEP, settings);
    expect(f.data[0]).toBe(paletteIndex(3, 3));
    // right block is only 25% covered
    expect(f.data[1]).toBe(0);
  });

  it('maps light to shades by threshold', () => {
    const shades = [0.1, 0.3, 0.6, 0.9].map((l) => {
      return downscaleFrame(pass([[[1, l]]]), 1, 1, 1, STEP, settings).data[0];
    });
    expect(shades).toEqual([0, 1, 2, 3].map((s) => paletteIndex(1, s)));
  });

  it('puts the top sample row at the top of the frame', () => {
    const f = downscaleFrame(pass([[[4, 0.9]], [null]]), 1, 2, 1, STEP, settings);
    expect(Array.from(f.data)).toEqual([paletteIndex(4, 3), 0]);
  });

  it('matches the reference downscale on noisy frames, for every outline and supersample', () => {
    for (const ss of [1, 4, 8, 12]) {
      for (const outlineMode of ['none', 'inner', 'outer'] as const) {
        for (const coverage of [0.1, 0.3, 0.9]) {
          const buf = randomPass(16, ss, ss * 100 + coverage * 10);
          const s = { coverage, thresholds: [0.3, 0.55, 0.8] as [number, number, number], outline: outlineMode };
          expect(Array.from(downscaleFrame(buf, 16, 16, ss, STEP, s).data)).toEqual(Array.from(referenceDownscale(buf, 16, 16, ss, s).data));
        }
      }
    }
  });
});

describe('sampleFrame & shadeFrame', () => {
  it('shades one render with any settings as if it were rendered again with them', () => {
    const buf = randomPass(16, 8, 5);
    const samples = sampleFrame(buf, 16, 16, 8, STEP);
    const variants: PostprocessSettings[] = [
      { coverage: 0.3, thresholds: [0.4, 0.62, 0.86], outline: 'inner' },
      { coverage: 0.8, thresholds: [0.2, 0.5, 0.7], outline: 'outer' },
      { coverage: 0.1, thresholds: [0.3, 0.55, 0.8], outline: 'none' },
    ];
    // twice over, so shading mustn't change the samples
    for (const s of [...variants, ...variants]) {
      expect(Array.from(shadeFrame(samples, s).data)).toEqual(Array.from(referenceDownscale(buf, 16, 16, 8, s).data));
    }
  });

  it('dithers by the opacity and phase it was rendered with, after the outline', () => {
    const buf = randomPass(16, 4, 9);
    const s: PostprocessSettings = { coverage: 0.3, thresholds: [0.4, 0.62, 0.86], outline: 'outer' };
    const glow = [3];
    const shaded = shadeFrame(sampleFrame(buf, 16, 16, 4, STEP, 0.5, 3), s, glow);
    expect(Array.from(shaded.data)).toEqual(Array.from(dither(referenceDownscale(buf, 16, 16, 4, s), 0.5, 3, glow).data));
  });

  it('refuses supersampling too fine for its counters', () => {
    expect(() => sampleFrame(new Uint8Array(16 * 16 * 4), 1, 1, 16, STEP)).toThrow();
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

describe('framePortrait', () => {
  const lit = paletteIndex(2, 3);
  // 4x4, the unit in the middle 2x2
  const frame: IndexedFrame = { width: 4, height: 4, data: new Uint8Array(16) };
  [5, 6, 9, 10].forEach((i) => (frame.data[i] = lit));

  it('fills only the transparent pixels', () => {
    const d = framePortrait(frame, 'dark', false).data;
    expect([d[5], d[6], d[9], d[10]]).toEqual(Array(4).fill(lit));
    expect([d[0], d[3], d[12], d[15]]).toEqual(Array(4).fill(PORTRAIT_FILL.dark));
  });

  it('leaves a transparent background with none, and fills the team background with a team shade', () => {
    expect(Array.from(framePortrait(frame, 'none', false).data)).toEqual(Array.from(frame.data));
    expect(TEAM_INDICES).toContain(framePortrait(frame, 'team', false).data[0]);
  });

  it('bevels the edge: light top and left, dark bottom and right', () => {
    const d = framePortrait(frame, 'none', true).data;
    expect([d[1], d[2], d[4], d[8]]).toEqual(Array(4).fill(BEVEL_LIGHT));
    expect([d[13], d[14], d[7], d[11]]).toEqual(Array(4).fill(BEVEL_DARK));
    expect(d[5]).toBe(lit);
  });

  it('leaves the frame it was given alone', () => {
    framePortrait(frame, 'dark', true);
    expect(frame.data[0]).toBe(0);
  });
});

describe('shadeStages', () => {
  const buf = randomPass(16, 4, 21);
  const s: PostprocessSettings = { coverage: 0.3, thresholds: [0.4, 0.62, 0.86], outline: 'outer' };

  it('ends in what shadeFrame makes, for every outline', () => {
    const f = sampleFrame(buf, 16, 16, 4, STEP, 0.5, 1);
    for (const o of ['none', 'inner', 'outer'] as const) {
      expect(shadeStages(f, { ...s, outline: o }, [2]).final.data).toEqual(shadeFrame(f, { ...s, outline: o }, [2]).data);
    }
  });

  it('shades, then outlines, then dithers', () => {
    const f = sampleFrame(buf, 16, 16, 4, STEP, 0.5, 1);
    const st = shadeStages(f, s);
    expect(st.shaded.data).toEqual(shadePixels(f, s).data);
    expect(st.outlined.data).toEqual(outline(st.shaded, 'outer').data);
    expect(st.final.data).toEqual(dither(st.outlined, 0.5, 1).data);
  });

  it('passes a frame on through a step with nothing to do', () => {
    const st = shadeStages(sampleFrame(buf, 16, 16, 4, STEP), { ...s, outline: 'none' });
    expect(st.outlined).toBe(st.shaded);
    expect(st.final).toBe(st.outlined);
  });
});

/** FNV-1a of a frame's pixels: enough to tell whether a frame came out exactly the same. */
function fnv1a(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const v of data) h = Math.imul(h ^ v, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

describe('outer outline (the baseline to keep)', () => {
  // [size, supersample, seed, opacity, phase, hash], from the pipeline as it was before any
  // quality work; a change here changes what sheets with the outer outline look like
  const GOLDEN: [number, number, number, number, number, string][] = [
    [16, 4, 1, 1, 0, '664f9a35'],
    [16, 8, 2, 1, 0, '88d11743'],
    [32, 8, 3, 1, 0, 'a916e9de'],
    [32, 12, 4, 1, 0, 'bc93f3ff'],
    [32, 8, 5, 0.5, 2, 'b6fe5376'],
    [24, 8, 6, 0.25, 1, '70a568e8'],
  ];
  it.each(GOLDEN)('shades a %ipx frame at %ix (seed %i, opacity %f, phase %i) exactly as before', (size, ss, seed, opacity, phase, hash) => {
    const s: PostprocessSettings = { coverage: 0.3, thresholds: [0.4, 0.62, 0.86], outline: 'outer' };
    expect(fnv1a(shadeFrame(sampleFrame(randomPass(size, ss, seed), size, size, ss, STEP, opacity, phase), s, [3]).data)).toBe(hash);
  });

  const square = ['......', '......', '..AA..', '..AA..', '......', '......'];

  it('rings a part through its 4 neighbours, leaving the corners open', () => {
    expect(ramps(outline(frameOf(square), 'outer'))).toEqual(['......', '..##..', '.#AA#.', '.#AA#.', '..##..', '......']);
  });

  it('thickens a diagonal line into a staircase, and draws nothing past the frame edge', () => {
    expect(ramps(outline(frameOf(['A...', '.A..', '..A.', '...A']), 'outer'))).toEqual(['A#..', '#A#.', '.#A#', '..#A']);
  });

  it('fills a 1 px gap between two parts', () => {
    expect(ramps(outline(frameOf(['A.A', 'A.A']), 'outer'))).toEqual(['A#A', 'A#A']);
  });

  it('is the same dark around every ramp, the team ramp too', () => {
    expect(rampIndex('team')).toBe(0);
    const d = outline(frameOf(['.A.']), 'outer').data;
    expect([d[0], d[2]]).toEqual([OUTLINE_INDEX, OUTLINE_INDEX]);
    expect(TEAM_INDICES).not.toContain(OUTLINE_INDEX);
  });

  it('turns one pixel of change in the silhouette into three changed pixels', () => {
    const a = outline(frameOf(square), 'outer');
    const b = outline(frameOf(['......', '......', '..AAA.', '..AA..', '......', '......']), 'outer');
    expect(a.data.filter((v, i) => v !== b.data[i]).length).toBe(3);
  });

  it('is dithered along with the sprite, so a see-through unit has gaps in its outline', () => {
    const f = outline(frameOf(['....', '.AA.', '.AA.', '....']), 'outer');
    const count = (g: IndexedFrame) => g.data.filter((v) => v === OUTLINE_INDEX).length;
    expect(count(dither(f, 0.5, 0))).toBeLessThan(count(f));
  });
});

describe('inner outline', () => {
  it('keeps its own shade only where a part is 3 px or more across', () => {
    expect(shades(outline(frameOf(['.....', '.AAA.', '.AAA.', '.AAA.', '.....']), 'inner'))).toEqual(['.....', '.000.', '.030.', '.000.', '.....']);
  });

  it('leaves nothing of a 2 px wide part but its darkest shade', () => {
    expect(shades(outline(frameOf(['.AA.', '.AA.', '.AA.']), 'inner'))).toEqual(['.00.', '.00.', '.00.']);
  });
});

describe('coverage threshold', () => {
  it('needs round(ss² × coverage) covered samples, never fewer than one', () => {
    expect(minCovered(8, 0.3)).toBe(19);
    expect(minCovered(8, 0.9)).toBe(58);
    expect(minCovered(4, 0.5)).toBe(8);
    expect(minCovered(8, 0)).toBe(1);
  });

  it('drops a block one sample short of it', () => {
    // the first n samples of an 8x8 block, in reading order
    const block = (n: number) => pass(Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (y * 8 + x < n ? ([2, 0.9] as [number, number]) : null))));
    const s = { ...settings, coverage: 0.3 };
    expect(downscaleFrame(block(18), 1, 1, 8, STEP, s).data[0]).toBe(0);
    expect(downscaleFrame(block(19), 1, 1, 8, STEP, s).data[0]).toBe(paletteIndex(2, 3));
  });

  it('counts every ramp toward coverage, but colours and lights the pixel from the largest alone', () => {
    // coverage 0.5 of 4x4 is 8 samples: 5 lit A and 4 dark B, neither enough alone
    const f = downscaleFrame(art(['AAAA', 'Abbb', 'b...', '....']), 1, 1, 4, STEP, settings);
    expect(f.data[0]).toBe(paletteIndex(0, 3));
  });
});

describe('dominant ramp', () => {
  it('breaks ties toward the samples read first: the bottom row of the block, then the left', () => {
    expect(ramps(downscaleFrame(art(['AA', 'BB']), 1, 1, 2, STEP, settings))).toEqual(['B']);
    expect(ramps(downscaleFrame(art(['AB', 'AB']), 1, 1, 2, STEP, settings))).toEqual(['A']);
  });

  it('so a west-facing render could differ from the mirrored east-facing one it is drawn as', () => {
    expect(ramps(mirrorFrame(downscaleFrame(art(['AB', 'AB']), 1, 1, 2, STEP, settings)))).toEqual(['A']);
    expect(ramps(downscaleFrame(art(['BA', 'BA']), 1, 1, 2, STEP, settings))).toEqual(['B']);
  });

  it('loses a thin line of another ramp that never has the most of a block', () => {
    // a one-sample line of B down the second column of every 4x4 block
    const f = downscaleFrame(art(Array(4).fill('ABAA'.repeat(4))), 4, 1, 4, STEP, settings);
    expect(ramps(f)).toEqual(['AAAA']);
  });
});

describe('known limitations: thin parts and sub-pixel motion', () => {
  // A bar's drawn width in pixels at each of the 8 sub-pixel offsets of 8x supersampling: what
  // a part that slides by less than a pixel from frame to frame comes out as. These record the
  // current behaviour, which better downsampling is meant to change.
  const widths = (widthSamples: number, coverage: number) =>
    Array.from({ length: 8 }, (_, off) => downscaleFrame(barPass(6, 8, 16 + off, widthSamples), 6, 1, 8, STEP, { ...settings, coverage }).data.filter((v) => v !== 0).length);

  it('draws a 1 px bar 1 or 2 px wide depending on where it falls between pixels', () => {
    expect(widths(8, 0.3)).toEqual([1, 1, 1, 2, 2, 2, 1, 1]);
  });

  it('drops a bar half a pixel wide or less at some offsets, so it blinks as it moves', () => {
    expect(widths(3, 0.3)).toEqual([1, 1, 1, 1, 1, 1, 0, 0]);
    expect(widths(4, 0.5)).toEqual([1, 1, 1, 1, 1, 0, 0, 0]);
  });
});

describe('dither', () => {
  const solid = frameOf(Array(4).fill('BBBB'));

  it('leaves a solid sprite alone', () => {
    expect(dither(solid, 1, 0)).toBe(solid);
  });

  it('makes a checkerboard at half opacity, shifted a pixel per phase', () => {
    expect(ramps(dither(solid, 0.5, 0))).toEqual(['B.B.', '.B.B', 'B.B.', '.B.B']);
    expect(ramps(dither(solid, 0.5, 1))).toEqual(['.B.B', 'B.B.', '.B.B', 'B.B.']);
  });

  it('repeats every 4 phases, so a loop of other than 4 frames shimmers unevenly where it wraps', () => {
    expect(dither(solid, 0.3, 4).data).toEqual(dither(solid, 0.3, 0).data);
  });

  it('keeps glowing ramps solid at half opacity', () => {
    expect(ramps(dither(solid, 0.5, 0, [1]))).toEqual(Array(4).fill('BBBB'));
  });
});
