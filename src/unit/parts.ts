import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
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
import type { Cape, HairStyle, Helmet, ShieldItem, UnitParams, WeaponItem } from './params';

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

  /** Cylinder with different end radii; `top` is the +Y end. */
  taper(parent: Object3D, ramp: RampName, top: number, bottom: number, height: number, pos?: V3, rotDeg?: V3): Mesh {
    return this.mesh(parent, new CylinderGeometry(top, bottom, height, 6), ramp, pos, rotDeg);
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
  switch (kind) {
    case 'none':
      buildHair(b, head, p.hairStyle, fit, p.hair, false);
      break;
    case 'cap':
      b.dome(head, p.metal, s * 0.66, [0, cy + s * 0.08, 0]);
      b.box(head, p.metal, [s * 0.14, s * 0.4, s * 0.06], [0, cy - s * 0.02, s * 0.52]); // nose guard
      buildHair(b, head, p.hairStyle, fit, p.hair, true);
      break;
    case 'horned':
      b.dome(head, p.metal, s * 0.66, [0, cy + s * 0.08, 0]);
      for (const side of [1, -1]) {
        b.cone(head, 'bone', s * 0.16, s * 0.6, [side * s * 0.62, cy + s * 0.42, 0], [0, 0, -side * 55]);
      }
      buildHair(b, head, p.hairStyle, fit, p.hair, true);
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

/**
 * Hair around the head box (face toward +Z). Under an open helmet (`helmeted`) only what
 * sticks out below it is built; full helms and hoods hide the hair entirely.
 */
function buildHair(b: PartBuilder, head: Object3D, style: HairStyle, fit: HeadFit, ramp: RampName, helmeted: boolean): void {
  const s = fit.size;
  const cy = fit.centerY;
  const top = () => b.box(head, ramp, [s * 1.08, s * 0.32, s * 1.08], [0, cy + s * 0.4, -s * 0.02]);
  switch (style) {
    case 'short':
      if (!helmeted) top();
      b.box(head, ramp, [s * 1.04, s * 0.7, s * 0.3], [0, cy + s * 0.1, -s * 0.4]);
      break;
    case 'long':
      if (!helmeted) top();
      // down the back to the shoulders, with locks framing the face
      b.box(head, ramp, [s * 1.1, s * 1.3, s * 0.3], [0, cy - s * 0.15, -s * 0.42]);
      for (const side of [1, -1]) b.box(head, ramp, [s * 0.14, s * 0.95, s * 0.55], [side * s * 0.56, cy - s * 0.05, -s * 0.12]);
      break;
    case 'afro':
      // a big round puff, set back and up so the face stays clear; squashed under a helmet
      if (helmeted) b.mesh(head, new SphereGeometry(s * 0.62, 8, 6), ramp, [0, cy - s * 0.02, -s * 0.22]);
      else b.mesh(head, new SphereGeometry(s * 0.74, 8, 6), ramp, [0, cy + s * 0.35, -s * 0.16]);
      break;
    case 'mohawk':
      // the crest is flattened by a helmet; the strip down the back of the head still shows
      if (!helmeted) b.box(head, ramp, [s * 0.24, s * 0.42, s * 0.95], [0, cy + s * 0.68, -s * 0.05]);
      b.box(head, ramp, [s * 0.24, s * 0.6, s * 0.2], [0, cy + s * 0.15, -s * 0.52]);
      break;
    case 'bald':
      break;
  }
}

/**
 * Weapons hang from the grip along -Y (the continuation of the forearm), edges facing -Z:
 * that side leads in a chop and faces away from the body in the raised resting pose.
 */
export function buildWeapon(b: PartBuilder, hand: Object3D, kind: WeaponItem, p: UnitParams): void {
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
      b.box(hand, 'steel', [0.07, 0.3, 0.22], [0, -0.56, -0.12]);
      b.box(hand, 'steel', [0.035, 0.08, 0.1], [0, -0.56, 0.06]);
      break;
    case 'doubleAxe':
      b.box(hand, 'wood', [0.075, 0.9, 0.075], [0, -0.28, 0]);
      for (const z of [1, -1]) {
        // each blade flares from a narrow neck to a tall edge
        b.box(hand, 'steel', [0.065, 0.2, 0.12], [0, -0.58, z * 0.09]);
        b.box(hand, 'steel', [0.07, 0.38, 0.08], [0, -0.58, z * 0.19]);
      }
      b.cone(hand, 'steel', 0.045, 0.12, [0, -0.78, 0], [180, 0, 0]); // spike on the end
      break;
    case 'hammer':
      b.box(hand, 'wood', [0.075, 0.8, 0.075], [0, -0.24, 0]);
      b.box(hand, p.metal, [0.16, 0.16, 0.3], [0, -0.58, 0]);
      break;
    case 'mace':
      b.box(hand, 'leather', [0.065, 0.55, 0.065], [0, -0.18, 0]);
      b.box(hand, p.metal, [0.17, 0.17, 0.17], [0, -0.5, 0]);
      b.box(hand, p.metal, [0.2, 0.1, 0.2], [0, -0.5, 0], [0, 45, 0]); // flanges
      b.cone(hand, p.metal, 0.05, 0.1, [0, -0.63, 0], [180, 0, 0]);
      break;
    case 'club':
      b.taper(hand, 'wood', 0.045, 0.11, 0.72, [0, -0.3, 0]);
      b.box(hand, 'wood', [0.06, 0.12, 0.06], [0.08, -0.5, 0], [0, 0, -40]); // knot
      break;
    case 'dagger':
      b.box(hand, 'leather', [0.05, 0.12, 0.05], [0, 0, 0]);
      b.box(hand, p.metal, [0.16, 0.04, 0.06], [0, -0.08, 0]);
      b.box(hand, 'steel', [0.08, 0.3, 0.09], [0, -0.25, 0]);
      break;
    case 'pickaxe':
      b.box(hand, 'wood', [0.07, 0.8, 0.07], [0, -0.24, 0]);
      b.box(hand, 'steel', [0.07, 0.08, 0.36], [0, -0.6, 0]);
      // both ends taper to points, the leading one longer
      b.cone(hand, 'steel', 0.05, 0.2, [0, -0.62, -0.27], [-90, 0, 0]);
      b.cone(hand, 'steel', 0.045, 0.14, [0, -0.62, 0.24], [90, 0, 0]);
      break;
    case 'shovel':
      b.box(hand, 'wood', [0.065, 0.85, 0.065], [0, -0.26, 0]);
      b.box(hand, 'steel', [0.22, 0.26, 0.04], [0, -0.78, 0.02]);
      break;
    case 'torch':
      b.taper(hand, 'wood', 0.04, 0.05, 0.5, [0, -0.13, 0]);
      b.box(hand, 'leather', [0.1, 0.08, 0.1], [0, -0.4, 0]); // pitch-soaked wrap
      // the flame always points away from the hand; it glows, so it's never in shadow
      b.cone(hand, 'fire', 0.1, 0.28, [0, -0.56, 0], [180, 0, 0]);
      b.box(hand, 'fire', [0.12, 0.1, 0.12], [0, -0.47, 0], [0, 45, 0]);
      break;
    case 'spear':
      b.box(hand, 'wood', [0.07, 1.75, 0.07], [0, -0.38, 0]);
      b.cone(hand, 'steel', 0.09, 0.3, [0, -1.39, 0], [180, 0, 0]);
      break;
    case 'halberd':
      b.box(hand, 'wood', [0.07, 1.75, 0.07], [0, -0.38, 0]);
      b.box(hand, 'steel', [0.06, 0.3, 0.22], [0, -1.05, 0.13]); // axe blade
      b.box(hand, 'steel', [0.05, 0.06, 0.12], [0, -1.05, -0.08]); // back hook
      b.cone(hand, 'steel', 0.07, 0.26, [0, -1.37, 0], [180, 0, 0]);
      break;
    case 'pitchfork':
      b.box(hand, 'wood', [0.065, 1.5, 0.065], [0, -0.3, 0]);
      b.box(hand, 'steel', [0.28, 0.05, 0.06], [0, -1.06, 0]);
      for (const x of [-0.12, 0, 0.12]) b.box(hand, 'steel', [0.04, 0.28, 0.04], [x, -1.22, 0]);
      break;
    case 'staff':
      b.taper(hand, 'wood', 0.05, 0.04, 1.5, [0, -0.3, 0]);
      b.box(hand, p.metal, [0.12, 0.06, 0.12], [0, -1.06, 0]);
      // orb in the team colour, so a mage reads as belonging to its player
      b.mesh(hand, new SphereGeometry(0.11, 8, 6), p.cloth, [0, -1.18, 0]);
      break;
  }
}

/**
 * Orb hovering above the open palm. The hand's +Z axis points up when the forearm is level,
 * which is how orbs are held.
 */
export function buildOrb(b: PartBuilder, hand: Object3D, p: UnitParams): void {
  b.mesh(hand, new IcosahedronGeometry(0.11, 0), p.magic, [0, -0.04, 0.26]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.box(hand, p.magic, [0.05, 0.05, 0.05], [Math.cos(a) * 0.17, -0.04 + Math.sin(a) * 0.17, 0.26], [45, 45, 0]);
  }
}

/** Bow limbs run along the hand's Z axis and bow toward -Y, i.e. forward when the arm points at the target. */
export function buildBow(b: PartBuilder, hand: Object3D): void {
  const curve = new QuadraticBezierCurve3(new Vector3(0, 0.18, -0.55), new Vector3(0, -0.18, 0), new Vector3(0, 0.18, 0.55));
  b.mesh(hand, new TubeGeometry(curve, 8, 0.05, 4), 'wood');
  b.box(hand, 'bone', [0.015, 0.015, 1.1], [0, 0.18, 0]); // string
}

/** How far a broad cape's side panels fold forward around the body, in degrees. */
const CAPE_WRAP = 40;

/**
 * Cape in two hinged segments hung from the upper back; the lower one widens a little.
 * - long: a flat panel about shoulder-wide;
 * - broad: much wider than the shoulders, its sides folded forward so it wraps the body.
 * Hangs over the quiver and hood tail, which is fine: a cape covers what's on the back.
 * `length` is both segments together. Returns the upper segment's length (where the lower hinge goes).
 */
export function buildCape(
  b: PartBuilder,
  cape: Object3D,
  tip: Object3D,
  kind: Exclude<Cape, 'none'>,
  ramp: RampName,
  shoulderWidth: number,
  length: number,
): number {
  const upper = 0.48 * length;
  const lower = 0.52 * length;
  if (kind === 'long') {
    b.box(cape, ramp, [shoulderWidth * 1.05, upper, 0.035], [0, -upper / 2, 0]);
    b.box(tip, ramp, [shoulderWidth * 1.2, lower, 0.035], [0, -lower / 2, 0]);
    return upper;
  }
  const panel = (parent: Object3D, centre: number, side: number, length: number) => {
    b.box(parent, ramp, [centre, length, 0.035], [0, -length / 2, 0]);
    for (const s of [1, -1]) {
      // hinge at the centre panel's edge; turning it makes the outer edge come forward
      const hinge = new Object3D();
      hinge.position.x = (s * centre) / 2;
      hinge.rotation.y = (-s * CAPE_WRAP * Math.PI) / 180;
      parent.add(hinge);
      b.box(hinge, ramp, [side, length, 0.035], [(s * side) / 2, -length / 2, 0]);
    }
  };
  panel(cape, shoulderWidth * 0.95, shoulderWidth * 0.45, upper);
  panel(tip, shoulderWidth * 1.05, shoulderWidth * 0.6, lower);
  return upper;
}

export function buildQuiver(b: PartBuilder, spine: Object3D, torsoLen: number, torsoDepth: number): void {
  const z = -torsoDepth / 2 - 0.07;
  b.cylinder(spine, 'leather', 0.08, 0.45, [0.06, torsoLen * 0.62, z], [0, 0, 22]);
  b.box(spine, 'bone', [0.12, 0.08, 0.1], [0.15, torsoLen * 0.62 + 0.24, z], [0, 0, 22]); // fletchings
}

/**
 * Shields mount on either hand. `forearmPitchDeg` is the forearm's resting pitch,
 * which the mount cancels so the shield faces forward in the stance pose.
 */
export function buildShield(
  b: PartBuilder,
  hand: Object3D,
  kind: ShieldItem,
  forearmPitchDeg: number,
  /** +1 on the left hand, -1 on the right: the side away from the body. */
  outward: number,
  p: UnitParams,
): void {
  const mount = new Object3D();
  mount.rotation.x = forearmPitchDeg * DEG;
  // in front of the fist, so the hand never pokes through
  mount.position.set(0.02 * outward, 0.04, 0.06);
  hand.add(mount);

  if (kind === 'roundShield') {
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
