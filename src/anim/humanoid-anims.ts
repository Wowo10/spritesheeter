import { effectiveShield, weaponStyle, type UnitParams } from '../unit/params';
import type { AnimationDef, JointName, JointRot, Pose } from './types';

type Joints = Partial<Record<JointName, JointRot>>;
type Key<T> = [time: number, value: T];

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Piecewise smoothstep interpolation between keyframes (times ascending, covering [0, 1]). */
function keys(t: number, ks: Key<number>[]): number {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    const [t1, v1] = ks[i];
    if (t <= t1) {
      const [t0, v0] = ks[i - 1];
      return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
    }
  }
  return ks[ks.length - 1][1];
}

function rotKeys(t: number, ks: Key<JointRot>[]): JointRot {
  return [0, 1, 2].map((c) => keys(t, ks.map(([kt, v]) => [kt, v[c]]))) as JointRot;
}

/** Arm pose holding the weapon (and shield) at rest; also the start/end of every attack. */
function armStance(unit: UnitParams): Joints {
  const style = weaponStyle(unit.weapon);
  if (style === 'bow') {
    return {
      shoulderL: [20, 0, 8],
      elbowL: [25, 0, 0],
      handL: [0, 0, 0],
      shoulderR: [10, 0, 8],
      elbowR: [25, 0, 0],
    };
  }
  const left: Joints =
    effectiveShield(unit) === 'none'
      ? { shoulderL: [8, 0, 8], elbowL: [20, 0, 0] }
      : { shoulderL: [20, 0, 10], elbowL: [60, 0, 0] };
  const right: Joints =
    style === 'thrust'
      ? // spear held upright: forearm forward, wrist turned up
        { shoulderR: [15, 0, 8], elbowR: [75, 0, 0], handR: [90, 0, 0] }
      : // blade raised forward-up, ready to strike
        { shoulderR: [15, 0, 8], elbowR: [40, 0, 0], handR: [95, 0, 0] };
  return { ...left, ...right };
}

const LEGS_REST: Joints = {
  hipL: [4, 0, 5],
  hipR: [-4, 0, 5],
  kneeL: [-6, 0, 0],
  kneeR: [-6, 0, 0],
};

function idle(t: number, unit: UnitParams): Pose {
  // subtle breathing, only visible when idle has more than one frame
  const b = Math.sin(t * Math.PI * 2);
  return {
    joints: { ...armStance(unit), ...LEGS_REST, spine: [-3 + 2 * b, 0, 0] },
    hips: [0, -0.02 - 0.01 * b, 0],
  };
}

function walk(t: number, unit: UnitParams): Pose {
  const phase = t * Math.PI * 2;
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const arms = armStance(unit);
  const swing = (j: JointName, amount: number) => {
    const r = arms[j];
    if (r) arms[j] = [r[0] + amount, r[1], r[2]];
  };
  // arms counter-swing the legs; hands full of gear swing less
  swing('shoulderL', weaponStyle(unit.weapon) === 'bow' || effectiveShield(unit) === 'none' ? -18 * s : -8 * s);
  swing('shoulderR', 12 * s);
  return {
    joints: {
      ...arms,
      spine: [-6, 6 * s, 0],
      head: [2, -4 * s, 0],
      hipL: [28 * s, 0, 3],
      hipR: [-28 * s, 0, 3],
      // the knee bends while its leg swings forward
      kneeL: [-5 - 40 * Math.max(0, c), 0, 0],
      kneeR: [-5 - 40 * Math.max(0, -c), 0, 0],
    },
    hips: [0, -0.07 * Math.abs(s) - 0.01, 0],
  };
}

