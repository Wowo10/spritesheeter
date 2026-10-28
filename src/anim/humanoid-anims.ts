import { handItems, itemKind, otherHand, type Hand, type ItemKind, type UnitParams } from '../unit/params';
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

interface Arm {
  shoulder: JointRot;
  elbow: JointRot;
  hand: JointRot;
}

const HANDS: Hand[] = ['L', 'R'];

/**
 * +1 for the right hand, -1 for the left. Motions are authored as if the right hand leads;
 * multiplying centre-line yaw by this mirrors them when the left hand leads instead.
 */
const sgn = (h: Hand) => (h === 'R' ? 1 : -1);

/** Arm holding each kind of item at rest; also where every attack starts and ends. */
const ARM_REST: Record<ItemKind, Arm> = {
  none: { shoulder: [8, 0, 8], elbow: [20, 0, 0], hand: [0, 0, 0] },
  // blade raised forward-up, ready to strike
  chop: { shoulder: [15, 0, 8], elbow: [40, 0, 0], hand: [95, 0, 0] },
  // spear held upright: forearm forward, wrist turned up
  thrust: { shoulder: [15, 0, 8], elbow: [75, 0, 0], hand: [90, 0, 0] },
  // shield in front of the body; the model's shield mount assumes this forearm pitch
  shield: { shoulder: [20, 0, 10], elbow: [60, 0, 0], hand: [0, 0, 0] },
  bow: { shoulder: [20, 0, 8], elbow: [25, 0, 0], hand: [0, 0, 0] },
};

function setArm(j: Joints, h: Hand, a: Arm): void {
  j[`shoulder${h}`] = a.shoulder;
  j[`elbow${h}`] = a.elbow;
  j[`hand${h}`] = a.hand;
}

function kinds(unit: UnitParams): Record<Hand, ItemKind> {
  const items = handItems(unit);
  return { L: itemKind(items.L), R: itemKind(items.R) };
}

function armStance(unit: UnitParams): Joints {
  const k = kinds(unit);
  const j: Joints = {};
  for (const h of HANDS) setArm(j, h, ARM_REST[k[h]]);
  return j;
}

/** Swaps left and right joints, for leg work authored with the right hand leading. */
function mirrorSides(j: Joints, lead: Hand): Joints {
  if (lead === 'R') return j;
  const out: Joints = {};
  for (const [name, rot] of Object.entries(j) as [JointName, JointRot][]) {
    const swapped = name.endsWith('L') ? name.slice(0, -1) + 'R' : name.endsWith('R') ? name.slice(0, -1) + 'L' : name;
    out[swapped as JointName] = rot;
  }
  return out;
}

const LEGS_REST: Joints = {
  hipL: [4, 0, 5],
  hipR: [-4, 0, 5],
  kneeL: [-6, 0, 0],
  kneeR: [-6, 0, 0],
};

/** Adds [pitch, yaw, roll] to a joint of a pose that already sets it. */
function nudge(joints: Joints, j: JointName, [p, y, r]: JointRot): void {
  const cur = joints[j];
  if (cur) joints[j] = [cur[0] + p, cur[1] + y, cur[2] + r];
}

function idle(t: number, unit: UnitParams): Pose {
  // Breathing (cos) and looking around / shifting weight (sin) are a quarter cycle apart,
  // so every frame of a 4-frame loop differs. Amplitudes are large enough to move 1-2 px.
  const phase = t * Math.PI * 2;
  const breath = Math.cos(phase);
  const look = Math.sin(phase);
  const k = kinds(unit);
  const joints: Joints = {
    ...armStance(unit),
    ...LEGS_REST,
    spine: [-3 + 3 * breath, 0, 2 * look],
    head: [-4 * breath, 22 * look, -3 * look],
  };
  for (const h of HANDS) {
    // shoulders rise on the in-breath; weapons bob with them, shields sag a little
    nudge(joints, `shoulder${h}`, [4 * breath, 0, 3 * breath]);
    if (k[h] === 'chop' || k[h] === 'thrust') nudge(joints, `hand${h}`, [6 * breath, 0, 0]);
    if (k[h] === 'shield') nudge(joints, `elbow${h}`, [-6 * breath, 0, 0]);
  }
  // weight shifts toward the side the head turns to
  nudge(joints, 'hipL', [0, 0, -3 * look]);
  nudge(joints, 'hipR', [0, 0, 3 * look]);
  return { joints, hips: [0.015 * look, -0.03 + 0.02 * breath, 0] };
}

/** How far each arm counter-swings while walking; hands full of gear swing less. */
const WALK_SWING: Record<ItemKind, number> = { none: 18, bow: 18, chop: 12, thrust: 12, shield: 8 };

