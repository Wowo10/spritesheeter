import { describe, expect, it } from 'vitest';
import { OUTLINE_INDEX, paletteIndex, RAMP_NAMES, TEAM_INDICES } from '../src/render/palette';
import { BEVEL_DARK, BEVEL_LIGHT, dither, downscaleFrame, framePortrait, mirrorFrame, outline, PORTRAIT_FILL, sampleFrame, shadeFrame, type IndexedFrame, type PostprocessSettings } from '../src/render/postprocess';
import { mulberry32 } from '../src/rng';

const STEP = 8;

/** Builds a WebGL-style (bottom row first) sprite pass from top-down per-sample descriptions. */
function pass(rows: ([ramp: number, light: number] | null)[][]): Uint8Array {
  const h = rows.length;
  const w = rows[0].length;
  const buf = new Uint8Array(w * h * 4);
  rows.forEach((row, y) =>
    row.forEach((s, x) => {
      if (s) buf.set([(s[0] + 1) * STEP, Math.round(s[1] * 255), 0, 255], ((h - 1 - y) * w + x) * 4);
    }),
  );
  return buf;
}

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

/** A noisy blob of a few ramps in patches, with gradients of light and ragged, part-covered edges. */
function randomPass(size: number, ss: number, seed: number): Uint8Array {
  const rng = mulberry32(seed);
  const n = size * ss;
  const buf = new Uint8Array(n * n * 4);
  const ramps = Array.from({ length: 5 }, () => Math.floor(rng() * RAMP_NAMES.length));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x - n / 2;
      const dy = y - n / 2;
      if (Math.hypot(dx, dy) > n * (0.3 + 0.1 * rng())) continue;
      const ramp = ramps[(Math.floor(x / (ss * 1.5)) + Math.floor(y / ss) + (rng() < 0.2 ? 1 : 0)) % ramps.length];
      buf.set([(ramp + 1) * STEP, Math.floor((x / n) * 200 + rng() * 55), 0, 255], (y * n + x) * 4);
    }
  }
  return buf;
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
