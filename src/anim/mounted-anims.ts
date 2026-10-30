import { beastDims, type BeastParams } from '../unit/beast-params';
import { mountParams, riderParams, type MountedParams, type MountedPose } from '../unit/mounted';
import { bodyDims, type UnitParams } from '../unit/params';
import { beastAnimations } from './beast-anims';
import { DEFAULT_FRAME_COUNTS, type AnimationName, type FrameCounts, humanoidAnimations } from './humanoid-anims';
import { keys } from './keys';
import type { AnimationDef, BeastPose, JointName, JointRot, Pose } from './types';

type Joints = Partial<Record<JointName, JointRot>>;
type MountedAnimationDef = AnimationDef<MountedParams, MountedPose>;
type PoseFn<U, P> = (t: number, unit: U, hipHeight: number) => P;

const DEG = Math.PI / 180;

/**
 * How low the seat is for the rider, 0-1: 0 when the legs can hang down the mount's sides,
 * 1 when they'd reach well into the ground.
 */
function lowSeat(rider: UnitParams, mount: BeastParams): number {
  const { thigh, shin, footH } = bodyDims(rider);
  const d = beastDims(mount);
  // the saddle point's height (see buildBeast) against how far hanging legs reach down
  const seat = d.hipHeight + 0.92 * d.depth;
  const reach = 0.85 * (thigh + shin + footH);
  return Math.min(1, Math.max(0, (reach - seat) / (0.5 * reach)));
}

/**
 * Legs astride the mount: thighs forward and rolled out until the knees clear its flank (the
 * saddle cloth or armour skirt), shins hanging down its side. On a mount too low for that,
 * the legs stretch out forward instead, clear of the ground.
 */
function seatedLegs(rider: UnitParams, mount: BeastParams): Joints {
  const { hipW, thigh, legT } = bodyDims(rider);
  const flank = beastDims(mount).width * (mount.barding === 'armor' ? 0.64 : 0.6) + legT / 2;
  const roll = Math.asin(Math.min(0.95, Math.max(0, (flank - hipW * 0.24) / thigh))) / DEG;
  const stretch = lowSeat(rider, mount);
  const hip: JointRot = [50 + 35 * stretch, 0, roll];
  const knee: JointRot = [-75 + 65 * stretch, 0, -0.8 * roll];
  return { hipL: hip, hipR: hip, kneeL: knee, kneeR: knee };
}

const LEGS: JointName[] = ['hipL', 'hipR', 'kneeL', 'kneeR'];

/** How much of the mount's pitch the rider leans against, to stay upright as it rears. */
const COUNTER_LEAN = 0.7;

/** Extra backward lift of a seated rider's cape, so it drapes over the mount's rump (and off the ground, on a low one). */
function capeLift(rider: UnitParams, mount: BeastParams): number {
  return 25 + 45 * lowSeat(rider, mount);
}

/**
 * A standing humanoid pose put in the saddle: legs astride, the standing pose's lunges and
 * crouches dropped (the saddle carries the hips), leaning against the mount's pitch.
 */
function seat(pose: Pose, mount: BeastPose, rider: UnitParams, m: BeastParams, capePose: Pose = pose): Pose {
  const joints: Joints = { ...pose.joints, ...seatedLegs(rider, m) };
  const lean = COUNTER_LEAN * (mount.joints.pelvis?.[0] ?? 0);
  const spine = joints.spine ?? [0, 0, 0];
  joints.spine = [spine[0] - lean, spine[1], spine[2]];
  const cape = capePose.joints.cape ?? [0, 0, 0];
  const tip = capePose.joints.capeTip ?? [0, 0, 0];
  joints.cape = [cape[0] - capeLift(rider, m), cape[1], cape[2]];
  joints.capeTip = tip;
  return { ...pose, joints, hips: [0, 0, 0], load: undefined };
}

/** How each sheet row is made: the mount's row under the rider's, seated. */
interface Row {
  mount: AnimationName;
  rider: AnimationName;
  /** Whose cape motion the rider's cape follows, if not the rider row's. */
  cape?: AnimationName;
  /** Rider leans forward this much (degrees), head up to look ahead. */
  lean?: number;
}

