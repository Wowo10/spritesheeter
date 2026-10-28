import { BEAST_HOVER, beastDims, type BeastDims, type BeastParams } from '../unit/beast-params';
import { DEFAULT_FRAME_COUNTS, type FrameCounts } from './humanoid-anims';
import { keys, rotKeys } from './keys';
import type { AnimationDef, BeastJoint, BeastPose, JointRot } from './types';

type Joints = Partial<Record<BeastJoint, JointRot>>;
type BeastAnimationDef = AnimationDef<BeastParams, BeastPose>;

const LEGS = ['FL', 'FR', 'BL', 'BR'] as const;
type Leg = (typeof LEGS)[number];

interface LegMove {
  /** Degrees forward. */
  swing?: number;
  /** 0-1: how far the paw is off the ground. */
  lift?: number;
  /** Extra knee pitch; < 0 folds the paw back. */
  bend?: number;
  /** How much of the sprawl's outward roll is kept; dead legs go limp. */
  splay?: number;
}

/**
 * Upright legs swing by pitching and lift by folding the knee; sprawled ones sweep around
 * their hip and lift by rolling further out. The knee always rolls back by the same amount,
 * so the lower leg stays upright.
 */
function legs(p: BeastParams, d: BeastDims, move: (leg: Leg) => LegMove): Joints {
  const up = 1 - p.sprawl;
  const j: Joints = {};
  for (const leg of LEGS) {
    const hind = leg[0] === 'B';
    const { swing = 0, lift = 0, bend = 0, splay = 1 } = move(leg);
    // hind thighs angle forward with the hocks back; sprawled front feet reach forward, hind ones back
    const restPitch = hind ? 8 : 0;
    const restYaw = hind ? 20 : -20;
    const roll = splay * (d.splay + 25 * lift * p.sprawl);
    j[`leg${leg}`] = [(restPitch + swing) * up, (restYaw - swing) * p.sprawl * splay, roll];
    j[`knee${leg}`] = [((hind ? -14 : 0) - 45 * lift) * up + bend, 0, -roll];
  }
  return j;
}

/** Upright beasts carry the neck raised and the head level; reptiles keep both low. */
function neckRaise(p: BeastParams): number {
  return 30 * (1 - p.sprawl);
}

function headRest(p: BeastParams, neck: JointRot = [0, 0, 0], head: JointRot = [0, 0, 0]): Joints {
  const n = neckRaise(p);
  return {
    neck: [n + neck[0], neck[1], neck[2]],
    head: [-n - 5 + head[0], head[1], head[2]],
  };
}

/** Joint rotations a fraction k of the way from `from` to `to`. */
function blend(from: Joints, to: Joints, k: number): Joints {
  const out: Joints = {};
  for (const [name, r] of Object.entries(to) as [BeastJoint, JointRot][]) {
    const f = from[name] ?? [0, 0, 0];
    out[name] = [0, 1, 2].map((c) => f[c] + (r[c] - f[c]) * k) as JointRot;
  }
  return out;
}

/** Tail hanging behind: dogs and cats droop theirs, reptiles drag them along the ground. */
function tailRest(p: BeastParams, yaw = 0, lift = 0): Joints {
  const up = 1 - p.sprawl;
  return {
    tail: [25 * up + 5 - lift, yaw, 0],
    tailMid: [10 * up - lift * 0.5, yaw * 0.8, 0],
    tailTip: [-10 * up, yaw * 0.6, 0],
  };
}

function idle(t: number, p: BeastParams): BeastPose {
  const d = beastDims(p);
  const phase = t * Math.PI * 2;
  const breath = Math.cos(phase);
  const look = Math.sin(phase);
  const up = 1 - p.sprawl;
  // dogs pant and wag; reptiles lie still, the tail tip twitching
  const wag = 20 * up + 6;
  return {
    joints: {
      ...legs(p, d, () => ({})),
      ...headRest(p, [3 * breath, 10 * look, 0], [-2 * breath, 6 * look, 0]),
      ...tailRest(p, wag * look),
      chest: [1.5 * breath, 0, 0],
      jaw: [-(6 + 4 * breath) * up, 0, 0],
    },
    offset: [0, 0.01 * breath, 0],
  };
}

