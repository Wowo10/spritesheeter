import { ConeGeometry, ExtrudeGeometry, Group, IcosahedronGeometry, Mesh, Object3D, Shape } from 'three';
import type { BuildingPose } from '../anim/types';
import type { DecayRecipe } from '../render/decay';
import type { MaterialLibrary } from '../render/materials';
import type { RampName } from '../render/palette';
import { buildingLayout, hash01, NORMALS, type Block, type BuildingParams, type Layout, type Opening } from './building-params';
import { PartBuilder } from './parts';

const DEG = Math.PI / 180;

/** Share of the windows on each side of the `lights` threshold that blink. */
const FLICKER_BAND = 0.1;
const PUFFS = 4;
/** How far a block leans once it has fallen, in degrees. */
const LEAN = 14;

interface BlockRig {
  block: Block;
  /** On the ground under the block's middle: what stays put, the foundation, scaffold and rubble. */
  base: Group;
  /** Pivots on the foot of one wall, so the block leans over as it falls without sinking into the ground. */
  lean: Group;
  /** Which way it leans: rotation about X or Z, and the sign that keeps it above the ground. */
  tilt: { axis: 'x' | 'z'; sign: number };
  /** When it starts to fall, 0-0.3 of the way through the collapse. */
  delay: number;
  /** Scaled in height as it rises and crumbles. */
  walls: Group;
  /** Sits on top of the walls. */
  roof: Group;
  /** Windows and doors with the height of their top, shown once the walls reach it. */
  openings: { obj: Object3D; top: number }[];
  scaffold: Group;
  foundation: Mesh;
  rubble: { mesh: Mesh; r: number }[];
}

export interface Building {
  /** Building origin: on the ground under the middle of its footprint, front facing +Z. */
  root: Group;
  /** Child of root that jolts when the building is hit. */
  body: Group;
  blocks: BlockRig[];
  /** Each window's glowing pane, and a fixed number that decides when it's lit. */
  lights: { pane: Mesh; hash: number }[];
  /** The front door's leaf, on its hinge, and the light inside, seen when it's open. */
  door: { hinge: Group; inside: Mesh };
  /** The puffs over each chimney. */
  smoke: Mesh[][];
  flag: Group | null;
  layout: Layout;
  size: number;
}

