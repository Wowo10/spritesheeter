import { OUTLINE_INDEX, paletteIndex, RAMP_NAMES, rampIndex, SHADES } from './palette';
import type { PortraitBackground } from './portrait';

/** Sprite frame as palette indices, row-major from the top-left; 0 is transparent. */
export interface IndexedFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

export type Outline = 'none' | 'inner' | 'outer';

const RAMP_COUNT = RAMP_NAMES.length;

export interface PostprocessSettings {
  /** Fraction of a block that must be covered for the output pixel to be opaque. */
  coverage: number;
  /** Light thresholds between shades 0|1, 1|2 and 2|3. */
  thresholds: [number, number, number];
  outline: Outline;
}

/**
 * A frame's supersampled render gathered per output pixel, before it's shaded: enough to shade
 * it again with other outline, coverage or thresholds without rendering it again.
 */
export interface FrameSamples {
  width: number;
  height: number;
  /** Supersampling: each output pixel gathered an ss x ss block. */
  ss: number;
  /** The ramp covering most of each pixel's block, or NO_RAMP. */
  ramp: Uint8Array;
  /** How many samples of each block are covered at all. */
  covered: Uint8Array;
  /** How many samples of each block are in its ramp, and their light summed. */
  count: Uint8Array;
  light: Uint16Array;
  /** Dithered to this opacity once shaded, the pattern shifted sideways by phase. */
  opacity: number;
  phase: number;
}

const NO_RAMP = 255;

/** Supersampling up to which a block's sample counts fit their 8 bits. */
export const MAX_SUPERSAMPLE = 15;

/**
 * Gathers the supersampled sprite pass per output pixel. The buffer is RGBA8 straight from
 * WebGL (bottom row first) of size (w*ss) x (h*ss): ramp id in red, light in green. Each pixel
 * keeps the ramp covering most of its block (the first one seen wins a tie) and the light of
 * just that ramp's samples, so colours never bleed between materials.
 */
export function sampleFrame(buf: Uint8Array, width: number, height: number, ss: number, idStep: number, opacity = 1, phase = 0): FrameSamples {
  if (ss > MAX_SUPERSAMPLE) throw new Error(`sampleFrame: supersample ${ss} is over ${MAX_SUPERSAMPLE}`);
  const srcW = width * ss;
  const n = width * height;
  const f: FrameSamples = {
    width,
    height,
    ss,
    ramp: new Uint8Array(n).fill(NO_RAMP),
    covered: new Uint8Array(n),
    count: new Uint8Array(n),
    light: new Uint16Array(n),
    opacity,
    phase,
  };
  // samples and summed light per ramp in the current block, and which ramps it has
  const counts = new Uint8Array(RAMP_COUNT);
  const lights = new Uint16Array(RAMP_COUNT);
  const seen = new Uint8Array(RAMP_COUNT);

  for (let oy = 0; oy < height; oy++) {
    // WebGL rows start at the bottom
    const sy0 = (height - 1 - oy) * ss;
    for (let ox = 0; ox < width; ox++) {
      let seenCount = 0;
      let covered = 0;
      for (let dy = 0; dy < ss; dy++) {
        let i = ((sy0 + dy) * srcW + ox * ss) * 4;
        for (let dx = 0; dx < ss; dx++, i += 4) {
          if (buf[i + 3] === 0) continue;
          const ramp = Math.round(buf[i] / idStep) - 1;
          if (ramp < 0 || ramp >= RAMP_COUNT) continue;
          covered++;
          if (counts[ramp]++ === 0) seen[seenCount++] = ramp;
          lights[ramp] += buf[i + 1];
        }
      }
      if (seenCount === 0) continue;
      const o = oy * width + ox;
      f.covered[o] = covered;
      // the counters are cleared for the next block as they're read
      for (let k = 0; k < seenCount; k++) {
        const ramp = seen[k];
        if (counts[ramp] > f.count[o]) {
          f.ramp[o] = ramp;
          f.count[o] = counts[ramp];
          f.light[o] = lights[ramp];
        }
        counts[ramp] = 0;
        lights[ramp] = 0;
      }
    }
  }
  return f;
}

/**
 * Shades gathered samples into an indexed frame: a pixel is opaque if enough of its block is
 * covered, and its shade comes from its ramp's average light. Then outlined, then dithered
 * see-through (after the outline, so the edge isn't drawn around every hole); `glow` ramps
 * fade slower, see dither.
 */
