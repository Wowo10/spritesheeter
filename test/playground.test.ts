import { describe, expect, it } from 'vitest';
import { packSheet, type AnimationFrames } from '../src/export/packer';
import { PALETTE } from '../src/render/palette';
import type { IndexedFrame } from '../src/render/postprocess';
import { DIRECTIONS, type Direction } from '../src/render/spriteRenderer';
import { directionOf, durationOf, frameAt, SpriteSet, yawOf } from '../src/playground/sprites';

/** A 4x4 frame with one pixel set to `v`, at (x, y). */
function dot(v: number, x: number, y: number): IndexedFrame {
  const data = new Uint8Array(16);
  data[y * 4 + x] = v;
  return { width: 4, height: 4, data };
}

/** Every frame's pixel value encodes (anim, frame, direction column). */
function anim(name: string, a: number, frames: number, loop = true): AnimationFrames {
  const byDir = new Map<Direction, IndexedFrame[]>();
  DIRECTIONS.forEach((d, col) => byDir.set(d, Array.from({ length: frames }, (_, i) => dot(a * 100 + i * 10 + col + 1, 1, 2))));
  return { name, fps: 8, loop, frames: byDir };
}

describe('playground directions', () => {
  it('faces the way it moves on the ground', () => {
    expect(directionOf(yawOf(0, 1))).toBe('S');
    expect(directionOf(yawOf(1, 0))).toBe('E');
    expect(directionOf(yawOf(0, -1))).toBe('N');
    expect(directionOf(yawOf(-1, 0))).toBe('W');
    expect(directionOf(yawOf(1, -1))).toBe('NE');
    expect(directionOf(yawOf(-1, 1))).toBe('SW');
    expect(directionOf(yawOf(-1, -1))).toBe('NW');
  });

  it('snaps to the nearest of eight directions', () => {
    expect(directionOf(20)).toBe('S');
    expect(directionOf(25)).toBe('SE');
    expect(directionOf(-170)).toBe('N');
    expect(directionOf(370)).toBe('S');
  });
});

describe('playground timing', () => {
  it('loops, or holds the last frame of a one-shot', () => {
    const loop = { frames: 4, fps: 8, loop: true };
    const once = { ...loop, loop: false };
    expect(durationOf(loop)).toBe(0.5);
    expect(frameAt(loop, 0.13)).toBe(1);
    expect(frameAt(loop, 0.5)).toBe(0);
    expect(frameAt(once, 0.4)).toBe(3);
    expect(frameAt(once, 5)).toBe(3);
  });
});

describe('SpriteSet', () => {
  const sheet = packSheet([anim('idle', 0, 2), anim('walk', 1, 3), anim('death', 2, 2, false)], { x: 2, y: 3 });
  const set = new SpriteSet(sheet, [PALETTE]);

  it('cuts the sheet into rows, directions and frames', () => {
    expect(set.frameWidth).toBe(4);
    expect(set.anchor).toEqual({ x: 2, y: 3 });
    const walk = set.strips.get('walk')!;
    expect(walk.frames).toBe(3);
    expect(walk.cells.get('SE')![2].data[2 * 4 + 1]).toBe(100 + 20 + 4);
    expect(set.strips.get('death')!.loop).toBe(false);
  });

  it('draws west-facing directions from their east twins, mirrored', () => {
    const idle = set.strips.get('idle')!;
    const { cell, flip } = set.cell(idle, 'W', 1);
    expect(flip).toBe(true);
    expect(cell.data[2 * 4 + 1]).toBe(10 + 3);
    // the pixel at x = 1 shows at x = 2 when mirrored
    expect(set.opaqueAt(cell, true, 2, 2)).toBe(true);
    expect(set.opaqueAt(cell, true, 1, 2)).toBe(false);
    expect(set.opaqueAt(cell, false, 1, 2)).toBe(true);
    expect(set.opaqueAt(cell, false, -1, 2)).toBe(false);
  });

  it('falls back to a similar row when one is missing', () => {
    expect(set.resolve('run').name).toBe('walk');
    expect(set.resolve('carry').name).toBe('walk');
    expect(set.resolve('taunt').name).toBe('idle');
    expect(set.resolve('death').name).toBe('death');
  });

  it('measures the drawn pixels of a row', () => {
    expect(set.bounds('idle', 'S')).toEqual({ left: 1, right: 2, top: 2, bottom: 3 });
    expect(set.bounds('cast', 'S')).toBeNull();
  });
});
