import { CylinderGeometry, ExtrudeGeometry, Group, IcosahedronGeometry, Mesh, Object3D, Shape } from 'three';
import { BEAST_JOINTS, type BeastJoint, type BeastPose } from '../anim/types';
import type { DecayRecipe } from '../render/decay';
import type { MaterialLibrary } from '../render/materials';
import { METAL_RAMPS, type RampName } from '../render/palette';
import { beastDims, type BeastDims, type BeastParams } from './beast-params';
import { PartBuilder } from './parts';

const DEG = Math.PI / 180;

export interface Beast {
  /** Unit origin: on the ground under the middle of the body, facing +Z. */
  root: Group;
  /** Child of root that poses may turn independently of the facing direction. */
  body: Group;
  joints: Record<BeastJoint, Group>;
  hipHeight: number;
  /** Spell effect at the mouth; hidden unless a pose shows it. */
  fx: Group;
  /** Packs over the back; hidden unless a pose shows them. */
  load: Group;
  /** Empty mount point on top of the back where a rider sits, following the pelvis. */
  saddle: Group;
  shadow: Mesh | null;
  /**
   * Middle of the head, snout or beak included, in the head joint's space, and a size that frames
   * it in a portrait as closely as a humanoid's head and shoulders.
   */
  skull: { center: [number, number, number]; size: number };
}

const SIDES = [
  ['L', 1],
  ['R', -1],
] as const;