function walk(t: number, p: BeastParams): BeastPose {
  return trot(t, p, 28);
}

/** Legs swinging `stride` degrees either way. */
function trot(t: number, p: BeastParams, stride: number): BeastPose {
  const d = beastDims(p);
  const phase = t * Math.PI * 2;
  const s = Math.sin(phase);
  const up = 1 - p.sprawl;
  // a trot: diagonal pairs move together; each paw lifts while it swings forward
  const offset: Record<Leg, number> = { FL: 0, BR: 0, FR: Math.PI, BL: Math.PI };
  const joints = legs(p, d, (leg) => ({
    swing: stride * Math.sin(phase + offset[leg]),
    lift: Math.max(0, Math.cos(phase + offset[leg])),
  }));
  // sprawled beasts swing the body side to side in an S, the head held steady and the tail
  // whipping the other way
  const wave = 12 * p.sprawl;
  return {
    joints: {
      ...joints,
      ...headRest(p, [3 * Math.cos(2 * phase), wave * s, 0], [-2 * Math.cos(2 * phase), 0, 0]),
      pelvis: [0, wave * s, 0],
      chest: [0, -2 * wave * s, 0],
      tail: [25 * up + 5, -wave * 1.5 * s + 6 * up * s, 0],
      tailMid: [10 * up, wave * Math.cos(phase), 0],
      tailTip: [-10 * up, -wave * s, 0],
      jaw: [-8 * up, 0, 0],
    },
    offset: [0, -0.02 * p.size * Math.abs(Math.cos(2 * phase)) * up, 0],
  };
}

/**
 * Upright beasts gallop: the hind pair then the front pair strike the ground, the back flexing
 * and the body bounding. Sprawled ones scramble in a fast trot, the body whipping side to side.
 */
function run(t: number, p: BeastParams): BeastPose {
  const d = beastDims(p);
  const phase = t * Math.PI * 2;
  const s = Math.sin(phase);
  const up = 1 - p.sprawl;
  // leg timing in cycles, blended between the two gaits by sprawl
  const gallop: Record<Leg, number> = { BL: 0, BR: 0.12, FL: 0.5, FR: 0.62 };
  const scramble: Record<Leg, number> = { FL: 0, BR: 0, FR: 0.5, BL: 0.5 };
  const joints = legs(p, d, (leg) => {
    const a = phase + (gallop[leg] * up + scramble[leg] * p.sprawl) * Math.PI * 2;
    return { swing: 40 * Math.sin(a), lift: Math.max(0, Math.cos(a)) };
  });
  const wave = 18 * p.sprawl;
  return {
    joints: {
      ...joints,
      // neck stretched out low and forward
      ...headRest(p, [-12 + 4 * Math.cos(phase) * up, wave * s, 0], [6, 0, 0]),
      pelvis: [4 * up * s, wave * s, 0],
      chest: [-6 * up * s, -2 * wave * s, 0],
      tail: [10 * up, -wave * 1.5 * s, 0],
      tailMid: [5 * up + 4 * Math.cos(phase), wave * Math.cos(phase), 0],
      tailTip: [-5 * up, -wave * s, 0],
      jaw: [-14 * up, 0, 0],
    },
    offset: [0, 0.04 * p.size * up * Math.sin(phase + Math.PI / 2) - 0.02 * p.size * up, 0],
  };
}

/** Recoils from a blow: head jerks up with a yelp, tail tucked, knocked back onto braced legs. */
function hit(t: number, p: BeastParams): BeastPose {
  const d = beastDims(p);
  const r = keys(t, [[0, 0], [0.25, 1], [1, 0]]);
  return {
    joints: {
      ...legs(p, d, (leg) => (leg[0] === 'F' ? { swing: 10 * r } : { swing: -6 * r, bend: -10 * r })),
      ...headRest(p, [14 * r, 0, 0], [16 * r, 0, 8 * r]),
      ...tailRest(p, 0, -20 * r),
      chest: [6 * r, 0, 0],
      jaw: [-25 * r, 0, 0],
    },
    offset: [0, -0.03 * p.size * r, -0.06 * p.size * r],
  };
}

