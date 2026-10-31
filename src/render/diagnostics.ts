/**
 * Development diagnostics: the post-processing of one frame laid out stage by stage, from what
 * was gathered (FrameSamples) and, when it was kept, the supersampled pass itself. Nothing here
 * changes what's exported; it only draws and counts.
 */
import { OUTLINE_INDEX, paletteIndex, RAMP_NAMES, type RGB } from './palette';
import { coverageMask, minCovered, NO_RAMP, shadeStages, type Downsample, type FrameSamples, type IndexedFrame, type Outline, type PostprocessSettings, type ShadeStages } from './postprocess';

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

/** Shown where a pixel with some coverage isn't drawn. */
export const DROPPED_RGB: RGB = [255, 40, 160];
/** Shown where ridge-preserving coverage draws a pixel the threshold alone wouldn't. */
export const ADDED_RGB: RGB = [40, 220, 255];

/**
 * How much of each pixel's block is covered, black to white; pixels with some coverage that
 * aren't drawn are tinted DROPPED_RGB, and pixels drawn under the threshold ADDED_RGB, brighter
 * the more they had.
 */
export function coverageToRgba(f: FrameSamples, settings: Pick<PostprocessSettings, 'coverage' | 'downsample'>): Uint8ClampedArray {
  const { data, put } = rgba(f.width * f.height);
  const total = f.ss * f.ss;
  const min = minCovered(f.ss, settings.coverage);
  const drawn = coverageMask(f, settings);
  for (let i = 0; i < f.covered.length; i++) {
    const c = f.covered[i];
    if (c === 0) continue;
    const v = 64 + Math.round((191 * c) / total);
    const tint = !drawn[i] ? DROPPED_RGB : c < min ? ADDED_RGB : null;
    put(i, tint ? tint.map((k) => (k * v) / 255) : [v, v, v]);
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
  /** Pixels with some coverage that weren't drawn. */
  dropped: number;
  /** Drawn pixels whose block had more than one ramp. */
  mixed: number;
  /** Covered samples in drawn pixels that weren't of the pixel's ramp, as a fraction of all of theirs. */
  lostSamples: number;
}

export function frameStats(f: FrameSamples, settings: Pick<PostprocessSettings, 'coverage' | 'downsample'>): FrameStats {
  const drawn = coverageMask(f, settings);
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
    if (!drawn[i]) {
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

export interface Compared {
  name: string;
  downsample: Downsample;
  outline: Outline;
}

/** The sets of configurations the panel compares side by side, on the same rendered frames. */
export const COMPARISONS: Record<'downsample' | 'outline', readonly Compared[]> = {
  /** Ridge-preserving coverage and the colored outline, each against what they're meant to improve. */
  downsample: [
    { name: 'classic + outer', downsample: 'classic', outline: 'outer' },
    { name: 'ridge + outer', downsample: 'ridge', outline: 'outer' },
    { name: 'classic + colored', downsample: 'classic', outline: 'colored' },
    { name: 'ridge + colored', downsample: 'ridge', outline: 'colored' },
  ],
  /** The outer outlines that keep gaps open, against the plain one; all over classic coverage. */
  outline: [
    { name: 'outer', downsample: 'classic', outline: 'outer' },
    { name: 'colored', downsample: 'classic', outline: 'colored' },
    { name: 'stable colored', downsample: 'classic', outline: 'stableColored' },
    { name: 'gap black', downsample: 'classic', outline: 'gapBlack' },
  ],
};

/** The first comparison: downsampling by outline. */
export const COMPARED = COMPARISONS.downsample;

/** What a row of frames (one direction) comes out as with some settings; per frame, averaged over the row. */
export interface RowStats {
  frames: number;
  /** Pixels drawn before the outline. */
  drawn: number;
  /** Pixels with some coverage that weren't drawn. */
  dropped: number;
  /** Drawn pixels one pixel across: with nothing drawn on either side, along a row or a column. */
  thin: number;
  /** Outline pixels: drawn after the outline but not before. */
  outline: number;
  /** Pixels in the outline's pure black. */
  black: number;
  /**
   * Outline pixels with no empty pixel beside them, other than a 1 px line turning a concave
   * corner: filling a gap or a hole rather than edging the sprite.
   */
  filled: number;
  /** Sides of drawn pixels facing an empty pixel before the outline (the silhouette's edge, frame edges aside). */
  edges: number;
  /** Of those, how many the outline left bare: facing a pixel still empty after it. */
  bare: number;
  /** Narrow gaps: empty pixels before the outline with drawn ones 1-2 pixels away on both sides, along a row or column. */
  gaps: number;
  /** Of those, how many are still empty in the end. */
  gapsOpen: number;
  /** Narrow gaps that are only dents: notches one pixel deep, whose two sides join right beside them. */
  dents: number;
  /** Of those, how many are still empty in the end (an outline left ragged there). */
  dentsOpen: number;
  /** Narrow gaps between separate parts: whose two sides don't join within PART_REACH steps through drawn pixels. */
  partGaps: number;
  /** Of those, how many are still empty in the end. */
  partGapsOpen: number;
  /** Final pixels that disappeared since the frame before (wrapping for loops). */
  disappeared: number;
  /** Final pixels that appeared, disappeared or changed colour since the frame before. */
  changed: number;
  /** Outline pixels in both frames whose colour changed since the frame before. */
  outlineRecoloured: number;
}

/** Two sides of a narrow gap belong to separate parts when they don't join within this many steps. */
export const PART_REACH = 12;

/** The pairs of drawn pixels (as indices) across empty (x, y), 1-2 pixels away on both sides along a row or column. */
function gapSides(d: Uint8Array, w: number, h: number, x: number, y: number): [number, number][] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[y * w + x] !== 0;
  const pairs: [number, number][] = [];
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    for (const [b, a] of [[1, 1], [1, 2], [2, 1]]) {
      if (at(x - b * dx, y - b * dy) && at(x + a * dx, y + a * dy)) pairs.push([(y - b * dy) * w + x - b * dx, (y + a * dy) * w + x + a * dx]);
    }
  }
  return pairs;
}

/** Whether drawn pixels a and b join within `limit` steps through drawn pixels, diagonals included. */
function joinedWithin(d: Uint8Array, w: number, h: number, a: number, b: number, limit: number): boolean {
  const dist = new Map([[a, 0]]);
  const queue = [a];
  for (let k = 0; k < queue.length; k++) {
    const p = queue[k];
    if (p === b) return true;
    const n = dist.get(p)!;
    if (n >= limit) continue;
    const [px, py] = [p % w, Math.floor(p / w)];
    for (let qy = Math.max(0, py - 1); qy <= Math.min(h - 1, py + 1); qy++) {
      for (let qx = Math.max(0, px - 1); qx <= Math.min(w - 1, px + 1); qx++) {
        const q = qy * w + qx;
        if (d[q] && !dist.has(q)) {
          dist.set(q, n + 1);
          queue.push(q);
        }
      }
    }
  }
  return false;
}

export function rowStats(frames: FrameSamples[], loop: boolean, settings: PostprocessSettings, glow: readonly number[] = []): RowStats {
  // outlines are counted before dithering hides some of them
  const stages = frames.map((f) => shadeStages(f, settings, glow));
  const st = stageStats(stages, loop);
  let dropped = 0;
  frames.forEach((f, k) => f.covered.forEach((c, i) => c && !stages[k].shaded.data[i] && dropped++));
  st.dropped = dropped / (frames.length || 1);
  return st;
}

/** rowStats from frames already shaded, outlined and finished (`dropped` needs the samples: 0 here). */
export function stageStats(stages: readonly ShadeStages[], loop: boolean): RowStats {
  const st: RowStats = { frames: stages.length, drawn: 0, dropped: 0, thin: 0, outline: 0, black: 0, filled: 0, edges: 0, bare: 0, gaps: 0, gapsOpen: 0, dents: 0, dentsOpen: 0, partGaps: 0, partGapsOpen: 0, disappeared: 0, changed: 0, outlineRecoloured: 0 };
  for (const { shaded, outlined, final } of stages) {
    const { width: w, height: h } = shaded;
    const d = shaded.data;
    const o = outlined.data;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
    const empty = (x: number, y: number) => !inside(x, y) || d[y * w + x] === 0;
    for (let i = 0; i < d.length; i++) {
      const [x, y] = [i % w, Math.floor(i / w)];
      if (d[i]) {
        st.drawn++;
        if ((empty(x - 1, y) && empty(x + 1, y)) || (empty(x, y - 1) && empty(x, y + 1))) st.thin++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!inside(x + dx, y + dy) || d[(y + dy) * w + x + dx]) continue;
          st.edges++;
          if (!o[(y + dy) * w + x + dx]) st.bare++;
        }
      } else {
        if (o[i]) {
          st.outline++;
          if (o[i] === OUTLINE_INDEX) st.black++;
          const clear = (x: number, y: number) => !inside(x, y) || o[y * w + x] === 0;
          // a 1 px line turning a concave corner has the sprite on one side along each axis and itself on the other
          const corner = empty(x - 1, y) !== empty(x + 1, y) && empty(x, y - 1) !== empty(x, y + 1);
          if (!(clear(x - 1, y) || clear(x + 1, y) || clear(x, y - 1) || clear(x, y + 1) || corner)) st.filled++;
        }
        const sides = gapSides(d, w, h, x, y);
        if (sides.length) {
          st.gaps++;
          if (!final.data[i]) st.gapsOpen++;
          // two sides `span` steps apart join in `span` steps only through the pixels beside the gap
          const span = ([a, b]: [number, number]) => Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
          if (sides.some((p) => joinedWithin(d, w, h, p[0], p[1], span(p)))) {
            st.dents++;
            if (!final.data[i]) st.dentsOpen++;
          }
          if (sides.some(([a, b]) => !joinedWithin(d, w, h, a, b, PART_REACH))) {
            st.partGaps++;
            if (!final.data[i]) st.partGapsOpen++;
          }
        }
      }
    }
  }
  const steps = loop ? stages.length : stages.length - 1;
  for (let k = loop ? 0 : 1; k < stages.length && stages.length > 1; k++) {
    const prev = stages[(k + stages.length - 1) % stages.length];
    const cur = stages[k];
    const c = frameDiff(prev.final, cur.final);
    st.disappeared += c.disappeared;
    st.changed += c.appeared + c.disappeared + c.recoloured;
    for (let i = 0; i < cur.outlined.data.length; i++) {
      const [a, b] = [prev.outlined.data[i], cur.outlined.data[i]];
      if (a && b && a !== b && !prev.shaded.data[i] && !cur.shaded.data[i]) st.outlineRecoloured++;
    }
  }
  const n = stages.length || 1;
  for (const k of ['drawn', 'thin', 'outline', 'black', 'filled', 'edges', 'bare', 'gaps', 'gapsOpen', 'dents', 'dentsOpen', 'partGaps', 'partGapsOpen'] as const) st[k] /= n;
  for (const k of ['disappeared', 'changed', 'outlineRecoloured'] as const) st[k] /= Math.max(1, steps);
  return st;
}

