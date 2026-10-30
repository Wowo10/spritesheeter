import { mulberry32, pick, range, type Rng } from '../rng';
import { MAGIC_RAMPS, type RampName } from '../render/palette';

/**
 * gable: two slopes meeting at a ridge along the block's long side; hip: sloping on all four
 * sides to a point; flat: a flat top behind a crenellated parapet. 'mixed' lets each block pick.
 */
export const ROOFS = ['mixed', 'gable', 'hip', 'flat'] as const;
export type Roof = (typeof ROOFS)[number];
export type BlockRoof = Exclude<Roof, 'mixed'>;

export const WALL_RAMPS: RampName[] = ['bone', 'paleSkin', 'fur', 'wood', 'tawny', 'leather'];
/** Plinth, corner posts, beams, window frames and chimneys. */
export const TRIM_RAMPS: RampName[] = ['wood', 'hair', 'leather', 'fur', 'dark', 'bone'];
export const ROOF_RAMPS: RampName[] = ['red', 'team', 'tawny', 'dark', 'wood', 'scales', 'blue', 'fur'];
/** What shines through the windows; these ramps glow. */
export const LIGHT_RAMPS: RampName[] = MAGIC_RAMPS;

/** No presets: the seed lays out the blocks, and these steer it. */
export interface BuildingParams {
  seed: number;
  /** Overall scale. */
  size: number;
  /** How many blocks it tries to put together; fewer when they don't fit. */
  blocks: number;
  /** Storeys of the main block; annexes are lower, towers taller. */
  floors: number;
  roof: Roof;
  /** 0-1: how many of the places a window could go get one. */
  windows: number;
  chimneys: boolean;
  /** A team-coloured flag on the tallest roof. */
  banner: boolean;
  walls: RampName;
  trim: RampName;
  roofColor: RampName;
  light: RampName;
}

export const MAX_FLOORS = 4;

/** Wall faces by the way they face: S is +Z, toward the camera in the S column; E is +X. */
export type Side = 'N' | 'E' | 'S' | 'W';
export const SIDES: Side[] = ['N', 'E', 'S', 'W'];
/** Outward normal of each face, [x, z]. */
export const NORMALS: Record<Side, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

/** A window or door, on a block's wall. */
export interface Opening {
  side: Side;
  /** Offset along the wall from its middle, toward +X (N and S walls) or +Z (E and W). */
  along: number;
  /** Height of its bottom above the ground. */
  y: number;
}

/** A box of storeys under a roof; positions are relative to the building's origin. */
export interface Block {
  x: number;
  z: number;
  /** Footprint along X and Z. */
  w: number;
  d: number;
  floors: number;
  /** Top of the walls. */
  height: number;
  roof: BlockRoof;
  /** How far the roof rises above the walls; for flat roofs, the parapet. */
  rise: number;
  tower: boolean;
  /** The block it was built against; -1 for the main one. */
  parent: number;
  windows: Opening[];
  /** Where a chimney stands through the roof, relative to the block's middle; none when absent. */
  chimney?: [number, number];
}

export interface Layout {
  blocks: Block[];
  /** The front door, on the main block. */
  door: Opening;
  /** The block whose roof carries the banner. */
  bannerOn: number;
  /** Storey height, and the sizes of windows and the door. */
  floorH: number;
  window: [w: number, h: number];
  doorSize: [w: number, h: number];
}

/** Storey height per unit of size, in world units: a door just shorter than a unit on foot. */
const FLOOR = 1.05;
/** How far the footprint reaches from the middle, per unit of size, so it fits a 128 px frame. */
const REACH = 2.2;
const WINDOW_SPACING = 0.75;

/**
 * Lays out the blocks for the seed: a main block, then annexes and towers built flush against
 * blocks already placed, none overlapping, all within reach of the middle. Drawn from its own
 * random stream and in a fixed order, so colours never move a block, and more blocks only adds
 * to the ones already there.
 */
export function buildingLayout(p: BuildingParams): Layout {
  const S = p.size;
  const rng = mulberry32((p.seed ^ 0x5bd1e995) >>> 0);
  const floors = clampInt(p.floors, 1, MAX_FLOORS);
  const floorH = FLOOR * S;
  const blocks: Block[] = [];

  const main = makeBlock(rng, p, {
    x: 0,
    z: 0,
    w: range(rng, 2.0, 2.9) * S,
    d: range(rng, 1.6, 2.3) * S,
    floors,
    tower: false,
    parent: -1,
  });
  blocks.push(main);

  for (let i = 1; i < clampInt(p.blocks, 1, 5); i++) {
    // eight draws per try whatever it makes of them, so params that change how a try turns
    // out (storeys, roofs) don't shift the draws after it
    for (let attempt = 0; attempt < 8; attempt++) {
      const draws = Array.from({ length: 8 }, rng);
      const block = attach(draws, p, blocks, floors);
      if (block && fits(block, blocks, REACH * S)) {
        blocks.push(makeBlock(rng, p, block));
        break;
      }
    }
  }

  // centre the footprint on the origin
  const [minX, maxX, minZ, maxZ] = extent(blocks);
  const [cx, cz] = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  for (const b of blocks) {
    b.x -= cx;
    b.z -= cz;
  }

  const window: [number, number] = [0.3 * S, 0.42 * S];
  const doorSize: [number, number] = [0.55 * S, 0.85 * S];
  const door = placeDoor(blocks, doorSize[0]);
  blocks.forEach((b, i) => (b.windows = placeWindows(p, blocks, i, floorH, window, door)));
  const bannerOn = blocks.reduce((best, b, i) => (b.height + b.rise > blocks[best].height + blocks[best].rise ? i : best), 0);
  return { blocks, door, bannerOn, floorH, window, doorSize };
}