function attackChop(t: number, unit: UnitParams): Pose {
  const rest = armStance(unit);
  return {
    joints: {
      ...rest,
      ...LEGS_REST,
      shoulderR: rotKeys(t, [
        [0, [15, 0, 8]],
        [0.25, [140, 0, 12]],
        [0.5, [175, 0, 10]],
        [0.75, [70, 0, 5]],
        [1, [35, 0, 8]],
      ]),
      elbowR: rotKeys(t, [
        [0, [40, 0, 0]],
        [0.25, [50, 0, 0]],
        [0.5, [60, 0, 0]],
        [0.75, [10, 0, 0]],
        [1, [30, 0, 0]],
      ]),
      handR: rotKeys(t, [
        [0, [95, 0, 0]],
        [0.25, [70, 0, 0]],
        [0.5, [60, 0, 0]],
        [0.75, [15, 0, 0]],
        [1, [60, 0, 0]],
      ]),
      spine: rotKeys(t, [
        [0, [-3, 0, 0]],
        [0.5, [8, 12, 0]],
        [0.75, [-18, -10, 0]],
        [1, [-8, 0, 0]],
      ]),
      hipL: [14, 0, 5],
      hipR: [-12, 0, 5],
    },
    hips: [0, keys(t, [[0, -0.02], [0.75, -0.08], [1, -0.04]]), keys(t, [[0, 0], [0.75, 0.06], [1, 0.02]])],
  };
}

function attackThrust(t: number, unit: UnitParams): Pose {
  const rest = armStance(unit);
  return {
    joints: {
      ...rest,
      ...LEGS_REST,
      // pull back with the spear levelled, then lunge with the whole body
      shoulderR: rotKeys(t, [
        [0, [15, 0, 8]],
        [0.25, [0, 0, 12]],
        [0.5, [30, 0, 10]],
        [0.75, [85, 0, 4]],
        [1, [30, 0, 8]],
      ]),
      elbowR: rotKeys(t, [
        [0, [75, 0, 0]],
        [0.25, [90, 0, 0]],
        [0.5, [60, 0, 0]],
        [0.75, [5, 0, 0]],
        [1, [60, 0, 0]],
      ]),
      handR: rotKeys(t, [
        [0, [90, 0, 0]],
        [0.25, [0, 0, 0]],
        [0.75, [0, 0, 0]],
        [1, [0, 0, 0]],
      ]),
      spine: rotKeys(t, [
        [0, [-3, 0, 0]],
        [0.25, [4, 10, 0]],
        [0.75, [-16, -12, 0]],
        [1, [-6, 0, 0]],
      ]),
      hipL: rotKeys(t, [
        [0, [4, 0, 5]],
        [0.75, [28, 0, 5]],
        [1, [12, 0, 5]],
      ]),
      hipR: rotKeys(t, [
        [0, [-4, 0, 5]],
        [0.75, [-18, 0, 5]],
        [1, [-8, 0, 5]],
      ]),
      kneeL: rotKeys(t, [
        [0, [-6, 0, 0]],
        [0.75, [-30, 0, 0]],
        [1, [-10, 0, 0]],
      ]),
    },
    hips: [0, keys(t, [[0, -0.02], [0.75, -0.1], [1, -0.04]]), keys(t, [[0, 0], [0.25, -0.04], [0.75, 0.12], [1, 0.03]])],
  };
}

function attackBow(t: number, unit: UnitParams): Pose {
  const rest = armStance(unit);
  return {
    joints: {
      ...rest,
      ...LEGS_REST,
      // bow arm up and pointing at the target, string hand draws back to the face
      shoulderL: rotKeys(t, [
        [0, [20, 0, 8]],
        [0.25, [80, 0, -10]],
        [0.75, [85, 0, -12]],
        [1, [40, 0, 0]],
      ]),
      elbowL: rotKeys(t, [
        [0, [25, 0, 0]],
        [0.25, [5, 0, 0]],
        [1, [15, 0, 0]],
      ]),
      shoulderR: rotKeys(t, [
        [0, [10, 0, 8]],
        [0.25, [80, 0, -25]],
        [0.5, [85, 0, -15]],
        [0.75, [70, 0, 20]],
        [1, [20, 0, 8]],
      ]),
      elbowR: rotKeys(t, [
        [0, [25, 0, 0]],
        [0.25, [100, 0, 0]],
        [0.5, [145, 0, 0]],
        [0.75, [40, 0, 0]],
        [1, [25, 0, 0]],
      ]),
      spine: rotKeys(t, [
        [0, [-3, 0, 0]],
        [0.25, [0, -25, 0]],
        [0.5, [2, -32, 0]],
        [0.75, [-2, -25, 0]],
        [1, [-3, -5, 0]],
      ]),
      head: rotKeys(t, [
        [0, [0, 0, 0]],
        [0.5, [0, 28, 0]],
        [1, [0, 5, 0]],
      ]),
    },
    hips: [0, -0.02, 0],
  };
}