/** How well a sprite's edge stands out from a ground: its edge pixels' mean luma difference to it, and the share too close to it to see. */
export interface EdgeContrast {
  /** Final pixels with an empty pixel (or the frame's edge) beside them. */
  edge: number;
  /** Their mean |luma - ground luma|, 0-1. */
  contrast: number;
  /** The share of them within LOST_CONTRAST of the ground. */
  lost: number;
}

/** Edge pixels this close to the ground in luma (0-1) are lost against it. */
export const LOST_CONTRAST = 0.08;

const lumaOf = ([r, g, b]: readonly number[]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

export function edgeContrast(f: IndexedFrame, palette: RGB[], ground: RGB): EdgeContrast {
  const { width: w, height: h, data: d } = f;
  const g = lumaOf(ground);
  const clear = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || d[y * w + x] === 0;
  let edge = 0;
  let sum = 0;
  let lost = 0;
  for (let i = 0; i < d.length; i++) {
    const [x, y] = [i % w, Math.floor(i / w)];
    if (!d[i] || !(clear(x - 1, y) || clear(x + 1, y) || clear(x, y - 1) || clear(x, y + 1))) continue;
    const c = Math.abs(lumaOf(palette[d[i]]) - g);
    edge++;
    sum += c;
    if (c < LOST_CONTRAST) lost++;
  }
  return { edge, contrast: edge ? sum / edge : 0, lost: edge ? lost / edge : 0 };
}
