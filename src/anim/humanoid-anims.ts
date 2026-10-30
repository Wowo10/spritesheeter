import { bodyDims, handItems, HOVER, itemKind, otherHand, SECOND_GRIP, type Gait, type Hand, type HandItem, type HeavyItem, type ItemKind, type UnitParams } from '../unit/params';
import { gripPose } from './ik';
import { keys, rotKeys } from './keys';
import type { AnimationDef, JointName, JointRot, Pose } from './types';

type Joints = Partial<Record<JointName, JointRot>>;

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
  // carried at the hip: forearm forward, wrist turned up under the stock, muzzle a little down
  shouldered: { shoulder: [15, 0, 8], elbow: [75, 0, 0], hand: [70, 0, 0] },
  // muzzle up beside the face, the swashbuckler's way (see buildPistol)
  pistol: { shoulder: [20, 0, 10], elbow: [110, 0, 0], hand: [50, 0, 0] },
  // on guard: fist in front of the belly, weapon up and forward; the other hand grips below (see withGrip)
  heavy: { shoulder: [30, 0, -25], elbow: [55, 0, 0], hand: [75, 0, 0] },
  // ready to throw: held up like a spear, forearm forward, wrist turned up
  throw: { shoulder: [15, 0, 8], elbow: [75, 0, 0], hand: [90, 0, 0] },
  // forearm level and palm up, so the orb floats straight above the hand
  orb: { shoulder: [18, 0, 12], elbow: [72, 0, 0], hand: [0, 0, 0] },
};

/** Empty hands per gait: ghosts reach out with limp wrists, zombies hold their arms out straight. */
const EMPTY_ARM: Record<Gait, Arm> = {
  walk: ARM_REST.none,
  float: { shoulder: [55, 0, 8], elbow: [30, 0, 0], hand: [-20, 0, 0] },
  shamble: { shoulder: [75, 0, 4], elbow: [10, 0, 0], hand: [-25, 0, 0] },
};

function restArm(unit: UnitParams, kind: ItemKind): Arm {
  return kind === 'none' ? EMPTY_ARM[unit.gait] : ARM_REST[kind];
}

/**
 * Total arm pitch at which the hand holds each kind upright while casting (orbs float above the
 * palm, crossbows and muskets stay level, pistols point at the sky).
 */
const CAST_WRIST: Partial<Record<ItemKind, number>> = { chop: 180, thrust: 180, orb: 90, shouldered: 180, pistol: 180, heavy: 180, throw: 180 };

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
  for (const h of HANDS) setArm(j, h, restArm(unit, k[h]));
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
    head: [-3 * breath, 10 * look, -1.5 * look],
  };
  for (const h of HANDS) {
    // shoulders rise on the in-breath; weapons bob with them, shields sag a little
    nudge(joints, `shoulder${h}`, [4 * breath, 0, 3 * breath]);
    if (k[h] === 'chop' || k[h] === 'thrust' || k[h] === 'heavy' || k[h] === 'throw' || k[h] === 'pistol') nudge(joints, `hand${h}`, [6 * breath, 0, 0]);
    if (k[h] === 'shield') nudge(joints, `elbow${h}`, [-6 * breath, 0, 0]);
    // the orb bobs up and down above the palm
    if (k[h] === 'orb') nudge(joints, `elbow${h}`, [8 * breath, 0, 0]);
  }
  // weight shifts toward the side the head turns to
  nudge(joints, 'hipL', [0, 0, -3 * look]);
  nudge(joints, 'hipR', [0, 0, 3 * look]);
  return { joints, hips: [0.015 * look, -0.03 + 0.02 * breath, 0] };
}

/** How far each arm counter-swings while walking; hands full of gear swing less. */
const WALK_SWING: Record<ItemKind, number> = { none: 18, bow: 18, shouldered: 10, pistol: 10, heavy: 5, throw: 12, chop: 12, thrust: 12, shield: 8, orb: 6 };

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

/** Leaning into a run: long strides with a moment in the air, empty arms pumping. */
function run(t: number, unit: UnitParams): Pose {
  const phase = t * Math.PI * 2;
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const k = kinds(unit);
  const arms = armStance(unit);
  for (const h of HANDS) {
    if (k[h] === 'none') setArm(arms, h, { shoulder: [10 + sgn(h) * 40 * s, 0, 10], elbow: [85, 0, 0], hand: [0, 0, 0] });
    else nudge(arms, `shoulder${h}`, [sgn(h) * 1.5 * WALK_SWING[k[h]] * s, 0, 0]);
  }
  return {
    joints: {
      ...arms,
      spine: [-16, 8 * s, 0],
      head: [10, -6 * s, 0],
      hipL: [8 + 42 * s, 0, 3],
      hipR: [8 - 42 * s, 0, 3],
      // the trailing foot kicks up behind as it comes through
      kneeL: [-12 - 75 * Math.max(0, c), 0, 0],
      kneeR: [-12 - 75 * Math.max(0, -c), 0, 0],
    },
    // lowest as the legs pass under the body, highest with them spread in the air
    hips: [0, -0.08 + 0.06 * Math.abs(s), 0],
  };
}

/** Arm holding a sack on its shoulder: forearm folded back up to grip its neck. */
const CARRY_ARM: Arm = { shoulder: [35, 0, 0], elbow: [140, 0, 0], hand: [0, 0, 0] };

/**
 * Walks in the unit's gait with a sack over one shoulder, held by the empty hand (the left
 * if both or neither are empty), stooped under its weight.
 */
function carry(t: number, unit: UnitParams, hipHeight: number): Pose {
  const k = kinds(unit);
  const side: Hand = k.L === 'none' || k.R !== 'none' ? 'L' : 'R';
  const p = WALK[unit.gait](t, unit, hipHeight);
  const joints = { ...p.joints };
  setArm(joints, side, CARRY_ARM);
  nudge(joints, 'spine', [-6, 0, 0]);
  const [x, y, z] = p.hips ?? [0, 0, 0];
  return { ...p, joints, hips: [x, y - 0.02, z], load: side };
}

// --- floating and shambling ----------------------------------------------------

/** Legs hanging loose under a floating unit: trailing `trail` degrees back, swaying with s in [-1, 1]. */
function dangle(s: number, trail = 8): Joints {
  return {
    hipL: [-trail + 6 * s, 0, 4],
    hipR: [-trail - 6 - 6 * s, 0, 4],
    kneeL: [-30 - 6 * s, 0, 0],
    kneeR: [-22 + 6 * s, 0, 0],
  };
}

