/**
 * Ridge-preserving coverage: which pixels of a frame are opaque, deciding thin parts as a whole
 * instead of pixel by pixel. A fixed coverage threshold draws a part about a pixel wide 1 or 2
 * pixels wide, and a narrower one 1 or 0, depending on where it falls between pixels, so thin
 * weapons, limbs and shafts blink and swell as they move. Here a thin part is drawn exactly one
 * pixel across wherever it falls; everything else keeps the threshold.
 *
 * Along each row, a run of covered pixels whose coverage adds up to under THIN pixels is a thin
 * part's cross-section if a run of the row above or below that touches it is thin too (so the
 * part goes on: a lone speck, or the partly covered last row of a thick part, isn't one). Such a
 * run draws one pixel, its most covered (the first on a tie), if it adds up to at least half the
 * coverage threshold, and none otherwise. Columns likewise. A pixel in a thin cross-section both
 * ways (a part at about 45°) is drawn if it's picked either way.
 */
import type { FrameSamples } from './postprocess';

/** Cross-sections under this many pixels' worth of coverage are drawn one pixel wide. */
export const THIN = 1.5;

/** Per pixel, along one axis: whether its run is a thin part's cross-section, and whether it's the pixel that run draws. */
interface AxisRuns {
  thin: Uint8Array;
  pick: Uint8Array;
}

/**
 * Runs of covered pixels along one axis. `at(line, k)` is the pixel index of the k-th pixel of
 * a line (a row or a column), `lines` lines of `length` pixels.
 */
function axisRuns(covered: Uint8Array, lines: number, length: number, at: (line: number, k: number) => number, thinMax: number, pickMin: number): AxisRuns {
  const n = covered.length;
  // each pixel's run, and per run its line, extent, coverage and most covered pixel
  const runOf = new Int32Array(n).fill(-1);
  const line: number[] = [];
  const start: number[] = [];
  const end: number[] = [];
  const mass: number[] = [];
  const best: number[] = [];
  for (let l = 0; l < lines; l++) {
    for (let k = 0; k < length; k++) {
      const i = at(l, k);
      if (covered[i] === 0) continue;
      const prev = k > 0 ? runOf[at(l, k - 1)] : -1;
      let r = prev;
      if (r < 0) {
        r = line.length;
        line.push(l);
        start.push(k);
        end.push(k);
        mass.push(0);
        best.push(i);
      }
      runOf[i] = r;
      end[r] = k;
      mass[r] += covered[i];
      if (covered[i] > covered[best[r]]) best[r] = i;
    }
  }
  // a run goes on into a neighbouring line if a thin run there touches it, diagonally included
  const thinRun = mass.map((m) => m < thinMax);
  const continues = (r: number, l: number): boolean => {
    if (l < 0 || l >= lines) return false;
    for (let k = Math.max(0, start[r] - 1); k <= Math.min(length - 1, end[r] + 1); k++) {
      const o = runOf[at(l, k)];
      if (o >= 0 && thinRun[o]) return true;
    }
    return false;
  };
  const thin = new Uint8Array(n);
  const pick = new Uint8Array(n);
  for (let r = 0; r < line.length; r++) {
    if (!thinRun[r] || !(continues(r, line[r] - 1) || continues(r, line[r] + 1))) continue;
    for (let k = start[r]; k <= end[r]; k++) thin[at(line[r], k)] = 1;
    if (mass[r] >= pickMin) pick[best[r]] = 1;
  }
  return { thin, pick };
}

/** Which pixels are opaque (1) with ridge-preserving coverage, `min` the covered samples the threshold takes; see above. */
export function ridgeCoverage(f: Pick<FrameSamples, 'width' | 'height' | 'ss' | 'covered'>, min: number): Uint8Array {
  const { width: w, height: h, covered } = f;
  const thinMax = THIN * f.ss * f.ss;
  const pickMin = Math.max(1, min / 2);
  const rows = axisRuns(covered, h, w, (y, x) => y * w + x, thinMax, pickMin);
  const cols = axisRuns(covered, w, h, (x, y) => y * w + x, thinMax, pickMin);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    if (covered[i] === 0) continue;
    const across = rows.thin[i] || cols.thin[i];
    out[i] = across ? rows.pick[i] | cols.pick[i] : covered[i] >= min ? 1 : 0;
  }
  return out;
}
