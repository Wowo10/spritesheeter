import { describe, expect, it } from 'vitest';
import { humanoidAnimations } from '../src/anim/humanoid-anims';
import type { JointName } from '../src/anim/types';
import { handItems, PRESETS, type HandItem, type UnitParams } from '../src/unit/params';

const attack = humanoidAnimations().find((a) => a.name === 'attack')!;
const unit = (rightHand: HandItem, leftHand: HandItem): UnitParams => ({ ...PRESETS.swordsman, rightHand, leftHand });
const pitch = (u: UnitParams, t: number, joint: JointName) => attack.pose(t, u, 0.8).joints[joint]?.[0] ?? 0;

describe('per-hand items', () => {
  it('a bow empties the other hand', () => {
    expect(handItems(unit('sword', 'bow'))).toEqual({ L: 'bow', R: 'none' });
    expect(handItems(unit('bow', 'kiteShield'))).toEqual({ L: 'none', R: 'bow' });
    expect(handItems(unit('axe', 'axe'))).toEqual({ L: 'axe', R: 'axe' });
  });

  it('two weapons both strike, the left a beat behind', () => {
    const u = unit('axe', 'axe');
    expect(pitch(u, 0.5, 'shoulderR')).toBeGreaterThan(150);
    expect(pitch(u, 0.5, 'shoulderL')).toBeGreaterThan(100);
    expect(pitch(u, 0.5, 'shoulderL')).toBeLessThan(pitch(u, 0.5, 'shoulderR'));
  });

  it('weapon + shield: only the weapon arm attacks', () => {
    const u = unit('sword', 'kiteShield');
    expect(pitch(u, 0.5, 'shoulderR')).toBeGreaterThan(150);
    expect(pitch(u, 0.5, 'shoulderL')).toBe(pitch(u, 0, 'shoulderL'));
  });

  it('a lone shield bashes, the empty hand stays put', () => {
    const u = unit('none', 'kiteShield');
    expect(pitch(u, 0.75, 'shoulderL')).toBeGreaterThan(80);
    expect(pitch(u, 0.75, 'shoulderR')).toBe(pitch(u, 0, 'shoulderR'));
  });

  it('empty hands punch with the right', () => {
    expect(pitch(unit('none', 'none'), 0.75, 'shoulderR')).toBeGreaterThan(80);
  });

  it('a right-hand bow is drawn with the left', () => {
    expect(pitch(unit('bow', 'none'), 0.5, 'elbowL')).toBeGreaterThan(120);
    expect(pitch(unit('none', 'bow'), 0.5, 'elbowR')).toBeGreaterThan(120);
  });

  it('a left-led attack mirrors the body twist', () => {
    const yaw = (u: UnitParams) => attack.pose(0.5, u, 0.8).joints.spine![1];
    expect(yaw(unit('none', 'sword'))).toBeCloseTo(-yaw(unit('sword', 'none')));
  });
});

describe('cast', () => {
  const caster = { ...PRESETS.mage };
  const castAnim = () => humanoidAnimations().find((a) => a.name === 'cast')!;

  it('is in every sheet', () => {
    expect(humanoidAnimations().map((a) => a.name)).toContain('cast');
  });

  it('raises both hands with the spell overhead, then flings it forward', () => {
    const top = castAnim().pose(0.45, caster, 0.8);
    expect(top.joints.shoulderL![0]).toBeGreaterThan(150);
    expect(top.joints.shoulderR![0]).toBeGreaterThan(150);
    const release = castAnim().pose(0.7, caster, 0.8);
    expect(release.fx!.pos[2]).toBeGreaterThan(top.fx!.pos[2]);
    expect(release.fx!.scale).toBeGreaterThan(top.fx!.scale);
  });

  it('raises the spell higher with longer arms', () => {
    const overhead = (armLength: number) => castAnim().pose(0.45, { ...caster, armLength }, 0.8).fx!.pos[1];
    expect(overhead(1.3)).toBeGreaterThan(overhead(1));
  });

  it('shows no effect before and after', () => {
    expect(castAnim().pose(0, caster, 0.8).fx!.scale).toBe(0);
    expect(castAnim().pose(1, caster, 0.8).fx!.scale).toBe(0);
  });
});

describe('cast blends with idle', () => {
  it('starts and ends in the idle stance', () => {
    const anims = humanoidAnimations();
    const idle = anims.find((a) => a.name === 'attack')!.pose(0, PRESETS.mage, 0.8).joints;
    const cast = anims.find((a) => a.name === 'cast')!;
    for (const t of [0, 1]) {
      const j = cast.pose(t, PRESETS.mage, 0.8).joints;
      for (const name of ['shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR'] as const) {
        expect(j[name]).toEqual(idle[name]);
      }
    }
  });
});

describe('orb', () => {
  it('a lone orb is thrust forward; a weapon takes precedence', () => {
    const orbOnly = unit('none', 'orb');
    expect(pitch(orbOnly, 0.75, 'shoulderL')).toBeGreaterThan(80);
    expect(pitch(orbOnly, 0.75, 'shoulderR')).toBe(pitch(orbOnly, 0, 'shoulderR'));
    const withSword = unit('sword', 'orb');
    expect(pitch(withSword, 0.75, 'shoulderL')).toBe(pitch(withSword, 0, 'shoulderL'));
  });

  it('stays above the palm while casting', () => {
    const u = unit('orb', 'none');
    const cast = humanoidAnimations().find((a) => a.name === 'cast')!;
    for (const t of [0.45, 0.7]) {
      const j = cast.pose(t, u, 0.8).joints;
      // shoulder + elbow + wrist = 90: the hand's up axis points at the sky
      expect(j.shoulderR![0] + j.elbowR![0] + j.handR![0]).toBeCloseTo(90);
    }
  });
});

describe('cape motion', () => {
  const anims = humanoidAnimations();
  const flare = (name: string, t: number) => -anims.find((a) => a.name === name)!.pose(t, PRESETS.mage, 0.8).joints.cape![0];

  it('is set by every animation and always lifts backward', () => {
    for (const a of anims) {
      for (const t of [0, 0.25, 0.5, 0.75]) expect(flare(a.name, t)).toBeGreaterThanOrEqual(0);
    }
  });

  it('streams further back when walking than when standing', () => {
    expect(flare('walk', 0.25)).toBeGreaterThan(flare('idle', 0.25));
  });
});
