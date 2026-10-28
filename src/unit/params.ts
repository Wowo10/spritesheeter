import { mulberry32, pick, range } from '../rng';
import { MAGIC_RAMPS, METAL_RAMPS, SKIN_RAMPS, type RampName } from '../render/palette';

export const HELMETS = ['none', 'cap', 'full', 'horned', 'hood'] as const;
export const ARMORS = ['none', 'leather', 'chain', 'plate'] as const;
export const CAPES = ['none', 'long', 'broad'] as const;
export const HAIR_STYLES = ['short', 'long', 'afro', 'mohawk', 'bald'] as const;
/** walk; float: hovers above the ground, legs dangling; shamble: lurches along dragging the right leg. */
export const GAITS = ['walk', 'float', 'shamble'] as const;
/** ghost: no legs, the body trails off into a wisp below the hips. */
export const BODIES = ['normal', 'ghost'] as const;

export const HAND_ITEMS = [
  'none',
  // one-handed, swung
  'sword',
  'axe',
  'doubleAxe',
  'hammer',
  'mace',
  'club',
  'dagger',
  // tools, also swung
  'pickaxe',
  'shovel',
  'torch',
  // polearms, thrust
  'spear',
  'halberd',
  'pitchfork',
  'staff',
  // floats above an open palm, glowing in the magic colour
  'orb',
  'roundShield',
  'kiteShield',
  'bow',
] as const;

export type Helmet = (typeof HELMETS)[number];
export type Armor = (typeof ARMORS)[number];
export type HandItem = (typeof HAND_ITEMS)[number];
export type Cape = (typeof CAPES)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type Gait = (typeof GAITS)[number];
export type Body = (typeof BODIES)[number];
export type ShieldItem = 'roundShield' | 'kiteShield';
export type WeaponItem = Exclude<HandItem, 'none' | 'bow' | 'orb' | ShieldItem>;
export type Hand = 'L' | 'R';

export interface UnitParams {
  seed: number;
  /** Overall height multiplier. */
  height: number;
  /** Width/thickness multiplier. */
  bulk: number;
  headSize: number;
  /** Per-part multipliers, on top of height (lengths) and bulk (widths). */
  torsoLength: number;
  shoulderWidth: number;
  armLength: number;
  armThickness: number;
  legLength: number;
  helmet: Helmet;
  armor: Armor;
  rightHand: HandItem;
  leftHand: HandItem;
  skin: RampName;
  cloth: RampName;
  metal: RampName;
  hairStyle: HairStyle;
  hair: RampName;
  /** Colour of the glowing spell effect. */
  magic: RampName;
  cape: Cape;
  capeColor: RampName;
  gait: Gait;
  body: Body;
  /** Below 1 the sprite is see-through, drawn as an ordered dither (0.5 drops every other pixel). */
  opacity: number;
  /** Eyes in the magic colour, lit whichever way the head faces. */
  glowEyes: boolean;
  /** Dark blob on the ground under the unit; shrinks as the unit rises off the ground. */
  shadow: boolean;
}

/** How high a floating unit's hips hover above where they'd be standing. */
export const HOVER = 0.16;

/** How an item is held and swung; drives both the model and the animations. */
export type ItemKind = 'none' | 'chop' | 'thrust' | 'shield' | 'bow' | 'orb';

export function itemKind(item: HandItem): ItemKind {
  switch (item) {
    case 'sword':
    case 'axe':
    case 'doubleAxe':
    case 'hammer':
    case 'mace':
    case 'club':
    case 'dagger':
    case 'pickaxe':
    case 'shovel':
    case 'torch':
      return 'chop';
    case 'spear':
    case 'halberd':
    case 'pitchfork':
    case 'staff':
      return 'thrust';
    case 'roundShield':
    case 'kiteShield':
      return 'shield';
    default:
      return item;
  }
}

export const otherHand = (h: Hand): Hand => (h === 'L' ? 'R' : 'L');

/**
 * What each hand actually holds. A bow needs both hands (the other one draws the string),
 * so it empties the other hand; with two bows the left one wins.
 */
export function handItems(p: UnitParams): Record<Hand, HandItem> {
  if (p.leftHand === 'bow') return { L: 'bow', R: 'none' };
  if (p.rightHand === 'bow') return { L: 'none', R: 'bow' };
  return { L: p.leftHand, R: p.rightHand };
}