/** Bobs in the air, drifting side to side; empty hands sway in turn. */
function floatIdle(t: number, unit: UnitParams): Pose {
  const phase = t * Math.PI * 2;
  const bob = Math.cos(phase);
  const sway = Math.sin(phase);
  const joints: Joints = {
    ...armStance(unit),
    ...dangle(sway),
    spine: [-4, 0, 3 * sway],
    head: [-3 * bob, 8 * sway, 0],
  };
  for (const h of HANDS) nudge(joints, `shoulder${h}`, [sgn(h) * 6 * sway + 4 * bob, 0, 0]);
  return { joints, hips: [0.02 * sway, HOVER + 0.05 * bob, 0] };
}

/** Glides leaning forward, legs or wisp trailing, rising and sinking once per cycle. */
function floatWalk(t: number, unit: UnitParams): Pose {
  const phase = t * Math.PI * 2;
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const joints: Joints = {
    ...armStance(unit),
    ...dangle(s, 25),
    spine: [-14, 5 * s, 0],
    head: [8, -4 * s, 0],
  };
  for (const h of HANDS) nudge(joints, `shoulder${h}`, [sgn(h) * 8 * s, 0, 0]);
  return { joints, hips: [0, HOVER + 0.06 * c, 0] };
}

/** Hunched and swaying, head lolling to one side. */
function shambleIdle(t: number, unit: UnitParams): Pose {
  const phase = t * Math.PI * 2;
  const bob = Math.cos(phase);
  const sway = Math.sin(phase);
  const joints: Joints = {
    ...armStance(unit),
    hipL: [6, 0, 6],
    hipR: [-6, 0, 10],
    kneeL: [-16, 0, 0],
    kneeR: [-4, 0, 0],
    spine: [-14 + 3 * bob, 4 * sway, -6 + 3 * sway],
    head: [-10, 8 * sway, 18 + 8 * bob],
  };
  for (const h of HANDS) nudge(joints, `shoulder${h}`, [sgn(h) * 5 * sway, 0, 0]);
  return { joints, hips: [0.03 * sway, -0.05 + 0.015 * bob, 0] };
}

/**
 * The left leg takes real steps; the right drags behind, stiff-kneed, and swings out to the
 * side to come forward. The body lurches over whichever leg carries it.
 */
function shambleWalk(t: number, unit: UnitParams): Pose {
  const phase = t * Math.PI * 2;
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const joints: Joints = {
    ...armStance(unit),
    hipL: [30 * s, 0, 4],
    kneeL: [-8 - 45 * Math.max(0, c), 0, 0],
    hipR: [-8 - 14 * s, 0, 6 + 8 * Math.max(0, -s)],
    kneeR: [-3, 0, 0],
    spine: [-16, 10 * s, -8 * s],
    head: [-8, -6 * s, 15 + 12 * c],
  };
  for (const h of HANDS) nudge(joints, `shoulder${h}`, [sgn(h) * 10 * s, 0, 0]);
  // sags onto the dragged leg
  return { joints, hips: [0.04 * s, -0.03 - 0.06 * Math.max(0, -s), 0] };
}

/** Floaters rush along leaning hard into it, legs streaming out behind. */
function floatRun(t: number, unit: UnitParams): Pose {
  const p = floatWalk(t, unit);
  const s = Math.sin(t * Math.PI * 2);
  const joints = { ...p.joints, ...dangle(s, 45) };
  nudge(joints, 'spine', [-12, 0, 0]);
  nudge(joints, 'head', [8, 0, 0]);
  return { ...p, joints };
}

/** Shamblers lurch along faster, pitched forward with the arms reaching. */
function shambleRun(t: number, unit: UnitParams): Pose {
  const p = shambleWalk(t, unit);
  const joints = { ...p.joints };
  nudge(joints, 'spine', [-12, 0, 0]);
  nudge(joints, 'head', [10, 0, 0]);
  for (const h of HANDS) nudge(joints, `shoulder${h}`, [12, 0, 0]);
  return { ...p, joints };
}

const IDLE: Record<Gait, AnimationDef['pose']> = { walk: idle, float: floatIdle, shamble: shambleIdle };
const WALK: Record<Gait, AnimationDef['pose']> = { walk, float: floatWalk, shamble: shambleWalk };
const RUN: Record<Gait, AnimationDef['pose']> = { walk: run, float: floatRun, shamble: shambleRun };

/**
 * Gait on top of the stationary animations: floaters attack and cast in mid-air with their
 * legs dangling; shamblers do it hunched over, and lunge with the head to bite.
 */
