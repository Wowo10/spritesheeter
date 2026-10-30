import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Euler,
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
import { markSoft } from '../render/decay';
import type { MaterialLibrary } from '../render/materials';
import type { RampName } from '../render/palette';
import { bodyDims, type Cape, type HairStyle, type Helmet, type OrbItem, type ShieldItem, type UnitParams, type WeaponItem } from './params';

type V3 = [number, number, number];

const DEG = Math.PI / 180;

/** Takes a built unit out of its scene and frees its geometry; the materials are shared, so they stay. */
export function disposeTree(root: Object3D): void {
  root.removeFromParent();
  root.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose();
  });
}

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
      buildOpenHelm(b, head, fit, p);
      b.box(head, p.metal, [s * 0.16, s * 0.42, s * 0.08], [0, cy - s * 0.04, s * 0.56]); // nose guard
      buildHair(b, head, p.hairStyle, fit, p.hair, true);
      break;
    case 'horned':
      buildOpenHelm(b, head, fit, p);
      for (const side of [1, -1]) {
        // base sunk into the band, tip sweeping up and out
        b.cone(head, 'bone', s * 0.18, s * 0.7, [side * s * 0.86, cy + s * 0.62, 0], [0, 0, -side * 55]);
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
    case 'tricorn':
      buildTricorn(b, head, fit);
      buildHair(b, head, p.hairStyle, fit, p.hair, true);
      break;
    case 'wizard':
      // a broad brim and a tall cone, its tip bent back
      b.cylinder(head, p.cloth, s * 1.0, s * 0.06, [0, cy + s * 0.45, 0], undefined, 10);
      b.cylinder(head, 'yellow', s * 0.78, s * 0.1, [0, cy + s * 0.53, 0]); // band
      b.cone(head, p.cloth, s * 0.76, s * 0.9, [0, cy + s * 0.93, 0]);
      b.cone(head, p.cloth, s * 0.3, s * 0.55, [0, cy + s * 1.42, -s * 0.12], [-35, 0, 0]);
      buildHair(b, head, p.hairStyle, fit, p.hair, true);
      break;
    case 'crown': {
      // a gold ring with points, sitting on the hair; open-topped so the hair shows inside
      const r = s * 0.8;
      const top = cy + s * 0.64;
      b.mesh(head, new CylinderGeometry(r, r * 0.96, s * 0.22, 8, 1, true), 'gold', [0, top - s * 0.11, 0]);
      for (let i = 0; i < 8; i++) {
        const a = ((i + 0.5) / 8) * Math.PI * 2;
        b.cone(head, 'gold', s * 0.1, s * 0.22, [r * Math.sin(a), top + s * 0.1, r * Math.cos(a)]);
      }
      b.box(head, 'red', [s * 0.13, s * 0.13, s * 0.05], [0, top - s * 0.1, r + s * 0.01], [0, 0, 45]); // gem
      buildHair(b, head, p.hairStyle, fit, p.hair, false);
      break;
    }
    case 'bandana':
      // tied tight over the top of the head, the knot and its ends at the back
      b.box(head, p.cloth, [s * 1.08, s * 0.42, s * 1.08], [0, cy + s * 0.36, 0]);
      b.box(head, p.cloth, [s * 0.22, s * 0.2, s * 0.16], [0, cy + s * 0.3, -s * 0.58]);
      for (const side of [1, -1]) b.box(head, p.cloth, [s * 0.13, s * 0.42, s * 0.05], [side * s * 0.09, cy + s * 0.04, -s * 0.62], [0, 0, side * 15]);
      buildHair(b, head, p.hairStyle, fit, p.hair, true);
      break;
    case 'strawHat':
      b.cylinder(head, 'tawny', s * 1.1, s * 0.05, [0, cy + s * 0.42, 0], undefined, 10);
      b.taper(head, 'tawny', s * 0.55, s * 0.76, s * 0.35, [0, cy + s * 0.6, 0]);
      b.cylinder(head, 'leather', s * 0.74, s * 0.08, [0, cy + s * 0.48, 0]); // band
      buildHair(b, head, p.hairStyle, fit, p.hair, true);
      break;
    case 'viking':
      // no horns: an open helm with a spectacle guard round the eyes and mail over the neck
      buildOpenHelm(b, head, fit, p);
      b.box(head, p.metal, [s * 0.14, s * 0.38, s * 0.08], [0, cy - s * 0.04, s * 0.56]); // nose
      for (const side of [1, -1]) {
        b.box(head, p.metal, [s * 0.36, s * 0.08, s * 0.08], [side * s * 0.24, cy - s * 0.13, s * 0.55]);
        b.box(head, p.metal, [s * 0.08, s * 0.3, s * 0.08], [side * s * 0.44, cy - s * 0.03, s * 0.53]);
      }
      b.box(head, p.metal, [s * 1.2, s * 0.5, s * 0.3], [0, cy - s * 0.22, -s * 0.45]);
      buildHair(b, head, p.hairStyle, fit, p.hair, true);
      break;
    case 'featherCap':
      // a soft cap with its brim turned up in front and a long feather swept back
      b.box(head, p.cloth, [s * 1.12, s * 0.3, s * 1.12], [0, cy + s * 0.48, 0]);
      b.box(head, p.cloth, [s * 1.0, s * 0.06, s * 0.4], [0, cy + s * 0.36, s * 0.64], [-20, 0, 0]);
      b.box(head, 'bone', [s * 0.05, s * 0.9, s * 0.14], [s * 0.5, cy + s * 0.78, -s * 0.22], [-40, 0, 0]);
      buildHair(b, head, p.hairStyle, fit, p.hair, true);
      break;
    case 'plagueMask':
      // a pale beaked mask with dark goggles, under a black wide-brimmed hat
      b.box(head, 'bone', [s * 1.04, s * 0.8, s * 0.1], [0, cy - s * 0.05, s * 0.52]);
      for (const x of [0.22, -0.22]) b.box(head, 'dark', [s * 0.24, s * 0.2, s * 0.06], [x * s, cy + s * 0.08, s * 0.58]);
      b.cone(head, 'bone', s * 0.2, s * 0.7, [0, cy - s * 0.27, s * 0.88], [110, 0, 0]);
      b.cylinder(head, 'dark', s * 1.0, s * 0.06, [0, cy + s * 0.45, 0], undefined, 10);
      b.cylinder(head, 'dark', s * 0.74, s * 0.4, [0, cy + s * 0.68, 0]);
      buildHair(b, head, p.hairStyle, fit, p.hair, true);
      break;
    case 'chefHat':
      // a tall white toque, puffed out at the top
      b.cylinder(head, 'bone', s * 0.76, s * 0.2, [0, cy + s * 0.5, 0]);
      b.taper(head, 'bone', s * 0.85, s * 0.72, s * 0.75, [0, cy + s * 0.95, 0]);
      b.dome(head, 'bone', s * 0.88, [0, cy + s * 1.3, 0]).scale.y = 0.4;
      buildHair(b, head, p.hairStyle, fit, p.hair, true);
      break;
  }
}