type Draft = Pick<Block, 'x' | 'z' | 'w' | 'd' | 'floors' | 'tower' | 'parent'>;

/** Roof and chimney for a placed block; always the same draws, whatever the params. */
function makeBlock(rng: Rng, p: BuildingParams, b: Draft): Block {
  const [roofDraw, chimneyDraw, alongDraw, sideDraw] = [rng(), rng(), rng(), rng()];
  const S = p.size;
  const mixed: BlockRoof = b.tower ? (roofDraw < 0.55 ? 'hip' : 'flat') : roofDraw < 0.55 ? 'gable' : roofDraw < 0.85 ? 'hip' : 'flat';
  const roof = p.roof === 'mixed' ? mixed : p.roof;
  const span = Math.min(b.w, b.d);
  const rise = roof === 'flat' ? 0.25 * S : roof === 'gable' ? 0.5 * span : b.tower ? Math.min(1.1 * span, 1.3 * S) : 0.55 * span;
  const block: Block = { ...b, height: b.floors * FLOOR * S, roof, rise, windows: [] };
  // the main block always smokes; others now and then
  if (p.chimneys && roof !== 'flat' && !b.tower && (b.parent < 0 || chimneyDraw < 0.4)) {
    const along = (alongDraw < 0.5 ? -1 : 1) * 0.28;
    const off = (sideDraw - 0.5) * 0.2;
    // along the ridge, or off the middle of a hip roof
    block.chimney = b.w >= b.d ? [along * b.w, off * b.d] : [off * b.w, along * b.d];
  }
  return block;
}

/** A new block against a side of one already placed, from 8 random draws; null if there's no room. */
function attach(draws: number[], p: BuildingParams, blocks: Block[], floors: number): Draft | null {
  const [whichDraw, sideDraw, towerDraw, wDraw, dDraw, offDraw, floorsDraw, cornerDraw] = draws;
  const S = p.size;
  const parentIdx = Math.floor(whichDraw * blocks.length);
  const parent = blocks[parentIdx];
  // the main block's front stays clear for its door
  const sides = parentIdx === 0 ? SIDES.filter((s) => s !== 'S') : SIDES;
  const side = sides[Math.floor(sideDraw * sides.length)];
  const tower = towerDraw < 0.3;
  const [nx, nz] = NORMALS[side];
  // the wall it's built against runs along `wallLen`; the new block reaches `depth` out from it
  const wallLen = nx !== 0 ? parent.d : parent.w;
  let along: number;
  let depth: number;
  if (tower) {
    const t = (1.0 + 0.35 * wDraw) * S;
    if (t > wallLen + 0.4 * S) return null;
    along = t;
    depth = t;
  } else {
    along = Math.min(wallLen, (1.1 + 0.9 * wDraw) * S);
    depth = (1.0 + 0.9 * dDraw) * S;
  }
  // towers stand at a corner of the wall, annexes anywhere along it
  const slack = (wallLen - along) / 2;
  const offset = tower ? (cornerDraw < 0.5 ? -1 : 1) * slack : (2 * offDraw - 1) * Math.max(0, slack);
  const blockFloors = tower ? Math.min(MAX_FLOORS, Math.max(floors, parent.floors) + 1) : 1 + Math.floor(floorsDraw * Math.min(floors, parent.floors));
  const [w, d] = nx !== 0 ? [depth, along] : [along, depth];
  const x = parent.x + nx * (parent.w / 2 + w / 2) + (nx === 0 ? offset : 0);
  const z = parent.z + nz * (parent.d / 2 + d / 2) + (nz === 0 ? offset : 0);
  return { x, z, w, d, floors: blockFloors, tower, parent: parentIdx };
}

/** Clear of every other block (touching is fine), and the whole footprint within `reach` of its middle. */
function fits(b: Draft, blocks: Block[], reach: number): boolean {
  const eps = 0.01;
  for (const o of blocks) {
    if (Math.abs(b.x - o.x) < (b.w + o.w) / 2 - eps && Math.abs(b.z - o.z) < (b.d + o.d) / 2 - eps) return false;
  }
  const [minX, maxX, minZ, maxZ] = extent([...blocks, b]);
  return maxX - minX <= 2 * reach && maxZ - minZ <= 2 * reach;
}

