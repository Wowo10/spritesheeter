import { BoxGeometry, Group, IcosahedronGeometry, Mesh, Object3D } from 'three';
import type { VehiclePose } from '../anim/types';
import type { MaterialLibrary } from '../render/materials';
import { PartBuilder } from './parts';
import { vehicleDims, type VehicleDims, type VehicleParams } from './vehicle-params';

const DEG = Math.PI / 180;

/** A weapon's moving parts. */
interface WeaponRig {
  /** Poses them for a stroke (see VehiclePose) and how wrecked the vehicle is. */
  pose: (stroke: number, wreck: number) => void;
  /** The shot waiting to be fired. */
  load?: Group;
  winch?: Group;
  /** Fire from the nozzle: hidden unless a pose lights it; its tongues flicker. */
  flame?: { group: Group; tongues: Mesh[]; size: number };
}

export interface Vehicle {
  /** Unit origin: on the ground under the middle of the deck, facing +Z. */
  root: Group;
  /** Child of root that poses may turn independently of the facing direction. */
  body: Group;
  /** Everything but the wheels; rocks on the axles. */
  frame: Group;
  /** Each knows its side (+1 left, -1 right) in userData.side. */
  wheels: Group[];
  pole: Group | null;
  flag: Group | null;
  weapon: WeaponRig;
  dims: VehicleDims;
}

const SIDES = [1, -1] as const;

export function buildVehicle(p: VehicleParams, mats: MaterialLibrary): Vehicle {
  const b = new PartBuilder(mats);
  const d = vehicleDims(p);
  const { length: L, width: W, wheelR: r, wheelT, beam, deckY } = d;

  const root = new Group();
  root.name = 'vehicle';
  const body = new Group();
  body.name = 'body';
  root.add(body);
  const frame = new Group();
  frame.name = 'frame';
  body.add(frame);

  // side beams resting on the axles, cross beams at the ends, planks between
  const beamY = deckY - beam / 2;
  for (const side of SIDES) b.box(frame, p.wood, [beam, beam, L], [side * (W / 2 - beam / 2), beamY, 0]);
  for (const end of SIDES) b.box(frame, p.wood, [W, beam, beam], [0, beamY, end * (L / 2 - beam / 2)]);
  b.box(frame, p.wood, [W - beam * 2, beam * 0.4, L - beam * 2], [0, deckY - beam * 0.25, 0]);
  for (const z of d.axles) b.cylinder(frame, p.wood, beam * 0.3, W + wheelT * 2, [0, r, z], [0, 0, 90]);

  // wheels hang off the body, not the frame, so the frame can rock on them
  const wheels: Group[] = [];
  for (const z of d.axles) {
    for (const side of SIDES) {
      const w = new Group();
      w.name = `wheel${wheels.length}`;
      w.position.set(side * (W / 2 + wheelT / 2 + 0.02), r, z);
      w.userData.rest = w.position.clone();
      w.userData.side = side;
      body.add(w);
      // an iron tyre around a wooden face, so the wheels stand out from the frame; a
      // 10-sided one, whose flats (not corners) are r from the axle
      b.cylinder(w, p.metal, r / Math.cos(Math.PI / 10), wheelT * 0.8, [0, 0, 0], [0, 0, 90], 10);
      b.cylinder(w, p.wood, r * 0.8, wheelT, [0, 0, 0], [0, 0, 90], 10);
      // iron straps across the outer face: four spokes, so a quarter turn looks the same
      for (const a of [0, 90]) b.box(w, p.metal, [wheelT * 0.3, r * 1.6, beam * 0.45], [side * wheelT * 0.5, 0, 0], [a, 0, 0]);
      b.cylinder(w, p.metal, r * 0.25, wheelT * 1.4, [0, 0, 0], [0, 0, 90], 6);
      wheels.push(w);
    }
  }

  if (p.roof && (p.weapon === 'ram' || p.weapon === 'flamethrower')) buildRoof(b, frame, p, d);

  let pole: Group | null = null;
  let flag: Group | null = null;
  if (p.banner) {
    // at a back corner, clear of the weapon
    pole = new Group();
    pole.name = 'pole';
    pole.position.set(-(W / 2 - beam / 2), deckY, -(L / 2 - beam / 2));
    frame.add(pole);
    b.cylinder(pole, p.wood, beam * 0.22, d.poleH, [0, d.poleH / 2, 0], [0, 0, 0], 6);
    flag = new Group();
    flag.name = 'flag';
    flag.position.set(0, d.poleH - 0.04, 0);
    pole.add(flag);
    const S = p.size;
    b.box(flag, p.cloth, [0.03, 0.3 * S, 0.42 * S], [0, -0.15 * S, -0.22 * S]);
  }

  const weapon = WEAPON_BUILDERS[p.weapon](b, frame, p, d);
  return { root, body, frame, wheels, pole, flag, weapon, dims: d };
}

