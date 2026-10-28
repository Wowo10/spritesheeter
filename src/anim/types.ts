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
}

export interface AnimationDef {
  name: string;
  frames: number;
  fps: number;
  loop: boolean;
  /** t in [0, 1): looping animations never sample t = 1, one-shots end on it. */
  pose: (t: number, unit: UnitParams, hipHeight: number) => Pose;
}

/** Normalised time for frame i, matching how the animation is played back. */
export function frameTime(anim: Pick<AnimationDef, 'frames' | 'loop'>, i: number): number {
  if (anim.loop) return i / anim.frames;
  return anim.frames <= 1 ? 0 : i / (anim.frames - 1);
}