/** Headgear that covers the face, leaving only what hangs below the chin. */
const faceCovered = (h: Helmet) => h === 'full' || h === 'plagueMask';
/** Headgear the ears would poke through. */
const earsCovered = (h: Helmet) => faceCovered(h) || h === 'hood';

/**
 * Ears, beard, teeth and face accessory, built after the headgear. Ears and beards are soft,
 * so they rot away with the hair; tusks and fangs stay with the skull. Under a full helm or a
 * mask only a beard's hang below the chin shows. The eyepatch sits over the left eye (+X),
 * standing out far enough to cover a glowing eye, its strap a thin slab through the head that
 * shows as a line where it crosses the faces.
 */
export function buildFace(b: PartBuilder, head: Object3D, fit: HeadFit, p: UnitParams): void {
  const s = fit.size;
  const cy = fit.centerY;
  // a cone from `base` toward its tip, the direction set by rotating +Y by `rotDeg`
  const spike = (ramp: RampName, r: number, h: number, base: V3, rotDeg: V3) => {
    const mid = new Vector3(0, h / 2, 0).applyEuler(new Euler(rotDeg[0] * DEG, rotDeg[1] * DEG, rotDeg[2] * DEG)).add(new Vector3(...base));
    return b.cone(head, ramp, r, h, mid.toArray(), rotDeg);
  };

  if (p.ears !== 'plain' && !earsCovered(p.helmet)) {
    const long = p.ears === 'long';
    for (const side of [1, -1]) {
      // out of the sides and swept back, flattened front to back
      const ear = spike(p.skin, s * (long ? 0.17 : 0.16), s * (long ? 0.75 : 0.55), [side * s * 0.42, cy, -s * 0.05], [long ? -10 : -20, 0, -side * (long ? 78 : 60)]);
      markSoft(ear).scale.z = 0.5;
    }
  }

  const covered = faceCovered(p.helmet);
  const beard = (size: V3, pos: V3, rotDeg?: V3) => markSoft(b.box(head, p.hair, size, pos, rotDeg));
  const moustache = () => {
    beard([s * 0.56, s * 0.11, s * 0.1], [0, cy - s * 0.2, s * 0.53]);
    for (const side of [1, -1]) beard([s * 0.11, s * 0.26, s * 0.1], [side * s * 0.27, cy - s * 0.3, s * 0.53]);
  };
  switch (p.beard) {
    case 'none':
      break;
    case 'moustache':
      if (!covered) moustache();
      break;
    case 'goatee':
      if (!covered) {
        moustache();
        beard([s * 0.32, s * 0.22, s * 0.1], [0, cy - s * 0.42, s * 0.52]);
      }
      markSoft(spike(p.hair, s * 0.15, s * 0.35, [0, cy - s * 0.5, s * 0.45], [180, 0, 0]));
      break;
    case 'full':
    case 'long':
      if (!covered) {
        moustache();
        // round the jaw from ear to ear, below the cheeks so the face doesn't read as a mask
        beard([s * 1.08, s * 0.34, s * 0.62], [0, cy - s * 0.4, s * 0.22]);
      }
      if (p.beard === 'full') {
        beard([s * 0.84, s * 0.3, s * 0.5], [0, cy - s * 0.68, s * 0.28]);
      } else {
        // down the chest, its tip pushed forward so it lies over the torso
        const hang = s * 1.0;
        markSoft(b.taper(head, p.hair, s * 0.4, s * 0.12, hang, [0, cy - s * 0.5 - hang / 2, s * 0.4], [-10, 0, 0])).scale.z = 0.6;
      }
      break;
  }

  if (!covered) {
    for (const side of [1, -1]) {
      if (p.teeth === 'tusks') spike('bone', s * 0.13, s * 0.45, [side * s * 0.3, cy - s * 0.45, s * 0.56], [25, 0, -side * 15]);
      if (p.teeth === 'fangs') spike('bone', s * 0.08, s * 0.26, [side * s * 0.13, cy - s * 0.24, s * 0.53], [180, 0, 0]);
    }
  }

  if (p.face === 'eyepatch') {
    b.box(head, 'dark', [s * 0.26, s * 0.22, 0.03], [s * 0.22, cy + s * 0.05, s / 2 + 0.025]);
    // rising from the patch across the forehead to above the other ear
    b.box(head, 'dark', [s * 1.04, s * 0.06, s * 1.04], [0, cy + s * 0.13, 0], [0, 0, -20]);
  }
}

