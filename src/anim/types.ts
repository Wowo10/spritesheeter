import type { UnitParams } from '../unit/params';

export const JOINTS = [
  'hips',
  'spine',
  'head',
  'shoulderL',
  'elbowL',
  'handL',
  'shoulderR',
  'elbowR',
  'handR',
  'hipL',
  'kneeL',
  'hipR',
  'kneeR',
  // two-segment cape hanging from the upper back; pitch < 0 lifts it backward
  'cape',
  'capeTip',
  // a ghost's wisp below the hips, two segments like the cape; pitch < 0 trails it backward
  'tail',
  'tailTip',
] as const;

export type JointName = (typeof JOINTS)[number];

/**
 * Joint rotation in degrees: [pitch, yaw, roll].
 * - pitch > 0 swings a downward-pointing limb forward (and tips an upward one backward);
 * - roll > 0 moves a limb outward, away from the body's centre line;
 * - yaw/roll are mirrored for right-side joints, so poses read the same for both sides.
 */
export type JointRot = [number, number, number];

export interface Pose {
  joints: Partial<Record<JointName, JointRot>>;
  /** Offset of the hips from their rest position, in world units. */
  hips?: [number, number, number];
  /** Turn of the whole body around the vertical axis, in degrees, on top of the facing direction. */
  turn?: number;
  /**
   * Spell effect: position relative to the unit origin (facing +Z), size, and turn of its sparks
   * around the facing axis in degrees; hidden when absent.
   */
  fx?: { pos: [number, number, number]; scale: number; spin?: number };
  /** How much of the sprite is drawn, 0-1, as an ordered dither; 1 when absent. */
  opacity?: number;
  /** A sack slung over this shoulder, held by the hand on that side; hidden when absent. */
  load?: 'L' | 'R';
  /** This hand has thrown what it held, so it's hidden; held when absent. */
  thrown?: 'L' | 'R';
  /** Guns firing: a flash at the muzzle, then smoke; neither when absent. */
  muzzle?: Partial<Record<'L' | 'R', 'flash' | 'smoke'>>;
}

/** One sheet row. Defaults to the humanoid's params and pose; beasts bring their own. */
export interface AnimationDef<U = UnitParams, P = Pose> {
  name: string;
  frames: number;
  fps: number;
  loop: boolean;
  /** t in [0, 1): looping animations never sample t = 1, one-shots end on it. */
  pose: (t: number, unit: U, hipHeight: number) => P;
}

/** Normalised time for frame i, matching how the animation is played back. */
export function frameTime(anim: Pick<AnimationDef, 'frames' | 'loop'>, i: number): number {
  if (anim.loop) return i / anim.frames;
  return anim.frames <= 1 ? 0 : i / (anim.frames - 1);
}

/**
 * A quadruped's joints. The pelvis sits over the hind legs and carries everything else; the
 * body runs forward (+Z) from it. Same rotation rules as the humanoid's; for parts that point
 * forward (neck, head, jaw) pitch > 0 tips them up, for the tail it lowers it, and a jaw
 * opens with pitch < 0. Front and hind legs are F and B, then L or R.
 */
export const BEAST_JOINTS = [
  'pelvis',
  'chest',
  'neck',
  'head',
  'jaw',
  'legFL',
  'kneeFL',
  'legFR',
  'kneeFR',
  'legBL',
  'kneeBL',
  'legBR',
  'kneeBR',
  'tail',
  'tailMid',
  'tailTip',
  // spread sideways at rest: roll > 0 raises a wing, yaw > 0 sweeps it back (folds it)
  'wingL',
  'wingTipL',
  'wingR',
  'wingTipR',
] as const;

export type BeastJoint = (typeof BEAST_JOINTS)[number];

export interface BeastPose {
  joints: Partial<Record<BeastJoint, JointRot>>;
  /** Offset of the pelvis from its rest position, in world units. */
  offset?: [number, number, number];
  /** Turn of the whole body around the vertical axis, in degrees. */
  turn?: number;
  /** Spell effect: position relative to the mouth (in head space, facing +Z), size and spin; hidden when absent. */
  fx?: { pos: [number, number, number]; scale: number; spin?: number };
  opacity?: number;
  /** Packs strapped over the back; hidden when absent. */
  load?: boolean;
}

/**
 * A vehicle's pose. Rigid but for its moving parts: wheels, the weapon, a winch, a flag.
 * The weapon's `stroke` means the same for every kind of weapon: 0 at rest (ram hanging,
 * catapult arm cocked back, ballista drawn), 1 at the end of the blow or shot (ram swung
 * forward, arm against its crossbar, bowstring straight), below 0 pulled back past rest.
 */
export interface VehiclePose {
  /** How far every wheel has turned, in degrees; > 0 rolls forward. */
  wheels: number;
  /** The frame rocking on its axles: nose-up pitch and roll in degrees, and lift. */
  rock?: [pitch: number, roll: number, lift: number];
  /** Turn of the whole vehicle around the vertical axis, in degrees. */
  turn?: number;
  stroke: number;
  /** The stone or javelin waiting to be shot; hidden once it's gone. */
  loaded: boolean;
  /** Turn of the winch that draws the weapon back, in degrees. */
  winch?: number;
  /** The flamethrower's fire: size (0 hides it, 1 a full burst) and a flicker phase in cycles. */
  flame?: { scale: number; flicker: number };
  /** Swing of the flag, in degrees. */
  flag?: number;
  /** 0-1: broken down, wheels off one side, the frame tipped onto the ground, the weapon slack. */
  wreck?: number;
}

/**
 * A building's pose. It never moves; what changes is how far it's built, which windows are
 * lit, the chimney smoke, the flag, the front door, and how far it has fallen down.
 */
export interface BuildingPose {
  /** 0-1: under construction, from bare foundations to finished; finished when absent. */
  build?: number;
  /** 0-1: share of the windows lit. */
  lights: number;
  /** Picks which windows near the `lights` threshold blink on or off; a new pick per eighth of a cycle. */
  flicker: number;
  /** How far, in cycles, the puffs have risen, and how thick the smoke is (0 none). */
  smoke: { phase: number; amount: number };
  /** Swing of the flag, in degrees. */
  flag?: number;
  /** 0 shut, 1 wide open. */
  door?: number;
  /** Sideways jolt of the whole building, in world units. */
  shake?: [x: number, z: number];
  /** 0-1: the blocks crumble, lean and drop into rubble. */
  collapse?: number;
  /** 0-1: once fallen, the rubble settles, the stumps and heaps sinking lower. */
  ruin?: number;
}
