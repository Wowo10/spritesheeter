import { CylinderGeometry, Group, IcosahedronGeometry, Mesh, Object3D } from 'three';
import { JOINTS, type JointName, type Pose } from '../anim/types';
import { markBody, type DecayRecipe } from '../render/decay';
import type { MaterialLibrary } from '../render/materials';
import { METAL_RAMPS, type RampName } from '../render/palette';
import { bodyDims, handItems, itemKind, type Hand, type OrbItem, type ShieldItem, type UnitParams, type WeaponItem } from './params';
import { buildBow, buildCape, buildCrossbow, buildMusket, buildPistol, buildFace, buildHelmet, buildOrb, buildQuiver, buildShield, buildWeapon, PartBuilder } from './parts';

const DEG = Math.PI / 180;

/** Resting forearm pitch of a shield arm (shoulder + elbow in the stance pose). */
const SHIELD_FOREARM_PITCH = 80;

export interface Humanoid {
  /** Unit origin: on the ground between the feet, facing +Z. Rotate around Y to change direction. */
  root: Group;
  /** Child of root that poses may turn independently of the facing direction. */
  body: Group;
  joints: Record<JointName, Group>;
  hipHeight: number;
  /** Spell effect, placed and sized by poses; hidden unless a pose shows it. */
  fx: Group;
  /** Sack carried over a shoulder; hidden unless a pose shows it, on the side it names. */
  load: Group;
  /** Ground shadow, if the unit has one; stays on the ground and shrinks as the hips rise. */
  shadow: Mesh | null;
  /** What each hand holds; hidden while a pose has it thrown. */
  grips: Record<Hand, Group>;
  /** A gun's muzzle flash and smoke, per hand holding one; shown when a pose fires it. */
  muzzles: Partial<Record<Hand, { flash: Object3D; smoke: Object3D }>>;
  /** Middle of the head in the head joint's space, and its size, headgear aside; framed by portraits. */
  skull: { center: [number, number, number]; size: number };
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
  /** Cloth down to the ankles: a flared skirt over the thighs and wide sleeves. */
  robe: boolean;
}

function outfit(p: UnitParams): Outfit {
  switch (p.armor) {
    case 'none':
      return { torso: p.cloth, pelvis: p.cloth, upperArm: p.skin, forearm: p.skin, thigh: 'leather', shin: 'leather', tabard: false, pauldrons: false, robe: false };
    case 'leather':
      return { torso: 'leather', pelvis: p.cloth, upperArm: p.skin, forearm: 'leather', thigh: p.cloth, shin: 'leather', tabard: false, pauldrons: false, robe: false };
    case 'chain':
      return { torso: p.metal, pelvis: p.cloth, upperArm: p.metal, forearm: 'leather', thigh: 'leather', shin: 'leather', tabard: true, pauldrons: false, robe: false };
    case 'plate':
      return { torso: p.metal, pelvis: p.cloth, upperArm: p.metal, forearm: p.metal, thigh: p.metal, shin: p.metal, tabard: true, pauldrons: true, robe: false };
    case 'robe':
      return { torso: p.cloth, pelvis: p.cloth, upperArm: p.cloth, forearm: p.cloth, thigh: p.cloth, shin: p.cloth, tabard: false, pauldrons: false, robe: true };
  }
}