/** Body part sizes in world units, shared by the model and the animations that depend on them. */
export interface BodyDims {
  thigh: number;
  shin: number;
  footH: number;
  legT: number;
  torsoLen: number;
  /** Across the shoulders. */
  torsoW: number;
  /** Across the hips; legs and pelvis follow this, so broad shoulders give a V shape. */
  hipW: number;
  torsoD: number;
  upperArm: number;
  forearm: number;
  armT: number;
  head: number;
  hipDrop: number;
  hipHeight: number;
}

export function bodyDims(p: UnitParams): BodyDims {
  const H = p.height;
  const B = p.bulk;
  // stylised, chunky proportions: big head and hands read better at 32 px
  const thigh = 0.36 * H * p.legLength;
  const shin = 0.34 * H * p.legLength;
  const footH = 0.08;
  const hipDrop = 0.04;
  return {
    thigh,
    shin,
    footH,
    legT: 0.14 * B,
    torsoLen: 0.5 * H * p.torsoLength,
    torsoW: 0.4 * B * p.shoulderWidth,
    hipW: 0.4 * B,
    torsoD: 0.24 * B,
    upperArm: 0.28 * H * p.armLength,
    forearm: 0.26 * H * p.armLength,
    armT: 0.11 * B * p.armThickness,
    head: 0.36 * p.headSize,
    hipDrop,
    hipHeight: hipDrop + thigh + shin + footH,
  };
}

const BASE: UnitParams = {
  seed: 1,
  height: 1,
  bulk: 1,
  headSize: 1,
  torsoLength: 1,
  shoulderWidth: 1,
  armLength: 1,
  armThickness: 1,
  legLength: 1,
  helmet: 'cap',
  armor: 'chain',
  rightHand: 'sword',
  leftHand: 'kiteShield',
  skin: 'skin',
  cloth: 'team',
  metal: 'steel',
  hairStyle: 'short',
  hair: 'hair',
  magic: 'arcane',
  cape: 'none',
  capeColor: 'team',
  gait: 'walk',
  body: 'normal',
  opacity: 1,
  glowEyes: false,
  shadow: false,
};