function walk(t: number, unit: UnitParams): Pose {
  const phase = t * Math.PI * 2;
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const k = kinds(unit);
  const arms = armStance(unit);
  // each arm swings opposite to the leg on its side
  for (const h of HANDS) nudge(arms, `shoulder${h}`, [sgn(h) * WALK_SWING[k[h]] * s, 0, 0]);
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

// --- attacks: arm motions per item, body motions per leading item ------------

/** Overhead chop: wind up behind the head, strike forward-down. */
function chopArm(t: number): Arm {
  return {
    shoulder: rotKeys(t, [
      [0, ARM_REST.chop.shoulder],
      [0.25, [140, 0, 12]],
      [0.5, [175, 0, 10]],
      [0.75, [70, 0, 5]],
      [1, [35, 0, 8]],
    ]),
    elbow: rotKeys(t, [
      [0, ARM_REST.chop.elbow],
      [0.25, [50, 0, 0]],
      [0.5, [60, 0, 0]],
      [0.75, [10, 0, 0]],
      [1, [30, 0, 0]],
    ]),
    hand: rotKeys(t, [
      [0, ARM_REST.chop.hand],
      [0.25, [70, 0, 0]],
      [0.5, [60, 0, 0]],
      [0.75, [15, 0, 0]],
      [1, [60, 0, 0]],
    ]),
  };
}

/** Pull back with the spear levelled, then thrust at full reach. */
function thrustArm(t: number): Arm {
  return {
    shoulder: rotKeys(t, [
      [0, ARM_REST.thrust.shoulder],
      [0.25, [0, 0, 12]],
      [0.5, [30, 0, 10]],
      [0.75, [85, 0, 4]],
      [1, [30, 0, 8]],
    ]),
    elbow: rotKeys(t, [
      [0, ARM_REST.thrust.elbow],
      [0.25, [90, 0, 0]],
      [0.5, [60, 0, 0]],
      [0.75, [5, 0, 0]],
      [1, [60, 0, 0]],
    ]),
    hand: rotKeys(t, [
      [0, ARM_REST.thrust.hand],
      [0.25, [0, 0, 0]],
      [1, [0, 0, 0]],
    ]),
  };
}

/** Shield bash or punch: cock the arm back, then drive it straight forward. */
function bashArm(t: number, rest: Arm): Arm {
  return {
    shoulder: rotKeys(t, [
      [0, rest.shoulder],
      [0.25, [5, 0, 12]],
      [0.5, [35, 0, 8]],
      [0.75, [85, 0, 2]],
      [1, [30, 0, 8]],
    ]),
    elbow: rotKeys(t, [
      [0, rest.elbow],
      [0.25, [100, 0, 0]],
      [0.5, [75, 0, 0]],
      [0.75, [10, 0, 0]],
      [1, [45, 0, 0]],
    ]),
    hand: rest.hand,
  };
}

function attackArm(kind: ItemKind, t: number): Arm {
  if (kind === 'chop') return chopArm(t);
  if (kind === 'thrust') return thrustArm(t);
  return bashArm(t, ARM_REST[kind]);
}

interface BodyMotion {
  spine: JointRot;
  legs: Joints;
  hips: [number, number, number];
}

/** Torso and legs behind an attack, authored for a right-hand lead. */
function attackBody(kind: ItemKind, t: number): BodyMotion {
  if (kind === 'chop') {
    return {
      spine: rotKeys(t, [
        [0, [-3, 0, 0]],
        [0.5, [8, 12, 0]],
        [0.75, [-18, -10, 0]],
        [1, [-8, 0, 0]],
      ]),
      legs: { hipL: [14, 0, 5], hipR: [-12, 0, 5] },
      hips: [0, keys(t, [[0, -0.02], [0.75, -0.08], [1, -0.04]]), keys(t, [[0, 0], [0.75, 0.06], [1, 0.02]])],
    };
  }
  // thrusts lunge with the whole body; bashes and punches do the same, a little less
  const k = kind === 'thrust' ? 1 : 0.75;
  return {
    spine: rotKeys(t, [
      [0, [-3, 0, 0]],
      [0.25, [4, 10, 0]],
      [0.75, [-16 * k, -12 * k, 0]],
      [1, [-6, 0, 0]],
    ]),
    legs: {
      hipL: rotKeys(t, [
        [0, [4, 0, 5]],
        [0.75, [28 * k, 0, 5]],
        [1, [12, 0, 5]],
      ]),
      hipR: rotKeys(t, [
        [0, [-4, 0, 5]],
        [0.75, [-18 * k, 0, 5]],
        [1, [-8, 0, 5]],
      ]),
      kneeL: rotKeys(t, [
        [0, [-6, 0, 0]],
        [0.75, [-30 * k, 0, 0]],
        [1, [-10, 0, 0]],
      ]),
    },
    hips: [0, keys(t, [[0, -0.02], [0.75, -0.1 * k], [1, -0.04]]), keys(t, [[0, 0], [0.25, -0.04], [0.75, 0.12 * k], [1, 0.03]])],
  };
}

/** Bow hand rises and points at the target while the other hand draws to the face. */
function attackBow(t: number, joints: Joints, bowHand: Hand): Pose {
  const drawHand = otherHand(bowHand);
  setArm(joints, bowHand, {
    shoulder: rotKeys(t, [
      [0, ARM_REST.bow.shoulder],
      [0.25, [80, 0, -10]],
      [0.75, [85, 0, -12]],
      [1, [40, 0, 0]],
    ]),
    elbow: rotKeys(t, [
      [0, ARM_REST.bow.elbow],
      [0.25, [5, 0, 0]],
      [1, [15, 0, 0]],
    ]),
    hand: ARM_REST.bow.hand,
  });
  setArm(joints, drawHand, {
    shoulder: rotKeys(t, [
      [0, ARM_REST.none.shoulder],
      [0.25, [80, 0, -25]],
      [0.5, [85, 0, -15]],
      [0.75, [70, 0, 20]],
      [1, [20, 0, 8]],
    ]),
    elbow: rotKeys(t, [
      [0, ARM_REST.none.elbow],
      [0.25, [100, 0, 0]],
      [0.5, [145, 0, 0]],
      [0.75, [40, 0, 0]],
      [1, [25, 0, 0]],
    ]),
    hand: ARM_REST.none.hand,
  });
  // turn side-on, bow shoulder toward the target, head back toward it
  const yaw = sgn(bowHand);
  const spine = rotKeys(t, [
    [0, [-3, 0, 0]],
    [0.25, [0, 25, 0]],
    [0.5, [2, 32, 0]],
    [0.75, [-2, 25, 0]],
    [1, [-3, 5, 0]],
  ]);
  const head = rotKeys(t, [
    [0, [0, 0, 0]],
    [0.5, [0, -28, 0]],
    [1, [0, -5, 0]],
  ]);
  joints.spine = [spine[0], spine[1] * yaw, spine[2]];
  joints.head = [head[0], head[1] * yaw, head[2]];
  return { joints, hips: [0, -0.02, 0] };
}

/** A second weapon strikes this far (in normalised time) behind the leading one. */
const OFF_HAND_LAG = 0.1;

function attack(t: number, unit: UnitParams): Pose {
  const k = kinds(unit);
  const joints: Joints = { ...armStance(unit), ...LEGS_REST };
  const bowHand = HANDS.find((h) => k[h] === 'bow');
  if (bowHand) return attackBow(t, joints, bowHand);

  // weapons attack; with none, shields bash; with empty hands, the right one punches
  const armed = HANDS.filter((h) => k[h] === 'chop' || k[h] === 'thrust');
  const shields = HANDS.filter((h) => k[h] === 'shield');
  const attackers: Hand[] = armed.length ? armed : shields.length ? shields : ['R'];
  const lead: Hand = attackers.includes('R') ? 'R' : attackers[0];

  for (const h of attackers) {
    const th = h === lead ? t : Math.max(0, (t - OFF_HAND_LAG) / (1 - OFF_HAND_LAG));
    setArm(joints, h, attackArm(k[h], th));
  }
  const body = attackBody(k[lead], t);
  const yaw = sgn(lead);
  return {
    joints: {
      ...joints,
      ...mirrorSides(body.legs, lead),
      spine: [body.spine[0], body.spine[1] * yaw, body.spine[2]],
    },
    hips: body.hips,
  };
}

/** Dying hands let go: weapons end up lying along the arm, shields flat on the ground. */
function dropGear(t: number, kind: ItemKind): JointRot {
  const rest = ARM_REST[kind].hand;
  if (kind === 'shield') {
    return rotKeys(t, [
      [0, rest],
      [1, [45, 0, 0]],
    ]);
  }
  return rotKeys(t, [
    [0, rest],
    [0.67, [40, 0, 0]],
    [1, [0, 0, 0]],
  ]);
}

function death(t: number, unit: UnitParams, hipHeight: number): Pose {
  const lying = 0.13 * unit.bulk - hipHeight;
  const stance = armStance(unit);
  const k = kinds(unit);
  return {
    // A body lying straight along the camera axis reads as someone standing; turning it
    // 22.5 deg keeps every one of the 8 directions at least that far off the axis.
    turn: keys(t, [
      [0, 0],
      [1, 22.5],
    ]),
    joints: {
      ...stance,
      handL: dropGear(t, k.L),
      handR: dropGear(t, k.R),
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

export const ANIMATION_NAMES = ['idle', 'walk', 'attack', 'death'] as const;
export type AnimationName = (typeof ANIMATION_NAMES)[number];

export interface FrameCounts {
  idle: number;
  walk: number;
  attack: number;
  death: number;
}

export const DEFAULT_FRAME_COUNTS: FrameCounts = { idle: 4, walk: 5, attack: 5, death: 4 };

export function humanoidAnimations(counts: FrameCounts = DEFAULT_FRAME_COUNTS): AnimationDef[] {
  return [
    { name: 'idle', frames: counts.idle, fps: 4, loop: true, pose: idle },
    { name: 'walk', frames: counts.walk, fps: 8, loop: true, pose: walk },
    { name: 'attack', frames: counts.attack, fps: 8, loop: false, pose: attack },
    { name: 'death', frames: counts.death, fps: 6, loop: false, pose: death },
  ];
}