/** Digging, looped: front paws scrape the ground in turn, head down over the hole, tail up. */
function work(t: number, p: BeastParams): BeastPose {
  const d = beastDims(p);
  const phase = t * Math.PI * 2;
  const up = 1 - p.sprawl;
  // each paw reaches forward while lifted, then drags back along the ground
  const paw = (a: number) => ({ swing: 20 + 25 * Math.sin(a), lift: Math.max(0, Math.cos(a)) });
  return {
    joints: {
      ...legs(p, d, (leg) => (leg === 'FL' ? paw(phase) : leg === 'FR' ? paw(phase + Math.PI) : { swing: -10, bend: -15 })),
      ...headRest(p, [-20, 0, 0], [-10 + 5 * Math.cos(2 * phase), 0, 0]),
      ...tailRest(p, (15 * up + 4) * Math.sin(phase), 10),
      chest: [-8, 0, 0],
      jaw: [-6 * up, 0, 0],
    },
    offset: [0, -0.03 * p.size, 0],
  };
}

/** A pack animal's plod: packs on the back, shorter strides, head low, sagging at each step. */
function carry(t: number, p: BeastParams): BeastPose {
  const pose = trot(t, p, 20);
  const joints = { ...pose.joints };
  const neck = joints.neck!;
  joints.neck = [neck[0] - 10, neck[1], neck[2]];
  const [x, y, z] = pose.offset ?? [0, 0, 0];
  const sag = 0.02 * p.size * Math.abs(Math.cos(2 * t * Math.PI * 2));
  return { ...pose, joints, offset: [x, y - sag, z], load: true };
}

/**
 * Challenges the enemy: upright beasts rear onto their hind legs and paw the air, snarling;
 * sprawled ones can't rear, so they lift the head, snap twice and lash the tail.
 */
function taunt(t: number, p: BeastParams): BeastPose {
  const d = beastDims(p);
  const up = 1 - p.sprawl;
  const rear = keys(t, [[0, 0], [0.3, 1], [0.75, 1], [1, 0]]);
  // each front paw strikes out in turn while reared up
  const paw = (shift: number) => rear * (20 + 25 * Math.max(0, Math.sin((t - shift) * Math.PI * 6)));
  const snap = keys(t, [[0, 0], [0.3, 0.4], [0.4, 1], [0.5, 0.2], [0.6, 1], [0.7, 0.2], [1, 0]]);
  return {
    joints: {
      ...legs(p, d, (leg) =>
        leg[0] === 'F'
          ? { swing: paw(leg === 'FL' ? 0 : 1 / 6) * up, lift: rear * up, bend: -30 * rear * up }
          : { swing: -35 * rear * up, bend: -20 * rear * up },
      ),
      ...headRest(p, [(-10 * up + 25 * p.sprawl) * rear, 0, 0], [8 * rear, 0, 0]),
      ...tailRest(p, 30 * p.sprawl * Math.sin(t * Math.PI * 4), 10 * rear),
      pelvis: [40 * up * rear, 0, 0],
      jaw: [-(10 + 30 * snap) * rear, 0, 0],
    },
    offset: [0, 0.02 * p.size * up * rear, -0.08 * p.size * up * rear],
  };
}