/** Corner posts holding up a peaked roof of hides, running the length of the deck. */
function buildRoof(b: PartBuilder, frame: Object3D, p: VehicleParams, d: VehicleDims): void {
  const { length: L, width: W, beam, deckY } = d;
  const S = p.size;
  const eaves = deckY + 1.05 * S;
  const rise = 0.35 * S;
  for (const side of SIDES) {
    for (const end of SIDES) b.box(frame, p.wood, [beam * 0.8, eaves - deckY, beam * 0.8], [side * (W / 2 - beam / 2), (eaves + deckY) / 2, end * (L / 2 - beam / 2)]);
    // overhanging the sides a little
    const half = W / 2 + 0.08 * S;
    const slope = Math.atan2(rise, half) / DEG;
    b.box(frame, p.cloth, [Math.hypot(half, rise), 0.05 * S, L * 1.06], [(side * half) / 2, eaves + rise / 2, 0], [0, 0, -side * slope]);
  }
  b.box(frame, p.wood, [beam, beam, L * 1.1], [0, eaves + rise + 0.02, 0]); // ridge
}

type WeaponBuilder = (b: PartBuilder, frame: Object3D, p: VehicleParams, d: VehicleDims) => WeaponRig;

/** A group at `pos` under `parent`, so moving parts can be posed around it. */
function pivot(parent: Object3D, name: string, pos: [number, number, number]): Group {
  const g = new Group();
  g.name = name;
  g.position.set(...pos);
  parent.add(g);
  return g;
}

/**
 * A log with an iron head, hung level from an A-frame at each end by two ropes, so it swings
 * like a pendulum without tipping. Stroke 1 swings it forward, -1 pulls it back.
 */
const buildRam: WeaponBuilder = (b, frame, p, d) => {
  const { length: L, width: W, beam, deckY } = d;
  const S = p.size;
  const top = deckY + 0.9 * S;
  const h = top - deckY;
  const lean = Math.atan2(W * 0.4 - 0.05, h) / DEG;
  for (const end of SIDES) {
    for (const side of SIDES) b.box(frame, p.wood, [beam * 0.7, h / Math.cos(lean * DEG), beam * 0.7], [side * (W * 0.2 + 0.025), (top + deckY) / 2, end * L * 0.38], [0, 0, side * lean]);
  }
  b.box(frame, p.wood, [beam, beam, L * 0.82], [0, top, 0]);

  const ropeLen = 0.4 * S;
  const ropes = SIDES.map((end) => {
    const rope = pivot(frame, end > 0 ? 'ropeF' : 'ropeB', [0, top, end * L * 0.3]);
    b.box(rope, 'leather', [0.03 * S, ropeLen, 0.03 * S], [0, -ropeLen / 2, 0]);
    return rope;
  });
  const logR = 0.12 * S;
  const ram = pivot(frame, 'ram', [0, top - ropeLen, 0]);
  const logLen = L * 1.05;
  const logZ = L * 0.12;
  b.cylinder(ram, p.wood, logR, logLen, [0, -logR, logZ], [90, 0, 0], 8);
  for (const z of [-0.3, 0.1]) b.cylinder(ram, p.metal, logR * 1.12, 0.05 * S, [0, -logR, logZ + z * logLen], [90, 0, 0], 8);
  // the iron head, blunt-nosed
  const front = logZ + logLen / 2;
  b.cylinder(ram, p.metal, logR * 1.3, 0.16 * S, [0, -logR, front + 0.06 * S], [90, 0, 0], 8);
  b.taper(ram, p.metal, logR * 0.7, logR * 1.3, 0.16 * S, [0, -logR, front + 0.22 * S], [90, 0, 0]);

  return {
    pose: (stroke, wreck) => {
      const a = 28 * stroke * (1 - wreck) * DEG;
      // the ropes snap and the log drops onto the deck
      for (const rope of ropes) {
        rope.rotation.x = -a;
        rope.visible = wreck < 0.5;
      }
      const y = top - ropeLen * Math.cos(a);
      const fallen = deckY + logR * 2;
      ram.position.set(0, y + (fallen - y) * wreck, ropeLen * Math.sin(a));
      ram.rotation.x = -8 * wreck * DEG;
    },
  };
};

/**
 * A throwing arm on a torsion axle, its cup holding a stone. Cocked, the arm lies back over
 * the deck; stroke 1 has it upright against the padded crossbar, the stone gone.
 */
