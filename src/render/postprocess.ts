import { OUTLINE_INDEX, paletteIndex, SHADES } from './palette';

/** Sprite frame as palette indices, row-major from the top-left; 0 is transparent. */
export interface IndexedFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

export type Outline = 'none' | 'inner' | 'outer';

export interface PostprocessSettings {
  /** Fraction of a block that must be covered for the output pixel to be opaque. */
  coverage: number;
  /** Light thresholds between shades 0|1, 1|2 and 2|3. */
  thresholds: [number, number, number];
  outline: Outline;
}

/**
 * Downscales the supersampled ID and light passes into one indexed frame.
 * Both buffers are RGBA8 straight from WebGL (bottom row first) of size (w*ss) x (h*ss).
 * Each output pixel takes the ramp covering most of its block, and its shade from the
 * average light of just that ramp's samples, so colours never bleed between materials.
 */
export function downscaleFrame(
  idBuf: Uint8Array,
  lightBuf: Uint8Array,
  width: number,
  height: number,
  ss: number,
  idStep: number,
  settings: PostprocessSettings,
): IndexedFrame {
  const srcW = width * ss;
  const out = new Uint8Array(width * height);
  const counts = new Map<number, { n: number; light: number }>();
  const minCovered = Math.max(1, Math.round(ss * ss * settings.coverage));
  const [t0, t1, t2] = settings.thresholds;

  for (let oy = 0; oy < height; oy++) {
    // WebGL rows start at the bottom
    const sy0 = (height - 1 - oy) * ss;
    for (let ox = 0; ox < width; ox++) {
      counts.clear();
      let covered = 0;
      for (let dy = 0; dy < ss; dy++) {
        let i = ((sy0 + dy) * srcW + ox * ss) * 4;
        for (let dx = 0; dx < ss; dx++, i += 4) {
          if (idBuf[i + 3] === 0) continue;
          const ramp = Math.round(idBuf[i] / idStep) - 1;
          if (ramp < 0) continue;
          covered++;
          const c = counts.get(ramp);
          if (c) {
            c.n++;
            c.light += lightBuf[i];
          } else counts.set(ramp, { n: 1, light: lightBuf[i] });
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
      const shade = light < t0 ? 0 : light < t1 ? 1 : light < t2 ? 2 : 3;
      out[oy * width + ox] = paletteIndex(best, shade);
    }
  }

  const frame = { width, height, data: out };
  return settings.outline === 'none' ? frame : outline(frame, settings.outline);
}

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function touches(f: IndexedFrame, x: number, y: number, wantOpaque: boolean): boolean {
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    const opaque = nx >= 0 && ny >= 0 && nx < f.width && ny < f.height && f.data[ny * f.width + nx] !== 0;
    if (opaque === wantOpaque) return true;
  }
  return false;
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
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const i = y * f.width + x;
      const v = f.data[i];
      if (v === 0) continue;
      const a = glow.includes(Math.floor((v - 1) / SHADES)) ? 2 * opacity : opacity;
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