/** Crouch, lunge with the jaws wide, snap them shut and shake, then back off. */
function attack(t: number, p: BeastParams): BeastPose {
  const d = beastDims(p);
  const swing = (front: number, hind: number) => ({ FL: front, FR: front * 0.8, BL: hind, BR: hind * 0.8 });
  const front = keys(t, [[0, 0], [0.3, -12], [0.6, 30], [1, 6]]);
  const hind = keys(t, [[0, 0], [0.3, 14], [0.6, -24], [1, 0]]);
  const sw = swing(front, hind);
  const S = p.size;
  return {
    joints: {
      ...legs(p, d, (leg) => ({ swing: sw[leg], bend: leg[0] === 'B' ? keys(t, [[0, 0], [0.3, -20], [0.6, 0]]) : 0 })),
      ...headRest(
        p,
        rotKeys(t, [
          [0, [0, 0, 0]],
          [0.3, [-12, 0, 0]],
          [0.6, [-neckRaise(p) * 0.7, 0, 0]],
          [0.75, [-neckRaise(p) * 0.7, 12, 0]],
          [1, [-4, 0, 0]],
        ]),
        rotKeys(t, [
          [0, [0, 0, 0]],
          [0.3, [6, 0, 0]],
          [0.6, [12, 0, 0]],
          // reptiles twist their prey
          [0.75, [-8, 0, 20 * p.sprawl]],
          [1, [0, 0, 0]],
        ]),
      ),
      ...tailRest(p, keys(t, [[0, 0], [0.6, -10], [0.75, 15], [1, 0]]), keys(t, [[0, 0], [0.6, 15], [1, 0]])),
      chest: rotKeys(t, [
        [0, [0, 0, 0]],
        [0.3, [-5, 0, 0]],
        [0.6, [-4, 0, 0]],
        [1, [0, 0, 0]],
      ]),
      jaw: [keys(t, [[0, 0], [0.3, -5], [0.55, -45], [0.7, 0], [1, -6]]), 0, 0],
    },
    offset: [0, keys(t, [[0, 0], [0.3, -0.04 * S], [0.6, -0.02 * S], [1, 0]]), keys(t, [[0, 0], [0.3, -0.06 * S], [0.6, 0.18 * S], [1, 0.04 * S]])],
  };
}

/** Without a breath attack: rear up a little and roar (or howl) at the sky. */
function roar(t: number, p: BeastParams): BeastPose {
  const d = beastDims(p);
  const up = 1 - p.sprawl;
  return {
    joints: {
      ...legs(p, d, (leg) => ({ swing: leg[0] === 'F' ? keys(t, [[0, 0], [0.4, 12], [0.85, 12], [1, 0]]) : 0 })),
      ...headRest(
        p,
        rotKeys(t, [
          [0, [0, 0, 0]],
          [0.4, [30, 0, 0]],
          [0.85, [35, 0, 0]],
          [1, [0, 0, 0]],
        ]),
        rotKeys(t, [
          [0, [0, 0, 0]],
          [0.4, [20, 0, 0]],
          [0.85, [25, 0, 0]],
          [1, [0, 0, 0]],
        ]),
      ),
      ...tailRest(p, 0, keys(t, [[0, 0], [0.5, 20], [1, 0]])),
      pelvis: [keys(t, [[0, 0], [0.4, 8 * up], [0.85, 8 * up], [1, 0]]), 0, 0],
      jaw: [keys(t, [[0, 0], [0.3, -8], [0.5, -40], [0.85, -38], [1, 0]]), 0, 0],
    },
    offset: [0, 0, keys(t, [[0, 0], [0.4, -0.04 * p.size], [1, 0]])],
  };
}

/** With a breath attack: rear back gathering the spell in the mouth, then spit it forward. */
function spit(t: number, p: BeastParams): BeastPose {
  const d = beastDims(p);
  return {
    joints: {
      ...legs(p, d, (leg) => ({ swing: leg[0] === 'F' ? keys(t, [[0, 0], [0.35, -8], [0.6, 14], [1, 0]]) : 0 })),
      ...headRest(
        p,
        rotKeys(t, [
          [0, [0, 0, 0]],
          [0.35, [25, 0, 0]],
          [0.6, [-12, 0, 0]],
          [1, [0, 0, 0]],
        ]),
        rotKeys(t, [
          [0, [0, 0, 0]],
          [0.35, [15, 0, 0]],
          [0.6, [-8, 0, 0]],
          [1, [0, 0, 0]],
        ]),
      ),
      ...tailRest(p, 0, keys(t, [[0, 0], [0.35, 12], [0.6, -6], [1, 0]])),
      jaw: [keys(t, [[0, 0], [0.35, -18], [0.6, -45], [0.85, -20], [1, 0]]), 0, 0],
    },
    offset: [0, 0, keys(t, [[0, 0], [0.35, -0.05 * p.size], [0.6, 0.06 * p.size], [1, 0]])],
    fx: {
      pos: [0, 0, keys(t, [[0, 0], [0.35, 0.02], [0.6, 0.35], [0.85, 1.1], [1, 1.6]])],
      scale: keys(t, [[0, 0], [0.35, 0.55], [0.6, 1.1], [0.85, 1.2], [1, 0]]),
      spin: 180 * t,
    },
  };
}

