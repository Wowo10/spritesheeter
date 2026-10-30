import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { bodyDims, otherHand, type BodyDims, type Hand, type UnitParams } from '../unit/params';
import type { JointName, JointRot } from './types';

type Joints = Partial<Record<JointName, JointRot>>;

const DEG = Math.PI / 180;

/** How much of its full length an arm may stretch to reach a grip; fully straight looks stiff. */
const STRETCH = 0.95;

/** A joint's [pitch, yaw, roll] as the rotation applyPose gives it (right-side joints mirrored). */
function toQuat(rot: JointRot | undefined, side: Hand): Quaternion {
  const [pitch, yaw, roll] = rot ?? [0, 0, 0];
  const m = side === 'R' ? -1 : 1;
  return new Quaternion().setFromEuler(new Euler(-pitch * DEG, m * yaw * DEG, m * roll * DEG));
}

function fromQuat(q: Quaternion, side: Hand): JointRot {
  const e = new Euler().setFromQuaternion(q);
  const m = side === 'R' ? -1 : 1;
  return [-e.x / DEG, (m * e.y) / DEG, (m * e.z) / DEG];
}

/** Where humanoid.ts links each shoulder to the spine; L is on +x. */
function shoulderAt(d: BodyDims, h: Hand): Vector3 {
  return new Vector3((h === 'L' ? 1 : -1) * (d.torsoW / 2 + d.armT / 2), d.torsoLen - d.armT * 0.6, 0);
}

/**
 * Sets one arm so its hand joint reaches `target` (as near as the arm allows) turned to `hand`,
 * all in the spine's space: a two-bone chain whose elbow bends down and out.
 */
function solveArm(joints: Joints, d: BodyDims, side: Hand, target: Vector3, hand: Quaternion): void {
  const a = d.upperArm;
  const b = d.forearm;
  const shoulder = shoulderAt(d, side);
  const toTarget = target.clone().sub(shoulder);
  const reach = Math.min(Math.max(toTarget.length(), Math.abs(a - b) + 1e-4), a + b - 1e-4);
  const dir = toTarget.normalize();
  const pole = new Vector3((side === 'L' ? 1 : -1) * 0.5, -1, -0.2);
  const bendDir = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const cosA = (a * a + reach * reach - b * b) / (2 * a * reach);
  const upper = dir.clone().multiplyScalar(cosA).addScaledVector(bendDir, Math.sqrt(Math.max(0, 1 - cosA * cosA)));
  const elbow = shoulder.clone().addScaledVector(upper, a);
  const fore = shoulder.clone().addScaledVector(dir, reach).sub(elbow).normalize();

  // the shoulder's -Y runs down the upper arm; the elbow bends the forearm toward its +Z
  const y = upper.clone().negate();
  let z = fore.clone().sub(upper.clone().multiplyScalar(fore.dot(upper)));
  if (z.lengthSq() < 1e-8) z = bendDir.clone().negate();
  z.normalize();
  const x = new Vector3().crossVectors(y, z);
  const qShoulder = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  const bend = Math.atan2(fore.dot(z), fore.dot(upper)) / DEG;
  const qArm = qShoulder.clone().multiply(toQuat([bend, 0, 0], side));

  joints[`shoulder${side}`] = fromQuat(qShoulder, side);
  joints[`elbow${side}`] = [bend, 0, 0];
  joints[`hand${side}`] = fromQuat(qArm.invert().multiply(hand), side);
}

/**
 * Puts the hand opposite `lead` on the grip of the two-handed weapon the lead hand holds,
 * `spacing` from the lead fist toward the pommel, both fists turned the same way. Where the
 * grip is out of that arm's reach, the weapon slides over toward it, keeping its angle, and
 * the lead arm follows.
 */
export function gripPose(joints: Joints, unit: UnitParams, lead: Hand, spacing: number): void {
  const d = bodyDims(unit);
  const side = otherHand(lead);

  // the lead arm, forward: shoulder -> elbow -> hand
  const qs = toQuat(joints[`shoulder${lead}`], lead);
  const elbowAt = shoulderAt(d, lead).add(new Vector3(0, -d.upperArm, 0).applyQuaternion(qs));
  const qe = qs.clone().multiply(toQuat(joints[`elbow${lead}`], lead));
  const handAt = elbowAt.add(new Vector3(0, -d.forearm, 0).applyQuaternion(qe));
  const hand = qe.clone().multiply(toQuat(joints[`hand${lead}`], lead));
  const grip = handAt.clone().add(new Vector3(0, spacing, 0).applyQuaternion(hand));

  const shoulder = shoulderAt(d, side);
  const short = grip.distanceTo(shoulder) - STRETCH * (d.upperArm + d.forearm);
  if (short > 0) {
    const shift = shoulder.sub(grip).normalize().multiplyScalar(short);
    handAt.add(shift);
    grip.add(shift);
    solveArm(joints, d, lead, handAt, hand);
  }
  solveArm(joints, d, side, grip, hand);
}