function extent(blocks: Pick<Block, 'x' | 'z' | 'w' | 'd'>[]): [number, number, number, number] {
  return [
    Math.min(...blocks.map((b) => b.x - b.w / 2)),
    Math.max(...blocks.map((b) => b.x + b.w / 2)),
    Math.min(...blocks.map((b) => b.z - b.d / 2)),
    Math.max(...blocks.map((b) => b.z + b.d / 2)),
  ];
}

/** The block (other than `self`) built against the wall at this point, and as high as `y`; covered walls get no openings. */
function covered(blocks: Block[], self: number, side: Side, along: number, y: number): boolean {
  const b = blocks[self];
  const [nx, nz] = NORMALS[side];
  const out = 0.05;
  const px = b.x + nx * (b.w / 2 + out) + (nx === 0 ? along : 0);
  const pz = b.z + nz * (b.d / 2 + out) + (nz === 0 ? along : 0);
  return blocks.some(
    (o, i) => i !== self && Math.abs(px - o.x) < o.w / 2 && Math.abs(pz - o.z) < o.d / 2 && y < o.height + o.rise,
  );
}

/** On the main block's front, as near the middle as it's clear; failing that, another wall. */
function placeDoor(blocks: Block[], width: number): Opening {
  const main = blocks[0];
  for (const side of ['S', 'E', 'W', 'N'] as Side[]) {
    const len = NORMALS[side][0] !== 0 ? main.d : main.w;
    for (const f of [0, -0.25, 0.25, -0.4, 0.4]) {
      const along = f * (len - width);
      if (!covered(blocks, 0, side, along - width / 2, 0.1) && !covered(blocks, 0, side, along + width / 2, 0.1)) return { side, along, y: 0 };
    }
  }
  return { side: 'S', along: 0, y: 0 };
}

/**
 * Evenly spaced along each storey of each wall; each spot is kept by a hash of where it is, so
 * the windows slider adds and removes windows without moving the rest. None where another block
 * covers the wall, or where the door is.
 */
function placeWindows(p: BuildingParams, blocks: Block[], i: number, floorH: number, [ww, wh]: [number, number], door: Opening): Opening[] {
  const b = blocks[i];
  const out: Opening[] = [];
  for (const side of SIDES) {
    const len = NORMALS[side][0] !== 0 ? b.d : b.w;
    const slots = Math.max(1, Math.floor((len - 0.3 * p.size) / (WINDOW_SPACING * p.size)));
    for (let f = 0; f < b.floors; f++) {
      const y = f * floorH + 0.42 * floorH;
      for (let s = 0; s < slots; s++) {
        const along = (s - (slots - 1) / 2) * (len / slots);
        if (hash01(p.seed, i, SIDES.indexOf(side), f, s) >= p.windows) continue;
        if (i === 0 && f === 0 && side === door.side && Math.abs(along - door.along) < 0.75 * p.size) continue;
        if (covered(blocks, i, side, along - ww / 2, y + wh) || covered(blocks, i, side, along + ww / 2, y + wh)) continue;
        out.push({ side, along, y });
      }
    }
  }
  return out;
}

/** A repeatable number in [0, 1) for a tuple of integers. */
export function hash01(...ints: number[]): number {
  let h = 0x811c9dc5;
  for (const n of ints) h = Math.imul(h ^ (n | 0), 0x01000193) ^ (h >>> 13);
  return mulberry32(h >>> 0)();
}

export const DEFAULT_BUILDING: BuildingParams = {
  seed: 1,
  size: 1,
  blocks: 3,
  floors: 2,
  roof: 'mixed',
  windows: 0.6,
  chimneys: true,
  banner: true,
  walls: 'bone',
  trim: 'wood',
  roofColor: 'red',
  light: 'holy',
};

/** Everything from the seed: knobs and colours (the layout then comes from the seed too). */
export function randomBuilding(seed: number): BuildingParams {
  const rng = mulberry32(seed);
  const walls = pick(rng, WALL_RAMPS);
  return {
    seed,
    size: round2(range(rng, 0.9, 1.05)),
    blocks: pick(rng, [1, 2, 2, 3, 3, 4, 5]),
    floors: pick(rng, [1, 1, 2, 2, 2, 3, 4]),
    roof: rng() < 0.7 ? 'mixed' : pick(rng, ROOFS.slice(1)),
    windows: round2(range(rng, 0.35, 0.9)),
    chimneys: rng() < 0.75,
    banner: rng() < 0.6,
    walls,
    // trim that stands out from the walls
    trim: pick(rng, TRIM_RAMPS.filter((r) => r !== walls)),
    roofColor: pick(rng, ROOF_RAMPS),
    light: pick(rng, ['holy', 'holy', 'fire', 'fire', 'arcane', 'venom'] as RampName[]),
  };
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