export function buildBuilding(p: BuildingParams, mats: MaterialLibrary): Building {
  const b = new PartBuilder(mats);
  const layout = buildingLayout(p);
  const S = p.size;

  const root = new Group();
  root.name = 'building';
  const body = new Group();
  body.name = 'body';
  root.add(body);

  const lights: Building['lights'] = [];
  const smoke: Mesh[][] = [];
  let flag: Group | null = null;
  let door: Building['door'] | null = null;

  const blocks = layout.blocks.map((block, i): BlockRig => {
    const { w, d, height: H } = block;
    const base = new Group();
    base.name = `block${i}`;
    base.position.set(block.x, 0, block.z);
    body.add(base);

    // the wall it falls toward
    const fallSide = Math.floor(hash01(p.seed, i, 99) * 4);
    const tilt = fallSide % 2 === 0 ? { axis: 'x' as const, sign: fallSide === 0 ? 1 : -1 } : { axis: 'z' as const, sign: fallSide === 1 ? 1 : -1 };
    const pivot: [number, number] = tilt.axis === 'x' ? [0, (tilt.sign * d) / 2] : [(tilt.sign * w) / 2, 0];
    const lean = new Group();
    lean.name = 'lean';
    lean.position.set(pivot[0], 0, pivot[1]);
    base.add(lean);
    const content = new Group();
    content.position.set(-pivot[0], 0, -pivot[1]);
    lean.add(content);

    const walls = new Group();
    walls.name = 'walls';
    content.add(walls);
    b.box(walls, p.walls, [w, H, d], [0, H / 2, 0]);
    b.box(walls, p.trim, [w + 0.08 * S, 0.18 * S, d + 0.08 * S], [0, 0.09 * S, 0]);
    // a beam around each floor and the top of the walls, and posts at the corners
    for (let f = 1; f <= block.floors; f++) b.box(walls, p.trim, [w + 0.04 * S, 0.08 * S, d + 0.04 * S], [0, Math.min(f * layout.floorH, H - 0.04 * S), 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(walls, p.trim, [0.1 * S, H, 0.1 * S], [(sx * w) / 2, H / 2, (sz * d) / 2]);

    const roof = new Group();
    roof.name = 'roof';
    roof.position.y = H;
    content.add(roof);
    const surface = buildRoof(b, roof, block, p);
    if (block.chimney) smoke.push(buildChimney(b, roof, block.chimney, surface, p));
    if (p.banner && i === layout.bannerOn) flag = buildBanner(b, roof, block, p);

    const openings: BlockRig['openings'] = [];
    for (const win of block.windows) {
      const g = onWall(content, block, win, 'window');
      const [ww, wh] = layout.window;
      g.position.y += wh / 2;
      b.box(g, p.trim, [ww + 0.08 * S, wh + 0.08 * S, 0.06 * S]);
      b.box(g, 'dark', [ww, wh, 0.05 * S], [0, 0, 0.015 * S]);
      const pane = b.box(g, p.light, [ww * 0.9, wh * 0.9, 0.02 * S], [0, 0, 0.04 * S]);
      pane.name = 'glow';
      lights.push({ pane, hash: hash01(p.seed, 7, lights.length) });
      openings.push({ obj: g, top: win.y + wh });
    }
    if (i === 0) {
      const g = onWall(content, block, layout.door, 'door');
      const [dw, dh] = layout.doorSize;
      b.box(g, p.trim, [dw + 0.12 * S, dh + 0.08 * S, 0.06 * S], [0, (dh + 0.08 * S) / 2, 0]);
      const inside = b.box(g, p.light, [dw, dh, 0.02 * S], [0, dh / 2, 0.035 * S]);
      inside.name = 'inside';
      const hinge = new Group();
      hinge.name = 'hinge';
      hinge.position.set(-dw / 2, 0, 0.05 * S);
      g.add(hinge);
      const leaf: RampName = p.walls === 'hair' || p.trim === 'hair' ? 'wood' : 'hair';
      b.box(hinge, leaf, [dw, dh, 0.05 * S], [dw / 2, dh / 2, 0]);
      door = { hinge, inside };
      openings.push({ obj: g, top: dh });
    }

    const foundation = b.box(base, 'hair', [w + 0.3 * S, 0.05 * S, d + 0.3 * S], [0, 0.025 * S, 0]);
    foundation.name = 'foundation';
    const scaffold = buildScaffold(b, base, block, layout.floorH, S);
    const rubble = Array.from({ length: 6 }, (_, k) => {
      const r = (0.3 + 0.25 * hash01(p.seed, i, k, 1)) * Math.min(w, d) * 0.5;
      const ramp = [p.walls, p.trim, p.roofColor][k % 3];
      const pos: [number, number, number] = [(hash01(p.seed, i, k, 2) - 0.5) * 0.7 * w, 0, (hash01(p.seed, i, k, 3) - 0.5) * 0.7 * d];
      const mesh = b.mesh(base, new IcosahedronGeometry(r, 0), ramp, pos, [0, 360 * hash01(p.seed, i, k, 4), 0]);
      mesh.name = 'rubble';
      return { mesh, r };
    });

    return { block, base, lean, tilt, delay: 0.3 * hash01(p.seed, i, 98), walls, roof, openings, scaffold, foundation, rubble };
  });

  return { root, body, blocks, lights, door: door!, smoke, flag, layout, size: S };
}

/** A group on the outside of a block's wall, at the opening's foot, its +Z facing out. */
function onWall(parent: Object3D, block: Block, o: Opening, name: string): Group {
  const [nx, nz] = NORMALS[o.side];
  const g = new Group();
  g.name = name;
  g.position.set(nx * (block.w / 2) + (nx === 0 ? o.along : 0), o.y, nz * (block.d / 2) + (nz === 0 ? o.along : 0));
  g.rotation.y = Math.atan2(nx, nz);
  parent.add(g);
  return g;
}

/**
 * The block's roof, its eaves at the roof group's origin. Returns the height of its top surface
 * at a point (x, z) of the block, for what stands on it.
 */
function buildRoof(b: PartBuilder, roof: Group, block: Block, p: BuildingParams): (x: number, z: number) => number {
  const S = p.size;
  const { w, d, rise } = block;
  const o = 0.12 * S;

  if (block.roof === 'gable') {
    // built with the ridge along Z, then turned to run along the long side
    const alongX = w >= d;
    const [span, len] = alongX ? [d, w] : [w, d];
    const frame = new Group();
    frame.rotation.y = alongX ? 90 * DEG : 0;
    roof.add(frame);
    const half = span / 2 + o;
    const slope = Math.atan2(rise, half) / DEG;
    for (const side of [-1, 1]) {
      b.box(frame, p.roofColor, [Math.hypot(half, rise), 0.07 * S, len + 2 * o], [(side * half) / 2, rise / 2, 0], [0, 0, -side * slope]);
    }
    b.box(frame, p.trim, [0.1 * S, 0.1 * S, len + 2 * o + 0.04 * S], [0, rise + 0.03 * S, 0]);
    // the gable ends, in the walls' colour, under the slopes
    const tri = new Shape();
    tri.moveTo(-span / 2, 0);
    tri.lineTo(span / 2, 0);
    tri.lineTo(0, rise * 0.97);
    tri.closePath();
    const geo = new ExtrudeGeometry(tri, { depth: len, bevelEnabled: false });
    geo.translate(0, 0, -len / 2);
    b.mesh(frame, geo, p.walls);
    return (x, z) => rise * Math.max(0, 1 - Math.abs(alongX ? z : x) / half) + 0.035 * S;
  }

  if (block.roof === 'hip') {
    // a square pyramid with a base 1 across, stretched over the walls
    const geo = new ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    const [ow, od] = [w + 2 * o, d + 2 * o];
    b.mesh(roof, geo, p.roofColor).scale.set(ow, rise, od);
    if (block.tower) b.cylinder(roof, p.trim, 0.03 * S, 0.25 * S, [0, rise + 0.1 * S, 0], [0, 0, 0], 6);
    return (x, z) => rise * Math.max(0, 1 - Math.max(Math.abs(x) / (ow / 2), Math.abs(z) / (od / 2)));
  }

  // flat: a low slab behind a parapet, crenellated
  const t = 0.1 * S;
  b.box(roof, 'dark', [w - t, 0.06 * S, d - t], [0, 0.03 * S, 0]);
  for (const s of [-1, 1]) {
    b.box(roof, p.walls, [w, rise, t], [0, rise / 2, (s * (d - t)) / 2]);
    b.box(roof, p.walls, [t, rise, d - 2 * t], [(s * (w - t)) / 2, rise / 2, 0]);
  }
  const merlon = 0.2 * S;
  for (const [len, alongX] of [[w, true], [d, false]] as const) {
    const n = Math.max(2, Math.floor(len / (2 * merlon)));
    for (let k = 0; k < n; k++) {
      const a = (k - (n - 1) / 2) * (len / n);
      for (const s of [-1, 1]) {
        const off = (s * ((alongX ? d : w) - t)) / 2;
        b.box(roof, p.walls, [alongX ? merlon : t, 0.16 * S, alongX ? t : merlon], alongX ? [a, rise + 0.08 * S, off] : [off, rise + 0.08 * S, a]);
      }
    }
  }
  return () => rise;
}

/** A chimney through the roof at `at`, and the smoke puffs over it, which poses move. */
function buildChimney(b: PartBuilder, roof: Group, at: [number, number], surface: (x: number, z: number) => number, p: BuildingParams): Mesh[] {
  const S = p.size;
  const top = surface(...at) + 0.4 * S;
  b.box(roof, p.trim, [0.26 * S, top, 0.26 * S], [at[0], top / 2, at[1]]);
  b.box(roof, 'dark', [0.32 * S, 0.06 * S, 0.32 * S], [at[0], top, at[1]]);
  const smoke = new Group();
  smoke.name = 'smoke';
  smoke.position.set(at[0], top + 0.05 * S, at[1]);
  roof.add(smoke);
  return Array.from({ length: PUFFS }, () => b.mesh(smoke, new IcosahedronGeometry(1, 0), 'fur'));
}

/** A team flag on a pole, at the peak of the block's roof (at the end of a ridge, on a parapet's corner). */
function buildBanner(b: PartBuilder, roof: Group, block: Block, p: BuildingParams): Group {
  const S = p.size;
  const { w, d, rise } = block;
  const end = hash01(p.seed, 5) < 0.5 ? -1 : 1;
  const at: [number, number, number] =
    block.roof === 'hip'
      ? [0, rise, 0]
      : block.roof === 'gable'
        ? w >= d
          ? [end * 0.4 * w, rise, 0]
          : [0, rise, end * 0.4 * d]
        : [end * (w / 2 - 0.1 * S), rise, d / 2 - 0.1 * S];
  const poleH = 0.8 * S;
  const pole = new Group();
  pole.name = 'pole';
  pole.position.set(...at);
  roof.add(pole);
  b.cylinder(pole, 'wood', 0.025 * S, poleH, [0, poleH / 2, 0], [0, 0, 0], 6);
  const flag = new Group();
  flag.name = 'flag';
  flag.position.y = poleH - 0.03 * S;
  pole.add(flag);
  b.box(flag, 'team', [0.03, 0.28 * S, 0.42 * S], [0, -0.14 * S, -0.22 * S]);
  return flag;
}

/** Poles at the corners and planks around each floor, standing clear of the walls. */
function buildScaffold(b: PartBuilder, base: Group, block: Block, floorH: number, S: number): Group {
  const g = new Group();
  g.name = 'scaffold';
  base.add(g);
  const gap = 0.18 * S;
  const [hw, hd] = [block.w / 2 + gap, block.d / 2 + gap];
  const h = block.height + 0.3 * S;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cylinder(g, 'wood', 0.035 * S, h, [sx * hw, h / 2, sz * hd], [0, 0, 0], 5);
  for (let f = 1; f <= block.floors; f++) {
    const y = Math.min(f * floorH, block.height) - 0.1 * S;
    for (const s of [-1, 1]) {
      b.box(g, 'wood', [2 * hw, 0.05 * S, 0.14 * S], [0, y, s * hd]);
      b.box(g, 'wood', [0.14 * S, 0.05 * S, 2 * hd], [s * hw, y, 0]);
    }
  }
  return g;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Whether a window is lit: below the threshold it is, above it isn't, and near it, it blinks. */
function isLit(hash: number, i: number, lights: number, flicker: number): boolean {
  if (lights <= 0) return false;
  if (hash < lights - FLICKER_BAND) return true;
  if (hash >= lights + FLICKER_BAND) return false;
  return hash01(i, Math.floor(flicker * 8), 3) < 0.5;
}

export function applyBuildingPose(bld: Building, pose: BuildingPose): void {
  const S = bld.size;
  const n = bld.blocks.length;
  const build = pose.build ?? 1;
  const collapse = pose.collapse ?? 0;
  // the rubble settles: stumps and heaps sink lower
  const settle = 1 - 0.7 * (pose.ruin ?? 0);
  const [sx, sz] = pose.shake ?? [0, 0];
  bld.body.position.set(sx, 0, sz);

  for (const [i, r] of bld.blocks.entries()) {
    // the main block goes up first, the others staggered after it; walls, then the roof
    const start = n === 1 ? 0 : (i / (n - 1)) * 0.35;
    const k = clamp01((build - start) / 0.65);
    const wallK = clamp01(k / 0.7);
    const roofK = clamp01((k - 0.7) / 0.3);
    const fall = clamp01((collapse - r.delay) / 0.6);

    const wallScale = Math.max(0.001, wallK * (1 - 0.8 * fall) * settle);
    r.walls.visible = wallK > 0;
    r.walls.scale.y = wallScale;
    const top = r.block.height * wallScale;
    // the roof caves in and is gone among the rubble before the walls are down
    r.roof.visible = roofK > 0 && fall < 0.7;
    r.roof.position.y = top;
    r.roof.scale.y = Math.max(0.001, roofK * (1 - 0.6 * fall) * settle);
    for (const o of r.openings) o.obj.visible = wallK > 0 && o.top <= top + 1e-6 && fall < 0.5;

    const lean = LEAN * fall * r.tilt.sign * DEG;
    r.lean.rotation.set(r.tilt.axis === 'x' ? lean : 0, 0, r.tilt.axis === 'z' ? -lean : 0);

    r.foundation.visible = build < 1;
    r.scaffold.visible = build < 1;
    r.scaffold.scale.y = Math.min(1, wallK + 0.15);
    for (const { mesh, r: radius } of r.rubble) {
      mesh.visible = fall > 0;
      const s = Math.max(0.001, fall);
      mesh.scale.set(s, 0.6 * s * settle, s);
      mesh.position.y = 0.6 * radius * s * settle;
    }
  }

  bld.lights.forEach((l, i) => (l.pane.visible = isLit(l.hash, i, pose.lights, pose.flicker)));

  const { phase, amount } = pose.smoke;
  for (const puffs of bld.smoke) {
    puffs.forEach((puff, j) => {
      // rising, growing and drifting downwind; each swells out of the chimney and fades at the top
      const u = (((phase + j / PUFFS) % 1) + 1) % 1;
      puff.visible = amount > 0;
      puff.position.set(-0.35 * S * u, 0.85 * S * u, 0);
      const fade = Math.min(1, u / 0.15, (1 - u) / 0.25);
      puff.scale.setScalar(Math.max(0.001, S * (0.08 + 0.14 * u) * Math.min(1.3, amount) * fade));
    });
  }

  if (bld.flag) bld.flag.rotation.y = (pose.flag ?? 0) * DEG;
  const open = pose.door ?? 0;
  bld.door.hinge.rotation.y = -100 * open * DEG;
  bld.door.inside.visible = open > 0.05 && pose.lights > 0;
}

/** Weathers: the walls go grey and everything else dark and rotten, while the rubble settles. */
export function buildingDecay(p: BuildingParams): DecayRecipe {
  return { flesh: [p.walls], rotted: 'fur', bare: 'fur', thin: 1, keep: ['dark', 'fur'], soft: { rot: 'hair', bare: 'hair' } };
}

export function disposeBuilding(bld: Building): void {
  bld.root.removeFromParent();
  bld.root.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose();
  });
}