const buildCatapult: WeaponBuilder = (b, frame, p, d) => {
  const { length: L, width: W, beam, deckY } = d;
  const S = p.size;
  const armLen = 0.62 * L;
  const pivotY = deckY + 0.14 * S;
  const pivotZ = 0.12 * L;
  // the axle, wound with rope between two cheeks
  for (const side of SIDES) b.box(frame, p.wood, [beam, 0.3 * S, 0.3 * S], [side * W * 0.3, deckY + 0.12 * S, pivotZ]);
  b.cylinder(frame, 'hair', 0.1 * S, W * 0.5, [0, pivotY, pivotZ], [0, 0, 90], 8);

  // the crossbar the arm stops against, just in front of it when it's upright
  const barY = pivotY + armLen * 0.55;
  const barZ = pivotZ + armLen * 0.55 * Math.sin(6 * DEG) + beam;
  for (const side of SIDES) b.box(frame, p.wood, [beam, barY - deckY, beam], [side * W * 0.4, (barY + deckY) / 2, barZ]);
  b.box(frame, p.wood, [W * 0.88, beam, beam], [0, barY, barZ]);
  b.box(frame, 'leather', [W * 0.3, beam * 1.3, beam * 0.5], [0, barY, barZ - beam * 0.6]); // padding

  // the arm points up (+Y) from the axle; its cup opens toward +Z, which is up when cocked
  const arm = pivot(frame, 'arm', [0, pivotY, pivotZ]);
  b.box(arm, p.wood, [beam * 0.9, armLen, beam * 0.9], [0, armLen / 2 - 0.05 * S, 0]);
  b.box(arm, p.metal, [beam * 1.05, 0.05 * S, beam * 1.05], [0, armLen * 0.45, 0]);
  const cupY = armLen - 0.1 * S;
  b.box(arm, p.wood, [0.3 * S, 0.3 * S, 0.08 * S], [0, cupY, beam * 0.5 + 0.04 * S]);
  const load = pivot(arm, 'load', [0, cupY, beam * 0.5 + 0.2 * S]);
  b.mesh(load, new IcosahedronGeometry(0.13 * S, 0), 'fur');

  // the winch that hauls the arm back down, at the back
  const winch = pivot(frame, 'winch', [0, deckY + 0.16 * S, -L * 0.42]);
  b.cylinder(winch, 'hair', 0.07 * S, W * 0.6, [0, 0, 0], [0, 0, 90], 8);
  for (const side of SIDES) {
    for (const a of [0, 90]) b.box(winch, p.wood, [0.04 * S, 0.3 * S, 0.04 * S], [side * W * 0.32, 0, 0], [a, 0, 0]);
  }
  for (const side of SIDES) b.box(frame, p.wood, [beam * 0.8, 0.2 * S, beam * 0.8], [side * W * 0.36, deckY + 0.08 * S, -L * 0.42]);

  return {
    pose: (stroke, wreck) => {
      const cocked = -72;
      const angle = cocked + 78 * stroke;
      // broken down, it falls back flat
      arm.rotation.x = (angle + (-86 - angle) * wreck) * DEG;
    },
    load,
    winch,
  };
};

/**
 * A crossbow on a post: a stock with a bow arm out each side, strung to a sliding claw that
 * holds a javelin. Drawn at rest; stroke 1 has the string straight and the javelin gone, and
 * past 1 the arms overshoot forward.
 */
