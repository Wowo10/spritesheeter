import { indexedToRgba, type Sheet } from '../export/packer';
import type { RGB } from '../render/palette';
import { MIRRORED, type AnyDirection, type Direction } from '../render/spriteRenderer';

/** Facing directions in 45° steps of yaw, starting from S (facing the camera) and turning toward E. */
const BY_YAW: AnyDirection[] = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];

/** Yaw (degrees) facing along (dx, dz) on the ground: +x is east, +z toward the camera (south). */
export const yawOf = (dx: number, dz: number): number => (Math.atan2(dx, dz) * 180) / Math.PI;

/** The sprite direction closest to a yaw. */
export function directionOf(yaw: number): AnyDirection {
  const k = Math.round(yaw / 45);
  return BY_YAW[((k % 8) + 8) % 8];
}

/** One frame of one direction: its palette indices, and its image per palette, made on first use. */
export interface Cell {
  data: Uint8Array;
  images: (HTMLCanvasElement | undefined)[];
}

/** One sheet row, cut into frames. */
export interface Strip {
  name: string;
  frames: number;
  fps: number;
  loop: boolean;
  /** Frames per sheet column (rendered direction). */
  cells: Map<Direction, Cell[]>;
}

/** Seconds a strip takes to play once. */
export const durationOf = (s: Pick<Strip, 'frames' | 'fps'>): number => s.frames / s.fps;

/** The frame showing `elapsed` seconds into a strip; one-shots hold their last frame. */
export function frameAt(s: Pick<Strip, 'frames' | 'fps' | 'loop'>, elapsed: number): number {
  const f = Math.floor(Math.max(0, elapsed) * s.fps);
  return s.loop ? f % s.frames : Math.min(f, s.frames - 1);
}

/** Rows that stand in for a missing one (a custom model may have only a few), before idle. */
const FALLBACKS: Record<string, string[]> = {
  run: ['walk'],
  carry: ['walk'],
  work: ['attack'],
  channel: ['cast', 'attack'],
  cast: ['attack'],
};

/** A sheet cut into rows and frames, to be drawn in any of eight directions and any palette. */
export class SpriteSet {
  readonly strips = new Map<string, Strip>();
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly anchor: { x: number; y: number };

  constructor(
    sheet: Sheet,
    private readonly palettes: RGB[][],
  ) {
    const { frameWidth: fw, frameHeight: fh, directions, animations, anchor } = sheet.meta;
    this.frameWidth = fw;
    this.frameHeight = fh;
    this.anchor = anchor;
    for (const [name, a] of Object.entries(animations)) {
      const cells = new Map<Direction, Cell[]>();
      directions.forEach((dir, col) => {
        cells.set(
          dir,
          Array.from({ length: a.frames }, (_, i) => {
            const data = new Uint8Array(fw * fh);
            for (let y = 0; y < fh; y++) {
              const src = ((a.row + i) * fh + y) * sheet.width + col * fw;
              data.set(sheet.data.subarray(src, src + fw), y * fw);
            }
            return { data, images: [] };
          }),
        );
      });
      this.strips.set(name, { name, frames: a.frames, fps: a.fps, loop: a.loop, cells });
    }
  }

  has(name: string): boolean {
    return this.strips.has(name);
  }

  /** The row to play for `name`: that row, a similar one the sheet has, idle, or the first row. */
  resolve(name: string): Strip {
    for (const n of [name, ...(FALLBACKS[name] ?? []), 'idle']) {
      const s = this.strips.get(n);
      if (s) return s;
    }
    return this.strips.values().next().value!;
  }

  /** The frame to draw, and whether to draw it mirrored (west-facing directions). */
  cell(strip: Strip, dir: AnyDirection, frame: number): { cell: Cell; flip: boolean } {
    const mirrored = (MIRRORED as Record<string, Direction>)[dir];
    const cells = strip.cells.get(mirrored ?? (dir as Direction))!;
    return { cell: cells[Math.min(frame, cells.length - 1)], flip: !!mirrored };
  }

  image(cell: Cell, palette: number): HTMLCanvasElement {
    let img = cell.images[palette];
    if (!img) {
      img = document.createElement('canvas');
      img.width = this.frameWidth;
      img.height = this.frameHeight;
      const rgba = indexedToRgba(cell.data, this.palettes[palette]);
      img.getContext('2d')!.putImageData(new ImageData(rgba, this.frameWidth, this.frameHeight), 0, 0);
      cell.images[palette] = img;
    }
    return img;
  }

  /** Whether frame pixel (x, y) is drawn; x as seen, so mirrored frames are flipped back. */
  opaqueAt(cell: Cell, flip: boolean, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.frameWidth || y >= this.frameHeight) return false;
    const fx = flip ? this.frameWidth - 1 - Math.floor(x) : Math.floor(x);
    return cell.data[Math.floor(y) * this.frameWidth + fx] !== 0;
  }

  /** Bounds of the drawn pixels over every frame of a row and direction, in frame pixels. */
  bounds(name: string, dir: Direction): { left: number; right: number; top: number; bottom: number } | null {
    const cells = this.strips.get(name)?.cells.get(dir);
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const c of cells ?? []) {
      for (let i = 0; i < c.data.length; i++) {
        if (c.data[i] === 0) continue;
        const x = i % this.frameWidth;
        const y = Math.floor(i / this.frameWidth);
        left = Math.min(left, x);
        right = Math.max(right, x + 1);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y + 1);
      }
    }
    return Number.isFinite(left) ? { left, right, top, bottom } : null;
  }
}
