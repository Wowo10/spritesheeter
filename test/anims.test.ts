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