export const PRESETS: Record<string, UnitParams> = {
  swordsman: { ...BASE, helmet: 'full', armor: 'chain', rightHand: 'sword', leftHand: 'kiteShield' },
  axeman: {
    ...BASE,
    bulk: 1.25,
    headSize: 1.1,
    helmet: 'horned',
    armor: 'leather',
    rightHand: 'axe',
    leftHand: 'roundShield',
    skin: 'greenSkin',
    metal: 'bronze',
  },
  spearman: { ...BASE, height: 1.05, bulk: 0.9, helmet: 'cap', armor: 'leather', rightHand: 'spear', leftHand: 'roundShield' },
  archer: { ...BASE, bulk: 0.85, helmet: 'hood', armor: 'leather', rightHand: 'none', leftHand: 'bow', skin: 'paleSkin' },
  knight: {
    ...BASE,
    bulk: 1.15,
    helmet: 'full',
    armor: 'plate',
    rightHand: 'hammer',
    leftHand: 'kiteShield',
    metal: 'gold',
    cape: 'broad',
  },
  berserker: {
    ...BASE,
    bulk: 1.3,
    headSize: 1.1,
    helmet: 'horned',
    armor: 'none',
    rightHand: 'axe',
    leftHand: 'axe',
    skin: 'greenSkin',
  },
  duelist: { ...BASE, bulk: 0.9, helmet: 'none', armor: 'leather', rightHand: 'sword', leftHand: 'sword', hairStyle: 'long', hair: 'yellow' },
  shieldbearer: { ...BASE, bulk: 1.2, helmet: 'full', armor: 'plate', rightHand: 'none', leftHand: 'kiteShield' },
  worker: { ...BASE, bulk: 0.95, helmet: 'none', armor: 'none', rightHand: 'pickaxe', leftHand: 'none', hairStyle: 'afro', hair: 'dark' },
  militia: { ...BASE, helmet: 'hood', armor: 'none', rightHand: 'pitchfork', leftHand: 'torch', hair: 'hair' },
  mage: {
    ...BASE,
    bulk: 0.85,
    height: 1.05,
    helmet: 'hood',
    armor: 'none',
    rightHand: 'staff',
    leftHand: 'none',
    skin: 'paleSkin',
    cape: 'long',
  },
  warlock: {
    ...BASE,
    bulk: 0.9,
    helmet: 'hood',
    armor: 'none',
    rightHand: 'orb',
    leftHand: 'orb',
    skin: 'paleSkin',
    magic: 'fire',
    cape: 'broad',
  },
  priest: {
    ...BASE,
    helmet: 'none',
    armor: 'none',
    rightHand: 'mace',
    leftHand: 'none',
    hairStyle: 'bald',
    hair: 'bone',
    magic: 'holy',
    cape: 'long',
    capeColor: 'yellow',
  },
  shaman: {
    ...BASE,
    bulk: 1.1,
    helmet: 'horned',
    armor: 'leather',
    rightHand: 'staff',
    leftHand: 'none',
    skin: 'greenSkin',
    metal: 'bronze',
    magic: 'venom',
  },
  guard: { ...BASE, height: 1.05, helmet: 'cap', armor: 'chain', rightHand: 'halberd', leftHand: 'none' },
  ghost: {
    ...BASE,
    bulk: 0.9,
    armLength: 1.1,
    armThickness: 0.85,
    helmet: 'hood',
    armor: 'none',
    rightHand: 'none',
    leftHand: 'none',
    skin: 'ghost',
    cloth: 'ghost',
    magic: 'venom',
    cape: 'long',
    gait: 'float',
    body: 'ghost',
    opacity: 0.5,
    glowEyes: true,
    shadow: true,
  },
  zombie: {
    ...BASE,
    bulk: 0.95,
    headSize: 1.08,
    armLength: 1.1,
    helmet: 'none',
    hairStyle: 'bald',
    armor: 'none',
    rightHand: 'none',
    leftHand: 'none',
    skin: 'rotSkin',
    gait: 'shamble',
  },
  brute: { ...BASE, bulk: 1.4, headSize: 1.15, shoulderWidth: 1.15, armLength: 1.12, armThickness: 1.2, legLength: 0.9, helmet: 'none', hairStyle: 'mohawk', armor: 'leather', rightHand: 'club', leftHand: 'none', skin: 'greenSkin' },
};

const MAIN_HAND: HandItem[] = ['sword', 'axe', 'doubleAxe', 'hammer', 'mace', 'club', 'spear', 'halberd', 'sword', 'axe', 'pickaxe'];
const OFF_HAND: HandItem[] = ['roundShield', 'kiteShield', 'roundShield', 'kiteShield', 'none', 'none', 'sword', 'axe', 'dagger', 'torch', 'orb'];

export function randomUnit(seed: number): UnitParams {
  const rng = mulberry32(seed);
  const archer = rng() < 0.15;
  return {
    seed,
    height: round2(range(rng, 0.9, 1.12)),
    bulk: round2(range(rng, 0.85, 1.3)),
    headSize: round2(range(rng, 0.9, 1.2)),
    helmet: pick(rng, HELMETS),
    armor: pick(rng, ARMORS),
    rightHand: archer ? 'none' : pick(rng, MAIN_HAND),
    leftHand: archer ? 'bow' : pick(rng, OFF_HAND),
    skin: pick(rng, SKIN_RAMPS),
    cloth: 'team',
    metal: pick(rng, METAL_RAMPS),
    hair: pick(rng, ['hair', 'dark', 'yellow', 'bone'] as RampName[]),
    // drawn last so adding these didn't change every earlier field for a given seed
    magic: pick(rng, MAGIC_RAMPS),
    cape: rng() < 0.35 ? pick(rng, ['long', 'broad'] as Cape[]) : 'none',
    capeColor: 'team',
    torsoLength: round2(range(rng, 0.92, 1.08)),
    shoulderWidth: round2(range(rng, 0.9, 1.15)),
    armLength: round2(range(rng, 0.92, 1.1)),
    armThickness: round2(range(rng, 0.9, 1.15)),
    legLength: round2(range(rng, 0.92, 1.08)),
    hairStyle: pick(rng, HAIR_STYLES),
    gait: 'walk',
    body: 'normal',
    opacity: 1,
    glowEyes: false,
    shadow: false,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