export function buildHumanoid(p: UnitParams, mats: MaterialLibrary): Humanoid {
  const b = new PartBuilder(mats);
  const { thigh, shin, footH, legT, torsoLen, torsoW, hipW, torsoD, upperArm, forearm, armT, head, hipDrop, hipHeight } = bodyDims(p);
  const o = outfit(p);
  const items = handItems(p);

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
  markBody(b.box(hips, o.pelvis, [hipW * 0.9, 0.16, torsoD * 0.95], [0, 0, 0]));
  if (o.robe && p.body !== 'ghost') {
    // flares from the waist to the knees; the cloth-covered shins below read as its hem
    const skirt = thigh * 0.95;
    b.taper(hips, p.cloth, hipW * 0.6, hipW * 0.8, skirt, [0, 0.04 - skirt / 2, 0]).scale.z = torsoD / hipW;
  }

  link(hips, spine, [0, 0.06, 0]);
  markBody(b.box(spine, o.torso, [(hipW + torsoW) / 2 * 0.88, torsoLen * 0.5, torsoD * 0.92], [0, torsoLen * 0.25, 0]));
  markBody(b.box(spine, o.torso, [torsoW, torsoLen * 0.55, torsoD], [0, torsoLen * 0.72, 0]));
  if (p.body !== 'ghost') b.box(spine, 'leather', [hipW * 0.92, 0.06, torsoD * 0.98], [0, 0.02, 0]); // belt
  if (o.tabard) {
    b.box(spine, p.cloth, [torsoW * 0.62, torsoLen * 0.95, torsoD + 0.03], [0, torsoLen * 0.42, 0]);
  }
  if ([items.L, items.R].some((i) => i === 'bow' || i === 'crossbow')) buildQuiver(b, spine, torsoLen, torsoD);

  // cape joints always exist so poses can set them; they're just empty without a cape
  link(spine, joints.cape, [0, torsoLen - 0.04, -torsoD / 2 - 0.04]);
  if (p.cape !== 'none') {
    // reaches about the same way down the legs whatever the proportions
    const capeLength = 0.78 * (hipHeight + 0.06 + torsoLen - 0.04);
    const upper = buildCape(b, joints.cape, joints.capeTip, p.cape, p.capeColor, torsoW, capeLength);
    link(joints.cape, joints.capeTip, [0, -upper, 0]);
    if (p.cape === 'broad') {
      // mantle over the shoulders and arms, with a standing collar behind the neck
      b.box(spine, p.capeColor, [torsoW * 1.45, 0.1, torsoD * 1.05], [0, torsoLen - 0.03, -torsoD * 0.05]);
      b.box(spine, p.capeColor, [torsoW * 0.7, 0.14, 0.05], [0, torsoLen + 0.06, -torsoD / 2 - 0.02]);
    } else {
      // shoulder drape
      b.box(spine, p.capeColor, [torsoW * 1.08, 0.07, torsoD * 0.7], [0, torsoLen - 0.02, -torsoD * 0.18]);
    }
    b.box(spine, p.metal, [0.07, 0.07, 0.04], [0, torsoLen - 0.08, torsoD / 2 + 0.01]); // clasp under the chin
  } else {
    link(joints.cape, joints.capeTip, [0, 0, 0]);
  }

  // over the left shoulder, hanging down the back; poses move it to the right one
  const load = new Group();
  load.name = 'load';
  load.visible = false;
  // big enough to read at 32 px: about the size of the torso, bulging over the shoulder
  load.position.set(torsoW * 0.3, torsoLen + 0.04, -torsoD * 0.3);
  load.userData.x = load.position.x;
  spine.add(load);
  b.box(load, 'bone', [torsoW * 0.8, torsoLen * 0.8, torsoD * 1.15], [0, -torsoLen * 0.1, -torsoD * 0.25], [-15, 0, 0]);
  b.box(load, 'leather', [torsoW * 0.3, 0.07, torsoD * 0.5], [0, torsoLen * 0.32, torsoD * 0.05]); // tied neck

  link(spine, joints.head, [0, torsoLen, 0]);
  markBody(b.box(joints.head, p.skin, [head * 0.45, 0.06, head * 0.45], [0, 0.03, 0])); // neck
  const headCenter = 0.05 + head / 2;
  markBody(b.box(joints.head, p.skin, [head, head * 1.05, head], [0, headCenter, 0]));
  buildHelmet(b, joints.head, p.helmet, { size: head, centerY: headCenter }, p);
  buildFace(b, joints.head, p.face, { size: head, centerY: headCenter });
  if (p.glowEyes) {
    for (const side of [1, -1]) b.box(joints.head, p.magic, [head * 0.2, head * 0.13, 0.03], [side * head * 0.22, headCenter + head * 0.05, head / 2 + 0.01]);
  }

  const grips = {} as Record<Hand, Group>;
  const muzzles: Humanoid['muzzles'] = {};
  for (const side of ['L', 'R'] as const) {
    const x = (side === 'L' ? 1 : -1) * (torsoW / 2 + armT / 2);
    const shoulder = joints[`shoulder${side}`];
    const elbow = joints[`elbow${side}`];
    const hand = joints[`hand${side}`];
    link(spine, shoulder, [x, torsoLen - armT * 0.6, 0]);
    markBody(b.box(shoulder, o.upperArm, [armT, upperArm, armT], [0, -upperArm / 2, 0]));
    if (o.pauldrons) b.box(shoulder, p.metal, [armT * 1.6, armT * 0.9, armT * 1.6], [0, 0, 0]);
    link(shoulder, elbow, [0, -upperArm, 0]);
    markBody(b.box(elbow, o.forearm, [armT * 0.92, forearm, armT * 0.92], [0, -forearm / 2, 0]));
    if (o.robe) b.box(elbow, p.cloth, [armT * 1.4, forearm * 0.45, armT * 1.4], [0, -forearm * 0.72, 0]); // bell sleeve
    link(elbow, hand, [0, -forearm, 0]);
    markBody(b.box(hand, p.skin, [armT * 1.15, armT * 1.15, armT * 1.15], [0, -armT * 0.4, 0]));

    const grip = new Group();
    grip.name = `grip${side}`;
    grip.position.y = -armT * 0.4;
    hand.add(grip);
    grips[side] = grip;
    const item = items[side];
    switch (itemKind(item)) {
      case 'chop':
      case 'thrust':
      case 'heavy':
      case 'throw':
        buildWeapon(b, grip, item as WeaponItem, p);
        break;
      case 'shield':
        buildShield(b, grip, item as ShieldItem, SHIELD_FOREARM_PITCH, side === 'L' ? 1 : -1, p);
        break;
      case 'bow':
        buildBow(b, grip);
        break;
      case 'shouldered':
        if (item === 'musket') buildMusket(b, grip, p);
        else buildCrossbow(b, grip, p);
        break;
      case 'pistol':
        buildPistol(b, grip, p);
        break;
      case 'orb':
        buildOrb(b, grip, item as OrbItem, p);
        break;
    }
    const flash = grip.getObjectByName('flash');
    const smoke = grip.getObjectByName('smoke');
    if (flash && smoke) muzzles[side] = { flash, smoke };
  }

  // a ghost's legs are joints without meshes, so every pose still works on it
  const ghost = p.body === 'ghost';
  for (const side of ['L', 'R'] as const) {
    const x = (side === 'L' ? 1 : -1) * hipW * 0.24;
    const hip = joints[`hip${side}`];
    const knee = joints[`knee${side}`];
    link(hips, hip, [x, -hipDrop, 0]);
    link(hip, knee, [0, -thigh, 0]);
    if (ghost) continue;
    markBody(b.box(hip, o.thigh, [legT, thigh, legT], [0, -thigh / 2, 0]));
    markBody(b.box(knee, o.shin, [legT * 0.92, shin, legT * 0.92], [0, -shin / 2, 0]));
    b.box(knee, 'leather', [legT * 1.05, footH, legT * 1.7], [0, -shin - footH / 2, legT * 0.3]); // foot
  }

  // the wisp narrows to a point well short of the ground, leaving a gap over the shadow
  link(hips, joints.tail, [0, -0.04, 0]);
  if (ghost) {
    const length = 0.8 * hipHeight;
    const upper = 0.45 * length;
    const lower = length - upper;
    const r = hipW * 0.5;
    b.taper(joints.tail, o.pelvis, r, r * 0.8, upper, [0, -upper / 2, 0]);
    link(joints.tail, joints.tailTip, [0, -upper, 0]);
    b.taper(joints.tailTip, o.pelvis, r * 0.8, 0.03, lower, [0, -lower / 2, 0]);
  } else {
    link(joints.tail, joints.tailTip, [0, 0, 0]);
  }

  let shadow: Mesh | null = null;
  if (p.shadow) {
    // on the root, so it neither turns nor rises with the body
    shadow = b.mesh(root, new CylinderGeometry(0.3 * p.bulk, 0.3 * p.bulk, 0.01, 12), 'dark', [0, 0.005, 0]);
    shadow.name = 'shadow';
  }

  const fx = new Group();
  fx.name = 'fx';
  fx.visible = false;
  body.add(fx);
  b.mesh(fx, new IcosahedronGeometry(0.17, 0), p.magic);
  // sparks around the orb: a tilted ring of small cubes
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.box(fx, p.magic, [0.07, 0.07, 0.07], [Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0], [45, 45, 0]);
  }

  return { root, body, joints, hipHeight, fx, load, shadow, grips, muzzles, skull: { center: [0, headCenter, 0], size: head * 1.05 } };
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
  if (unit.shadow) {
    const s = Math.min(1, Math.max(0.45, 1 - 1.5 * y));
    unit.shadow.scale.set(s, 1, s);
  }

  unit.load.visible = pose.load !== undefined;
  for (const side of ['L', 'R'] as const) {
    unit.grips[side].visible = pose.thrown !== side;
    const muzzle = unit.muzzles[side];
    if (muzzle) {
      muzzle.flash.visible = pose.muzzle?.[side] === 'flash';
      muzzle.smoke.visible = pose.muzzle?.[side] === 'smoke';
    }
  }
  unit.load.position.x = (pose.load === 'R' ? -1 : 1) * unit.load.userData.x;

  const scale = pose.fx?.scale ?? 0;
  unit.fx.visible = scale > 0.01;
  if (pose.fx) {
    unit.fx.position.set(...pose.fx.pos);
    unit.fx.scale.setScalar(Math.max(scale, 0.01));
    unit.fx.rotation.z = (pose.fx.spin ?? 0) * DEG;
  }
}

/**
 * Rots to a skeleton: skin to rotting flesh, then bones; clothes, belts and hair rot away.
 * Armour, helmets, weapons and shields are left lying with the bones.
 */
export function humanoidDecay(p: UnitParams): DecayRecipe {
  return { flesh: [p.skin], rotted: 'rotSkin', bare: 'bone', thin: 0.5, keep: [...METAL_RAMPS, 'wood', 'bone', 'dark'], soft: { rot: 'hair', bare: 'hide' } };
}

export function disposeHumanoid(unit: Humanoid): void {
  unit.root.removeFromParent();
  unit.root.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose();
  });
}
