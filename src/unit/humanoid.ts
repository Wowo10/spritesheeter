import { Group, Mesh, Object3D } from 'three';
import { JOINTS, type JointName, type Pose } from '../anim/types';
import type { MaterialLibrary } from '../render/materials';
import type { RampName } from '../render/palette';
import { effectiveShield, type UnitParams } from './params';
import { buildBow, buildHelmet, buildQuiver, buildShield, buildWeapon, PartBuilder } from './parts';

const DEG = Math.PI / 180;

/** Resting forearm pitch of the shield arm (shoulder + elbow in the stance pose). */
const SHIELD_FOREARM_PITCH = 80;

export interface Humanoid {
  /** Unit origin: on the ground between the feet, facing +Z. Rotate around Y to change direction. */
  root: Group;
  /** Child of root that poses may turn independently of the facing direction. */
  body: Group;
  joints: Record<JointName, Group>;
  hipHeight: number;
}

interface Outfit {
  torso: RampName;
  pelvis: RampName;
  upperArm: RampName;
  forearm: RampName;
  thigh: RampName;
  shin: RampName;
  tabard: boolean;
  pauldrons: boolean;
}

function outfit(p: UnitParams): Outfit {
  switch (p.armor) {
    case 'none':
      return { torso: p.cloth, pelvis: p.cloth, upperArm: p.skin, forearm: p.skin, thigh: 'leather', shin: 'leather', tabard: false, pauldrons: false };
    case 'leather':
      return { torso: 'leather', pelvis: p.cloth, upperArm: p.skin, forearm: 'leather', thigh: p.cloth, shin: 'leather', tabard: false, pauldrons: false };
    case 'chain':
      return { torso: p.metal, pelvis: p.cloth, upperArm: p.metal, forearm: 'leather', thigh: 'leather', shin: 'leather', tabard: true, pauldrons: false };
    case 'plate':
      return { torso: p.metal, pelvis: p.cloth, upperArm: p.metal, forearm: p.metal, thigh: p.metal, shin: p.metal, tabard: true, pauldrons: true };
  }
}