/** Every row but the building's. */
const ROWS: Record<Exclude<AnimationName, 'build'>, Row> = {
  idle: { mount: 'idle', rider: 'idle' },
  walk: { mount: 'walk', rider: 'idle', cape: 'walk' },
  attack: { mount: 'walk', rider: 'attack' },
  cast: { mount: 'idle', rider: 'cast' },
  // made by death() below
  death: { mount: 'death', rider: 'death' },
  channel: { mount: 'idle', rider: 'channel' },
  hit: { mount: 'hit', rider: 'hit' },
  run: { mount: 'run', rider: 'idle', cape: 'run', lean: 15 },
  work: { mount: 'work', rider: 'idle' },
  carry: { mount: 'carry', rider: 'idle', cape: 'walk' },
  taunt: { mount: 'taunt', rider: 'taunt' },
};

/** Distance from the mount's back to where a thrown rider lands, beyond its body. */
const THROW = 0.35;

/**
 * The mount keels over; the rider is thrown off on the side its back rolls toward, and falls
 * as a standing unit would, legs coming out of the saddle. A mount that rolls onto its back
 * never lands on the rider.
 */
function death(t: number, rider: UnitParams, m: BeastParams, riderPose: Pose, mountPose: BeastPose): MountedPose {
  const k = keys(t, [[0, 0], [0.2, 0], [0.7, 1], [1, 1]]);
  const seated = seatedLegs(rider, m);
  const joints: Joints = { ...riderPose.joints };
  for (const j of LEGS) {
    const from = seated[j]!;
    const to = joints[j] ?? [0, 0, 0];
    joints[j] = [0, 1, 2].map((c) => from[c] + (to[c] - from[c]) * k) as JointRot;
  }
  const cape = joints.cape ?? [0, 0, 0];
  joints.cape = [cape[0] - capeLift(rider, m) * (1 - k), cape[1], cape[2]];
  const [x, y, z] = riderPose.hips ?? [0, 0, 0];
  // the beast's back rolls toward -x (see the death pose's pelvis roll), turning with its
  // body: past the saddle point (0.92 depths above the pelvis), with room for the rider's width
  const d = beastDims(m);
  const side = -(0.92 * d.depth + d.width / 2 + THROW);
  const back = -d.length * 0.05;
  const turn = (mountPose.turn ?? 0) * DEG;
  const pos: [number, number, number] = [side * Math.cos(turn) + back * Math.sin(turn), 0, -side * Math.sin(turn) + back * Math.cos(turn)];
  return {
    mount: mountPose,
    rider: { ...riderPose, joints, hips: [x * k, y * k, z * k] },
    thrown: { k, pos },
    opacity: mountPose.opacity,
  };
}

/** Same rows, frame counts and timing as the humanoid's and the beast's, so all sheets line up. */
export function mountedAnimations(counts: FrameCounts = DEFAULT_FRAME_COUNTS): MountedAnimationDef[] {
  const humanoid = Object.fromEntries(humanoidAnimations(counts).map((a) => [a.name, a])) as Record<AnimationName, AnimationDef>;
  const beast = Object.fromEntries(beastAnimations(counts).map((a) => [a.name, a.pose])) as Record<AnimationName, PoseFn<BeastParams, BeastPose>>;
  return (Object.keys(ROWS) as (keyof typeof ROWS)[]).map((name) => {
    const row = ROWS[name];
    const { frames, fps, loop } = humanoid[name];
    const pose = (t: number, p: MountedParams): MountedPose => {
      const rider = riderParams(p);
      const m = mountParams(p);
      const riderHip = bodyDims(rider).hipHeight;
      const mountPose = beast[row.mount](t, m, beastDims(m).hipHeight);
      const riderPose = humanoid[row.rider].pose(t, rider, riderHip);
      if (name === 'death') return death(t, rider, m, riderPose, mountPose);
      const capePose = row.cape ? humanoid[row.cape].pose(t, rider, riderHip) : riderPose;
      const seated = seat(riderPose, mountPose, rider, m, capePose);
      if (row.lean) {
        const { spine = [0, 0, 0], head = [0, 0, 0] } = seated.joints;
        seated.joints.spine = [spine[0] - row.lean, spine[1], spine[2]];
        seated.joints.head = [head[0] + row.lean * 0.7, head[1], head[2]];
      }
      return { mount: mountPose, rider: seated, opacity: mountPose.opacity };
    };
    return { name, frames, fps, loop, pose };
  });
}