function cast(t: number, p: BeastParams): BeastPose {
  return p.breath ? spit(t, p) : roar(t, p);
}

/**
 * Front legs buckle, then it keels over onto its side; reptiles roll on over onto their backs,
 * legs in the air. A see-through beast fades away instead of leaving a body.
 */
function death(t: number, p: BeastParams): BeastPose {
  const d = beastDims(p);
  const onBack = p.sprawl > 0.5;
  const roll = keys(t, [[0, 0], [0.33, 4], [0.67, 45], [1, onBack ? 178 : 88]]);
  const limp = keys(t, [[0, 1], [0.67, 0.6], [1, 0]]);
  // lying down, the leg joints rest on whatever sticks out furthest: on its side, the folded
  // wings, mane or armour; on its back, the spikes, the root of the tail or the back of the head
  const D = d.depth;
  const spikes = p.back === 'spikes' ? 0.34 * Math.min(d.width, D) : 0;
  const lying =
    (onBack
      ? Math.max(0.8 * D + spikes, 0.5 * D + d.tailT + 0.8 * spikes, 0.55 * D + 0.5 * d.head)
      : 0.5 * d.width * (p.wings !== 'none' ? 1.3 : p.back === 'mane' ? 1.4 : p.barding === 'armor' ? 1.22 : 1.08)) +
    0.01 -
    d.hipHeight;
  return {
    turn: keys(t, [[0, 0], [1, 22.5]]),
    joints: {
      ...legs(p, d, (leg) => ({
        swing: leg[0] === 'F' ? keys(t, [[0, 0], [0.33, 20], [1, 25]]) : keys(t, [[0, 0], [1, leg === 'BL' ? -15 : 10]]),
        bend: leg[0] === 'F' ? keys(t, [[0, 0], [0.33, -55], [1, -20]]) : keys(t, [[0, 0], [1, -15]]),
        splay: limp,
      })),
      ...headRest(
        p,
        rotKeys(t, [
          [0, [0, 0, 0]],
          [0.33, [-15, 0, 0]],
          [1, [-neckRaise(p) - 5, 0, 10]],
        ]),
        rotKeys(t, [
          [0, [0, 0, 0]],
          [1, [10, 0, 15]],
        ]),
      ),
      // the tail straightens out to lie flat; on its side, pitch curls it along the ground
      ...blend(tailRest(p), { tail: [0, 0, 0], tailMid: [15, 0, 0], tailTip: [10, 0, 0] }, keys(t, [[0, 0], [0.67, 0.5], [1, 1]])),
      pelvis: [0, 0, roll],
      chest: rotKeys(t, [
        [0, [0, 0, 0]],
        [0.33, [-12, 0, 0]],
        [1, [0, 0, 0]],
      ]),
      jaw: [keys(t, [[0, 0], [0.33, -25], [1, -15]]), 0, 0],
    },
    offset: [0, keys(t, [[0, 0], [0.33, -0.06 * p.size], [0.67, lying * 0.6], [1, lying]]), 0],
    opacity: p.opacity < 1 ? keys(t, [[0, 1], [0.3, 0.9], [1, 0]]) : 1,
  };
}

/**
 * Looped. With a breath attack: braced, mouth wide, pouring a steady stream of the spell.
 * Without one: crouched low and snarling.
 */