export function buildBeast(p: BeastParams, mats: MaterialLibrary): Beast {
  const b = new PartBuilder(mats);
  const d = beastDims(p);
  const { length: L, depth: D, width: W, head: h, snout, legT, hipHeight } = d;

  const joints = Object.fromEntries(BEAST_JOINTS.map((name) => [name, new Group()])) as Record<BeastJoint, Group>;
  for (const [name, g] of Object.entries(joints)) g.name = name;
  const root = new Group();
  root.name = 'beast';
  const link = (parent: Object3D, child: Group, pos: [number, number, number]) => {
    child.position.set(...pos);
    child.userData.rest = child.position.clone();
    parent.add(child);
  };

  const body = new Group();
  root.add(body);
  const { pelvis, chest, neck, head, jaw } = joints;

  // the body sits a little above the leg joints; its two halves bend at the middle
  const bodyY = D * 0.3;
  const topY = bodyY + D / 2;
  link(body, pelvis, [0, hipHeight, -L / 2]);
  b.box(pelvis, p.hide, [W, D * 0.92, L * 0.62], [0, bodyY, L * 0.2]);
  b.box(pelvis, p.belly, [W * 1.02, D * 0.22, L * 0.5], [0, bodyY - D * 0.36, L * 0.25]);
  link(pelvis, chest, [0, 0, L / 2]);
  b.box(chest, p.hide, [W * 1.06, D, L * 0.62], [0, bodyY, L * 0.2]);
  b.box(chest, p.belly, [W * 1.08, D * 0.24, L * 0.5], [0, bodyY - D * 0.4, L * 0.2]);

  // neck from the top of the chest, pointing forward; poses raise it
  const neckT = Math.min(D, W) * 0.7;
  link(chest, neck, [0, bodyY + D * 0.25, L * 0.48]);
  b.box(neck, p.hide, [neckT, neckT, d.neck + neckT * 0.6], [0, 0, d.neck / 2]);

  link(neck, head, [0, 0, d.neck]);
  b.box(head, p.hide, [h, h * 0.9, h * 0.9], [0, 0, h * 0.4]); // skull
  const snoutZ = h * 0.75;
  if (p.beak) {
    // tapering to a point, hooked down at the tip
    b.taper(head, 'yellow', h * 0.08, h * 0.36, snout + h * 0.2, [0, -h * 0.08, snoutZ + snout / 2], [90, 0, 0]);
    b.cone(head, 'yellow', h * 0.1, h * 0.26, [0, -h * 0.2, snoutZ + snout], [180, 0, 0]);
  } else {
    b.box(head, p.hide, [h * 0.6, h * 0.42, snout], [0, -h * 0.15, snoutZ + snout / 2]); // upper jaw
    b.box(head, 'dark', [h * 0.3, h * 0.16, h * 0.1], [0, h * 0.02, snoutZ + snout]); // nose
    if (p.snoutLength >= 1.4) b.box(head, 'bone', [h * 0.62, h * 0.06, snout * 0.85], [0, -h * 0.36, snoutZ + snout * 0.55]); // teeth
  }
  for (const [, side] of SIDES) {
    b.box(head, p.glowEyes ? p.magic : 'dark', [h * 0.2, h * 0.14, h * 0.06], [side * h * 0.28, h * 0.12, h * 0.85]);
  }

  link(head, jaw, [0, -h * 0.36, h * 0.5]);
  const jawLen = snout + h * 0.25;
  b.box(jaw, p.beak ? 'yellow' : p.hide, [h * 0.45, h * 0.14, p.beak ? jawLen * 0.8 : jawLen], [0, -h * 0.07, (p.beak ? jawLen * 0.8 : jawLen) / 2]);
  b.box(jaw, 'red', [h * 0.42, h * 0.04, jawLen * 0.8], [0, 0, jawLen * 0.45]); // tongue, seen when the mouth opens

  buildEars(b, head, p, h);
  buildHorns(b, head, jaw, p, h, jawLen);

  const fxMount = new Group();
  fxMount.position.set(0, -h * 0.2, snoutZ + snout + 0.05);
  head.add(fxMount);
  const fx = new Group();
  fx.name = 'fx';
  fx.visible = false;
  fxMount.add(fx);
  b.mesh(fx, new IcosahedronGeometry(0.15, 0), p.magic);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.box(fx, p.magic, [0.06, 0.06, 0.06], [Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0], [45, 45, 0]);
  }

  // legs: front ones under the front of the chest, hind ones at the pelvis; sprawled legs
  // start out at the sides of the body
  const legX = (W / 2) * (0.55 + 0.45 * p.sprawl);
  for (const [s, side] of SIDES) {
    for (const [end, parent, z, thick] of [
      ['F', chest, L * 0.42, 1],
      ['B', pelvis, L * 0.02, 1.25],
    ] as const) {
      const leg = joints[`leg${end}${s}`];
      const knee = joints[`knee${end}${s}`];
      link(parent, leg, [side * legX, 0, z]);
      b.box(leg, p.hide, [legT * thick, d.upperLeg + legT * 0.5, legT * 1.2 * thick], [0, -d.upperLeg / 2 + legT * 0.2, 0]);
      link(leg, knee, [0, -d.upperLeg, 0]);
      b.box(knee, p.hide, [legT * 0.8, d.lowerLeg, legT * 0.8], [0, -d.lowerLeg / 2, 0]);
      b.box(knee, p.hide, [legT * 1.1, d.paw, legT * 1.5], [0, -d.lowerLeg - d.paw / 2, legT * 0.25]);
    }
  }

  // the tail tapers down three segments, pointing back (-Z)
  link(pelvis, joints.tail, [0, bodyY + D * 0.2, -L * 0.08]);
  const segs = [joints.tail, joints.tailMid, joints.tailTip];
  const radii = [0.85, 1, 0.75, 0.25].map((f) => d.tailT * f);
  segs.forEach((seg, i) => {
    if (i > 0) link(segs[i - 1], seg, [0, 0, -d.tailSeg]);
    if (d.tailSeg > 0.01) b.taper(seg, p.hide, radii[i + 1], radii[i], d.tailSeg + radii[i] * 0.5, [0, 0, -d.tailSeg / 2], [-90, 0, 0]);
  });

  // wing joints always exist so poses can set them; they're just empty without wings
  for (const [s, side] of SIDES) {
    link(chest, joints[`wing${s}`], [side * W * 0.4, topY - 0.02, L * 0.32]);
    link(joints[`wing${s}`], joints[`wingTip${s}`], [side * d.wingInner, 0, 0]);
  }
  buildWings(b, joints, p, d);
  buildBack(b, joints, p, d, topY, neckT);
  buildBarding(b, joints, p, d, topY, neckT);
  const load = buildPacks(b, joints.pelvis, d, topY);

  // on top of the saddle's seat, where the body's two halves meet
  const saddle = new Group();
  saddle.name = 'saddle';
  saddle.position.set(0, topY + D * 0.12, L * 0.45);
  pelvis.add(saddle);

  let shadow: Mesh | null = null;
  if (p.shadow) {
    shadow = b.mesh(root, new CylinderGeometry(W * 0.9, W * 0.9, 0.01, 12), 'dark', [0, 0.005, 0]);
    shadow.name = 'shadow';
    // stretched along the body
    shadow.userData.length = Math.max(1, (L + d.neck + h) / (W * 1.8));
  }

  // the skull runs from just behind the joint to h * 0.85, the snout from snoutZ; a long face
  // lies across the frame, so it needn't be as far inside it as a head standing upright
  const faceEnd = Math.max(h * 0.85, snoutZ + snout);
  const skull = { center: [0, 0, (faceEnd - h * 0.1) / 2] as [number, number, number], size: 0.7 * (faceEnd + h * 0.1) };
  return { root, body, joints, hipHeight, fx, load, saddle, shadow, skull };
}

