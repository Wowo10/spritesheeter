/**
 * Development diagnostics: the post-processing of one frame laid out stage by stage, from what
 * was gathered (FrameSamples) and, when it was kept, the supersampled pass itself. Nothing here
 * changes what's exported; it only draws and counts.
 */
import { paletteIndex, RAMP_NAMES, type RGB } from './palette';
import { minCovered, NO_RAMP, type FrameSamples, type IndexedFrame, type PostprocessSettings } from './postprocess';

const RAMP_COUNT = RAMP_NAMES.length;

/** A supersampled sprite pass, top row first: per sample its ramp (or NO_RAMP) and light. */
export interface RawFrame {
  width: number;
  height: number;
  ramp: Uint8Array;
  light: Uint8Array;
}

/**
 * Keeps a supersampled pass (see sampleFrame) as a RawFrame: half the size of the WebGL buffer,
 * and decoded the same way sampleFrame decodes it.
 */
export function compactRaw(buf: Uint8Array, width: number, height: number, ss: number, idStep: number): RawFrame {
  const w = width * ss;
  const h = height * ss;
  const raw: RawFrame = { width: w, height: h, ramp: new Uint8Array(w * h).fill(NO_RAMP), light: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) {
    // WebGL rows start at the bottom
    let i = (h - 1 - y) * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      if (buf[i + 3] === 0) continue;
      const ramp = Math.round(buf[i] / idStep) - 1;
      if (ramp < 0 || ramp >= RAMP_COUNT) continue;
      raw.ramp[y * w + x] = ramp;
      raw.light[y * w + x] = buf[i + 1];
    }
  }
  return raw;
}

const shadeOf = (light: number, [t0, t1, t2]: readonly number[]) => (light < t0 ? 0 : light < t1 ? 1 : light < t2 ? 2 : 3);

function rgba(n: number): { data: Uint8ClampedArray; put: (i: number, c: readonly number[], a?: number) => void } {
  const data = new Uint8ClampedArray(n * 4);
  return {
    data,
    put: (i, c, a = 255) => {
      data[i * 4] = c[0];
      data[i * 4 + 1] = c[1];
      data[i * 4 + 2] = c[2];
      data[i * 4 + 3] = a;
    },
  };
}

/** The supersampled pass, each sample posterised to its ramp's shade, as the 3D preview draws it. */
export function rawToRgba(raw: RawFrame, thresholds: readonly number[], palette: RGB[]): Uint8ClampedArray {
  const { data, put } = rgba(raw.ramp.length);
  for (let i = 0; i < raw.ramp.length; i++) {
    if (raw.ramp[i] !== NO_RAMP) put(i, palette[paletteIndex(raw.ramp[i], shadeOf(raw.light[i] / 255, thresholds))]);
  }
  return data;
}

/** Shown where coverage is too low for a pixel: covered, but dropped. */
export const DROPPED_RGB: RGB = [255, 40, 160];

/**
 * How much of each pixel's block is covered, black to white; pixels with some coverage that
 * the coverage setting drops are tinted DROPPED_RGB, brighter the more they had.
 */
export function coverageToRgba(f: FrameSamples, coverage: number): Uint8ClampedArray {
  const { data, put } = rgba(f.width * f.height);
  const total = f.ss * f.ss;
  const min = minCovered(f.ss, coverage);
  for (let i = 0; i < f.covered.length; i++) {
    const c = f.covered[i];
    if (c === 0) continue;
    const v = 64 + Math.round((191 * c) / total);
    put(i, c < min ? DROPPED_RGB.map((k) => (k * v) / 255) : [v, v, v]);
  }
  return data;
}

/** The ramp each pixel kept, in that ramp's second-lightest shade, whether or not the pixel is drawn. */
export function rampToRgba(f: FrameSamples, palette: RGB[]): Uint8ClampedArray {
  const { data, put } = rgba(f.width * f.height);
  for (let i = 0; i < f.ramp.length; i++) if (f.ramp[i] !== NO_RAMP) put(i, palette[paletteIndex(f.ramp[i], 2)]);
  return data;
}

/**
 * How much of each pixel's covered samples its ramp has: white where the block is all one ramp,
 * shading to orange as more of it belonged to the ramps that lost (whose colour and light are dropped).
 */
export function purityToRgba(f: FrameSamples): Uint8ClampedArray {
  const { data, put } = rgba(f.width * f.height);
  for (let i = 0; i < f.ramp.length; i++) {
    if (f.covered[i] === 0) continue;
    const p = f.count[i] / f.covered[i];
    put(i, [255, Math.round(120 + 135 * p), Math.round(255 * p * p)]);
  }
  return data;
}

/** Shown where a pixel appeared, disappeared, or changed colour since the frame before. */
export const APPEARED_RGB: RGB = [80, 230, 80];
export const DISAPPEARED_RGB: RGB = [240, 60, 60];
export const RECOLOURED_RGB: RGB = [250, 210, 60];

/** What changed from `prev` to `cur` (both final frames), over `cur` faded to grey. */
export function diffToRgba(cur: IndexedFrame, prev: IndexedFrame, palette: RGB[]): Uint8ClampedArray {
  const { data, put } = rgba(cur.data.length);
  for (let i = 0; i < cur.data.length; i++) {
    const a = prev.data[i];
    const b = cur.data[i];
    if (a === b) {
      if (b) {
        const [r, g, bl] = palette[b];
        const v = Math.round((r + g + bl) / 6);
        put(i, [v, v, v]);
      }
    } else put(i, a === 0 ? APPEARED_RGB : b === 0 ? DISAPPEARED_RGB : RECOLOURED_RGB);
  }
  return data;
}

export interface FrameStats {
  /** Pixels with any coverage. */
  touched: number;
  /** Pixels drawn before the outline. */
  opaque: number;
  /** Pixels with some coverage that the coverage setting dropped. */
  dropped: number;
  /** Drawn pixels whose block had more than one ramp. */
  mixed: number;
  /** Covered samples in drawn pixels that weren't of the pixel's ramp, as a fraction of all of theirs. */
  lostSamples: number;
}

export function frameStats(f: FrameSamples, settings: Pick<PostprocessSettings, 'coverage'>): FrameStats {
  const min = minCovered(f.ss, settings.coverage);
  let touched = 0;
  let opaque = 0;
  let dropped = 0;
  let mixed = 0;
  let covered = 0;
  let lost = 0;
  for (let i = 0; i < f.covered.length; i++) {
    const c = f.covered[i];
    if (c === 0) continue;
    touched++;
    if (c < min) {
      dropped++;
      continue;
    }
    opaque++;
    covered += c;
    lost += c - f.count[i];
    if (f.count[i] < c) mixed++;
  }
  return { touched, opaque, dropped, mixed, lostSamples: covered ? lost / covered : 0 };
}

export interface FrameDiff {
  appeared: number;
  disappeared: number;
  recoloured: number;
}

/** Pixels that changed between two frames of the same size. */
export function frameDiff(prev: IndexedFrame, cur: IndexedFrame): FrameDiff {
  const d: FrameDiff = { appeared: 0, disappeared: 0, recoloured: 0 };
  for (let i = 0; i < cur.data.length; i++) {
    const a = prev.data[i];
    const b = cur.data[i];
    if (a === b) continue;
    if (a === 0) d.appeared++;
    else if (b === 0) d.disappeared++;
    else d.recoloured++;
  }
  return d;
}