/** How far the tricorn's turned-up brim leans out from the head, in degrees. */
const TRICORN_LEAN = 20;

/**
 * Pirate hat: a low crown ringed by a brim turned up into three walls, one corner
 * pointing forward, the wall tops trimmed in gold. The walls stand just outside the
 * head box's corners, so the head never pokes through.
 */
function buildTricorn(b: PartBuilder, head: Object3D, fit: HeadFit): void {
  const s = fit.size;
  const cy = fit.centerY;
  const base = cy + s * 0.25;
  const r = s * 0.66; // from the centre to the middle of each wall
  const h = s * 0.45;
  const lean = TRICORN_LEAN * DEG;
  const length = 2 * Math.sqrt(3) * (r + (h / 2) * Math.sin(lean)); // a side of the triangle at mid-height
  b.dome(head, 'dark', s * HELM_RADIUS, [0, cy + s * 0.5, 0]).scale.y = 0.5;
  // walls face back, front-left and front-right
  for (const angle of [180, 60, -60]) {
    const wall = new Object3D();
    wall.position.set(r * Math.sin(angle * DEG), base, r * Math.cos(angle * DEG));
    wall.rotation.y = angle * DEG; // local +Z points out of the hat
    head.add(wall);
    const up = (y: number): V3 => [0, y * Math.cos(lean), y * Math.sin(lean)];
    b.box(wall, 'dark', [length, h, s * 0.08], up(h / 2), [TRICORN_LEAN, 0, 0]);
    b.box(wall, 'gold', [length, s * 0.07, s * 0.1], up(h), [TRICORN_LEAN, 0, 0]);
  }
}

/** Octagonal radius that just clears the head box's vertical edges (its corners sit on the octagon's vertices). */
const HELM_RADIUS = 0.74;

/**
 * Brow band plus a flattened dome. The band encloses the whole upper head box, so its
 * corners can't poke through the way they do through a plain hemisphere.
 */
function buildOpenHelm(b: PartBuilder, head: Object3D, fit: HeadFit, p: UnitParams): void {
  const s = fit.size;
  const r = s * HELM_RADIUS;
  const bottom = fit.centerY + s * 0.08; // just above the eyes
  const top = fit.centerY + s * 0.55; // just above the head box
  b.cylinder(head, p.metal, r, top - bottom, [0, (top + bottom) / 2, 0]);
  b.dome(head, p.metal, r, [0, top, 0]).scale.y = 0.5;
}

/**
 * Hair around the head box (face toward +Z). Under an open helmet (`helmeted`) only what
 * sticks out below it is built; full helms and hoods hide the hair entirely.
 */
function buildHair(b: PartBuilder, head: Object3D, style: HairStyle, fit: HeadFit, ramp: RampName, helmeted: boolean): void {
  const s = fit.size;
  const cy = fit.centerY;
  const top = () => markSoft(b.box(head, ramp, [s * 1.08, s * 0.32, s * 1.08], [0, cy + s * 0.4, -s * 0.02]));
  switch (style) {
    case 'short':
      if (!helmeted) top();
      markSoft(b.box(head, ramp, [s * 1.04, s * 0.7, s * 0.3], [0, cy + s * 0.1, -s * 0.4]));
      break;
    case 'long':
      if (!helmeted) top();
      // down the back to the shoulders, with locks framing the face
      markSoft(b.box(head, ramp, [s * 1.1, s * 1.3, s * 0.3], [0, cy - s * 0.15, -s * 0.42]));
      for (const side of [1, -1]) markSoft(b.box(head, ramp, [s * 0.14, s * 0.95, s * 0.55], [side * s * 0.56, cy - s * 0.05, -s * 0.12]));
      break;
    case 'afro':
      // a big round puff, set back and up so the face stays clear; squashed under a helmet
      if (helmeted) markSoft(b.mesh(head, new SphereGeometry(s * 0.62, 8, 6), ramp, [0, cy - s * 0.02, -s * 0.22]));
      else markSoft(b.mesh(head, new SphereGeometry(s * 0.94, 8, 6), ramp, [0, cy + s * 0.75, -s * 0.16]));
      break;
    case 'mohawk':
      // the crest is flattened by a helmet; the strip down the back of the head still shows
      if (!helmeted) markSoft(b.box(head, ramp, [s * 0.24, s * 0.42, s * 0.95], [0, cy + s * 0.68, -s * 0.05]));
      markSoft(b.box(head, ramp, [s * 0.24, s * 0.6, s * 0.2], [0, cy + s * 0.15, -s * 0.52]));
      break;
    case 'bald':
      break;
  }
}

/** How far a pole reaches past the fist to where its head starts; sets the length of every polearm. */
const POLE = 0.95;
/** How much of a pole sticks out behind the fist. */
const BUTT = 0.3;

