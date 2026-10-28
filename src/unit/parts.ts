import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Mesh,
  Object3D,
  QuadraticBezierCurve3,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { MaterialLibrary } from '../render/materials';
import type { RampName } from '../render/palette';
import type { Helmet, Shield, UnitParams, Weapon } from './params';

type V3 = [number, number, number];

const DEG = Math.PI / 180;

/** Small helper that creates meshes in a ramp material and parents them in one call. */
export class PartBuilder {
  constructor(private readonly mats: MaterialLibrary) {}

  mesh(parent: Object3D, geo: BufferGeometry, ramp: RampName, pos: V3 = [0, 0, 0], rotDeg: V3 = [0, 0, 0]): Mesh {
    const m = new Mesh(geo, this.mats.get(ramp));
    m.position.set(...pos);
    m.rotation.set(rotDeg[0] * DEG, rotDeg[1] * DEG, rotDeg[2] * DEG);
    parent.add(m);
    return m;
  }

  box(parent: Object3D, ramp: RampName, size: V3, pos?: V3, rotDeg?: V3): Mesh {
    return this.mesh(parent, new BoxGeometry(...size), ramp, pos, rotDeg);
  }

  cylinder(parent: Object3D, ramp: RampName, radius: number, height: number, pos?: V3, rotDeg?: V3, segments = 8): Mesh {
    return this.mesh(parent, new CylinderGeometry(radius, radius, height, segments), ramp, pos, rotDeg);
  }

  cone(parent: Object3D, ramp: RampName, radius: number, height: number, pos?: V3, rotDeg?: V3): Mesh {
    return this.mesh(parent, new ConeGeometry(radius, height, 6), ramp, pos, rotDeg);
  }

  dome(parent: Object3D, ramp: RampName, radius: number, pos?: V3): Mesh {
    return this.mesh(parent, new SphereGeometry(radius, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), ramp, pos);
  }
}

/** Head-relative measurements needed to fit helmets around the head box. */
export interface HeadFit {
  size: number;
  centerY: number;
}

export function buildHelmet(b: PartBuilder, head: Object3D, kind: Helmet, fit: HeadFit, p: UnitParams): void {
  const s = fit.size;
  const cy = fit.centerY;
  const backHair = () => b.box(head, p.hair, [s * 1.04, s * 0.7, s * 0.3], [0, cy + s * 0.1, -s * 0.4]);
  switch (kind) {
    case 'none':
      b.box(head, p.hair, [s * 1.08, s * 0.32, s * 1.08], [0, cy + s * 0.4, -s * 0.02]);
      backHair();
      break;
    case 'cap':
      b.dome(head, p.metal, s * 0.66, [0, cy + s * 0.08, 0]);
      b.box(head, p.metal, [s * 0.14, s * 0.4, s * 0.06], [0, cy - s * 0.02, s * 0.52]); // nose guard
      backHair();
      break;
    case 'horned':
      b.dome(head, p.metal, s * 0.66, [0, cy + s * 0.08, 0]);
      for (const side of [1, -1]) {
        b.cone(head, 'bone', s * 0.16, s * 0.6, [side * s * 0.62, cy + s * 0.42, 0], [0, 0, -side * 55]);
      }
      backHair();
      break;
    case 'full':
      b.box(head, p.metal, [s * 1.14, s * 1.12, s * 1.14], [0, cy + s * 0.02, 0]);
      b.box(head, 'dark', [s * 0.8, s * 0.12, s * 0.04], [0, cy + s * 0.08, s * 0.58]); // visor slit
      b.cone(head, p.metal, s * 0.1, s * 0.3, [0, cy + s * 0.72, 0]);
      break;
    case 'hood':
      b.box(head, p.cloth, [s * 1.18, s * 1.12, s * 1.06], [0, cy + s * 0.06, -s * 0.12]);
      b.box(head, p.cloth, [s * 0.7, s * 0.3, s * 0.5], [0, cy - s * 0.35, -s * 0.55], [-30, 0, 0]); // hood tail
      break;
  }
}

