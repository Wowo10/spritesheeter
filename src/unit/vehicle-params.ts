import { mulberry32, pick, range } from '../rng';
import { METAL_RAMPS, type RampName } from '../render/palette';

/**
 * ram: an iron-headed log hung on ropes and swung into gates; catapult: a throwing arm that
 * flings stones; ballista: a giant crossbow shooting javelins; flamethrower: a pumped tank
 * spraying fire from a nozzle.
 */
export const WEAPONS = ['ram', 'catapult', 'ballista', 'flamethrower'] as const;
export type Weapon = (typeof WEAPONS)[number];

/** Timber colours for the frame, wheels and weapon. */
export const WOOD_RAMPS: RampName[] = ['wood', 'leather', 'hair', 'bone', 'dark'];

export interface VehicleParams {
  seed: number;
  weapon: Weapon;
  /** Overall scale. */
  size: number;
  /** Per-part multipliers, on top of size. */
  length: number;
  width: number;
  /** Wheels on each side. */
  wheels: number;
  wheelSize: number;
  /** A peaked roof of team-coloured hides over the deck, against arrows and boiling oil. */
  roof: boolean;
  /** A team-coloured flag on a pole at the back. */
  banner: boolean;
  wood: RampName;
  metal: RampName;
  /** Roof hides and flag. */
  cloth: RampName;
  /** The flamethrower's fire. */
  flame: RampName;
}

/** Part sizes in world units, shared by the model and the animations. */
export interface VehicleDims {
  /** The deck, front to back and side to side. */
  length: number;
  width: number;
  wheelR: number;
  wheelT: number;
  /** Thickness of the frame's timbers. */
  beam: number;
  /** Height of the deck's top. */
  deckY: number;
  /** Where each pair of wheels sits along the deck. */
  axles: number[];
  poleH: number;
}

export function vehicleDims(p: VehicleParams): VehicleDims {
  const S = p.size;
  const length = 1.8 * S * p.length;
  const wheelR = 0.26 * S * p.wheelSize;
  const beam = 0.1 * S;
  const n = Math.max(1, Math.round(p.wheels));
  // spread evenly, the end wheels just inside the deck's ends
  const reach = Math.max(0, length / 2 - wheelR * 1.1);
  const axles = n === 1 ? [0] : Array.from({ length: n }, (_, i) => -reach + (2 * reach * i) / (n - 1));
  return {
    length,
    width: 0.95 * S * p.width,
    wheelR,
    wheelT: 0.1 * S,
    beam,
    deckY: wheelR + beam * 0.8,
    axles,
    poleH: 1.1 * S,
  };
}

const BASE: VehicleParams = {
  seed: 1,
  weapon: 'catapult',
  size: 1,
  length: 1,
  width: 1,
  wheels: 2,
  wheelSize: 1,
  roof: false,
  banner: true,
  wood: 'wood',
  metal: 'steel',
  cloth: 'team',
  flame: 'fire',
};

export const VEHICLE_PRESETS: Record<string, VehicleParams> = {
  ram: { ...BASE, weapon: 'ram', length: 1.25, width: 1.05, wheels: 3, wheelSize: 0.9, roof: true, banner: false },
  catapult: { ...BASE, weapon: 'catapult', length: 1.1, wheelSize: 1.1 },
  ballista: { ...BASE, weapon: 'ballista', length: 0.8, width: 0.85, wheelSize: 0.9 },
  flamethrower: { ...BASE, weapon: 'flamethrower', width: 0.9 },
};

export function randomVehicle(seed: number): VehicleParams {
  const rng = mulberry32(seed);
  const base = VEHICLE_PRESETS[pick(rng, Object.keys(VEHICLE_PRESETS))];
  const vary = (v: number, by = 0.12) => round2(v * range(rng, 1 - by, 1 + by));
  return {
    ...base,
    seed,
    size: vary(base.size, 0.08),
    length: vary(base.length),
    width: vary(base.width),
    wheels: base.weapon === 'ram' ? pick(rng, [2, 3]) : pick(rng, [2, 2, 3]),
    wheelSize: vary(base.wheelSize),
    // only the slow ones get a roof: it would be in the way of a throwing arm or a bow
    roof: (base.weapon === 'ram' || base.weapon === 'flamethrower') && rng() < 0.6,
    banner: rng() < 0.7,
    wood: pick(rng, WOOD_RAMPS),
    metal: pick(rng, METAL_RAMPS),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
