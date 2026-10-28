import { describe, expect, it } from 'vitest';
import { humanoidAnimations } from '../src/anim/humanoid-anims';
import { paletteIndex, rampIndex } from '../src/render/palette';
import { dither, type IndexedFrame } from '../src/render/postprocess';
import { HOVER, PRESETS, randomUnit } from '../src/unit/params';

const anims = humanoidAnimations();
const anim = (name: string) => anims.find((a) => a.name === name)!;

function solid(value: number, size = 4): IndexedFrame {
  return { width: size, height: size, data: new Uint8Array(size * size).fill(value) };
}

describe('dither', () => {
  const steel = paletteIndex(rampIndex('steel'), 2);
  const fire = paletteIndex(rampIndex('fire'), 2);

  it('leaves opaque sprites alone', () => {
    const f = solid(steel);
    expect(dither(f, 1, 0)).toBe(f);
  });

  it('drops every other pixel at 50%, and shifts with the phase', () => {
    const a = dither(solid(steel), 0.5, 0).data;
    const b = dither(solid(steel), 0.5, 1).data;
    expect(a.filter((v) => v !== 0).length).toBe(8);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = y * 4 + x;
        if (x + 1 < 4) expect(a[i] === 0).not.toBe(a[i + 1] === 0);
        expect(b[i] === 0).not.toBe(a[i] === 0);
      }
    }
  });

  it('keeps about the requested share of pixels', () => {
    for (const o of [0.25, 0.75]) expect(dither(solid(steel), o, 0).data.filter((v) => v !== 0).length).toBe(16 * o);
  });

  it('fades glowing ramps half as fast', () => {
    const glow = [rampIndex('fire')];
    expect(dither(solid(fire), 0.5, 0, glow).data.every((v) => v === fire)).toBe(true);
    expect(dither(solid(fire), 0.25, 0, glow).data.filter((v) => v !== 0).length).toBe(8);
    expect(dither(solid(fire), 0, 0, glow).data.every((v) => v === 0)).toBe(true);
  });
});

describe('floating', () => {
  const ghost = PRESETS.ghost;

  it('hovers in every animation but death', () => {
    for (const name of ['idle', 'walk', 'attack', 'cast']) {
      for (const t of [0, 0.25, 0.5, 0.75]) expect(anim(name).pose(t, ghost, 0.8).hips![1]).toBeGreaterThan(HOVER / 2);
    }
  });

  it('casts the spell from where the hands are, up in the air', () => {
    const grounded = { ...ghost, gait: 'walk' as const };
    expect(anim('cast').pose(0.45, ghost, 0.8).fx!.pos[1]).toBeCloseTo(anim('cast').pose(0.45, grounded, 0.8).fx!.pos[1] + HOVER);
  });

  it('a ghost rises as it dies and fades out completely', () => {
    const death = anim('death');
    expect(death.pose(1, ghost, 0.8).hips![1]).toBeGreaterThan(death.pose(0, ghost, 0.8).hips![1]);
    expect(death.pose(0, ghost, 0.8).opacity).toBe(ghost.opacity);
    expect(death.pose(1, ghost, 0.8).opacity).toBe(0);
  });

  it('a floater with legs drops to the ground when it dies', () => {
    const lich = { ...PRESETS.mage, gait: 'float' as const };
    const mage = PRESETS.mage;
    expect(anim('death').pose(0, lich, 0.8).hips![1]).toBeCloseTo(anim('death').pose(0, mage, 0.8).hips![1] + HOVER);
    expect(anim('death').pose(1, lich, 0.8).hips).toEqual(anim('death').pose(1, mage, 0.8).hips);
  });
});

describe('shambling', () => {
  const zombie = PRESETS.zombie;

  it('drags the right leg: it swings less than the left, knee kept straight', () => {
    const walk = anim('walk');
    const range = (j: 'hipL' | 'hipR') => {
      const ps = [0, 0.25, 0.5, 0.75].map((t) => walk.pose(t, zombie, 0.8).joints[j]![0]);
      return Math.max(...ps) - Math.min(...ps);
    };
    expect(range('hipR')).toBeLessThan(range('hipL'));
    for (const t of [0, 0.25, 0.5, 0.75]) expect(walk.pose(t, zombie, 0.8).joints.kneeR![0]).toBeGreaterThan(-10);
  });

  it('holds its arms out, and attacks and casts from there', () => {
    const idle = anim('idle').pose(0, zombie, 0.8).joints;
    expect(idle.shoulderL![0]).toBeGreaterThan(60);
    expect(idle.shoulderR![0]).toBeGreaterThan(60);
    for (const name of ['attack', 'cast']) {
      const start = anim(name).pose(0, zombie, 0.8).joints;
      expect(start.shoulderL![0]).toBe(anim('cast').pose(0, zombie, 0.8).joints.shoulderL![0]);
      expect(start.shoulderL![0]).toBeGreaterThan(60);
    }
  });

  it('claws with both empty hands', () => {
    const attack = anim('attack');
    for (const j of ['shoulderL', 'shoulderR'] as const) {
      expect(attack.pose(0.25, zombie, 0.8).joints[j]![0]).toBeLessThan(attack.pose(0, zombie, 0.8).joints[j]![0]);
    }
  });
});

it('random units stay among the living', () => {
  for (let seed = 0; seed < 50; seed++) {
    const u = randomUnit(seed);
    expect([u.gait, u.body, u.opacity, u.glowEyes, u.shadow]).toEqual(['walk', 'normal', 1, false, false]);
    expect(['rotSkin', 'ghost']).not.toContain(u.skin);
  }
});