/**
 * Weapons hang from the grip along -Y (the continuation of the forearm), edges facing -Z:
 * that side leads in a chop and faces away from the body in the raised resting pose.
 * Poles run from BUTT behind the fist to -POLE, where their heads go.
 */
export function buildWeapon(b: PartBuilder, hand: Object3D, kind: WeaponItem, p: UnitParams): void {
  const pole: [number, V3] = [BUTT + POLE, [0, (BUTT - POLE) / 2, 0]]; // length and centre
  const head = -POLE;
  switch (kind) {
    case 'sword':
      b.box(hand, 'leather', [0.05, 0.16, 0.05], [0, 0, 0]);
      b.box(hand, p.metal, [0.07, 0.06, 0.07], [0, 0.1, 0]); // pommel
      b.box(hand, p.metal, [0.24, 0.05, 0.07], [0, -0.1, 0]); // crossguard
      // chunkier than real so it survives downscaling from every direction
      b.box(hand, 'steel', [0.1, 0.62, 0.11], [0, -0.43, 0]);
      break;
    case 'sabre': {
      b.box(hand, 'leather', [0.05, 0.16, 0.05], [0, 0, 0]);
      b.box(hand, p.metal, [0.08, 0.05, 0.22], [0, -0.1, -0.03]); // guard
      // knuckle bow on the edge side, from the guard round to the pommel
      b.box(hand, p.metal, [0.04, 0.24, 0.04], [0, 0, -0.12]);
      b.box(hand, p.metal, [0.05, 0.05, 0.16], [0, 0.1, -0.05]);
      // drawn with x along the hand's Z: the convex edge leads, the tip curls back toward the spine
      const blade = new Shape();
      blade.moveTo(-0.055, -0.1);
      blade.quadraticCurveTo(-0.07, -0.6, 0.13, -0.8);
      blade.quadraticCurveTo(0.07, -0.5, 0.055, -0.1);
      blade.closePath();
      b.mesh(hand, new ExtrudeGeometry(blade, { depth: 0.08, bevelEnabled: false }), 'steel', [0.04, 0, 0], [0, -90, 0]);
      break;
    }
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
    case 'cleaver':
      b.box(hand, 'wood', [0.06, 0.2, 0.06], [0, 0, 0]);
      // a broad slab hung off the handle line, so the edge sticks well out in front
      b.box(hand, 'steel', [0.05, 0.42, 0.26], [0, -0.35, -0.06]);
      b.box(hand, 'dark', [0.06, 0.05, 0.05], [0, -0.5, 0.02]); // hanging hole
      break;
    case 'flail': {
      b.box(hand, 'wood', [0.07, 0.4, 0.07], [0, -0.1, 0]);
      b.box(hand, p.metal, [0.09, 0.05, 0.09], [0, -0.31, 0]);
      // the chain holds straight, so the ball reads at the end of the swing
      for (let i = 0; i < 3; i++) b.box(hand, p.metal, [0.04, 0.07, 0.04], [0, -0.38 - i * 0.08, 0], [0, i * 45, 0]);
      const ball = -0.68;
      b.mesh(hand, new IcosahedronGeometry(0.1, 0), p.metal, [0, ball, 0]);
      const spikes: [V3, V3][] = [
        [[0.13, 0, 0], [0, 0, -90]],
        [[-0.13, 0, 0], [0, 0, 90]],
        [[0, 0, 0.13], [90, 0, 0]],
        [[0, 0, -0.13], [-90, 0, 0]],
        [[0, -0.13, 0], [180, 0, 0]],
      ];
      for (const [[x, y, z], rot] of spikes) b.cone(hand, 'steel', 0.035, 0.1, [x, ball + y, z], rot);
      break;
    }
    case 'warhammer':
      b.box(hand, 'wood', [0.075, 0.85, 0.075], [0, -0.26, 0]);
      b.box(hand, p.metal, [0.14, 0.14, 0.18], [0, -0.6, -0.06]); // striking face leads
      b.cone(hand, p.metal, 0.05, 0.22, [0, -0.6, 0.14], [90, 0, 0]); // spike on the back
      b.cone(hand, 'steel', 0.04, 0.12, [0, -0.73, 0], [180, 0, 0]);
      break;
    case 'practiceSword':
      // the sword's shape, all wood, blunt
      b.box(hand, 'leather', [0.05, 0.16, 0.05], [0, 0, 0]);
      b.box(hand, 'wood', [0.07, 0.06, 0.07], [0, 0.1, 0]);
      b.box(hand, 'wood', [0.22, 0.06, 0.08], [0, -0.1, 0]);
      b.box(hand, 'wood', [0.1, 0.6, 0.1], [0, -0.42, 0]);
      break;
    case 'boneClub':
      // a great thigh bone: a knob behind the fist, a double knuckle on the striking end
      b.taper(hand, 'bone', 0.05, 0.065, 0.62, [0, -0.28, 0]);
      b.mesh(hand, new SphereGeometry(0.07, 6, 4), 'bone', [0, 0.1, 0]);
      for (const z of [1, -1]) b.mesh(hand, new SphereGeometry(0.09, 6, 4), 'bone', [0, -0.62, z * 0.07]);
      break;
    case 'hook': {
      // a cuff over the fist, sized to it, so the hand never shows through
      const fist = bodyDims(p).armT * 1.15;
      b.cylinder(hand, 'wood', fist * 0.78, fist * 1.3, [0, 0, 0]);
      b.cylinder(hand, p.metal, fist * 0.82, fist * 0.2, [0, -fist * 0.6, 0]);
      const curve = new CatmullRomCurve3([
        new Vector3(0, -fist * 0.6, 0),
        new Vector3(0, -0.26, 0),
        new Vector3(0, -0.37, -0.06),
        new Vector3(0, -0.33, -0.15),
        new Vector3(0, -0.24, -0.15),
      ]);
      b.mesh(hand, new TubeGeometry(curve, 10, 0.035, 5), 'steel');
      break;
    }
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
    case 'scythe': {
      b.box(hand, 'wood', [0.065, pole[0], 0.065], pole[1]);
      // drawn like the sabre's blade: x along the hand's Z, sweeping forward from the end of
      // the shaft with the point curling back toward the hand
      const blade = new Shape();
      blade.moveTo(0.05, head - 0.06);
      blade.quadraticCurveTo(-0.3, head - 0.14, -0.62, head + 0.16);
      blade.quadraticCurveTo(-0.3, head, 0.05, head + 0.04);
      blade.closePath();
      b.mesh(hand, new ExtrudeGeometry(blade, { depth: 0.06, bevelEnabled: false }), 'steel', [0.03, 0, 0], [0, -90, 0]);
      break;
    }
    case 'fryingPan':
      b.box(hand, 'wood', [0.05, 0.34, 0.05], [0, -0.09, 0]);
      // the flat bottom leads, for a good clang
      b.cylinder(hand, 'dark', 0.2, 0.06, [0, -0.45, 0], [90, 0, 0], 10);
      b.cylinder(hand, 'steel', 0.16, 0.02, [0, -0.45, 0.025], [90, 0, 0], 10);
      break;
    // thrown: light enough to throw, chunky enough to see
    case 'javelin':
      b.box(hand, 'wood', [0.05, 1.25, 0.05], [0, -0.375, 0]);
      b.box(hand, p.cloth, [0.08, 0.1, 0.08], [0, -0.12, 0]); // binding where it's held
      b.cone(hand, 'steel', 0.07, 0.24, [0, -1.1, 0], [180, 0, 0]);
      break;
    case 'bomb':
      // sitting on the fist, fuse lit
      b.mesh(hand, new IcosahedronGeometry(0.17, 1), 'dark', [0, -0.17, 0]);
      b.cylinder(hand, p.metal, 0.06, 0.05, [0, -0.34, 0]);
      b.box(hand, 'leather', [0.025, 0.08, 0.025], [0, -0.39, 0]); // fuse
      b.box(hand, 'fire', [0.07, 0.07, 0.07], [0, -0.45, 0], [45, 45, 0]);
      break;
    case 'throwingAxe':
      b.box(hand, 'wood', [0.06, 0.48, 0.06], [0, -0.14, 0]);
      b.box(hand, 'steel', [0.06, 0.14, 0.14], [0, -0.32, -0.09]);
      b.box(hand, 'steel', [0.06, 0.24, 0.05], [0, -0.32, -0.18]); // flared edge
      break;
    // two-handed: the grip or haft runs back past the fist for the other hand (SECOND_GRIP)
    case 'greatsword':
      b.box(hand, 'leather', [0.055, 0.34, 0.055], [0, 0.07, 0]);
      b.box(hand, p.metal, [0.09, 0.07, 0.09], [0, 0.27, 0]); // pommel
      b.box(hand, p.metal, [0.34, 0.06, 0.09], [0, -0.12, 0]); // crossguard
      b.box(hand, 'steel', [0.16, 0.85, 0.15], [0, -0.57, 0]);
      b.cone(hand, 'steel', 0.1, 0.14, [0, -1.06, 0], [180, 45, 0]); // point
      break;
    case 'maul':
      b.box(hand, 'wood', [0.08, 1.1, 0.08], [0, -0.25, 0]);
      b.box(hand, p.metal, [0.3, 0.3, 0.48], [0, -0.85, 0]);
      b.box(hand, 'dark', [0.32, 0.06, 0.5], [0, -0.85, 0]); // band round the head
      break;
    case 'greataxe': {
      b.box(hand, 'wood', [0.08, 1.15, 0.08], [0, -0.27, 0]);
      // a crescent drawn with x along the hand's Z, its edge leading
      const blade = new Shape();
      blade.moveTo(-0.03, -0.62);
      blade.lineTo(-0.2, -0.48);
      blade.quadraticCurveTo(-0.42, -0.73, -0.2, -0.98);
      blade.lineTo(-0.03, -0.84);
      blade.closePath();
      b.mesh(hand, new ExtrudeGeometry(blade, { depth: 0.07, bevelEnabled: false }), 'steel', [0.035, 0, 0], [0, -90, 0]);
      b.cone(hand, p.metal, 0.05, 0.18, [0, -0.73, 0.12], [90, 0, 0]); // spike on the back
      b.cone(hand, 'steel', 0.045, 0.12, [0, -0.88, 0], [180, 0, 0]);
      break;
    }
    case 'spear':
      b.box(hand, 'wood', [0.07, pole[0], 0.07], pole[1]);
      b.cone(hand, 'steel', 0.09, 0.3, [0, head - 0.13, 0], [180, 0, 0]);
      break;
    case 'halberd':
      b.box(hand, 'wood', [0.07, pole[0], 0.07], pole[1]);
      b.box(hand, 'steel', [0.06, 0.3, 0.22], [0, head + 0.2, -0.13]); // axe blade
      b.box(hand, 'steel', [0.05, 0.06, 0.12], [0, head + 0.2, 0.08]); // back hook
      b.cone(hand, 'steel', 0.07, 0.26, [0, head - 0.11, 0], [180, 0, 0]);
      break;
    case 'lance': {
      // a little longer than the other poles
      const shaft = POLE + 0.1;
      b.box(hand, 'wood', [0.07, 0.4, 0.07], [0, 0.15, 0]); // butt
      // painted shaft tapering away from the hand, behind a cone guard that covers the fist
      b.taper(hand, p.cloth, 0.065, 0.025, shaft, [0, -0.16 - shaft / 2, 0]);
      b.cone(hand, p.metal, 0.13, 0.16, [0, -0.16, 0], [180, 0, 0]);
      b.cone(hand, 'steel', 0.04, 0.16, [0, -0.24 - shaft, 0], [180, 0, 0]);
      break;
    }
    case 'broom':
      b.taper(hand, 'wood', 0.035, 0.035, pole[0], pole[1]);
      b.box(hand, 'leather', [0.1, 0.06, 0.1], [0, head, 0]); // binding
      // straw flaring out from the binding
      b.taper(hand, 'tawny', 0.06, 0.14, 0.4, [0, head - 0.22, 0]);
      break;
    case 'pitchfork':
      b.box(hand, 'wood', [0.065, pole[0], 0.065], pole[1]);
      b.box(hand, 'steel', [0.28, 0.05, 0.06], [0, head, 0]);
      for (const x of [-0.12, 0, 0.12]) b.box(hand, 'steel', [0.04, 0.28, 0.04], [x, head - 0.16, 0]);
      break;
    case 'trident':
      b.box(hand, 'wood', [0.07, pole[0], 0.07], pole[1]);
      b.box(hand, p.metal, [0.28, 0.05, 0.07], [0, head, 0]);
      // barbed prongs, the middle one longest
      for (const x of [-0.12, 0, 0.12]) {
        const len = x === 0 ? 0.3 : 0.22;
        b.box(hand, p.metal, [0.045, len, 0.045], [x, head - len / 2, 0]);
        b.cone(hand, p.metal, 0.045, 0.1, [x, head - len - 0.05, 0], [180, 0, 0]);
      }
      break;
    case 'glaive': {
      b.box(hand, 'wood', [0.07, pole[0], 0.07], pole[1]);
      b.box(hand, p.metal, [0.1, 0.08, 0.1], [0, head + 0.08, 0]); // socket
      // a long single-edged blade, drawn like the sabre's: edge leading, tip curling back
      const top = head + 0.08;
      const blade = new Shape();
      blade.moveTo(-0.06, top);
      blade.quadraticCurveTo(-0.08, top - 0.38, 0.1, top - 0.55);
      blade.quadraticCurveTo(0.07, top - 0.3, 0.05, top);
      blade.closePath();
      b.mesh(hand, new ExtrudeGeometry(blade, { depth: 0.07, bevelEnabled: false }), 'steel', [0.035, 0, 0], [0, -90, 0]);
      break;
    }
    case 'banner':
      b.box(hand, 'wood', [0.06, pole[0], 0.06], pole[1]);
      b.box(hand, 'wood', [0.44, 0.04, 0.04], [0, head, 0]); // crossbar
      b.cone(hand, p.metal, 0.05, 0.14, [0, head - 0.09, 0], [180, 0, 0]); // finial
      // team-coloured cloth hanging from the crossbar, toward the hand, with a swallowtail
      b.box(hand, p.cloth, [0.36, 0.38, 0.03], [0, head + 0.21, -0.045]);
      for (const x of [-0.11, 0.11]) b.box(hand, p.cloth, [0.14, 0.12, 0.03], [x, head + 0.46, -0.045]);
      break;
    case 'crook': {
      b.taper(hand, 'wood', 0.035, 0.035, pole[0], pole[1]);
      // the hook curls over forward and back down
      const curve = new CatmullRomCurve3([
        new Vector3(0, head + 0.05, 0),
        new Vector3(0, head - 0.18, 0),
        new Vector3(0, head - 0.3, -0.08),
        new Vector3(0, head - 0.26, -0.2),
        new Vector3(0, head - 0.14, -0.22),
      ]);
      b.mesh(hand, new TubeGeometry(curve, 10, 0.035, 5), 'wood');
      break;
    }
    case 'fishingRod': {
      // thinner and a little longer than a pole, with a reel just past the fist
      const rod = BUTT + POLE + 0.2;
      const tip = BUTT - rod;
      b.taper(hand, 'wood', 0.035, 0.015, rod, [0, BUTT - rod / 2, 0]);
      b.cylinder(hand, p.metal, 0.05, 0.04, [0, -0.12, 0.06], [0, 0, 90]);
      // the line hangs back from the tip, a little forward of the rod, with a float on it
      const line = 0.3;
      const a = 15 * DEG;
      b.box(hand, 'bone', [0.012, line, 0.012], [0, tip + (line / 2) * Math.cos(a), (-line / 2) * Math.sin(a)], [-15, 0, 0]);
      b.mesh(hand, new SphereGeometry(0.045, 6, 4), 'red', [0, tip + line * Math.cos(a), -line * Math.sin(a)]);
      break;
    }
    case 'rake':
      b.box(hand, 'wood', [0.065, pole[0], 0.065], pole[1]);
      b.box(hand, 'wood', [0.36, 0.06, 0.06], [0, head, 0]);
      // teeth stick out forward, square to the handle
      for (let x = -0.14; x <= 0.15; x += 0.07) b.box(hand, 'steel', [0.035, 0.035, 0.13], [x, head, -0.08]);
      break;
    case 'staff':
      b.taper(hand, 'wood', 0.05, 0.04, pole[0], pole[1]);
      b.box(hand, p.metal, [0.12, 0.06, 0.12], [0, head, 0]);
      // orb in the team colour, so a mage reads as belonging to its player
      b.mesh(hand, new SphereGeometry(0.11, 8, 6), p.cloth, [0, head - 0.12, 0]);
      break;
  }
}

