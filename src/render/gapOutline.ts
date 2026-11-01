/**
 * Two refinements of the outer outline, both deciding everything per material rather than per
 * lit pixel, so light moving over a part doesn't change its outline from frame to frame:
 * - stableColoredOutline: the colored outline's ring and gap rule, but each outline pixel is
 *   always the darkest shade of the material it borders (black for materials too pale for that),
 *   whatever the light on the pixel next to it.
 * - gapBlackOutline: the outer outline's black ring, except where it would close a narrow gap
 *   between separate parts (a leg and the other leg, an arm and the body, a weapon and a limb)
 *   or fill a small enclosed hole. Dents in a single part are still outlined as the outer
 *   outline does, and so are pinholes: single enclosed pixels, which would show as specks.
 * The silhouette itself is left as it is.
 */
import { MAX_OUTLINE_LUMA } from './coloredOutline';
import { OUTLINE_INDEX, PALETTE, SHADES } from './palette';
import type { IndexedFrame } from './postprocess';

/**
 * A notch whose two sides join within this many pixels of it is a dent in one part, outlined:
 * at 1, a notch one pixel deep, and the end row of a deeper slit.
 */
export const DENT_DEPTH = 1;
/** Enclosed transparent regions of at most this many pixels are holes too small to outline: left as they are. */
export const SMALL_HOLE = 4;

const LUMA = PALETTE.map(([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255);

const darkestOf = (v: number) => v - ((v - 1) % SHADES);

/**
 * Per palette index: its material's outline colour, the ramp's darkest shade, or black where
 * that is too light to read as an outline. One table for the palette, built once: the shade
 * (the light) of the pixel never enters into it.
 */
export const MATERIAL_OUTLINE = PALETTE.map((_, v) => (v === 0 ? 0 : LUMA[darkestOf(v)] <= MAX_OUTLINE_LUMA ? darkestOf(v) : OUTLINE_INDEX));

/**
 * Per palette index: how dark its material is, lower first: by its darkest shade's luma, then
 * by ramp, so a choice between two materials comes out the same whatever the light. Every
 * shade of a ramp has its ramp's rank.
 */
export const MATERIAL_RANK = (() => {
  const ramps = (PALETTE.length - 1) / SHADES;
  const order = Array.from({ length: ramps }, (_, r) => r).sort((a, b) => LUMA[1 + a * SHADES] - LUMA[1 + b * SHADES] || a - b);
  const rank = new Uint8Array(PALETTE.length).fill(255);
  order.forEach((r, k) => rank.fill(k, 1 + r * SHADES, 1 + (r + 1) * SHADES));
  return rank;
})();

type At = (x: number, y: number) => number;

/**
 * Whether (x, y) stays open as part of a gap along (dx, dy): one pixel wide, or two wide with
 * the darker material (on a tie, the left or upper part) on the other side, as the colored
 * outline has it but by material. `separate` decides whether the pixels across it are parts
 * apart rather than one part's two sides.
 */
function inGap(at: At, x: number, y: number, dx: number, dy: number, separate: (x0: number, y0: number, x1: number, y1: number) => boolean): boolean {
  const before = at(x - dx, y - dy);
  const after = at(x + dx, y + dy);
  if (before && after) return separate(x - dx, y - dy, x + dx, y + dy);
  if (before && !after) {
    const far = at(x + 2 * dx, y + 2 * dy);
    return !!far && MATERIAL_RANK[far] < MATERIAL_RANK[before] && separate(x - dx, y - dy, x + 2 * dx, y + 2 * dy);
  }
  if (after && !before) {
    const far = at(x - 2 * dx, y - 2 * dy);
    return !!far && MATERIAL_RANK[far] <= MATERIAL_RANK[after] && separate(x - 2 * dx, y - 2 * dy, x + dx, y + dy);
  }
  return false;
}

const reader = (f: IndexedFrame): At => {
  const { width: w, height: h, data } = f;
  return (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? data[y * w + x] : 0);
};

const always = () => true;

/** The colored outer outline with each pixel's colour fixed by the materials it borders, not by their light. */
export function stableColoredOutline(f: IndexedFrame): IndexedFrame {
  const { width: w, height: h } = f;
  const src = f.data;
  const data = new Uint8Array(src);
  const at = reader(f);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y * w + x] !== 0) continue;
      // the darkest material of the 4 neighbours; a tie is one material, so one colour
      let next = 0;
      for (const v of [at(x, y + 1), at(x + 1, y), at(x, y - 1), at(x - 1, y)]) if (v && (!next || MATERIAL_RANK[v] < MATERIAL_RANK[next])) next = v;
      if (!next || inGap(at, x, y, 1, 0, always) || inGap(at, x, y, 0, 1, always)) continue;
      data[y * w + x] = MATERIAL_OUTLINE[next];
    }
  }
  return { ...f, data };
}