function withGait(name: 'attack' | 'cast' | 'channel' | 'hit' | 'work' | 'taunt', pose: AnimationDef['pose']): AnimationDef['pose'] {
  return (t, unit, hipHeight) => {
    const p = pose(t, unit, hipHeight);
    if (unit.gait === 'float') {
      const [x, y, z] = p.hips ?? [0, 0, 0];
      const fx = p.fx && { ...p.fx, pos: [p.fx.pos[0], p.fx.pos[1] + HOVER, p.fx.pos[2]] as [number, number, number] };
      return { ...p, joints: { ...p.joints, ...dangle(0) }, hips: [x, y + HOVER, z], fx };
    }
    if (unit.gait === 'shamble') {
      const joints = { ...p.joints };
      const bite = name === 'attack' ? keys(t, [[0, 0], [0.5, 10], [0.75, -25], [1, 0]]) : 0;
      nudge(joints, 'spine', [-10, 0, 0]);
      nudge(joints, 'head', [-6 + bite, 0, 15]);
      return { ...p, joints };
    }
    return p;
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

function attackArm(kind: ItemKind, t: number, rest: Arm): Arm {
  if (kind === 'chop') return chopArm(t);
  if (kind === 'thrust') return thrustArm(t);
  return bashArm(t, rest);
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

/** How far a crossbowman or musketeer turns side-on to aim, steadying shoulder forward. */
const SHOULDER_TURN = 18;
/**
 * Arm aiming a crossbow or musket from the shoulder, forearm upright, butt beside the cheek.
 * Its yaw and roll undo SHOULDER_TURN, so the shot goes straight ahead.
 */
const SHOULDER_AIM: Arm = { shoulder: [75, -16, -15], elbow: [95, 0, 0], hand: [10, 0, 0] };
/** Empty hand reaching across under the fore-end, just ahead of the other fist. */
const SHOULDER_SUPPORT: Arm = { shoulder: [85, 35, -40], elbow: [5, 0, 0], hand: [0, 0, 0] };

const lerpRot = (a: JointRot, b: JointRot, w: number): JointRot => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];

/** 0 at rest, 1 while a crossbow or gun is up and aimed. */
const aiming = (t: number) => keys(t, [[0, 0], [0.25, 1], [0.8, 1], [1, 0]]);
/** The shot's kick, peaking on the frame after the playground lets the shot fly (0.55). */
const recoil = (t: number) => keys(t, [[0, 0], [0.55, 0], [0.75, 1], [1, 0]]);
/** A gun's muzzle: flashing on the kick's frame, smoking on the next. */
const muzzleAt = (t: number): 'flash' | 'smoke' | undefined => (t > 0.55 && t < 0.85 ? 'flash' : t >= 0.85 ? 'smoke' : undefined);
/** Time for a second gun or crossbow, which fires a beat behind the first. */
const lagged = (t: number) => Math.max(0, (t - OFF_HAND_LAG) / (1 - OFF_HAND_LAG));

function shoulderedArm(t: number): Arm {
  const rest = ARM_REST.shouldered;
  const aim = aiming(t);
  const kick = recoil(t);
  const shoulder = lerpRot(rest.shoulder, SHOULDER_AIM.shoulder, aim);
  const elbow = lerpRot(rest.elbow, SHOULDER_AIM.elbow, aim);
  shoulder[0] += 8 * kick;
  elbow[0] -= 6 * kick;
  // 180 holds the stock level (see buildCrossbow); 4 more makes up for the dip the aim's yaw and roll give it
  const level = 184 + 12 * kick - shoulder[0] - elbow[0];
  return { shoulder, elbow, hand: [rest.hand[0] + (level - rest.hand[0]) * aim, 0, 0] };
}

/**
 * Crossbow or musket raised to the shoulder and aimed (0.25 to 0.8), the muzzle kicking up as
 * it shoots, then lowered. The wrist holds the stock level throughout the aim (see
 * buildCrossbow). An empty other hand (always, for a musket) steadies the fore-end, a second
 * crossbow aims and shoots a beat behind, anything else stays where it is.
 */
function attackShouldered(t: number, joints: Joints, unit: UnitParams, k: Record<Hand, ItemKind>): Pose {
  const lead: Hand = k.R === 'shouldered' ? 'R' : 'L';
  const other = otherHand(lead);
  const items = handItems(unit);
  const muzzle: Pose['muzzle'] = {};
  setArm(joints, lead, shoulderedArm(t));
  if (items[lead] === 'musket') muzzle[lead] = muzzleAt(t);
  if (k[other] === 'shouldered') setArm(joints, other, shoulderedArm(lagged(t)));
  else if (k[other] === 'none') {
    const rest = restArm(unit, 'none');
    const aim = aiming(t);
    setArm(joints, other, {
      shoulder: lerpRot(rest.shoulder, SHOULDER_SUPPORT.shoulder, aim),
      elbow: lerpRot(rest.elbow, SHOULDER_SUPPORT.elbow, aim),
      hand: lerpRot(rest.hand, SHOULDER_SUPPORT.hand, aim),
    });
  }
  // turn a little side-on, the steadying shoulder forward, and sight along the stock;
  // the shot jolts the body back
  const aim = aiming(t);
  const kick = recoil(t);
  const yaw = sgn(lead);
  joints.spine = [-3 + 3 * aim + 5 * kick, -SHOULDER_TURN * aim * yaw, 0];
  joints.head = [-6 * aim + 6 * kick, SHOULDER_TURN * aim * yaw, 0];
  return { joints, hips: [0, -0.02, -0.02 * kick], muzzle };
}

/** How far a pistoleer turns side-on, the pistol shoulder toward the target. */
const PISTOL_TURN = 30;
/**
 * Pistol arm straight out at shoulder height. Its roll swings it back out to undo PISTOL_TURN,
 * so the shot goes straight ahead (yaw would only twist the straight arm about itself).
 */
const PISTOL_AIM: Arm = { shoulder: [85, 0, 30], elbow: [5, 0, 0], hand: [0, 0, 0] };
/** Empty hand tucked behind the back, the duelling stance. */
const BEHIND_BACK: Arm = { shoulder: [-25, 0, 10], elbow: [100, 0, 0], hand: [0, 0, 0] };

/** The pistol raised to arm's length, held level (see buildPistol), the muzzle jumping up as it fires. */
function pistolArm(t: number): Arm {
  const rest = ARM_REST.pistol;
  const aim = aiming(t);
  const kick = recoil(t);
  const shoulder = lerpRot(rest.shoulder, PISTOL_AIM.shoulder, aim);
  const elbow = lerpRot(rest.elbow, PISTOL_AIM.elbow, aim);
  shoulder[0] += 15 * kick;
  // 90 is level (see buildPistol); 3 more makes up for the dip the aim's roll gives it
  const level = 93 + 20 * kick - shoulder[0] - elbow[0];
  return { shoulder, elbow, hand: [rest.hand[0] + (level - rest.hand[0]) * aim, 0, 0] };
}

/**
 * Duellist's shot: side-on, pistol arm out straight at the target, fired with a kick (0.55),
 * then raised back up. An empty other hand goes behind the back; a second pistol fires a beat
 * later; anything else stays where it is.
 */
function attackPistol(t: number, joints: Joints, unit: UnitParams, k: Record<Hand, ItemKind>): Pose {
  const lead: Hand = k.R === 'pistol' ? 'R' : 'L';
  const other = otherHand(lead);
  const muzzle: Pose['muzzle'] = { [lead]: muzzleAt(t) };
  setArm(joints, lead, pistolArm(t));
  if (k[other] === 'pistol') {
    setArm(joints, other, pistolArm(lagged(t)));
    muzzle[other] = muzzleAt(lagged(t));
  } else if (k[other] === 'none') {
    const rest = restArm(unit, 'none');
    const aim = aiming(t);
    setArm(joints, other, {
      shoulder: lerpRot(rest.shoulder, BEHIND_BACK.shoulder, aim),
      elbow: lerpRot(rest.elbow, BEHIND_BACK.elbow, aim),
      hand: lerpRot(rest.hand, BEHIND_BACK.hand, aim),
    });
  }
  const aim = aiming(t);
  const kick = recoil(t);
  const yaw = sgn(lead);
  joints.spine = [-3 + 4 * kick, PISTOL_TURN * aim * yaw, 0];
  joints.head = [-2 * aim + 4 * kick, -PISTOL_TURN * aim * yaw, 0];
  return { joints, hips: [0, -0.02, -0.015 * kick], muzzle };
}

/**
 * Maul or greataxe: heaved up behind the head and smashed down in front, the whole body
 * bending into the blow. Authored for a right-hand lead; the other hand follows on the haft.
 */
function smash(t: number, joints: Joints, lead: Hand): Pose {
  const rest = ARM_REST.heavy;
  setArm(joints, lead, {
    shoulder: rotKeys(t, [
      [0, rest.shoulder],
      [0.25, [150, 0, -15]],
      [0.5, [170, 0, -15]],
      [0.75, [55, 0, -20]],
      [1, rest.shoulder],
    ]),
    elbow: rotKeys(t, [
      [0, rest.elbow],
      [0.25, [70, 0, 0]],
      [0.5, [80, 0, 0]],
      [0.75, [10, 0, 0]],
      [1, rest.elbow],
    ]),
    hand: rotKeys(t, [
      [0, rest.hand],
      [0.25, [40, 0, 0]],
      [0.5, [40, 0, 0]],
      [0.75, [20, 0, 0]],
      [1, rest.hand],
    ]),
  });
  const spine = rotKeys(t, [
    [0, [-3, 0, 0]],
    [0.5, [12, 10, 0]],
    [0.75, [-28, -8, 0]],
    [1, [-6, 0, 0]],
  ]);
  const legs: Joints = {
    hipL: rotKeys(t, [[0, [4, 0, 5]], [0.75, [30, 0, 6]], [1, [10, 0, 5]]]),
    hipR: rotKeys(t, [[0, [-4, 0, 5]], [0.75, [-20, 0, 6]], [1, [-6, 0, 5]]]),
    kneeL: rotKeys(t, [[0, [-6, 0, 0]], [0.75, [-35, 0, 0]], [1, [-10, 0, 0]]]),
  };
  return {
    joints: { ...joints, ...mirrorSides(legs, lead), spine: [spine[0], spine[1] * sgn(lead), spine[2]] },
    hips: [0, keys(t, [[0, -0.02], [0.5, 0], [0.75, -0.12], [1, -0.04]]), keys(t, [[0, 0], [0.5, -0.03], [0.75, 0.08], [1, 0.02]])],
  };
}

/**
 * Greatsword: wound back to the lead side, then swept across at waist height to the far side,
 * the torso turning through the swing. Authored for a right-hand lead.
 */
function sweep(t: number, joints: Joints, lead: Hand): Pose {
  const rest = ARM_REST.heavy;
  // yaw > 0 swings the arm out to its own side, < 0 across the body
  setArm(joints, lead, {
    shoulder: rotKeys(t, [
      [0, rest.shoulder],
      [0.3, [70, 45, 10]],
      [0.45, [70, 35, 5]],
      [0.75, [70, -50, -10]],
      [1, rest.shoulder],
    ]),
    elbow: rotKeys(t, [
      [0, rest.elbow],
      [0.3, [40, 0, 0]],
      [0.75, [20, 0, 0]],
      [1, rest.elbow],
    ]),
    hand: rotKeys(t, [
      [0, rest.hand],
      [0.3, [0, 0, 0]],
      [0.75, [0, 0, 0]],
      [1, rest.hand],
    ]),
  });
  const spine = rotKeys(t, [
    [0, [-3, 0, 0]],
    [0.3, [4, -40, 0]],
    [0.45, [0, -30, 0]],
    [0.75, [-10, 45, 0]],
    [1, [-4, 0, 0]],
  ]);
  const head = rotKeys(t, [
    [0, [0, 0, 0]],
    [0.3, [0, 25, 0]],
    [0.75, [0, -30, 0]],
    [1, [0, 0, 0]],
  ]);
  const yaw = sgn(lead);
  return {
    joints: {
      ...joints,
      hipL: [10, 0, 10],
      hipR: [-8, 0, 10],
      kneeL: [-12, 0, 0],
      kneeR: [-10, 0, 0],
      spine: [spine[0], spine[1] * yaw, spine[2]],
      head: [head[0], head[1] * yaw, head[2]],
    },
    hips: [0, keys(t, [[0, -0.03], [0.3, -0.06], [0.75, -0.08], [1, -0.04]]), 0],
  };
}

function attackHeavy(t: number, joints: Joints, item: HandItem, lead: Hand): Pose {
  return item === 'greatsword' ? sweep(t, joints, lead) : smash(t, joints, lead);
}

/**
 * Javelin or throwing axe, overarm: cocked back above the shoulder (0.25), whipped over and let
 * go at full reach (0.6), followed through down across the body. Until the release the wrist
 * holds the item level and point-first, like a crossbow's (see shoulderedArm).
 */
function overarmArm(t: number): Arm {
  const rest = ARM_REST.throw;
  const shoulder = rotKeys(t, [
    [0, rest.shoulder],
    // no roll while cocked, which would turn the level javelin out to the side; the yaw
    // undoes the body's wind-up twist, so it points at the target
    [0.25, [165, 25, 0]],
    [0.45, [140, 5, 0]],
    [0.6, [90, 0, 0]],
    [0.8, [35, 0, -15]],
    [1, rest.shoulder],
  ]);
  const elbow = rotKeys(t, [
    [0, rest.elbow],
    [0.25, [100, 0, 0]],
    [0.45, [60, 0, 0]],
    [0.6, [5, 0, 0]],
    [0.8, [15, 0, 0]],
    [1, rest.elbow],
  ]);
  const hold = keys(t, [[0, 0], [0.25, 1], [0.55, 1], [0.7, 0], [1, 0]]);
  // 90 is level; a little more tips the point up for distance
  const level = 100 - shoulder[0] - elbow[0];
  return { shoulder, elbow, hand: [rest.hand[0] + (level - rest.hand[0]) * hold, 0, 0] };
}

/** Bomb, underarm: swung back low past the hip (0.3), then up and forward to lob it high (0.6). */
function underarmArm(t: number): Arm {
  const rest = ARM_REST.throw;
  return {
    shoulder: rotKeys(t, [
      [0, rest.shoulder],
      [0.3, [-50, 0, 10]],
      [0.45, [-10, 0, 8]],
      [0.6, [110, 0, 0]],
      [0.8, [130, 0, -5]],
      [1, rest.shoulder],
    ]),
    elbow: rotKeys(t, [
      [0, rest.elbow],
      [0.3, [10, 0, 0]],
      [0.6, [10, 0, 0]],
      [0.8, [20, 0, 0]],
      [1, rest.elbow],
    ]),
    hand: rotKeys(t, [
      [0, rest.hand],
      [0.3, [20, 0, 0]],
      [0.6, [30, 0, 0]],
      [1, rest.hand],
    ]),
  };
}

/**
 * Throws what the lead hand holds; the playground lets it fly at 0.55, after which the hand
 * is empty until another is drawn on the last frame. An empty other hand points at the target,
 * then pulls back as the throw comes through; anything else it holds stays put.
 */
function attackThrow(t: number, joints: Joints, unit: UnitParams, item: HandItem, lead: Hand): Pose {
  const lob = item === 'bomb';
  setArm(joints, lead, lob ? underarmArm(t) : overarmArm(t));
  const other = otherHand(lead);
  if (handItems(unit)[other] === 'none') {
    const rest = restArm(unit, 'none');
    setArm(joints, other, {
      shoulder: rotKeys(t, [
        [0, rest.shoulder],
        [0.25, [80, 0, -5]],
        [0.5, [70, 0, 0]],
        [0.65, [20, 0, 15]],
        [1, rest.shoulder],
      ]),
      elbow: rotKeys(t, [
        [0, rest.elbow],
        [0.25, [10, 0, 0]],
        [0.65, [60, 0, 0]],
        [1, rest.elbow],
      ]),
      hand: rest.hand,
    });
  }
  // authored for a right-hand lead: the lead shoulder turns back to wind up, then through;
  // overarm leans back and steps into it, underarm crouches and rises with the lob
  const spine = lob
    ? rotKeys(t, [
        [0, [-3, 0, 0]],
        [0.3, [-12, -20, 0]],
        [0.6, [6, 15, 0]],
        [1, [-3, 0, 0]],
      ])
    : rotKeys(t, [
        [0, [-3, 0, 0]],
        [0.25, [8, -25, 0]],
        [0.5, [0, -5, 0]],
        [0.65, [-16, 20, 0]],
        [1, [-4, 0, 0]],
      ]);
  const legs: Joints = lob
    ? {
        hipL: rotKeys(t, [[0, [4, 0, 5]], [0.3, [22, 0, 5]], [0.6, [10, 0, 5]], [1, [4, 0, 5]]]),
        hipR: rotKeys(t, [[0, [-4, 0, 5]], [0.3, [10, 0, 5]], [0.6, [-8, 0, 5]], [1, [-4, 0, 5]]]),
        kneeL: rotKeys(t, [[0, [-6, 0, 0]], [0.3, [-35, 0, 0]], [0.6, [-8, 0, 0]], [1, [-6, 0, 0]]]),
        kneeR: rotKeys(t, [[0, [-6, 0, 0]], [0.3, [-30, 0, 0]], [0.6, [-6, 0, 0]], [1, [-6, 0, 0]]]),
      }
    : {
        hipL: rotKeys(t, [[0, [4, 0, 5]], [0.25, [20, 0, 5]], [0.65, [30, 0, 5]], [1, [8, 0, 5]]]),
        hipR: rotKeys(t, [[0, [-4, 0, 5]], [0.65, [-20, 0, 5]], [1, [-6, 0, 5]]]),
        kneeL: rotKeys(t, [[0, [-6, 0, 0]], [0.25, [-20, 0, 0]], [0.65, [-30, 0, 0]], [1, [-10, 0, 0]]]),
      };
  const hips: [number, number, number] = lob
    ? [0, keys(t, [[0, -0.02], [0.3, -0.1], [0.6, -0.01], [1, -0.02]]), keys(t, [[0, 0], [0.6, 0.04], [1, 0]])]
    : [0, keys(t, [[0, -0.02], [0.25, -0.03], [0.65, -0.08], [1, -0.03]]), keys(t, [[0, 0], [0.25, -0.04], [0.65, 0.08], [1, 0.02]])];
  return {
    joints: { ...joints, ...mirrorSides(legs, lead), spine: [spine[0], spine[1] * sgn(lead), spine[2]] },
    hips,
    thrown: t > 0.55 && t < 0.95 ? lead : undefined,
  };
}

function attack(t: number, unit: UnitParams): Pose {
  const k = kinds(unit);
  const joints: Joints = { ...armStance(unit), ...LEGS_REST };
  const bowHand = HANDS.find((h) => k[h] === 'bow');
  if (bowHand) return attackBow(t, joints, bowHand);
  if (k.L === 'shouldered' || k.R === 'shouldered') return attackShouldered(t, joints, unit, k);
  if (k.L === 'pistol' || k.R === 'pistol') return attackPistol(t, joints, unit, k);
  const heavyHand = HANDS.find((h) => k[h] === 'heavy');
  const thrower: Hand | undefined = k.R === 'throw' ? 'R' : k.L === 'throw' ? 'L' : undefined;
  if (thrower) return attackThrow(t, joints, unit, handItems(unit)[thrower], thrower);
  if (heavyHand) return attackHeavy(t, joints, handItems(unit)[heavyHand], heavyHand);

  // weapons attack; failing that, orbs are thrust at the enemy, then shields bash;
  // with empty hands, the right one punches, or a shambler claws with both
  const armed = HANDS.filter((h) => k[h] === 'chop' || k[h] === 'thrust');
  const orbs = HANDS.filter((h) => k[h] === 'orb');
  const shields = HANDS.filter((h) => k[h] === 'shield');
  const attackers: Hand[] = armed.length ? armed : orbs.length ? orbs : shields.length ? shields : unit.gait === 'shamble' ? HANDS : ['R'];
  const lead: Hand = attackers.includes('R') ? 'R' : attackers[0];

  for (const h of attackers) {
    const th = h === lead ? t : Math.max(0, (t - OFF_HAND_LAG) / (1 - OFF_HAND_LAG));
    setArm(joints, h, attackArm(k[h], th, restArm(unit, k[h])));
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
  if (unit.body === 'ghost') return ghostDeath(t, unit);
  const pose = fall(t, unit, hipHeight);
  if (unit.gait !== 'float') return pose;
  // drops out of the air
  const [x, y, z] = pose.hips!;
  return { ...pose, hips: [x, y + HOVER * keys(t, [[0, 1], [0.67, 0], [1, 0]]), z] };
}

/** Rises, arching back with the arms thrown up, and fades away. */
function ghostDeath(t: number, unit: UnitParams): Pose {
  const joints: Joints = { ...armStance(unit), ...dangle(0) };
  for (const h of HANDS) {
    joints[`shoulder${h}`] = rotKeys(t, [
      [0, joints[`shoulder${h}`]!],
      [0.5, [140, 0, 30]],
      [1, [165, 0, 40]],
    ]);
    joints[`elbow${h}`] = rotKeys(t, [
      [0, joints[`elbow${h}`]!],
      [1, [5, 0, 0]],
    ]);
  }
  joints.spine = rotKeys(t, [
    [0, [-4, 0, 0]],
    [0.5, [14, 0, 0]],
    [1, [20, 0, 0]],
  ]);
  joints.head = rotKeys(t, [
    [0, [0, 0, 0]],
    [0.5, [25, 0, 0]],
    [1, [30, 0, 0]],
  ]);
  return {
    joints,
    hips: [0, HOVER + keys(t, [[0, 0], [1, 0.45]]), 0],
    opacity: keys(t, [[0, 1], [0.3, 0.9], [1, 0]]),
  };
}

function fall(t: number, unit: UnitParams, hipHeight: number): Pose {
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

/**
 * Spell cast: gather energy at the chest, raise it overhead, hurl it forward with both hands.
 * Whatever the hands hold comes along; a staff ends up raised high, which reads well.
 */
function cast(t: number, unit: UnitParams, hipHeight: number): Pose {
  const dims = bodyDims(unit);
  const shoulderY = hipHeight + 0.06 + dims.torsoLen;
  // hands overhead: shoulder plus most of the arm
  const overhead = 0.83 * (dims.upperArm + dims.forearm);
  const joints: Joints = { ...armStance(unit), hipL: [10, 0, 8], hipR: [-8, 0, 8], kneeL: [-10, 0, 0], kneeR: [-6, 0, 0] };
  // starts and ends in each arm's own resting pose, so the cast blends with idle
  const castArm = (rest: Arm): Arm => ({
    // roll < 0 brings the hands together in front of the body
    shoulder: rotKeys(t, [
      [0, rest.shoulder],
      [0.2, [50, 0, -25]],
      [0.45, [165, 0, -10]],
      [0.7, [95, 0, -18]],
      [1, rest.shoulder],
    ]),
    elbow: rotKeys(t, [
      [0, rest.elbow],
      [0.2, [110, 0, 0]],
      [0.45, [25, 0, 0]],
      [0.7, [0, 0, 0]],
      [1, rest.elbow],
    ]),
    hand: rest.hand,
  });
  // The wrist keeps held items upright while casting (see CAST_WRIST), so a staff rises with
  // the hands instead of swinging around behind the back, and an orb stays above the palm.
  const upright = keys(t, [
    [0, 0],
    [0.2, 1],
    [0.8, 1],
    [1, 0],
  ]);
  const k = kinds(unit);
  for (const h of HANDS) {
    const arm = castArm(restArm(unit, k[h]));
    const rest = arm.hand;
    const target = CAST_WRIST[k[h]];
    const wrist = target === undefined ? rest[0] : target - arm.shoulder[0] - arm.elbow[0];
    setArm(joints, h, { ...arm, hand: [rest[0] + (wrist - rest[0]) * upright, 0, 0] });
  }
  joints.spine = rotKeys(t, [
    [0, [-3, 0, 0]],
    [0.45, [12, 0, 0]],
    [0.7, [-14, 0, 0]],
    [1, [-3, 0, 0]],
  ]);
  joints.head = rotKeys(t, [
    [0, [0, 0, 0]],
    [0.45, [18, 0, 0]],
    [0.7, [-6, 0, 0]],
    [1, [0, 0, 0]],
  ]);
  return {
    joints,
    hips: [0, -0.04, keys(t, [[0, 0], [0.45, -0.04], [0.7, 0.07], [1, 0]])],
    // the spell follows the hands: chest, overhead, then flung out in front
    fx: {
      pos: [
        0,
        keys(t, [
          [0, shoulderY - 0.15],
          [0.2, shoulderY - 0.1],
          [0.45, shoulderY + overhead],
          [0.7, shoulderY],
          [1, shoulderY - 0.1],
        ]),
        keys(t, [
          [0, 0.3],
          [0.2, 0.35],
          [0.45, 0.15],
          [0.7, 0.85],
          [1, 1.3],
        ]),
      ],
      scale: keys(t, [
        [0, 0],
        [0.2, 0.55],
        [0.45, 1],
        [0.7, 1.4],
        [0.85, 0.9],
        [1, 0],
      ]),
    },
  };
}

/**
 * Channelling, looped: legs braced, both hands held out in front, pouring energy into a spell
 * that hangs just past the fingertips. The arms push and draw back with each pulse; the spell
 * swells on the push and its sparks turn a quarter turn per loop, which their ring repeats.
 */
function channel(t: number, unit: UnitParams, hipHeight: number): Pose {
  const phase = t * Math.PI * 2;
  const push = Math.sin(phase);
  const pulse = Math.cos(phase);
  const dims = bodyDims(unit);
  const sink = -0.05 + 0.01 * pulse;
  const shoulderY = hipHeight + 0.06 + dims.torsoLen + sink;
  const reach = dims.upperArm + dims.forearm;
  const joints: Joints = {
    hipL: [10, 0, 8],
    hipR: [-8, 0, 8],
    kneeL: [-12, 0, 0],
    kneeR: [-8, 0, 0],
    spine: [-6 + 2 * pulse, 0, 0],
    head: [-4, 0, 0],
  };
  // roll < 0 brings the hands in toward the spell; the wrists hold items upright, as in cast
  const k = kinds(unit);
  for (const h of HANDS) {
    const shoulder: JointRot = [80 + 5 * push, 0, -20];
    const elbow: JointRot = [30 - 12 * push, 0, 0];
    const target = CAST_WRIST[k[h]];
    const wrist = target === undefined ? restArm(unit, k[h]).hand[0] : target - shoulder[0] - elbow[0];
    setArm(joints, h, { shoulder, elbow, hand: [wrist, 0, 0] });
  }
  return {
    joints,
    hips: [0, sink, 0],
    fx: {
      pos: [0, shoulderY + 0.05 + 0.02 * push, 0.9 * reach + 0.12 + 0.04 * push],
      scale: 1.1 + 0.2 * push,
      spin: 90 * t,
    },
  };
}

/** Knocked back by a blow: head snaps back, arms fly up, half a step back, then recovers. */
function hit(t: number, unit: UnitParams): Pose {
  const r = keys(t, [[0, 0], [0.25, 1], [1, 0]]);
  const joints: Joints = { ...armStance(unit), ...LEGS_REST };
  for (const h of HANDS) nudge(joints, `shoulder${h}`, [15 * r, 0, 10 * r]);
  nudge(joints, 'hipR', [-14 * r, 0, 0]);
  nudge(joints, 'kneeL', [-14 * r, 0, 0]);
  joints.spine = [-3 + 16 * r, 0, 4 * r];
  joints.head = [14 * r, 0, -6 * r];
  return { joints, hips: [0, -0.03 * r, -0.06 * r] };
}

/**
 * Looped labour: the tool hand (a weapon or tool if it has one, the right otherwise) swings
 * its item up overhead and drives it down into the ground in front, bending into the blow.
 * An empty other hand grips the haft too. Reads as mining, chopping, hammering or digging.
 */
function work(t: number, unit: UnitParams): Pose {
  const k = kinds(unit);
  const tools = HANDS.filter((h) => k[h] === 'chop' || k[h] === 'thrust' || k[h] === 'heavy');
  const lead: Hand = tools.includes('R') || tools.length === 0 ? 'R' : 'L';
  const swing: Arm = {
    shoulder: rotKeys(t, [
      [0, [60, 0, 10]],
      [0.35, [165, 0, 8]],
      [0.6, [40, 0, 6]],
      [0.8, [30, 0, 8]],
      [1, [60, 0, 10]],
    ]),
    elbow: rotKeys(t, [
      [0, [50, 0, 0]],
      [0.35, [70, 0, 0]],
      [0.6, [5, 0, 0]],
      [0.8, [15, 0, 0]],
      [1, [50, 0, 0]],
    ]),
    // the head of the tool trails behind the hands on the way up and strikes forward-down
    hand: rotKeys(t, [
      [0, [40, 0, 0]],
      [0.35, [20, 0, 0]],
      [0.6, [30, 0, 0]],
      [1, [40, 0, 0]],
    ]),
  };
  const joints: Joints = { ...armStance(unit), hipL: [14, 0, 8], hipR: [-10, 0, 8], kneeL: [-18, 0, 0], kneeR: [-14, 0, 0] };
  setArm(joints, lead, swing);
  const other = otherHand(lead);
  // roll < 0 brings the hand in to the haft
  if (k[other] === 'none') setArm(joints, other, { ...swing, shoulder: [swing.shoulder[0], 0, -18], elbow: [swing.elbow[0] + 15, 0, 0] });
  const spine = rotKeys(t, [
    [0, [-6, 0, 0]],
    [0.35, [6, 8, 0]],
    [0.6, [-26, -6, 0]],
    [0.8, [-24, 0, 0]],
    [1, [-6, 0, 0]],
  ]);
  joints.spine = [spine[0], spine[1] * sgn(lead), spine[2]];
  joints.head = [keys(t, [[0, 0], [0.35, 8], [0.6, 14], [1, 0]]), 0, 0];
  return { joints, hips: [0, keys(t, [[0, -0.05], [0.35, -0.03], [0.6, -0.1], [0.8, -0.1], [1, -0.05]]), 0] };
}

/**
 * Shouts a challenge: the weapon hand (as for work) thrusts its item overhead and shakes it
 * twice, held upright, while an empty other hand beckons the enemy on. Starts and ends in
 * the stance, like attack.
 */
function taunt(t: number, unit: UnitParams): Pose {
  const k = kinds(unit);
  const tools = HANDS.filter((h) => k[h] !== 'none' && k[h] !== 'shield');
  const lead: Hand = tools.includes('R') || tools.length === 0 ? 'R' : 'L';
  const joints: Joints = { ...armStance(unit), hipL: [10, 0, 10], hipR: [-8, 0, 10], kneeL: [-8, 0, 0], kneeR: [-6, 0, 0] };
  const rest = restArm(unit, k[lead]);
  // up at 0.25, two shakes, back down
  const shoulder = rotKeys(t, [
    [0, rest.shoulder],
    [0.25, [165, 0, 18]],
    [0.4, [145, 0, 22]],
    [0.55, [168, 0, 18]],
    [0.7, [145, 0, 22]],
    [1, rest.shoulder],
  ]);
  const elbow = rotKeys(t, [
    [0, rest.elbow],
    [0.25, [15, 0, 0]],
    [0.4, [40, 0, 0]],
    [0.55, [15, 0, 0]],
    [0.7, [40, 0, 0]],
    [1, rest.elbow],
  ]);
  const upright = keys(t, [[0, 0], [0.25, 1], [0.7, 1], [1, 0]]);
  const target = CAST_WRIST[k[lead]];
  const wrist = target === undefined ? rest.hand[0] : target - shoulder[0] - elbow[0];
  setArm(joints, lead, { shoulder, elbow, hand: [rest.hand[0] + (wrist - rest.hand[0]) * upright, 0, 0] });

  const other = otherHand(lead);
  // a two-hander is raised in both hands (see withGrip)
  if (k[other] === 'none' && k[lead] !== 'heavy') {
    // arm out in front, palm up, curling the forearm in twice: "come on"
    const out = keys(t, [[0, 0], [0.25, 1], [0.8, 1], [1, 0]]);
    const curl = keys(t, [[0, 0], [0.3, 0], [0.45, 1], [0.6, 0], [0.75, 1], [0.9, 0], [1, 0]]);
    const r = restArm(unit, 'none');
    setArm(joints, other, {
      shoulder: [r.shoulder[0] + (55 - r.shoulder[0]) * out, 0, r.shoulder[2] + (14 - r.shoulder[2]) * out],
      elbow: [r.elbow[0] + (25 - r.elbow[0]) * out + 70 * curl, 0, 0],
      hand: [0, 0, 0],
    });
  }
  // chest out, head thrown back on each shout
  const shout = keys(t, [[0, 0], [0.25, 1], [0.4, 0.6], [0.55, 1], [0.7, 0.6], [1, 0]]);
  joints.spine = [-3 + 11 * shout, 6 * sgn(lead) * shout, 0];
  joints.head = [16 * shout, 0, 0];
  return { joints, hips: [0, -0.02 - 0.02 * shout, -0.02 * shout] };
}

// --- cape: secondary motion layered on top of every animation -----------------

/** How far the cape and its lower half lift backward (degrees) at time t. */
type CapeMotion = (t: number) => [flare: number, tip: number];

const CAPE: Record<string, CapeMotion> = {
  idle: (t) => {
    const breath = Math.cos(t * Math.PI * 2);
    return [5 + 2 * breath, 3 - 2 * breath];
  },
  // the tip lags the upper half by a quarter step, so it ripples rather than flaps
  walk: (t) => [12 + 8 * Math.abs(Math.sin(t * Math.PI * 2)), 8 + 8 * Math.abs(Math.cos(t * Math.PI * 2))],
  attack: (t) => [
    keys(t, [[0, 5], [0.5, 10], [0.75, 28], [1, 10]]),
    keys(t, [[0, 3], [0.5, 6], [0.75, 22], [1, 12]]),
  ],
  // billows in the spell's wind
  cast: (t) => [
    keys(t, [[0, 5], [0.2, 12], [0.45, 34], [0.7, 22], [1, 5]]),
    keys(t, [[0, 3], [0.2, 8], [0.45, 26], [0.7, 32], [1, 4]]),
  ],
  // held back by the spell's steady wind, rippling with each pulse
  channel: (t) => [18 + 4 * Math.sin(t * Math.PI * 2), 14 + 5 * Math.cos(t * Math.PI * 2)],
  // streams up while falling, then lies flat under the body
  death: (t) => [
    keys(t, [[0, 8], [0.33, 25], [0.67, 45], [1, 0]]),
    keys(t, [[0, 5], [0.67, 30], [1, 0]]),
  ],
  hit: (t) => [keys(t, [[0, 5], [0.25, 20], [1, 5]]), keys(t, [[0, 3], [0.25, 14], [1, 3]])],
  run: (t) => [30 + 8 * Math.abs(Math.sin(t * Math.PI * 2)), 22 + 10 * Math.abs(Math.cos(t * Math.PI * 2))],
  // swings out behind as the body bends into the blow
  work: (t) => [keys(t, [[0, 6], [0.35, 4], [0.6, 16], [0.8, 12], [1, 6]]), keys(t, [[0, 4], [0.6, 8], [0.8, 14], [1, 4]])],
  taunt: (t) => [keys(t, [[0, 5], [0.25, 14], [0.55, 18], [1, 5]]), keys(t, [[0, 3], [0.4, 12], [0.7, 14], [1, 3]])],
  // weighed down by the sack, it barely lifts
  carry: (t) => [6 + 4 * Math.abs(Math.sin(t * Math.PI * 2)), 4 + 4 * Math.abs(Math.cos(t * Math.PI * 2))],
};

/** A ghost's wisp: [upper, tip] rotations. Its sideways roll lags a quarter cycle down the tip. */
type TailMotion = (t: number) => [JointRot, JointRot];

const TAIL: Record<string, TailMotion> = {
  idle: (t) => {
    const phase = t * Math.PI * 2;
    return [
      [-6 + 3 * Math.sin(phase), 0, 6 * Math.cos(phase)],
      [-8 + 4 * Math.cos(phase), 0, 10 * Math.sin(phase)],
    ];
  },
  walk: (t) => {
    const phase = t * Math.PI * 2;
    return [
      [-28 - 5 * Math.sin(phase), 0, 8 * Math.cos(phase)],
      [-18 - 8 * Math.cos(phase), 0, 12 * Math.sin(phase)],
    ];
  },
  attack: (t) => [
    [keys(t, [[0, -6], [0.5, -10], [0.75, -32], [1, -12]]), 0, 0],
    [keys(t, [[0, -8], [0.5, -6], [0.75, -24], [1, -14]]), 0, 0],
  ],
  cast: (t) => [
    [keys(t, [[0, -6], [0.45, -20], [0.7, -14], [1, -6]]), 0, 0],
    [keys(t, [[0, -8], [0.45, -16], [0.7, -26], [1, -8]]), 0, 0],
  ],
  channel: (t) => {
    const phase = t * Math.PI * 2;
    return [
      [-16 + 3 * Math.sin(phase), 0, 4 * Math.cos(phase)],
      [-14 + 4 * Math.cos(phase), 0, 6 * Math.sin(phase)],
    ];
  },
  // hangs straight while the body arches back, so it swings forward of it
  death: (t) => [
    [keys(t, [[0, -6], [1, 12]]), 0, 0],
    [keys(t, [[0, -8], [1, 20]]), 0, 0],
  ],
  hit: (t) => [
    [keys(t, [[0, -6], [0.25, 4], [1, -6]]), 0, 0],
    [keys(t, [[0, -8], [0.25, 6], [1, -8]]), 0, 0],
  ],
  run: (t) => {
    const phase = t * Math.PI * 2;
    return [
      [-40 - 5 * Math.sin(phase), 0, 6 * Math.cos(phase)],
      [-26 - 8 * Math.cos(phase), 0, 10 * Math.sin(phase)],
    ];
  },
  work: (t) => [
    [keys(t, [[0, -6], [0.6, -14], [1, -6]]), 0, 0],
    [keys(t, [[0, -8], [0.8, -16], [1, -8]]), 0, 0],
  ],
  carry: (t) => TAIL.walk(t),
  taunt: (t) => [
    [keys(t, [[0, -6], [0.4, -14], [1, -6]]), 0, 0],
    [keys(t, [[0, -8], [0.55, -18], [1, -8]]), 0, 0],
  ],
};

/**
 * The other hand on a two-handed weapon's grip, whatever the lead arm does; except in death,
 * where the hands let go, and carry, where it holds the sack.
 */
function withGrip(name: string, pose: AnimationDef['pose']): AnimationDef['pose'] {
  if (name === 'death' || name === 'carry') return pose;
  return (t, unit, hipHeight) => {
    const p = pose(t, unit, hipHeight);
    const items = handItems(unit);
    const lead = HANDS.find((h) => itemKind(items[h]) === 'heavy');
    if (!lead) return p;
    const joints = { ...p.joints };
    gripPose(joints, unit, lead, SECOND_GRIP[items[lead] as HeavyItem]);
    return { ...p, joints };
  };
}

/** Cape and wisp motion, and the unit's opacity, layered over a pose. */
function withSecondary(name: string, pose: AnimationDef['pose']): AnimationDef['pose'] {
  const cape = CAPE[name];
  const tail = TAIL[name];
  return (t, unit, hipHeight) => {
    const p = pose(t, unit, hipHeight);
    const [flare, tip] = cape(t);
    const [tailUpper, tailTip] = tail(t);
    return {
      ...p,
      joints: { ...p.joints, cape: [-flare, 0, 0], capeTip: [-tip, 0, 0], tail: tailUpper, tailTip },
      opacity: unit.opacity * (p.opacity ?? 1),
    };
  };
}

// new animations go last: rows of sheets games already use must not shift
// decay isn't posed: it's the end of death, rotting (see sheetRows in main.ts)
export const ANIMATION_NAMES = ['idle', 'walk', 'attack', 'cast', 'death', 'channel', 'hit', 'run', 'work', 'carry', 'taunt', 'build', 'decay'] as const;
export type AnimationName = (typeof ANIMATION_NAMES)[number];

export type FrameCounts = Record<AnimationName, number>;

export const DEFAULT_FRAME_COUNTS: FrameCounts = { idle: 4, walk: 5, attack: 5, cast: 6, death: 4, channel: 4, hit: 3, run: 6, work: 5, carry: 5, taunt: 6, build: 8, decay: 4 };

/** The sheet's animations, top to bottom. */
export function humanoidAnimations(counts: FrameCounts = DEFAULT_FRAME_COUNTS): AnimationDef[] {
  const all: AnimationDef[] = [
    { name: 'idle', frames: counts.idle, fps: 4, loop: true, pose: (t, u, h) => IDLE[u.gait](t, u, h) },
    { name: 'walk', frames: counts.walk, fps: 8, loop: true, pose: (t, u, h) => WALK[u.gait](t, u, h) },
    { name: 'attack', frames: counts.attack, fps: 8, loop: false, pose: withGait('attack', attack) },
    { name: 'cast', frames: counts.cast, fps: 8, loop: false, pose: withGait('cast', cast) },
    { name: 'death', frames: counts.death, fps: 6, loop: false, pose: death },
    { name: 'channel', frames: counts.channel, fps: 6, loop: true, pose: withGait('channel', channel) },
    { name: 'hit', frames: counts.hit, fps: 10, loop: false, pose: withGait('hit', hit) },
    { name: 'run', frames: counts.run, fps: 12, loop: true, pose: (t, u, h) => RUN[u.gait](t, u, h) },
    { name: 'work', frames: counts.work, fps: 8, loop: true, pose: withGait('work', work) },
    { name: 'carry', frames: counts.carry, fps: 8, loop: true, pose: carry },
    { name: 'taunt', frames: counts.taunt, fps: 8, loop: false, pose: withGait('taunt', taunt) },
  ];
  return all.map((a) => ({ ...a, pose: withSecondary(a.name, withGrip(a.name, a.pose)) }));
}
