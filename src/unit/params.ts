import { mulberry32, pick, range } from '../rng';
import { METAL_RAMPS, SKIN_RAMPS, type RampName } from '../render/palette';

export const HELMETS = ['none', 'cap', 'full', 'horned', 'hood'] as const;
export const ARMORS = ['none', 'leather', 'chain', 'plate'] as const;
export const HAND_ITEMS = ['none', 'sword', 'axe', 'hammer', 'spear', 'roundShield', 'kiteShield', 'bow'] as const;

export type Helmet = (typeof HELMETS)[number];
export type Armor = (typeof ARMORS)[number];
export type HandItem = (typeof HAND_ITEMS)[number];
export type Hand = 'L' | 'R';

export interface UnitParams {
  seed: number;
  /** Overall height multiplier. */
  height: number;
  /** Width/thickness multiplier. */
  bulk: number;
  headSize: number;
  helmet: Helmet;
  armor: Armor;
  rightHand: HandItem;
  leftHand: HandItem;
  skin: RampName;
  cloth: RampName;
  metal: RampName;
  hair: RampName;
}

/** How an item is held and swung; drives both the model and the animations. */
export type ItemKind = 'none' | 'chop' | 'thrust' | 'shield' | 'bow';

export function itemKind(item: HandItem): ItemKind {
  switch (item) {
    case 'sword':
    case 'axe':
    case 'hammer':
      return 'chop';
    case 'spear':
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

const BASE: UnitParams = {
  seed: 1,
  height: 1,
  bulk: 1,
  headSize: 1,
  helmet: 'cap',
  armor: 'chain',
  rightHand: 'sword',
  leftHand: 'kiteShield',
  skin: 'skin',
  cloth: 'team',
  metal: 'steel',
  hair: 'hair',
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
  knight: { ...BASE, bulk: 1.15, helmet: 'full', armor: 'plate', rightHand: 'hammer', leftHand: 'kiteShield', metal: 'gold' },
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
  duelist: { ...BASE, bulk: 0.9, helmet: 'none', armor: 'leather', rightHand: 'sword', leftHand: 'sword', hair: 'yellow' },
  shieldbearer: { ...BASE, bulk: 1.2, helmet: 'full', armor: 'plate', rightHand: 'none', leftHand: 'kiteShield' },
};

const MAIN_HAND: HandItem[] = ['sword', 'axe', 'hammer', 'spear', 'sword', 'axe', 'none'];
const OFF_HAND: HandItem[] = ['roundShield', 'kiteShield', 'roundShield', 'kiteShield', 'none', 'sword', 'axe'];

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
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
