import { RAMPS, type RampName } from '../render/palette';

/**
 * The playground's props, drawn as pixel art in the palette's ramps: a gold mine to work and a
 * depot to carry the gold to. Sized for 32 px units; the playground scales them with the frame.
 */

type Raster = (string | null)[][];

const raster = (w: number, h: number): Raster => Array.from({ length: h }, () => Array<string | null>(w).fill(null));
const shade = (ramp: RampName, s: number) => RAMPS[ramp][Math.max(0, Math.min(3, s))];

/** Darkens every empty pixel next to a drawn one, like the sprites' outer outline. */
function outline(r: Raster): void {
  const edge = RAMPS.dark[1];
  const filled = (x: number, y: number) => !!r[y]?.[x] && r[y][x] !== edge;
  r.forEach((row, y) =>
    row.forEach((c, x) => {
      if (!c && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) row[x] = edge;
    }),
  );
}

function toCanvas(r: Raster): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r[0].length;
  c.height = r.length;
  const ctx = c.getContext('2d')!;
  r.forEach((row, y) =>
    row.forEach((col, x) => {
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return c;
}

/** A heap of boulders lit from the upper left, with gold glinting between them. */
export function drawMine(): HTMLCanvasElement {
  const w = 26;
  const h = 17;
  const r = raster(w, h);
  // back to front: [centre x, centre y, radius x, radius y]
  const rocks: [number, number, number, number][] = [
    [13, 6, 6, 5],
    [7, 9, 5, 4],
    [19, 9, 5, 4.5],
    [11, 12, 5, 3.5],
    [17, 13, 4.5, 3],
  ];
  for (const [cx, cy, rx, ry] of rocks) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        // light from the upper left; each boulder's rim stays dark
        const lit = -0.6 * nx - 0.8 * ny;
        const s = nx * nx + ny * ny > 0.75 ? 0 : lit > 0.45 ? 3 : lit > -0.05 ? 2 : 1;
        r[y][x] = shade('fur', s);
      }
    }
  }
  const nuggets: [number, number][] = [
    [12, 4], [13, 4], [12, 5], [8, 8], [9, 8], [19, 7], [20, 7], [20, 8], [11, 11], [16, 12], [17, 12], [15, 8],
  ];
  nuggets.forEach(([x, y], i) => (r[y][x] = shade('gold', i % 3 === 0 ? 3 : 2)));
  outline(r);
  return toCanvas(r);
}

/** A storehouse of planks under a thatched roof, with a dark doorway. */
export function drawDepot(): HTMLCanvasElement {
  const w = 24;
  const h = 22;
  const r = raster(w, h);
  // walls: vertical planks, lit from the left
  for (let y = 9; y < h - 1; y++) {
    for (let x = 3; x < w - 3; x++) {
      const plank = Math.floor((x - 3) / 3);
      const seam = (x - 3) % 3 === 2;
      r[y][x] = shade('wood', seam ? 0 : x < w / 2 ? 2 + (plank % 2) : 1 + (plank % 2));
    }
  }
  // the doorway, with its lintel
  for (let y = 13; y < h - 1; y++) for (let x = 9; x < 15; x++) r[y][x] = shade('dark', y === 13 ? 2 : 1);
  for (let x = 8; x < 16; x++) r[12][x] = shade('wood', 0);
  // a thatched roof overhanging the walls, its near slope lit
  for (let y = 1; y < 11; y++) {
    const half = 1 + y * 1.15;
    for (let x = 0; x < w; x++) {
      const d = x + 0.5 - w / 2;
      if (Math.abs(d) > half) continue;
      const streak = (x + y * 2) % 5 === 0;
      r[y][x] = shade('tawny', (d < 0 ? 3 : 1) - (streak ? 1 : 0) - (y === 10 ? 1 : 0));
    }
  }
  outline(r);
  return toCanvas(r);
}
