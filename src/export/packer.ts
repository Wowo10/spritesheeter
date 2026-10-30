import { PALETTE, TEAM_COLOR_NAMES, TEAM_INDICES, teamRgb, type RGB, type TeamColor } from '../render/palette';
import type { IndexedFrame } from '../render/postprocess';
import { DIRECTIONS, MIRRORED, type Direction } from '../render/spriteRenderer';

export interface AnimationFrames {
  name: string;
  fps: number;
  loop: boolean;
  /** Seconds each frame is shown for, on rows played that slowly (decay). */
  hold?: number;
  /** Frames per rendered direction, all the same length. */
  frames: Map<Direction, IndexedFrame[]>;
}

export interface SheetMeta {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  /** Column order: one column per rendered direction. */
  directions: Direction[];
  /** Directions not in the sheet: draw the named column flipped horizontally. */
  mirrored: Record<string, Direction>;
  /** Pixel inside each frame where the unit touches the ground. */
  anchor: { x: number; y: number };
  animations: Record<string, { row: number; frames: number; fps: number; loop: boolean; hold?: number }>;
  palette: RGB[];
  /** Palette entries to swap per player, and what to swap them to for each team colour. */
  team: { indices: number[]; colors: Record<TeamColor, RGB[]> };
  [extra: string]: unknown;
}

export interface Sheet {
  width: number;
  height: number;
  /** Palette indices, 0 = transparent. */
  data: Uint8Array;
  meta: SheetMeta;
}

/** Columns are directions (N, NE, E, SE, S); rows are frames, animations stacked top to bottom. */
export function packSheet(anims: AnimationFrames[], anchor: { x: number; y: number }): Sheet {
  const first = anims[0]?.frames.get(DIRECTIONS[0])?.[0];
  if (!first) throw new Error('packSheet: no frames');
  const fw = first.width;
  const fh = first.height;
  const columns = DIRECTIONS.length;
  const rows = anims.reduce((n, a) => n + (a.frames.get(DIRECTIONS[0])?.length ?? 0), 0);
  const width = columns * fw;
  const height = rows * fh;
  const data = new Uint8Array(width * height);
  const animations: SheetMeta['animations'] = {};

  let row = 0;
  for (const anim of anims) {
    const count = anim.frames.get(DIRECTIONS[0])!.length;
    animations[anim.name] = { row, frames: count, fps: anim.fps, loop: anim.loop, ...(anim.hold !== undefined && { hold: anim.hold }) };
    DIRECTIONS.forEach((dir, col) => {
      const frames = anim.frames.get(dir);
      if (frames?.length !== count) throw new Error(`packSheet: ${anim.name}/${dir} has ${frames?.length} frames, expected ${count}`);
      frames.forEach((f, i) => blit(data, width, f, col * fw, (row + i) * fh));
    });
    row += count;
  }

  return {
    width,
    height,
    data,
    meta: {
      frameWidth: fw,
      frameHeight: fh,
      columns,
      rows,
      directions: [...DIRECTIONS],
      mirrored: { ...MIRRORED },
      anchor,
      animations,
      palette: PALETTE,
      team: teamMeta(),
    },
  };
}

/** Palette entries to swap per player, and what to swap them to for each team colour. */
export function teamMeta(): SheetMeta['team'] {
  return {
    indices: TEAM_INDICES,
    colors: Object.fromEntries(TEAM_COLOR_NAMES.map((t) => [t, teamRgb(t)])) as Record<TeamColor, RGB[]>,
  };
}

/** Frames of the same size side by side, left to right. */
export function packStrip(frames: IndexedFrame[]): Pick<Sheet, 'width' | 'height' | 'data'> {
  if (frames.length === 0) throw new Error('packStrip: no frames');
  const { width: fw, height } = frames[0];
  const width = fw * frames.length;
  const data = new Uint8Array(width * height);
  frames.forEach((f, i) => blit(data, width, f, i * fw, 0));
  return { width, height, data };
}

function blit(dst: Uint8Array, dstW: number, f: IndexedFrame, x0: number, y0: number): void {
  for (let y = 0; y < f.height; y++) {
    dst.set(f.data.subarray(y * f.width, (y + 1) * f.width), (y0 + y) * dstW + x0);
  }
}

/** Each palette entry as one opaque RGBA pixel (entry 0 transparent), ready to copy as a 32-bit word. */
const rgbaTables = new WeakMap<RGB[], Uint32Array>();

function rgbaTable(palette: RGB[]): Uint32Array {
  let table = rgbaTables.get(palette);
  if (!table) {
    table = new Uint32Array(256);
    // written bytewise, so the words come out right whatever the byte order
    const bytes = new Uint8Array(table.buffer);
    palette.forEach(([r, g, b], v) => v !== 0 && bytes.set([r, g, b, 255], v * 4));
    rgbaTables.set(palette, table);
  }
  return table;
}

export function indexedToRgba(data: Uint8Array, palette: RGB[] = PALETTE): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length * 4);
  const words = new Uint32Array(out.buffer);
  const table = rgbaTable(palette);
  for (let i = 0; i < data.length; i++) words[i] = table[data[i]];
  return out;
}