export interface GapBlackOptions {
  dentDepth?: number;
  smallHole?: number;
  /** false leaves pinholes open, as small holes, as before they were filled. */
  fillPinholes?: boolean;
}

/**
 * The outer outline in black, keeping open what separates parts: a narrow gap whose two sides
 * don't join within `dentDepth` pixels of it (through the drawn pixels, diagonals included),
 * and every pixel of an enclosed hole of at most `smallHole` pixels, pinholes aside (see
 * pinholes), which are filled. Larger holes are outlined inside except where they're narrow.
 */
export function gapBlackOutline(f: IndexedFrame, { dentDepth = DENT_DEPTH, smallHole = SMALL_HOLE, fillPinholes = true }: GapBlackOptions = {}): IndexedFrame {
  const { width: w, height: h } = f;
  const n = w * h;
  const src = f.data;
  const data = new Uint8Array(src);
  const at = reader(f);
  const hole = holes(f);
  const pin = fillPinholes ? pinholes(f, hole) : null;

  // a bounded breadth-first walk through drawn pixels, reused for every gap
  const seen = new Uint32Array(n);
  const dist = new Uint8Array(n);
  const queue = new Int32Array(n);
  let stamp = 0;
  /** Whether the drawn pixels (x0, y0) and (x1, y1) join within `limit` steps. */
  const joined = (x0: number, y0: number, x1: number, y1: number, limit: number): boolean => {
    const goal = y1 * w + x1;
    let head = 0;
    let tail = 0;
    queue[tail++] = y0 * w + x0;
    seen[y0 * w + x0] = ++stamp;
    dist[y0 * w + x0] = 0;
    while (head < tail) {
      const p = queue[head++];
      if (p === goal) return true;
      const d = dist[p];
      if (d >= limit) continue;
      const px = p % w;
      const py = (p - px) / w;
      for (let qy = Math.max(0, py - 1); qy <= Math.min(h - 1, py + 1); qy++) {
        for (let qx = Math.max(0, px - 1); qx <= Math.min(w - 1, px + 1); qx++) {
          const q = qy * w + qx;
          if (src[q] === 0 || seen[q] === stamp) continue;
          seen[q] = stamp;
          dist[q] = d + 1;
          queue[tail++] = q;
        }
      }
    }
    return false;
  };
  // two sides `span` steps apart are one part when they join on a path that strays at most dentDepth from the gap
  const separate = (x0: number, y0: number, x1: number, y1: number) => {
    const span = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    return !joined(x0, y0, x1, y1, span + 2 * (dentDepth - 1));
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i] !== 0) continue;
      if (!(at(x, y + 1) || at(x + 1, y) || at(x, y - 1) || at(x - 1, y))) continue;
      if (pin?.[i]) {
        data[i] = OUTLINE_INDEX;
        continue;
      }
      if (hole[i] && hole[i] <= smallHole) continue;
      // a hole's sides always join around it: narrow parts of one stay open as they are
      const apart = hole[i] ? always : separate;
      if (inGap(at, x, y, 1, 0, apart) || inGap(at, x, y, 0, 1, apart)) continue;
      data[i] = OUTLINE_INDEX;
    }
  }
  return { ...f, data };
}