/**
 * Orb, or something else magical, hovering above the open palm. The hand's +Z axis points up
 * when the forearm is level, which is how orbs are held.
 */
export function buildOrb(b: PartBuilder, hand: Object3D, kind: OrbItem, p: UnitParams): void {
  if (kind === 'orb') {
    b.mesh(hand, new IcosahedronGeometry(0.11, 0), p.magic, [0, -0.04, 0.26]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      b.box(hand, p.magic, [0.05, 0.05, 0.05], [Math.cos(a) * 0.17, -0.04 + Math.sin(a) * 0.17, 0.26], [45, 45, 0]);
    }
    return;
  }
  // the rest are built upright: +Y up and +Z forward (along the level forearm) in the stance pose
  const float = new Object3D();
  float.rotation.x = 90 * DEG;
  hand.add(float);
  switch (kind) {
    case 'skull':
      float.position.set(0, -0.04, 0.26);
      b.mesh(float, new SphereGeometry(0.1, 8, 6), 'bone', [0, 0.03, 0]);
      b.box(float, 'bone', [0.13, 0.07, 0.12], [0, -0.07, 0.03]); // jaw
      // eyes lit in the magic colour, so it reads as cursed rather than just carried
      for (const x of [0.045, -0.045]) b.box(float, p.magic, [0.05, 0.04, 0.03], [x, 0.01, 0.09]);
      break;
    case 'lantern':
      float.position.set(0, -0.04, 0.24);
      b.box(float, p.magic, [0.12, 0.16, 0.12], [0, 0, 0]); // the glow inside
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.box(float, p.metal, [0.025, 0.17, 0.025], [x * 0.07, 0, z * 0.07]);
      b.box(float, p.metal, [0.17, 0.035, 0.17], [0, -0.095, 0]);
      b.cone(float, p.metal, 0.12, 0.08, [0, 0.12, 0]);
      b.box(float, p.metal, [0.03, 0.05, 0.03], [0, 0.18, 0]); // ring
      break;
    case 'spellbook': {
      // lying open on the palm, tipped back toward the reader
      float.position.set(0, -0.04, 0.14);
      const book = new Object3D();
      book.rotation.x = -30 * DEG;
      float.add(book);
      for (const side of [1, -1]) {
        const half = new Object3D();
        half.rotation.z = side * 15 * DEG;
        book.add(half);
        b.box(half, p.cloth, [0.14, 0.02, 0.22], [side * 0.07, 0, 0]); // cover
        b.box(half, 'bone', [0.12, 0.03, 0.19], [side * 0.065, 0.02, 0]); // pages
      }
      b.box(book, p.magic, [0.05, 0.05, 0.05], [0, 0.13, 0], [45, 45, 0]); // a rune lifting off the page
      break;
    }
  }
}