function channel(t: number, p: BeastParams): BeastPose {
  const d = beastDims(p);
  const phase = t * Math.PI * 2;
  const push = Math.sin(phase);
  const pulse = Math.cos(phase);
  const S = p.size;
  if (p.breath) {
    return {
      joints: {
        ...legs(p, d, (leg) => ({ swing: leg[0] === 'F' ? 12 : -10 })),
        ...headRest(p, [-8 + 3 * pulse, 0, 0], [-4, 0, 0]),
        ...tailRest(p, 8 * push, 8),
        jaw: [-35 - 6 * pulse, 0, 0],
      },
      offset: [0, -0.03 * S, -0.02 * S],
      fx: { pos: [0, 0, 0.3 + 0.06 * push], scale: 1.1 + 0.2 * push, spin: 90 * t },
    };
  }
  return {
    joints: {
      ...legs(p, d, (leg) => ({ swing: leg[0] === 'F' ? 10 : -6, bend: -12 })),
      ...headRest(p, [-16 + 2 * pulse, 4 * push, 0], [10, 0, 0]),
      ...tailRest(p, 6 * push, -10),
      chest: [-6, 0, 0],
      jaw: [-14 - 8 * Math.max(0, push), 0, 0],
    },
    offset: [0, -0.05 * S + 0.01 * pulse, -0.03 * S],
  };
}

// --- wings: layered on top of every animation ----------------------------------

type WingPose = [wing: JointRot, tip: JointRot];

/**
 * Folded: the wing's leading edge runs back and up over the body, so the elbow shows above
 * the back, with the membrane hanging down the side and the outer half doubled back.
 */
const FOLDED: WingPose = [
  [70, 0, 72],
  [0, 0, -165],
];

/** Spread out to the side; flap in [-1, 1] runs from the bottom of the downstroke to the top. */
function spread(flap: number): WingPose {
  return [
    [0, 10, 12 + 38 * flap],
    // the outer half trails the stroke, bending against it
    [0, 0, -18 * flap],
  ];
}

function blendWing(a: WingPose, b: WingPose, k: number): WingPose {
  const mix = (x: JointRot, y: JointRot) => [0, 1, 2].map((c) => x[c] + (y[c] - x[c]) * k) as JointRot;
  return [mix(a[0], b[0]), mix(a[1], b[1])];
}

/** Grounded beasts keep their wings folded, spreading them to threaten, roar and snarl. */
function groundWings(name: string, t: number): WingPose {
  const phase = t * Math.PI * 2;
  switch (name) {
    case 'idle': {
      const [wing, tip] = FOLDED;
      return [[wing[0], wing[1], wing[2] + 4 * Math.cos(phase)], tip];
    }
    case 'walk': {
      const [wing, tip] = FOLDED;
      return [[wing[0], wing[1], wing[2] + 5 * Math.abs(Math.sin(phase))], tip];
    }
    case 'attack':
      return blendWing(FOLDED, spread(keys(t, [[0, 0.8], [0.55, 0.2], [1, 0.8]])), keys(t, [[0, 0], [0.3, 0.7], [0.55, 1], [0.75, 1], [1, 0]]));
    case 'cast':
      return blendWing(FOLDED, spread(keys(t, [[0, 1], [0.4, 1], [0.6, -0.2], [0.85, 0.6], [1, 1]])), keys(t, [[0, 0], [0.3, 1], [0.85, 1], [1, 0]]));
    case 'channel':
      // mantling: half spread and raised, pulsing
      return blendWing(FOLDED, spread(0.7 + 0.2 * Math.sin(phase)), 0.7);
    case 'hit':
      // flare out with the shock, then fold back
      return blendWing(FOLDED, spread(0.6), keys(t, [[0, 0], [0.25, 0.8], [1, 0]]));
    case 'run':
    case 'carry': {
      const [wing, tip] = FOLDED;
      return [[wing[0], wing[1], wing[2] + 6 * Math.abs(Math.sin(phase))], tip];
    }
    case 'taunt':
      // full threat display: spread wide and beating
      return blendWing(FOLDED, spread(0.6 + 0.4 * Math.sin(phase * 2)), keys(t, [[0, 0], [0.25, 1], [0.8, 1], [1, 0]]));
    case 'work': {
      // half open for balance, head down
      return blendWing(FOLDED, spread(0.3 + 0.1 * Math.sin(phase)), 0.25);
    }
    default:
      // death: flung out as it falls, then folded under the body
      return blendWing(FOLDED, spread(keys(t, [[0, 0.5], [0.33, 1], [1, -0.5]])), keys(t, [[0, 0], [0.33, 0.8], [1, 0]]));
  }
}