const buildBallista: WeaponBuilder = (b, frame, p, d) => {
  const { length: L, width: W, deckY } = d;
  const S = p.size;
  const stockY = deckY + 0.5 * S;
  b.box(frame, p.wood, [0.18 * S, stockY - deckY, 0.18 * S], [0, (stockY + deckY) / 2, 0]);
  // aimed a little upward
  const mount = pivot(frame, 'mount', [0, stockY, 0]);
  mount.rotation.x = -6 * DEG;
  const Ls = Math.max(L * 0.95, 1.1 * S);
  b.box(mount, p.wood, [0.16 * S, 0.1 * S, Ls], [0, 0, 0]);
  b.box(mount, p.metal, [0.22 * S, 0.14 * S, 0.12 * S], [0, 0, Ls * 0.3]); // the bow's housing

  const lineY = 0.08 * S;
  const bowZ = Ls * 0.3;
  const root = 0.11 * S;
  const span = 0.42 * S + 0.25 * W;
  const arms = SIDES.map((side) => {
    const g = pivot(mount, side > 0 ? 'bowL' : 'bowR', [side * root, lineY, bowZ]);
    b.box(g, p.wood, [span, 0.07 * S, 0.07 * S], [(side * span) / 2, 0, 0]);
    b.box(g, p.metal, [0.05 * S, 0.09 * S, 0.09 * S], [side * span, 0, 0]);
    return g;
  });
  // each half of the string is a unit-long box, stretched and turned to run from tip to claw
  const strings = SIDES.map((side) => {
    const s = b.mesh(mount, new BoxGeometry(0.025 * S, 0.025 * S, 1), 'bone');
    s.name = side > 0 ? 'stringL' : 'stringR';
    return s;
  });
  const claw = pivot(mount, 'claw', [0, lineY, 0]);
  b.box(claw, p.metal, [0.1 * S, 0.06 * S, 0.06 * S], [0, 0, 0]);
  // the javelin rests on the stock, its butt in the claw
  const boltLen = Ls * 0.8;
  const load = pivot(claw, 'load', [0, 0.02 * S, 0]);
  b.cylinder(load, p.wood, 0.025 * S, boltLen, [0, 0, boltLen / 2], [90, 0, 0], 6);
  b.cone(load, p.metal, 0.06 * S, 0.16 * S, [0, 0, boltLen + 0.06 * S], [90, 0, 0]);
  b.box(load, 'team', [0.14 * S, 0.025 * S, 0.14 * S], [0, 0, 0.1 * S]);

  const winch = pivot(mount, 'winch', [0, -0.02 * S, -Ls / 2 + 0.06 * S]);
  b.cylinder(winch, 'hair', 0.05 * S, 0.3 * S, [0, 0, 0], [0, 0, 90], 8);
  for (const a of [0, 90]) b.box(winch, p.wood, [0.03 * S, 0.24 * S, 0.03 * S], [0.17 * S, 0, 0], [a, 0, 0]);

  const DRAWN = 34;
  const SLACK = 16;
  const drawnZ = -Ls * 0.35;
  return {
    pose: (stroke, wreck) => {
      // the arms swing forward as the string is let go; a wreck leaves them slack
      const sweep = (DRAWN + (SLACK - DRAWN) * stroke) * (1 - wreck) + SLACK * wreck;
      const a = sweep * DEG;
      arms[0].rotation.y = a;
      arms[1].rotation.y = -a;
      const tipX = root + span * Math.cos(a);
      const tipZ = bowZ - span * Math.sin(a);
      // the claw slides forward with the string until it's straight
      const k = Math.min(1, Math.max(stroke, wreck));
      const clawZ = Math.min(tipZ, drawnZ + (tipZ - drawnZ) * k);
      claw.position.z = clawZ;
      SIDES.forEach((side, i) => {
        const dx = side * tipX;
        const dz = tipZ - clawZ;
        const s = strings[i];
        s.position.set(dx / 2, lineY, (tipZ + clawZ) / 2);
        s.scale.z = Math.max(0.01, Math.hypot(dx, dz));
        s.rotation.y = Math.atan2(dx, dz);
      });
      mount.rotation.x = (-6 + 26 * wreck) * DEG;
    },
    load,
    winch,
  };
};

/**
 * A tank of fire on a cradle, with a pump lever on top and a nozzle ending in a beast's head
 * that pokes out past the front. Stroke ±1 rocks the lever.
 */
