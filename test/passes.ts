import { OUTLINE_INDEX, RAMP_NAMES, SHADES } from '../src/render/palette';
import type { IndexedFrame } from '../src/render/postprocess';
import { mulberry32 } from '../src/rng';

/** Ramp id step of the sprite passes built here. */
export const STEP = 8;

/** Builds a WebGL-style (bottom row first) sprite pass from top-down per-sample descriptions. */
export function pass(rows: ([ramp: number, light: number] | null)[][]): Uint8Array {
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

/**
 * A sprite pass drawn as text, one character per sample, top row first: '.' is empty, a letter
 * is a ramp (A = ramp 0, B = ramp 1, ...), lit at 0.9 in capitals and 0.3 in lower case.
 */
export function art(lines: string[]): Uint8Array {
  return pass(
    lines.map((line) =>
      [...line].map((c) => {
        if (c === '.') return null;
        const upper = c.toUpperCase();
        return [upper.charCodeAt(0) - 65, c === upper ? 0.9 : 0.3];
      }),
    ),
  );
}

/** A frame as text: '.' transparent, '#' the outline, else its ramp's letter (A = ramp 0). */
export function ramps(f: IndexedFrame): string[] {
  return rows(f, (v) => String.fromCharCode(65 + Math.floor((v - 1) / SHADES)));
}

/** A frame as text: '.' transparent, '#' the outline, else its shade, 0 (darkest) to 3. */
export function shades(f: IndexedFrame): string[] {
  return rows(f, (v) => String((v - 1) % SHADES));
}

function rows(f: IndexedFrame, char: (v: number) => string): string[] {
  return Array.from({ length: f.height }, (_, y) =>
    Array.from(f.data.subarray(y * f.width, (y + 1) * f.width), (v) => (v === 0 ? '.' : v === OUTLINE_INDEX ? '#' : char(v))).join(''),
  );
}

/** An indexed frame from text drawn like `ramps` prints it, every pixel in the given shade. */
export function frameOf(lines: string[], shade = 3): IndexedFrame {
  const width = lines[0].length;
  const data = new Uint8Array(width * lines.length);
  lines.forEach((line, y) =>
    [...line].forEach((c, x) => {
      if (c === '#') data[y * width + x] = OUTLINE_INDEX;
      else if (c !== '.') data[y * width + x] = 1 + (c.charCodeAt(0) - 65) * SHADES + shade;
    }),
  );
  return { width, height: lines.length, data };
}

/** A noisy blob of a few ramps in patches, with gradients of light and ragged, part-covered edges. */
export function randomPass(size: number, ss: number, seed: number): Uint8Array {
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

/** A vertical bar `widthSamples` wide from sample column `x0`, filling a frame `width` x 1 px of ramp 1. */
export function barPass(width: number, ss: number, x0: number, widthSamples: number): Uint8Array {
  const n = width * ss;
  const buf = new Uint8Array(n * ss * 4);
  for (let y = 0; y < ss; y++) for (let x = x0; x < x0 + widthSamples; x++) buf.set([2 * STEP, 230, 0, 255], (y * n + x) * 4);
  return buf;
}