function buildEars(b: PartBuilder, head: Object3D, p: BeastParams, h: number): void {
  for (const [, side] of SIDES) {
    switch (p.ears) {
      case 'pointed':
        b.cone(head, p.hide, h * 0.18, h * 0.5, [side * h * 0.3, h * 0.62, h * 0.25], [-10, 0, -side * 15]);
        break;
      case 'floppy':
        b.box(head, p.hide, [h * 0.1, h * 0.5, h * 0.3], [side * h * 0.55, h * 0.05, h * 0.25], [0, 0, side * 15]);
        break;
      case 'round':
        b.cylinder(head, p.hide, h * 0.16, h * 0.08, [side * h * 0.36, h * 0.5, h * 0.2], [90, 0, 0]);
        break;
    }
  }
}

function buildHorns(b: PartBuilder, head: Object3D, jaw: Object3D, p: BeastParams, h: number, jawLen: number): void {
  for (const [, side] of SIDES) {
    if (p.horns === 'horns') {
      // sweep back and out from the brow
      b.cone(head, 'bone', h * 0.14, h * 0.8, [side * h * 0.32, h * 0.7, h * 0.45], [-25, 0, -side * 35]);
    } else if (p.horns === 'tusks') {
      // up from the lower jaw, past the upper lip
      b.cone(jaw, 'bone', h * 0.08, h * 0.45, [side * h * 0.3, h * 0.12, jawLen * 0.75], [25, 0, -side * 15]);
    }
  }
}

function buildBack(b: PartBuilder, j: Record<BeastJoint, Group>, p: BeastParams, d: BeastDims, topY: number, neckT: number): void {
  const { length: L, depth: D, width: W, head: h } = d;
  switch (p.back) {
    case 'mane':
      // thick around the neck and framing the face
      b.box(j.chest, p.accent, [W * 1.4, D * 1.25, L * 0.32], [0, topY - D * 0.35, L * 0.42]);
      b.box(j.neck, p.accent, [neckT * 1.6, neckT * 1.6, d.neck + neckT], [0, neckT * 0.1, d.neck / 2]);
      b.box(j.head, p.accent, [h * 1.35, h * 1.3, h * 0.45], [0, h * 0.05, h * 0.05]);
      break;
    case 'spikes': {
      // a row of plates from the shoulders down to the tail tip
      const spike = (parent: Object3D, z: number, y: number, size: number) =>
        b.cone(parent, p.accent, size * 0.5, size, [0, y + size * 0.35, z], [-25, 0, 0]);
      const s = Math.min(W, D) * 0.4;
      for (const z of [0, 0.2, 0.4]) spike(j.pelvis, L * z, topY, s);
      for (const z of [0, 0.2, 0.4]) spike(j.chest, L * z, topY, s);
      for (const [i, seg] of [j.tail, j.tailMid, j.tailTip].entries()) {
        if (d.tailSeg > 0.05) spike(seg, -d.tailSeg * 0.5, d.tailT * (1 - i * 0.25), s * (0.8 - i * 0.2));
      }
      break;
    }
    case 'ridge':
      b.box(j.pelvis, p.accent, [W * 0.18, D * 0.22, L * 0.6], [0, topY + D * 0.05, L * 0.2]);
      b.box(j.chest, p.accent, [W * 0.2, D * 0.3, L * 0.6], [0, topY + D * 0.08, L * 0.2]);
      b.box(j.neck, p.accent, [neckT * 0.3, neckT * 0.4, d.neck + neckT * 0.4], [0, neckT * 0.6, d.neck / 2]);
      break;
    case 'crest':
      // a horse's mane: along the top of the neck only, leaving the back free for a rider, and a forelock
      b.box(j.neck, p.accent, [neckT * 0.4, neckT * 0.6, d.neck + neckT * 0.5], [0, neckT * 0.55, d.neck / 2 - neckT * 0.1]);
      b.box(j.head, p.accent, [h * 0.32, h * 0.3, h * 0.3], [0, h * 0.48, h * 0.15]);
      break;
  }
}