/** Legs of a beast in flight: front paws tucked up under the chest, hind legs trailing. */
function tucked(p: BeastParams, d: BeastDims, reach = 0): Joints {
  return legs(p, d, (leg) => (leg[0] === 'F' ? { swing: 35 + reach, bend: -80 + reach } : { swing: -45, bend: -10 }));
}

/**
 * Wings over a pose. A flying beast stays aloft, flapping once per loop (one-shots too, so
 * they start and end in the same stroke), legs tucked and tail streaming behind, and drops
 * out of the air when it dies.
 */
function withWings(name: string, pose: BeastAnimationDef['pose']): BeastAnimationDef['pose'] {
  return (t, p, h) => {
    const out = pose(t, p, h);
    if (p.wings === 'none') return out;
    const flying = p.flying && name !== 'death';
    const flap = Math.sin(t * Math.PI * 2);
    const [wing, tip] = flying ? spread(flap) : groundWings(name, t);
    const joints: Joints = { ...out.joints, wingL: wing, wingR: wing, wingTipL: tip, wingTipR: tip };
    const [x, y, z] = out.offset ?? [0, 0, 0];
    const hover = BEAST_HOVER * p.size;
    if (name === 'death' && p.flying) {
      return { ...out, joints, offset: [x, y + hover * keys(t, [[0, 1], [0.67, 0], [1, 0]]), z] };
    }
    if (!flying) return { ...out, joints };
    const d = beastDims(p);
    // claws out to strike
    const reach = name === 'attack' ? keys(t, [[0, 0], [0.3, 10], [0.6, 60], [1, 0]]) : 0;
    Object.assign(joints, tucked(p, d, reach), {
      tail: [0, joints.tail?.[1] ?? 0, 0],
      tailMid: [4, joints.tailMid?.[1] ?? 0, 0],
      tailTip: [-4, joints.tailTip?.[1] ?? 0, 0],
    });
    // rises on the downstroke
    return { ...out, joints, offset: [x, y + hover - 0.04 * p.size * Math.cos(t * Math.PI * 2), z] };
  };
}

/** The unit's opacity on top of the pose's own. */
function withOpacity(pose: BeastAnimationDef['pose']): BeastAnimationDef['pose'] {
  return (t, p, h) => {
    const out = pose(t, p, h);
    return { ...out, opacity: p.opacity * (out.opacity ?? 1) };
  };
}

/** Same rows, frame counts and timing as the humanoid's, so sheets of both line up. */
export function beastAnimations(counts: FrameCounts = DEFAULT_FRAME_COUNTS): BeastAnimationDef[] {
  const all: BeastAnimationDef[] = [
    { name: 'idle', frames: counts.idle, fps: 4, loop: true, pose: idle },
    { name: 'walk', frames: counts.walk, fps: 8, loop: true, pose: walk },
    { name: 'attack', frames: counts.attack, fps: 8, loop: false, pose: attack },
    { name: 'cast', frames: counts.cast, fps: 8, loop: false, pose: cast },
    { name: 'death', frames: counts.death, fps: 6, loop: false, pose: death },
    { name: 'channel', frames: counts.channel, fps: 6, loop: true, pose: channel },
    { name: 'hit', frames: counts.hit, fps: 10, loop: false, pose: hit },
    { name: 'run', frames: counts.run, fps: 12, loop: true, pose: run },
    { name: 'work', frames: counts.work, fps: 8, loop: true, pose: work },
    { name: 'carry', frames: counts.carry, fps: 8, loop: true, pose: carry },
    { name: 'taunt', frames: counts.taunt, fps: 8, loop: false, pose: taunt },
  ];
  return all.map((a) => ({ ...a, pose: withOpacity(withWings(a.name, a.pose)) }));
}
