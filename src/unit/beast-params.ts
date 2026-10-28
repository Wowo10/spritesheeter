import { mulberry32, pick, range } from '../rng';
import { HIDE_RAMPS, MAGIC_RAMPS, METAL_RAMPS, type RampName } from '../render/palette';

export const EARS = ['none', 'pointed', 'floppy', 'round'] as const;
/** horns: curving up from the brow; tusks: jutting up from the lower jaw. */
export const HORNS = ['none', 'horns', 'tusks'] as const;
/**
 * mane: thick fur around the neck; spikes: a row of plates down the spine and tail; ridge: a
 * crest of bristles; crest: a horse's mane along the top of the neck.
 */
export const BACKS = ['none', 'mane', 'spikes', 'ridge', 'crest'] as const;
/** The team-coloured gear that tells whose beast it is. */
export const BARDINGS = ['none', 'collar', 'saddle', 'armor'] as const;
/** bat: leathery membrane between finger bones; feathered: bird wings with ragged flight feathers. */
export const WINGS = ['none', 'bat', 'feathered'] as const;

export type Ears = (typeof EARS)[number];
export type Horns = (typeof HORNS)[number];
export type Back = (typeof BACKS)[number];
export type Barding = (typeof BARDINGS)[number];
export type Wings = (typeof WINGS)[number];

export interface BeastParams {
  seed: number;
  /** Overall scale. */
  size: number;
  /** Width multiplier of body and legs. */
  bulk: number;
  /** Per-part multipliers, on top of size. */
  bodyLength: number;
  /** Height of the body from back to belly. */
  bodyDepth: number;
  legLength: number;
  /** 0: legs straight under the body (dogs, bears); 1: splayed out to the sides (lizards, crocodiles). */
  sprawl: number;
  neckLength: number;
  headSize: number;
  snoutLength: number;
  /** A hooked yellow beak instead of a snout, snoutLength long. */
  beak: boolean;
  tailLength: number;
  tailThickness: number;
  ears: Ears;
  horns: Horns;
  back: Back;
  barding: Barding;
  wings: Wings;
  /** Span multiplier. */
  wingSize: number;
  /** Membrane or feathers; the wing bones are in the hide colour. */
  wingColor: RampName;
  /** Stays in the air, flapping, legs tucked up; drops to the ground when it dies. Needs wings. */
  flying: boolean;
  hide: RampName;
  belly: RampName;
  /** Mane, spikes or ridge. */
  accent: RampName;
  metal: RampName;
  magic: RampName;
  /** Spits its spell (cast) and breathes a steady stream (channel), in the magic colour. */
  breath: boolean;
  /** Below 1 the sprite is see-through, drawn as an ordered dither; it also fades away as it dies. */
  opacity: number;
  glowEyes: boolean;
  shadow: boolean;
}

/** Body part sizes in world units, shared by the model and the animations. */
export interface BeastDims {
  /** From the hind legs to the front legs. */
  length: number;
  /** Body height, back to belly, and width. */
  depth: number;
  width: number;
  upperLeg: number;
  lowerLeg: number;
  paw: number;
  legT: number;
  /** Outward roll of the upper legs, in degrees; the lower legs stay upright. */
  splay: number;
  neck: number;
  head: number;
  snout: number;
  /** Length of each of the tail's three segments, and its thickness at the root. */
  tailSeg: number;
  tailT: number;
  /** Height of the leg joints, where the hind and front legs meet the body. */
  hipHeight: number;
  /** Each wing's inner and outer segment, and its depth front to back at the root. */
  wingInner: number;
  wingOuter: number;
  wingChord: number;
}

/** How high a flying beast's body hovers above where it would stand, per unit of size. */
export const BEAST_HOVER = 0.45;

export function beastDims(p: BeastParams): BeastDims {
  const S = p.size;
  const upperLeg = 0.24 * S * p.legLength;
  const lowerLeg = 0.24 * S * p.legLength;
  const paw = 0.05 * S;
  const splay = 70 * p.sprawl;
  const head = 0.25 * S * p.headSize;
  const length = 0.62 * S * p.bodyLength;
  const width = 0.38 * S * p.bulk;
  const span = 0.8 * (length + width) * p.wingSize;
  return {
    length,
    depth: 0.3 * S * p.bodyDepth * p.bulk,
    width,
    upperLeg,
    lowerLeg,
    paw,
    legT: 0.11 * S * p.bulk,
    splay,
    neck: 0.22 * S * p.neckLength,
    head,
    snout: 0.75 * head * p.snoutLength,
    tailSeg: (0.6 * S * p.tailLength) / 3,
    tailT: 0.1 * S * p.tailThickness,
    hipHeight: upperLeg * Math.cos((splay * Math.PI) / 180) + lowerLeg + paw,
    wingInner: 0.42 * span,
    wingOuter: 0.58 * span,
    wingChord: 0.6 * length * p.wingSize,
  };
}