/**
 * Flat panel lying level, its leading edge along X from 0 to `length` (mirrored to -X when
 * side = -1) and trailing back (-Z) by `trailing(x)`, x in [0, 1] along the edge.
 */
function wingPanel(b: PartBuilder, parent: Object3D, ramp: RampName, side: number, length: number, trailing: [x: number, depth: number][]): void {
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(side * length, 0);
  for (const [x, depth] of trailing) s.lineTo(side * x * length, depth);
  s.closePath();
  // shape y becomes depth behind the leading edge (-Z); the thickness becomes height
  b.mesh(parent, new ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false }), ramp, [0, -0.012, 0], [-90, 0, 0]);
}

/**
 * Wings on the shoulders, each an inner and an outer segment with a bone along the leading
 * edge. Bat wings have scalloped trailing edges between the fingers; feathered ones end in
 * long, ragged flight feathers.
 */
function buildWings(b: PartBuilder, j: Record<BeastJoint, Group>, p: BeastParams, d: BeastDims): void {
  if (p.wings === 'none') return;
  const { wingInner: inner, wingOuter: outer, wingChord: c, legT } = d;
  const bat = p.wings === 'bat';
  for (const [s, side] of SIDES) {
    const wing = j[`wing${s}`];
    const tip = j[`wingTip${s}`];
    const bone = legT * (bat ? 0.45 : 0.6);
    b.box(wing, p.hide, [inner, bone, bone], [(side * inner) / 2, 0, 0]);
    b.box(tip, p.hide, [outer * (bat ? 0.95 : 0.6), bone * 0.8, bone * 0.8], [(side * outer * (bat ? 0.95 : 0.6)) / 2, 0, 0]);
    if (bat) {
      // membrane between the fingers, its edge dipping in between them
      wingPanel(b, wing, p.wingColor, side, inner, [[1, c * 0.85], [0.6, c * 0.7], [0.25, c], [0, c]]);
      wingPanel(b, tip, p.wingColor, side, outer, [[1, 0], [0.75, c * 0.45], [0.55, c * 0.55], [0.3, c * 0.6], [0, c * 0.85]]);
      // fingers spreading through the membrane
      for (const [x, z] of [[0.55, 0.5], [0.3, 0.6]]) {
        const len = Math.hypot(x * outer, z * c);
        b.box(tip, p.hide, [len, bone * 0.5, bone * 0.5], [(side * x * outer) / 2, 0, (-z * c) / 2], [0, side * Math.atan2(z * c, x * outer) * (180 / Math.PI), 0]);
      }
    } else {
      // coverts over the inner wing, then long primaries fanning out past the tip
      wingPanel(b, wing, p.wingColor, side, inner, [[1, c * 0.8], [0.5, c * 0.9], [0, c]]);
      wingPanel(b, tip, p.wingColor, side, outer, [
        [1.12, -c * 0.05],
        [1, c * 0.25],
        [0.95, c * 0.3],
        [0.82, c * 0.48],
        [0.75, c * 0.5],
        [0.55, c * 0.68],
        [0.48, c * 0.7],
        [0.25, c * 0.82],
        [0, c * 0.8],
      ]);
    }
  }
}