/** Weapons hang from the grip along -Y (the continuation of the forearm), edges facing +Z. */
export function buildWeapon(b: PartBuilder, hand: Object3D, kind: Weapon, p: UnitParams): void {
  switch (kind) {
    case 'sword':
      b.box(hand, 'leather', [0.05, 0.16, 0.05], [0, 0, 0]);
      b.box(hand, p.metal, [0.07, 0.06, 0.07], [0, 0.1, 0]); // pommel
      b.box(hand, p.metal, [0.24, 0.05, 0.07], [0, -0.1, 0]); // crossguard
      // chunkier than real so it survives downscaling from every direction
      b.box(hand, 'steel', [0.1, 0.62, 0.11], [0, -0.43, 0]);
      break;
    case 'axe':
      b.box(hand, 'wood', [0.075, 0.85, 0.075], [0, -0.26, 0]);
      b.box(hand, 'steel', [0.07, 0.3, 0.22], [0, -0.56, 0.12]);
      b.box(hand, 'steel', [0.035, 0.08, 0.1], [0, -0.56, -0.06]);
      break;
    case 'hammer':
      b.box(hand, 'wood', [0.075, 0.8, 0.075], [0, -0.24, 0]);
      b.box(hand, p.metal, [0.16, 0.16, 0.3], [0, -0.58, 0]);
      break;
    case 'spear':
      b.box(hand, 'wood', [0.07, 1.75, 0.07], [0, -0.38, 0]);
      b.cone(hand, 'steel', 0.09, 0.3, [0, -1.39, 0], [180, 0, 0]);
      break;
    case 'bow':
      // bows are held in the off hand, see buildBow
      break;
  }
}

/** Bow limbs run along the hand's Z axis and bow toward -Y, i.e. forward when the arm points at the target. */
export function buildBow(b: PartBuilder, hand: Object3D): void {
  const curve = new QuadraticBezierCurve3(new Vector3(0, 0.18, -0.55), new Vector3(0, -0.18, 0), new Vector3(0, 0.18, 0.55));
  b.mesh(hand, new TubeGeometry(curve, 8, 0.05, 4), 'wood');
  b.box(hand, 'bone', [0.015, 0.015, 1.1], [0, 0.18, 0]); // string
}

export function buildQuiver(b: PartBuilder, spine: Object3D, torsoLen: number, torsoDepth: number): void {
  const z = -torsoDepth / 2 - 0.07;
  b.cylinder(spine, 'leather', 0.08, 0.45, [0.06, torsoLen * 0.62, z], [0, 0, 22]);
  b.box(spine, 'bone', [0.12, 0.08, 0.1], [0.15, torsoLen * 0.62 + 0.24, z], [0, 0, 22]); // fletchings
}

/**
 * Shields mount on the off hand. `forearmPitchDeg` is the forearm's resting pitch,
 * which the mount cancels so the shield faces forward in the stance pose.
 */
export function buildShield(b: PartBuilder, hand: Object3D, kind: Shield, forearmPitchDeg: number, p: UnitParams): void {
  if (kind === 'none') return;
  const mount = new Object3D();
  mount.rotation.x = forearmPitchDeg * DEG;
  // in front of the fist, so the hand never pokes through
  mount.position.set(0.02, 0.04, 0.06);
  hand.add(mount);

  if (kind === 'round') {
    b.cylinder(mount, p.metal, 0.25, 0.03, [0, 0, 0.04], [90, 0, 0], 12);
    b.cylinder(mount, p.cloth, 0.21, 0.04, [0, 0, 0.06], [90, 0, 0], 12);
    b.dome(mount, p.metal, 0.06, [0, 0, 0.08]).rotation.x = 90 * DEG;
    return;
  }

  const kite = (scale: number) => {
    const s = new Shape();
    s.moveTo(-0.2 * scale, 0.24 * scale);
    s.lineTo(0.2 * scale, 0.24 * scale);
    s.lineTo(0.18 * scale, -0.04 * scale);
    s.lineTo(0, -0.42 * scale);
    s.lineTo(-0.18 * scale, -0.04 * scale);
    s.closePath();
    return s;
  };
  b.mesh(mount, new ExtrudeGeometry(kite(0.9), { depth: 0.03, bevelEnabled: false }), p.metal, [0, 0, 0.02]);
  b.mesh(mount, new ExtrudeGeometry(kite(0.8), { depth: 0.04, bevelEnabled: false }), p.cloth, [0, 0, 0.04]);
  b.box(mount, p.metal, [0.045, 0.4, 0.02], [0, -0.02, 0.09]); // centre stripe
}