const BASE: BeastParams = {
  seed: 1,
  size: 1,
  bulk: 1,
  bodyLength: 1,
  bodyDepth: 1,
  legLength: 1,
  sprawl: 0,
  neckLength: 1,
  headSize: 1,
  snoutLength: 1,
  beak: false,
  tailLength: 1,
  tailThickness: 1,
  ears: 'pointed',
  horns: 'none',
  back: 'none',
  barding: 'collar',
  wings: 'none',
  wingSize: 1,
  wingColor: 'leather',
  flying: false,
  hide: 'fur',
  belly: 'bone',
  accent: 'dark',
  metal: 'steel',
  magic: 'fire',
  breath: false,
  opacity: 1,
  glowEyes: false,
  shadow: false,
};

/** Low-slung reptiles: splayed legs, flat body, long tail. */
const REPTILE: BeastParams = {
  ...BASE,
  bodyDepth: 0.6,
  legLength: 0.5,
  sprawl: 1,
  neckLength: 0.3,
  tailLength: 1.3,
  tailThickness: 1.4,
  ears: 'none',
  barding: 'saddle',
  hide: 'greenSkin',
  belly: 'bone',
};

export const BEAST_PRESETS: Record<string, BeastParams> = {
  wolf: { ...BASE, bulk: 0.95, snoutLength: 1.15, tailThickness: 1.2 },
  hound: { ...BASE, bulk: 0.9, legLength: 1.05, snoutLength: 1.05, tailThickness: 0.7, ears: 'floppy', hide: 'leather', belly: 'bone' },
  warhound: {
    ...BASE,
    size: 1.1,
    bulk: 1.15,
    bodyDepth: 1.1,
    headSize: 1.1,
    snoutLength: 0.85,
    tailLength: 0.6,
    tailThickness: 0.8,
    barding: 'armor',
    hide: 'hair',
    belly: 'leather',
  },
  hellhound: {
    ...BASE,
    size: 1.1,
    bulk: 1.05,
    snoutLength: 1.1,
    tailThickness: 0.7,
    horns: 'horns',
    back: 'spikes',
    hide: 'dark',
    belly: 'red',
    accent: 'red',
    magic: 'fire',
    breath: true,
    glowEyes: true,
  },
  ghostWolf: {
    ...BASE,
    snoutLength: 1.15,
    tailThickness: 1.2,
    back: 'ridge',
    barding: 'none',
    hide: 'ghost',
    belly: 'ghost',
    accent: 'ghost',
    magic: 'venom',
    opacity: 0.5,
    glowEyes: true,
    shadow: true,
  },
  bear: {
    ...BASE,
    size: 1.2,
    bulk: 1.45,
    bodyLength: 0.85,
    bodyDepth: 1.15,
    legLength: 0.85,
    neckLength: 0.5,
    headSize: 1.15,
    snoutLength: 0.75,
    tailLength: 0.15,
    tailThickness: 1.3,
    ears: 'round',
    barding: 'saddle',
    hide: 'hair',
    belly: 'leather',
  },
  boar: {
    ...BASE,
    bulk: 1.3,
    bodyLength: 0.9,
    bodyDepth: 1.2,
    legLength: 0.6,
    neckLength: 0.3,
    headSize: 1.1,
    snoutLength: 0.9,
    tailLength: 0.3,
    tailThickness: 0.4,
    horns: 'tusks',
    back: 'ridge',
    barding: 'saddle',
    hide: 'leather',
    belly: 'hair',
    accent: 'hair',
  },
  lion: {
    ...BASE,
    size: 1.1,
    bulk: 1.1,
    bodyLength: 1.1,
    snoutLength: 0.75,
    tailLength: 1.2,
    tailThickness: 0.5,
    ears: 'round',
    back: 'mane',
    hide: 'tawny',
    belly: 'bone',
    accent: 'leather',
  },
  panther: {
    ...BASE,
    bulk: 0.95,
    bodyLength: 1.15,
    legLength: 0.9,
    snoutLength: 0.7,
    tailLength: 1.3,
    tailThickness: 0.5,
    ears: 'round',
    hide: 'dark',
    belly: 'dark',
    magic: 'venom',
    glowEyes: true,
  },
  horse: {
    ...BASE,
    size: 1.4,
    bodyLength: 1.2,
    bodyDepth: 1.1,
    legLength: 1.4,
    neckLength: 1.4,
    snoutLength: 1.6,
    tailLength: 0.9,
    tailThickness: 0.9,
    back: 'crest',
    barding: 'saddle',
    hide: 'leather',
    belly: 'leather',
    accent: 'dark',
  },
  rat: {
    ...BASE,
    size: 0.75,
    bulk: 1.1,
    bodyDepth: 1.1,
    legLength: 0.5,
    neckLength: 0.4,
    snoutLength: 1.2,
    tailLength: 1.4,
    tailThickness: 0.35,
    ears: 'round',
    hide: 'fur',
    belly: 'paleSkin',
  },
  crocodile: {
    ...REPTILE,
    size: 0.95,
    bulk: 1.15,
    bodyLength: 1.25,
    headSize: 0.95,
    snoutLength: 1.9,
    back: 'spikes',
    hide: 'scales',
    accent: 'scales',
  },
  lizard: {
    ...REPTILE,
    bulk: 0.9,
    sprawl: 0.75,
    legLength: 0.65,
    neckLength: 0.6,
    snoutLength: 1.2,
    tailThickness: 0.9,
    back: 'ridge',
    hide: 'greenSkin',
    accent: 'red',
  },
  dragon: {
    ...REPTILE,
    size: 1.05,
    bulk: 1.1,
    bodyDepth: 0.85,
    legLength: 0.8,
    sprawl: 0.35,
    neckLength: 1.3,
    headSize: 1.05,
    snoutLength: 1.3,
    tailLength: 1.2,
    tailThickness: 1.1,
    horns: 'horns',
    back: 'spikes',
    barding: 'collar',
    wings: 'bat',
    wingColor: 'dark',
    hide: 'red',
    belly: 'yellow',
    accent: 'dark',
    magic: 'fire',
    breath: true,
    glowEyes: true,
  },
  griffin: {
    ...BASE,
    size: 1.05,
    bulk: 1.05,
    bodyLength: 1.05,
    neckLength: 0.8,
    snoutLength: 0.9,
    beak: true,
    tailLength: 1.1,
    tailThickness: 0.45,
    ears: 'pointed',
    back: 'mane',
    barding: 'saddle',
    wings: 'feathered',
    wingColor: 'bone',
    flying: true,
    hide: 'tawny',
    belly: 'bone',
    accent: 'bone',
    shadow: true,
  },
  salamander: {
    ...REPTILE,
    bulk: 0.95,
    sprawl: 0.85,
    neckLength: 0.5,
    snoutLength: 0.9,
    tailThickness: 1.1,
    back: 'spikes',
    hide: 'red',
    belly: 'yellow',
    accent: 'dark',
    magic: 'fire',
    breath: true,
    glowEyes: true,
  },
};