/** Team colours: a collar, a saddle cloth, or plates over a team-coloured skirt. */
function buildBarding(b: PartBuilder, j: Record<BeastJoint, Group>, p: BeastParams, d: BeastDims, topY: number, neckT: number): void {
  const { length: L, depth: D, width: W, head: h, snout } = d;
  const collar = () => {
    b.box(j.neck, 'team', [neckT * 1.2, neckT * 1.2, Math.max(0.07, neckT * 0.4)], [0, 0, Math.min(d.neck * 0.3, 0.05)]);
    for (const [, side] of SIDES) b.box(j.neck, p.metal, [0.04, 0.05, 0.05], [side * neckT * 0.62, 0, Math.min(d.neck * 0.3, 0.05)]);
  };
  switch (p.barding) {
    case 'collar':
      collar();
      break;
    case 'saddle':
      // cloth draped over the back where the halves meet, a leather seat on top
      b.box(j.pelvis, 'team', [W * 1.12, D * 0.42, L * 0.55], [0, topY - D * 0.17, L * 0.45]);
      b.box(j.pelvis, 'leather', [W * 0.6, D * 0.12, L * 0.3], [0, topY + D * 0.06, L * 0.45]);
      b.box(j.chest, 'leather', [W * 1.1, D * 0.1, d.legT * 0.6], [0, topY - D * 0.45, L * 0.05]); // girth strap
      break;
    case 'armor':
      collar();
      b.box(j.chest, p.metal, [W * 1.16, D * 0.6, L * 0.55], [0, topY - D * 0.25, L * 0.2]);
      b.box(j.pelvis, p.metal, [W * 1.1, D * 0.5, L * 0.45], [0, topY - D * 0.2, L * 0.22]);
      b.box(j.pelvis, 'team', [W * 1.18, D * 0.4, L * 0.55], [0, topY - D * 0.6, L * 0.25]);
      b.box(j.chest, 'team', [W * 1.22, D * 0.4, L * 0.5], [0, topY - D * 0.68, L * 0.2]);
      b.box(j.head, p.metal, [h * 0.7, h * 0.12, h * 0.55 + snout * 0.6], [0, h * 0.42, h * 0.4 + snout * 0.3]); // chamfron
      break;
  }
}

/** Saddlebags hanging down both flanks where the halves meet, a bedroll across the top. */
function buildPacks(b: PartBuilder, pelvis: Object3D, d: BeastDims, topY: number): Group {
  const { length: L, depth: D, width: W } = d;
  const load = new Group();
  load.name = 'load';
  load.visible = false;
  pelvis.add(load);
  for (const [, side] of SIDES) b.box(load, 'leather', [W * 0.3, D * 0.5, L * 0.3], [side * W * 0.62, topY - D * 0.42, L * 0.45]);
  b.box(load, 'bone', [W * 1.1, D * 0.28, L * 0.18], [0, topY + D * 0.1, L * 0.45]);
  return load;
}

export function applyBeastPose(beast: Beast, pose: BeastPose): void {
  for (const name of BEAST_JOINTS) {
    const j = beast.joints[name];
    const [pitch, yaw, roll] = pose.joints[name] ?? [0, 0, 0];
    const mirror = name.endsWith('R') ? -1 : 1;
    j.rotation.set(-pitch * DEG, mirror * yaw * DEG, mirror * roll * DEG);
    j.position.copy(j.userData.rest);
  }
  beast.body.rotation.y = (pose.turn ?? 0) * DEG;
  const [x, y, z] = pose.offset ?? [0, 0, 0];
  beast.joints.pelvis.position.x += x;
  beast.joints.pelvis.position.y += y;
  beast.joints.pelvis.position.z += z;
  if (beast.shadow) {
    const s = Math.min(1, Math.max(0.45, 1 - 1.5 * y));
    beast.shadow.scale.set(s, 1, s * beast.shadow.userData.length);
  }

  beast.load.visible = pose.load ?? false;

  const scale = pose.fx?.scale ?? 0;
  beast.fx.visible = scale > 0.01;
  if (pose.fx) {
    beast.fx.position.set(...pose.fx.pos);
    beast.fx.scale.setScalar(Math.max(scale, 0.01));
    beast.fx.rotation.z = (pose.fx.spin ?? 0) * DEG;
  }
}

/**
 * Rots to a skeleton: hide and belly rot, then are bones; manes, wing membranes, saddles and
 * collars rot away. Metal barding, horns, tusks and beaks are left lying with the bones.
 */
export function beastDecay(p: BeastParams): DecayRecipe {
  const keep: RampName[] = [...METAL_RAMPS, 'bone', 'dark', ...(p.beak ? (['yellow'] as const) : [])];
  return { flesh: [p.hide, p.belly], rotted: 'rotSkin', bare: 'bone', thin: 0.5, keep, soft: { rot: 'hair', bare: 'hide' } };
}

export function disposeBeast(beast: Beast): void {
  beast.root.removeFromParent();
  beast.root.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose();
  });
}