export function buildHumanoid(p: UnitParams, mats: MaterialLibrary): Humanoid {
  const b = new PartBuilder(mats);
  const H = p.height;
  const B = p.bulk;
  const S = p.headSize;

  // stylised, chunky proportions: big head and hands read better at 32 px
  const thigh = 0.36 * H;
  const shin = 0.34 * H;
  const footH = 0.08;
  const legT = 0.14 * B;
  const torsoLen = 0.5 * H;
  const torsoW = 0.4 * B;
  const torsoD = 0.24 * B;
  const upperArm = 0.28 * H;
  const forearm = 0.26 * H;
  const armT = 0.11 * B;
  const head = 0.36 * S;
  const hipDrop = 0.04;
  const hipHeight = hipDrop + thigh + shin + footH;
  const o = outfit(p);

  const joints = Object.fromEntries(JOINTS.map((name) => [name, new Group()])) as Record<JointName, Group>;
  for (const [name, g] of Object.entries(joints)) g.name = name;
  const root = new Group();
  root.name = 'unit';
  const link = (parent: Object3D, child: Group, pos: [number, number, number]) => {
    child.position.set(...pos);
    child.userData.rest = child.position.clone();
    parent.add(child);
  };

  const body = new Group();
  root.add(body);
  const { hips, spine } = joints;
  link(body, hips, [0, hipHeight, 0]);
  b.box(hips, o.pelvis, [torsoW * 0.9, 0.16, torsoD * 0.95], [0, 0, 0]);

  link(hips, spine, [0, 0.06, 0]);
  b.box(spine, o.torso, [torsoW * 0.88, torsoLen * 0.5, torsoD * 0.92], [0, torsoLen * 0.25, 0]);
  b.box(spine, o.torso, [torsoW, torsoLen * 0.55, torsoD], [0, torsoLen * 0.72, 0]);
  b.box(spine, 'leather', [torsoW * 0.92, 0.06, torsoD * 0.98], [0, 0.02, 0]); // belt
  if (o.tabard) {
    b.box(spine, p.cloth, [torsoW * 0.62, torsoLen * 0.95, torsoD + 0.03], [0, torsoLen * 0.42, 0]);
  }
  if (p.weapon === 'bow') buildQuiver(b, spine, torsoLen, torsoD);

  link(spine, joints.head, [0, torsoLen, 0]);
  b.box(joints.head, p.skin, [head * 0.45, 0.06, head * 0.45], [0, 0.03, 0]); // neck
  const headCenter = 0.05 + head / 2;
  b.box(joints.head, p.skin, [head, head * 1.05, head], [0, headCenter, 0]);
  buildHelmet(b, joints.head, p.helmet, { size: head, centerY: headCenter }, p);

  for (const side of ['L', 'R'] as const) {
    const x = (side === 'L' ? 1 : -1) * (torsoW / 2 + armT / 2);
    const shoulder = joints[`shoulder${side}`];
    const elbow = joints[`elbow${side}`];
    const hand = joints[`hand${side}`];
    link(spine, shoulder, [x, torsoLen - armT * 0.6, 0]);
    b.box(shoulder, o.upperArm, [armT, upperArm, armT], [0, -upperArm / 2, 0]);
    if (o.pauldrons) b.box(shoulder, p.metal, [armT * 1.6, armT * 0.9, armT * 1.6], [0, 0, 0]);
    link(shoulder, elbow, [0, -upperArm, 0]);
    b.box(elbow, o.forearm, [armT * 0.92, forearm, armT * 0.92], [0, -forearm / 2, 0]);
    link(elbow, hand, [0, -forearm, 0]);
    b.box(hand, p.skin, [armT * 1.15, armT * 1.15, armT * 1.15], [0, -armT * 0.4, 0]);

    const grip = new Group();
    grip.position.y = -armT * 0.4;
    hand.add(grip);
    if (side === 'R') buildWeapon(b, grip, p.weapon, p);
    else if (p.weapon === 'bow') buildBow(b, grip);
    else buildShield(b, grip, effectiveShield(p), SHIELD_FOREARM_PITCH, p);
  }

  for (const side of ['L', 'R'] as const) {
    const x = (side === 'L' ? 1 : -1) * torsoW * 0.24;
    const hip = joints[`hip${side}`];
    const knee = joints[`knee${side}`];
    link(hips, hip, [x, -hipDrop, 0]);
    b.box(hip, o.thigh, [legT, thigh, legT], [0, -thigh / 2, 0]);
    link(hip, knee, [0, -thigh, 0]);
    b.box(knee, o.shin, [legT * 0.92, shin, legT * 0.92], [0, -shin / 2, 0]);
    b.box(knee, 'leather', [legT * 1.05, footH, legT * 1.7], [0, -shin - footH / 2, legT * 0.3]); // foot
  }

  return { root, body, joints, hipHeight };
}

export function applyPose(unit: Humanoid, pose: Pose): void {
  for (const name of JOINTS) {
    const j = unit.joints[name];
    const [pitch, yaw, roll] = pose.joints[name] ?? [0, 0, 0];
    const mirror = name.endsWith('R') ? -1 : 1;
    j.rotation.set(-pitch * DEG, mirror * yaw * DEG, mirror * roll * DEG);
    j.position.copy(j.userData.rest);
  }
  unit.body.rotation.y = (pose.turn ?? 0) * DEG;
  const [x, y, z] = pose.hips ?? [0, 0, 0];
  unit.joints.hips.position.x += x;
  unit.joints.hips.position.y += y;
  unit.joints.hips.position.z += z;
}

export function disposeHumanoid(unit: Humanoid): void {
  unit.root.removeFromParent();
  unit.root.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose();
  });
}
