import { bodyDims, handItems, HOVER, itemKind, otherHand, type Gait, type Hand, type ItemKind, type UnitParams } from '../unit/params';
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

/** Total arm pitch at which the hand holds each kind upright while casting (orbs float above the palm). */
const CAST_WRIST: Partial<Record<ItemKind, number>> = { chop: 180, thrust: 180, orb: 90 };

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
    if (k[h] === 'chop' || k[h] === 'thrust') nudge(joints, `hand${h}`, [6 * breath, 0, 0]);
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
const WALK_SWING: Record<ItemKind, number> = { none: 18, bow: 18, chop: 12, thrust: 12, shield: 8, orb: 6 };

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

const IDLE: Record<Gait, AnimationDef['pose']> = { walk: idle, float: floatIdle, shamble: shambleIdle };
const WALK: Record<Gait, AnimationDef['pose']> = { walk, float: floatWalk, shamble: shambleWalk };

/**
 * Gait on top of the stationary animations: floaters attack and cast in mid-air with their
 * legs dangling; shamblers do it hunched over, and lunge with the head to bite.
 */
function withGait(name: 'attack' | 'cast' | 'channel', pose: AnimationDef['pose']): AnimationDef['pose'] {
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

function attack(t: number, unit: UnitParams): Pose {
  const k = kinds(unit);
  const joints: Joints = { ...armStance(unit), ...LEGS_REST };
  const bowHand = HANDS.find((h) => k[h] === 'bow');
  if (bowHand) return attackBow(t, joints, bowHand);

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
};

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
export const ANIMATION_NAMES = ['idle', 'walk', 'attack', 'cast', 'death', 'channel'] as const;
export type AnimationName = (typeof ANIMATION_NAMES)[number];

export type FrameCounts = Record<AnimationName, number>;

export const DEFAULT_FRAME_COUNTS: FrameCounts = { idle: 4, walk: 5, attack: 5, cast: 6, death: 4, channel: 4 };

/** The sheet's animations, top to bottom. */
export function humanoidAnimations(counts: FrameCounts = DEFAULT_FRAME_COUNTS): AnimationDef[] {
  const all: AnimationDef[] = [
    { name: 'idle', frames: counts.idle, fps: 4, loop: true, pose: (t, u, h) => IDLE[u.gait](t, u, h) },
    { name: 'walk', frames: counts.walk, fps: 8, loop: true, pose: (t, u, h) => WALK[u.gait](t, u, h) },
    { name: 'attack', frames: counts.attack, fps: 8, loop: false, pose: withGait('attack', attack) },
    { name: 'cast', frames: counts.cast, fps: 8, loop: false, pose: withGait('cast', cast) },
    { name: 'death', frames: counts.death, fps: 6, loop: false, pose: death },
    { name: 'channel', frames: counts.channel, fps: 6, loop: true, pose: withGait('channel', channel) },
  ];
  return all.map((a) => ({ ...a, pose: withSecondary(a.name, a.pose) }));
}
