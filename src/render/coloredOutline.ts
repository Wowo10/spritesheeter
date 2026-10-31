/**
 * Colored outer outline: the outer outline's ring around the silhouette, but each pixel of it
 * the darkest shade of the material it borders where that is lit (so the outline follows the
 * light: coloured on the lit side, black on the shadowed side) and still dark enough to read as
 * an outline; black elsewhere. Next to several pixels, the darkest decides. The
 * silhouette itself is left as it is. Narrow gaps between parts stay open: a 1 px gap isn't
 * outlined at all, and a 2 px gap only on the side of its darker part, so legs and arms close
 * together don't run into one dark mass.
 */
import { OUTLINE_INDEX, PALETTE, SHADES } from './palette';
import type { IndexedFrame } from './postprocess';

/** An outline colour must be at most this light (luma, 0-1), so it still reads as an outline. */
export const MAX_OUTLINE_LUMA = 0.3;
/** Pixels in this shade or lighter are lit: the outline next to them takes their material's colour. */
export const LIT_SHADE = 2;

const LUMA = PALETTE.map(([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255);

/** Per palette index: what the outline is next to a pixel of that colour. */
const OUTLINE_FOR = PALETTE.map((_, v) => {
  if (v === 0) return 0;
  const shade = (v - 1) % SHADES;
  const darkest = v - shade;
  return shade >= LIT_SHADE && LUMA[darkest] <= MAX_OUTLINE_LUMA ? darkest : OUTLINE_INDEX;
});

export function coloredOutline(f: IndexedFrame): IndexedFrame {
  const { width: w, height: h } = f;
  const src = f.data;
  const data = new Uint8Array(src);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? src[y * w + x] : 0);
  /**
   * Whether (x, y) stays open as part of a gap along (dx, dy): one pixel wide, or two wide with
   * the darker part (on a tie, the left or upper one) on the other side.
   */
  const inGap = (x: number, y: number, dx: number, dy: number): boolean => {
    const before = at(x - dx, y - dy);
    const after = at(x + dx, y + dy);
    if (before && after) return true;
    if (before && !after && at(x + 2 * dx, y + 2 * dy)) return LUMA[at(x + 2 * dx, y + 2 * dy)] < LUMA[before];
    if (after && !before && at(x - 2 * dx, y - 2 * dy)) return LUMA[at(x - 2 * dx, y - 2 * dy)] <= LUMA[after];
    return false;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y * w + x] !== 0) continue;
      // the darkest of the 4 neighbours the outline borders
      let next = 0;
      for (const v of [at(x, y + 1), at(x + 1, y), at(x, y - 1), at(x - 1, y)]) if (v && (!next || LUMA[v] < LUMA[next])) next = v;
      if (!next || inGap(x, y, 1, 0) || inGap(x, y, 0, 1)) continue;
      data[y * w + x] = OUTLINE_FOR[next];
    }
  }
  return { ...f, data };
}