/** Bow limbs run along the hand's Z axis and bow toward -Y, i.e. forward when the arm points at the target. */
export function buildBow(b: PartBuilder, hand: Object3D): void {
  const curve = new QuadraticBezierCurve3(new Vector3(0, 0.18, -0.55), new Vector3(0, -0.18, 0), new Vector3(0, 0.18, 0.55));
  b.mesh(hand, new TubeGeometry(curve, 8, 0.05, 4), 'wood');
  b.box(hand, 'bone', [0.015, 0.015, 1.1], [0, 0.18, 0]); // string
}

/**
 * The stock runs along the hand's -Z, resting on top of the fist (-Y), so the crossbow is level
 * and points forward when shoulder + elbow + wrist pitch add up to 180 (forearm upright, aiming
 * from the shoulder). Loaded: a bolt lies in the groove, the string across in front of the hand.
 */
export function buildCrossbow(b: PartBuilder, hand: Object3D, p: UnitParams): void {
  const y = -0.08;
  b.box(hand, 'wood', [0.07, 0.07, 0.62], [0, y, -0.19]); // stock
  b.box(hand, 'wood', [0.08, 0.1, 0.14], [0, y + 0.015, 0.06]); // butt, against the shoulder
  // the prod sweeps forward to the tip of the stock
  const curve = new QuadraticBezierCurve3(new Vector3(-0.28, y, -0.34), new Vector3(0, y, -0.5), new Vector3(0.28, y, -0.34));
  b.mesh(hand, new TubeGeometry(curve, 6, 0.035, 4), p.metal);
  b.box(hand, 'bone', [0.56, 0.015, 0.015], [0, y, -0.34]); // string
  b.box(hand, 'wood', [0.025, 0.025, 0.3], [0, y - 0.045, -0.3]); // bolt
  b.cone(hand, p.metal, 0.025, 0.06, [0, y - 0.045, -0.48], [-90, 0, 0]);
}