const buildFlamethrower: WeaponBuilder = (b, frame, p, d) => {
  const { length: L, width: W, deckY } = d;
  const S = p.size;
  const R = Math.min(0.3 * S, W * 0.36);
  const tankLen = 0.62 * L;
  const tankZ = -0.1 * L;
  const tankY = deckY + R + 0.05 * S;
  for (const z of [-0.3, 0.3]) b.box(frame, p.wood, [R * 1.6, 0.14 * S, 0.1 * S], [0, deckY + 0.05 * S, tankZ + z * tankLen]);
  b.cylinder(frame, p.metal, R, tankLen, [0, tankY, tankZ], [90, 0, 0], 10);
  for (const z of [-0.35, 0, 0.35]) b.cylinder(frame, 'dark', R * 1.05, 0.05 * S, [0, tankY, tankZ + z * tankLen], [90, 0, 0], 10);

  // the pump: a post on the tank and a lever rocking on it
  const postTop = tankY + R + 0.15 * S;
  b.box(frame, p.wood, [0.06 * S, 0.2 * S, 0.06 * S], [0, postTop - 0.1 * S, tankZ]);
  const lever = pivot(frame, 'lever', [0, postTop, tankZ]);
  b.box(lever, p.wood, [0.05 * S, 0.05 * S, 0.7 * S], [0, 0, 0]);
  b.box(lever, p.wood, [0.2 * S, 0.05 * S, 0.05 * S], [0, 0, -0.33 * S]); // handle

  // the nozzle, angled a little up, out of the tank's front
  const nozzleStart = tankZ + tankLen / 2;
  const tip = L / 2 + 0.2 * S;
  const nozzleLen = tip - nozzleStart;
  const tilt = 8;
  const nozzle = pivot(frame, 'nozzle', [0, tankY, nozzleStart]);
  nozzle.rotation.x = -tilt * DEG;
  b.cylinder(nozzle, p.metal, 0.05 * S, nozzleLen, [0, 0, nozzleLen / 2], [90, 0, 0], 6);
  // a gaping beast's head at the end
  b.taper(nozzle, p.metal, 0.13 * S, 0.07 * S, 0.22 * S, [0, 0, nozzleLen], [90, 0, 0]);
  for (const side of SIDES) b.cone(nozzle, p.metal, 0.03 * S, 0.1 * S, [side * 0.07 * S, 0.1 * S, nozzleLen - 0.05 * S], [-30, 0, 0]);

  const group = pivot(nozzle, 'flame', [0, 0, nozzleLen + 0.12 * S]);
  group.visible = false;
  b.mesh(group, new IcosahedronGeometry(0.16 * S, 0), p.flame);
  // pointing forward (+Z); scaled and placed by applyVehiclePose, since their length flickers
  const tongues = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2;
    return b.cone(group, p.flame, 0.13 * S, 1, [Math.cos(a) * 0.08 * S, Math.sin(a) * 0.08 * S, 0], [90, 0, 0]);
  });

  return {
    pose: (stroke, wreck) => {
      lever.rotation.x = (-22 * stroke * (1 - wreck) + 18 * wreck) * DEG;
    },
    flame: { group, tongues, size: S },
  };
};

const WEAPON_BUILDERS: Record<VehicleParams['weapon'], WeaponBuilder> = {
  ram: buildRam,
  catapult: buildCatapult,
  ballista: buildBallista,
  flamethrower: buildFlamethrower,
};

export function applyVehiclePose(v: Vehicle, pose: VehiclePose): void {
  const { width: W, wheelR: r, wheelT, beam } = v.dims;
  const wreck = pose.wreck ?? 0;
  v.body.rotation.y = (pose.turn ?? 0) * DEG;

  // a wreck tips the frame onto its right side (-x), pivoting on the left wheels' axles
  const [pitch, roll, lift] = pose.rock ?? [0, 0, 0];
  const tip = Math.asin(Math.min(0.9, (r - 0.2 * beam) / W)) * wreck;
  const a = roll * DEG + tip;
  const [px, py] = [W / 2, r];
  v.frame.rotation.set(-pitch * DEG, 0, a);
  v.frame.position.set(px - (px * Math.cos(a) - py * Math.sin(a)), lift + py - (px * Math.sin(a) + py * Math.cos(a)), 0);

  for (const w of v.wheels) {
    w.position.copy(w.userData.rest);
    w.rotation.set(pose.wheels * DEG, 0, 0);
    if (w.userData.side < 0 && wreck > 0) {
      // broken off: rolls out from under the frame and tips over flat, its rim on the ground
      const fall = 90 * wreck * DEG;
      w.position.x -= (r + 0.1) * wreck;
      w.position.y = r * Math.cos(fall) + (wheelT / 2) * Math.sin(fall);
      w.rotation.z = -fall;
    }
  }

  if (v.pole) v.pole.rotation.z = 55 * wreck * DEG;
  if (v.flag) v.flag.rotation.y = (pose.flag ?? 0) * DEG;

  v.weapon.pose(pose.stroke, wreck);
  if (v.weapon.load) v.weapon.load.visible = pose.loaded;
  if (v.weapon.winch) v.weapon.winch.rotation.x = (pose.winch ?? 0) * DEG;
  const flame = v.weapon.flame;
  if (flame) {
    const scale = pose.flame?.scale ?? 0;
    flame.group.visible = scale > 0.01;
    flame.group.scale.setScalar(Math.max(scale, 0.01));
    const flicker = pose.flame?.flicker ?? 0;
    flame.tongues.forEach((tongue, i) => {
      // the stream is long and narrow; each tongue flickers on its own beat
      const len = (0.55 + 0.2 * Math.sin((flicker + i / 5) * Math.PI * 2)) * flame.size;
      tongue.scale.y = len;
      tongue.position.z = 0.1 * flame.size + len / 2;
    });
  }
}

export function disposeVehicle(v: Vehicle): void {
  v.root.removeFromParent();
  v.root.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose();
  });
}