export function shadeFrame(f: FrameSamples, settings: PostprocessSettings, glow: readonly number[] = []): IndexedFrame {
  const out = new Uint8Array(f.width * f.height);
  const minCovered = Math.max(1, Math.round(f.ss * f.ss * settings.coverage));
  const [t0, t1, t2] = settings.thresholds;
  for (let i = 0; i < out.length; i++) {
    if (f.ramp[i] === NO_RAMP || f.covered[i] < minCovered) continue;
    const light = f.light[i] / f.count[i] / 255;
    const shade = light < t0 ? 0 : light < t1 ? 1 : light < t2 ? 2 : 3;
    out[i] = paletteIndex(f.ramp[i], shade);
  }
  const frame = { width: f.width, height: f.height, data: out };
  const outlined = settings.outline === 'none' ? frame : outline(frame, settings.outline);
  return dither(outlined, f.opacity, f.phase, glow);
}

/** Downscales the supersampled sprite pass (see sampleFrame) straight into an opaque indexed frame. */
export function downscaleFrame(buf: Uint8Array, width: number, height: number, ss: number, idStep: number, settings: PostprocessSettings): IndexedFrame {
  return shadeFrame(sampleFrame(buf, width, height, ss, idStep), settings);
}

/** Whether pixel (x, y) is opaque; outside the frame counts as transparent. */
function opaqueAt(f: IndexedFrame, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < f.width && y < f.height && f.data[y * f.width + x] !== 0;
}

/** Whether any of the 4 neighbours of (x, y) is opaque (or, with wantOpaque false, transparent). */
function touches(f: IndexedFrame, x: number, y: number, wantOpaque: boolean): boolean {
  return (
    opaqueAt(f, x + 1, y) === wantOpaque ||
    opaqueAt(f, x - 1, y) === wantOpaque ||
    opaqueAt(f, x, y + 1) === wantOpaque ||
    opaqueAt(f, x, y - 1) === wantOpaque
  );
}

/**
 * inner: edge pixels drop to the darkest shade of their own ramp;
 * outer: a 1 px dark line is added around the silhouette.
 */
export function outline(f: IndexedFrame, mode: Exclude<Outline, 'none'>): IndexedFrame {
  const data = new Uint8Array(f.data);
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const i = y * f.width + x;
      const v = f.data[i];
      if (mode === 'inner' && v !== 0 && touches(f, x, y, false)) {
        data[i] = v - ((v - 1) % SHADES);
      } else if (mode === 'outer' && v === 0 && touches(f, x, y, true)) {
        data[i] = OUTLINE_INDEX;
      }
    }
  }
  return { ...f, data };
}

/** 4x4 Bayer matrix: below 16 * opacity a pixel is kept; at 0.5 that's a checkerboard. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Fakes translucency with an ordered dither, dropping pixels until about `opacity` of them are
 * left. `phase` shifts the pattern sideways, so consecutive frames shimmer. Pixels in the
 * `glow` ramps fade half as fast: a 50% ghost keeps solid eyes, and they go last when it fades.
 */
export function dither(f: IndexedFrame, opacity: number, phase: number, glow: readonly number[] = []): IndexedFrame {
  if (opacity >= 1) return f;
  const data = new Uint8Array(f.data);
  // palette indices in the glowing ramps
  const glows = new Uint8Array(256);
  for (const ramp of glow) glows.fill(1, paletteIndex(ramp, 0), paletteIndex(ramp, SHADES));
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const i = y * f.width + x;
      const v = f.data[i];
      if (v === 0) continue;
      const a = glows[v] ? 2 * opacity : opacity;
      if (BAYER4[(y % 4) * 4 + ((x + phase) % 4)] + 0.5 >= 16 * a) data[i] = 0;
    }
  }
  return { ...f, data };
}

export function mirrorFrame(f: IndexedFrame): IndexedFrame {
  const data = new Uint8Array(f.data.length);
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      data[y * f.width + x] = f.data[y * f.width + (f.width - 1 - x)];
    }
  }
  return { ...f, data };
}

/** What fills the transparent pixels of a portrait; the team's darkest shade, so the unit stands out. */
export const PORTRAIT_FILL: Record<PortraitBackground, number> = {
  none: 0,
  dark: paletteIndex(rampIndex('dark'), 1),
  team: paletteIndex(rampIndex('team'), 0),
};
/** The bevel: lit along the top and left, in shadow along the bottom and right. */
export const BEVEL_LIGHT = paletteIndex(rampIndex('steel'), 2);
export const BEVEL_DARK = paletteIndex(rampIndex('steel'), 0);

/** A portrait's background behind the unit, and a 1 px bevel drawn over its edge pixels. */
export function framePortrait(f: IndexedFrame, background: PortraitBackground, border: boolean): IndexedFrame {
  const fill = PORTRAIT_FILL[background];
  const data = f.data.map((v) => v || fill);
  if (border) {
    const { width: w, height: h } = f;
    for (let x = 0; x < w; x++) {
      data[x] = BEVEL_LIGHT;
      data[(h - 1) * w + x] = BEVEL_DARK;
    }
    for (let y = 0; y < h; y++) {
      data[y * w] = BEVEL_LIGHT;
      data[y * w + w - 1] = BEVEL_DARK;
    }
  }
  return { ...f, data };
}