/**
 * Same hold as the crossbow (see buildCrossbow): the stock along the hand's -Z on top of the
 * fist, level when shoulder + elbow + wrist pitch add up to 180. The barrel runs well past the
 * stock, the muzzle at its end.
 */
export function buildMusket(b: PartBuilder, hand: Object3D, p: UnitParams): void {
  const y = -0.08;
  b.box(hand, 'wood', [0.07, 0.08, 0.7], [0, y, -0.17]); // stock
  b.box(hand, 'wood', [0.08, 0.13, 0.16], [0, y + 0.02, 0.1]); // butt, against the shoulder
  b.box(hand, p.metal, [0.045, 0.045, 0.62], [0, y - 0.055, -0.6]); // barrel
  b.box(hand, p.metal, [0.04, 0.07, 0.07], [0.04, y - 0.04, 0.02]); // flintlock
  buildMuzzle(b, hand, [0, y - 0.055, -0.93], [-90, 0, 0]);
}

/**
 * Flintlock pistol: the barrel continues the arm along -Y, level when shoulder + elbow + wrist
 * pitch add up to 90 (arm straight out); the curved grip drops toward -Z, below the hand when aimed.
 */
export function buildPistol(b: PartBuilder, hand: Object3D, p: UnitParams): void {
  b.box(hand, 'wood', [0.06, 0.16, 0.08], [0, 0.02, -0.02], [-25, 0, 0]); // grip, in the fist
  b.box(hand, p.metal, [0.08, 0.06, 0.09], [0, 0.1, -0.06]); // butt cap
  b.box(hand, 'wood', [0.07, 0.2, 0.07], [0, -0.15, 0.02]); // stock under the barrel
  b.box(hand, p.metal, [0.05, 0.36, 0.05], [0, -0.22, 0.05]); // barrel
  b.box(hand, p.metal, [0.07, 0.04, 0.07], [0, -0.41, 0.05]); // flared muzzle
  b.box(hand, 'dark', [0.03, 0.06, 0.05], [0.04, -0.04, 0.06]); // flintlock
  buildMuzzle(b, hand, [0, -0.46, 0.05], [180, 0, 0]);
}