/**
 * The pinholes, as 1s: transparent pixels shut in on all four sides (enclosed holes of one
 * pixel) that no ground passes through. Open, they show as specks of ground inside the sprite
 * that come and go from frame to frame, so gapBlackOutline fills them, as the outer outline does.
 * - A pixel's four sides touch each other diagonally, so they're never separate parts: a dent.
 * - Ground can still reach it diagonally, through its corners. One reached through one corner at
 *   most is a dead end; filling it can't cut any ground off from any other. That may make another
 *   such pixel a dead end, and so on: a chain of them, enclosed or leading in from outside, is
 *   filled whole. One that ground passes through, corner to corner, linking other ground (a
 *   diagonal channel between two parallel diagonals, a leg beside a cloak) stays open.
 * Bigger holes, gaps and the background are never filled, so what they join to stays joined.
 */
export function pinholes(f: IndexedFrame, hole: Uint32Array = holes(f)): Uint8Array {
  const { width: w, data: src } = f;
  const n = src.length;
  const pin = new Uint8Array(n);
  // per 1 px hole, its transparent corners not filled yet; dead ends are filled, which may make more
  const open = new Uint8Array(n);
  const stack: number[] = [];
  const corners = [-w - 1, -w + 1, w - 1, w + 1];
  for (let i = 0; i < n; i++) {
    if (hole[i] !== 1) continue;
    // a 1 px hole is never on the frame's edge, so its corners are inside it
    for (const d of corners) if (src[i + d] === 0) open[i]++;
    if (open[i] <= 1) stack.push(i);
  }
  while (stack.length) {
    const i = stack.pop()!;
    if (pin[i]) continue;
    pin[i] = 1;
    for (const d of corners) {
      const q = i + d;
      if (hole[q] === 1 && !pin[q] && --open[q] <= 1) stack.push(q);
    }
  }
  return pin;
}

/**
 * Per pixel, the size of the enclosed hole it's in: a region of transparent pixels (joined
 * along rows and columns) that doesn't reach the frame's edge; 0 elsewhere.
 */
export function holes(f: IndexedFrame): Uint32Array {
  const { width: w, height: h, data: src } = f;
  const n = w * h;
  const size = new Uint32Array(n);
  // 1: reaches the frame's edge; 2: enclosed
  const state = new Uint8Array(n);
  const stack = new Int32Array(n);
  const region = new Int32Array(n);
  /** Marks the transparent region around `start`, leaving its pixels in `region`; returns how many. */
  const fill = (start: number, mark: number): number => {
    if (src[start] !== 0 || state[start]) return 0;
    state[start] = mark;
    stack[0] = start;
    let top = 1;
    let count = 0;
    while (top) {
      const p = stack[--top];
      region[count++] = p;
      const x = p % w;
      // left, right, up, down
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? (x > 0 ? p - 1 : -1) : k === 1 ? (x < w - 1 ? p + 1 : -1) : k === 2 ? p - w : p + w;
        if (q < 0 || q >= n || src[q] !== 0 || state[q]) continue;
        state[q] = mark;
        stack[top++] = q;
      }
    }
    return count;
  };
  for (let x = 0; x < w; x++) {
    fill(x, 1);
    fill((h - 1) * w + x, 1);
  }
  for (let y = 0; y < h; y++) {
    fill(y * w, 1);
    fill(y * w + w - 1, 1);
  }
  for (let p = 0; p < n; p++) {
    if (src[p] !== 0 || state[p]) continue;
    const count = fill(p, 2);
    for (let k = 0; k < count; k++) size[region[k]] = count;
  }
  return size;
}