function death(t: number, unit: UnitParams, hipHeight: number): Pose {
  const lying = 0.13 * unit.bulk - hipHeight;
  const stance = armStance(unit);
  return {
    // A body lying straight along the camera axis reads as someone standing; turning it
    // 22.5 deg keeps every one of the 8 directions at least that far off the axis.
    turn: keys(t, [
      [0, 0],
      [1, 22.5],
    ]),
    joints: {
      ...stance,
      // let go of the gear: weapon lies along the arm, shield flat on the ground
      handR: rotKeys(t, [
        [0, stance.handR ?? [0, 0, 0]],
        [0.67, [40, 0, 0]],
        [1, [0, 0, 0]],
      ]),
      handL: rotKeys(t, [
        [0, stance.handL ?? [0, 0, 0]],
        [1, [45, 0, 0]],
      ]),
      // falls on its back; arms flung up while falling, then flat beside the body
      hips: rotKeys(t, [
        [0, [10, 0, 0]],
        [0.33, [25, 0, 4]],
        [0.67, [60, 0, 6]],
        [1, [88, 0, 4]],
      ]),
      spine: rotKeys(t, [
        [0, [10, 0, 0]],
        [0.33, [12, 8, 0]],
        [0.67, [10, 0, 0]],
        [1, [2, 0, 0]],
      ]),
      head: rotKeys(t, [
        [0, [15, 0, 0]],
        [0.67, [20, 0, 10]],
        [1, [-5, 0, 15]],
      ]),
      shoulderL: rotKeys(t, [
        [0, [30, 0, 15]],
        [0.33, [70, 0, 30]],
        [0.67, [90, 0, 40]],
        [1, [15, 0, 25]],
      ]),
      shoulderR: rotKeys(t, [
        [0, [40, 0, 15]],
        [0.33, [90, 0, 25]],
        [0.67, [110, 0, 35]],
        [1, [20, 0, 28]],
      ]),
      elbowL: [20, 0, 0],
      elbowR: [20, 0, 0],
      hipL: rotKeys(t, [
        [0, [10, 0, 5]],
        [0.33, [20, 0, 8]],
        [1, [0, 0, 12]],
      ]),
      hipR: rotKeys(t, [
        [0, [-5, 0, 5]],
        [0.33, [5, 0, 8]],
        [1, [-4, 0, 8]],
      ]),
      kneeL: rotKeys(t, [
        [0, [-20, 0, 0]],
        [0.33, [-50, 0, 0]],
        [0.67, [-30, 0, 0]],
        [1, [-12, 0, 0]],
      ]),
      kneeR: rotKeys(t, [
        [0, [-15, 0, 0]],
        [0.33, [-45, 0, 0]],
        [0.67, [-25, 0, 0]],
        [1, [-6, 0, 0]],
      ]),
    },
    hips: [
      0,
      keys(t, [
        [0, -0.04],
        [0.33, -0.18],
        [0.67, lying * 0.6],
        [1, lying],
      ]),
      keys(t, [
        [0, 0],
        [1, -0.25],
      ]),
    ],
  };
}

function attack(t: number, unit: UnitParams): Pose {
  switch (weaponStyle(unit.weapon)) {
    case 'thrust':
      return attackThrust(t, unit);
    case 'bow':
      return attackBow(t, unit);
    default:
      return attackChop(t, unit);
  }
}

export const ANIMATION_NAMES = ['idle', 'walk', 'attack', 'death'] as const;
export type AnimationName = (typeof ANIMATION_NAMES)[number];

export interface FrameCounts {
  idle: number;
  walk: number;
  attack: number;
  death: number;
}

export const DEFAULT_FRAME_COUNTS: FrameCounts = { idle: 1, walk: 5, attack: 5, death: 4 };

export function humanoidAnimations(counts: FrameCounts = DEFAULT_FRAME_COUNTS): AnimationDef[] {
  return [
    { name: 'idle', frames: counts.idle, fps: 2, loop: true, pose: idle },
    { name: 'walk', frames: counts.walk, fps: 8, loop: true, pose: walk },
    { name: 'attack', frames: counts.attack, fps: 8, loop: false, pose: attack },
    { name: 'death', frames: counts.death, fps: 6, loop: false, pose: death },
  ];
}