/**
 * A flash and a puff of smoke at a gun's muzzle, `rot` turning +Y out of the barrel; both
 * hidden until a pose fires the gun.
 */
function buildMuzzle(b: PartBuilder, hand: Object3D, at: V3, rot: V3): void {
  const muzzle = new Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(...at);
  muzzle.rotation.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG);
  hand.add(muzzle);
  const flash = new Object3D();
  flash.name = 'flash';
  flash.visible = false;
  muzzle.add(flash);
  // a burst of fire out of the barrel, flaring sideways where it leaves
  b.mesh(flash, new IcosahedronGeometry(0.1, 0), 'fire', [0, 0.1, 0]);
  b.cone(flash, 'fire', 0.08, 0.22, [0, 0.24, 0]);
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) b.box(flash, 'fire', [0.06, 0.06, 0.06], [x * 0.12, 0.08, z * 0.12], [45, 45, 0]);
  const smoke = new Object3D();
  smoke.name = 'smoke';
  smoke.visible = false;
  muzzle.add(smoke);
  // bunched round the muzzle rather than strung out along the barrel, which may point any way by then
  for (const [x, y, z, r] of [[0, 0.1, 0, 0.17], [0.14, 0.14, 0.06, 0.14], [-0.12, 0.16, -0.06, 0.13]]) {
    b.mesh(smoke, new IcosahedronGeometry(r, 0), 'fur', [x, y, z]);
  }
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
  // well clear of the fist (even a bulky one, turned by the mount), so the hand never pokes through
  mount.position.set(0.02 * outward, -0.04, 0.06);
  hand.add(mount);

  switch (kind) {
    case 'roundShield':
      b.cylinder(mount, p.metal, 0.25, 0.03, [0, 0, 0.04], [90, 0, 0], 12);
      b.cylinder(mount, p.cloth, 0.21, 0.04, [0, 0, 0.06], [90, 0, 0], 12);
      b.dome(mount, p.metal, 0.06, [0, 0, 0.08]).rotation.x = 90 * DEG;
      return;
    case 'buckler':
      // small and close to the fist
      b.cylinder(mount, p.metal, 0.14, 0.03, [0, 0, 0.02], [90, 0, 0], 10);
      b.dome(mount, 'steel', 0.07, [0, 0, 0.035]).rotation.x = 90 * DEG;
      return;
    case 'towerShield':
      // from the shins to the chin, hanging mostly below the hand
      b.box(mount, p.metal, [0.44, 0.9, 0.03], [0, -0.12, 0.03]);
      b.box(mount, p.cloth, [0.38, 0.84, 0.04], [0, -0.12, 0.05]);
      for (const y of [0.18, -0.42]) b.box(mount, p.metal, [0.44, 0.05, 0.02], [0, y, 0.08]); // bands
      b.dome(mount, p.metal, 0.07, [0, -0.12, 0.07]).rotation.x = 90 * DEG;
      return;
    case 'boardShield':
      // rough planks of uneven length, a diagonal stripe painted across them
      for (const [x, h] of [[-0.15, 0.5], [0, 0.55], [0.15, 0.47]]) b.box(mount, 'wood', [0.15, h, 0.04], [x, -0.06, 0.04]);
      b.box(mount, p.cloth, [0.11, 0.6, 0.012], [0, -0.06, 0.066], [0, 0, 35]);
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