/** Rough body plans that random beasts are varied from. */
const ARCHETYPES = ['wolf', 'hound', 'bear', 'boar', 'lion', 'rat', 'crocodile', 'lizard', 'horse'];

/** A random beast varied from one of `archetypes` (preset names). */
export function randomBeast(seed: number, archetypes: readonly string[] = ARCHETYPES): BeastParams {
  const rng = mulberry32(seed);
  const base = BEAST_PRESETS[pick(rng, archetypes)];
  const vary = (v: number, by = 0.15) => round2(v * range(rng, 1 - by, 1 + by));
  const magic = rng() < 0.2;
  return {
    ...base,
    seed,
    size: vary(base.size, 0.1),
    bulk: vary(base.bulk),
    bodyLength: vary(base.bodyLength),
    bodyDepth: vary(base.bodyDepth),
    legLength: vary(base.legLength),
    neckLength: vary(base.neckLength, 0.3),
    headSize: vary(base.headSize, 0.1),
    snoutLength: vary(base.snoutLength, 0.2),
    tailLength: vary(base.tailLength, 0.3),
    tailThickness: vary(base.tailThickness, 0.2),
    ears: base.sprawl > 0.5 ? 'none' : pick(rng, EARS),
    horns: rng() < 0.25 ? pick(rng, ['horns', 'tusks'] as Horns[]) : 'none',
    back: pick(rng, BACKS),
    barding: pick(rng, ['collar', 'collar', 'saddle', 'armor'] as Barding[]),
    hide: pick(rng, HIDE_RAMPS.filter((r) => r !== 'rotSkin' && r !== 'ghost')),
    belly: pick(rng, ['bone', 'paleSkin', 'leather', 'hair', 'yellow'] as RampName[]),
    accent: pick(rng, ['dark', 'hair', 'leather', 'red', 'bone'] as RampName[]),
    metal: pick(rng, METAL_RAMPS),
    magic: pick(rng, MAGIC_RAMPS),
    breath: magic,
    glowEyes: magic,
    // drawn last so adding these didn't change every earlier field for a given seed
    ...randomWings(rng),
  };
}

function randomWings(rng: () => number): Pick<BeastParams, 'wings' | 'wingSize' | 'wingColor' | 'flying'> {
  const wings: Wings = rng() < 0.15 ? pick(rng, ['bat', 'feathered'] as Wings[]) : 'none';
  return {
    wings,
    wingSize: 1,
    wingColor: pick(rng, ['leather', 'bone', 'dark', 'hair', 'red'] as RampName[]),
    flying: wings !== 'none' && rng() < 0.5,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
