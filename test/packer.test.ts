import { describe, expect, it } from 'vitest';
import { indexedToRgba, packSheet, packStrip, type AnimationFrames } from '../src/export/packer';
import { PALETTE } from '../src/render/palette';
import type { IndexedFrame } from '../src/render/postprocess';
import { DIRECTIONS, type Direction } from '../src/render/spriteRenderer';

const solid = (v: number): IndexedFrame => ({ width: 2, height: 2, data: new Uint8Array(4).fill(v) });

/** Frame value encodes (anim, frame, direction) so positions are easy to check. */
function anim(name: string, a: number, frames: number): AnimationFrames {
  const byDir = new Map<Direction, IndexedFrame[]>();
  DIRECTIONS.forEach((d, col) => byDir.set(d, Array.from({ length: frames }, (_, i) => solid(a * 100 + i * 10 + col + 1))));
  return { name, fps: 8, loop: a === 0, frames: byDir };
}

describe('packSheet', () => {
  const sheet = packSheet([anim('walk', 0, 3), anim('death', 1, 2)], { x: 1, y: 2 });

  it('lays out directions as columns and frames as rows', () => {
    expect(sheet.width).toBe(5 * 2);
    expect(sheet.height).toBe(5 * 2);
    const at = (col: number, row: number) => sheet.data[row * 2 * sheet.width + col * 2];
    expect(at(0, 0)).toBe(1); // walk f0 N
    expect(at(4, 2)).toBe(25); // walk f2 S
    expect(at(2, 3)).toBe(103); // death f0 E
    expect(at(1, 4)).toBe(112); // death f1 NE
  });

  it('records animations and mirroring in the metadata', () => {
    expect(sheet.meta.animations).toEqual({
      walk: { row: 0, frames: 3, fps: 8, loop: true },
      death: { row: 3, frames: 2, fps: 8, loop: false },
    });
    expect(sheet.meta.mirrored).toEqual({ NW: 'NE', W: 'E', SW: 'SE' });
    expect(sheet.meta.anchor).toEqual({ x: 1, y: 2 });
    expect(sheet.meta.team.indices).toHaveLength(4);
    expect(Object.keys(sheet.meta.team.colors)).toContain('blue');
  });

  it('only ever uses palette colours or full transparency', () => {
    const rgba = indexedToRgba(new Uint8Array([0, 5, PALETTE.length - 1]));
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(rgba.slice(4, 8))).toEqual([...PALETTE[5], 255]);
  });
});

describe('packStrip', () => {
  it('puts frames side by side, left to right', () => {
    const strip = packStrip([solid(1), solid(2), solid(3)]);
    expect([strip.width, strip.height]).toEqual([6, 2]);
    expect(Array.from(strip.data.subarray(0, 6))).toEqual([1, 1, 2, 2, 3, 3]);
    expect(Array.from(strip.data.subarray(6))).toEqual([1, 1, 2, 2, 3, 3]);
  });
});
