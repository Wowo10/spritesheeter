import { mulberry32, pick, range } from '../rng';
import { METAL_RAMPS, SKIN_RAMPS, type RampName } from '../render/palette';

export const HELMETS = ['none', 'cap', 'full', 'horned', 'hood'] as const;
export const ARMORS = ['none', 'leather', 'chain', 'plate'] as const;
export const WEAPONS = ['sword', 'axe', 'hammer', 'spear', 'bow'] as const;
export const SHIELDS = ['none', 'round', 'kite'] as const;

export type Helmet = (typeof HELMETS)[number];
export type Armor = (typeof ARMORS)[number];
export type Weapon = (typeof WEAPONS)[number];
export type Shield = (typeof SHIELDS)[number];

export interface UnitParams {
  seed: number;
  /** Overall height multiplier. */
  height: number;
  /** Width/thickness multiplier. */
  bulk: number;
  headSize: number;
  helmet: Helmet;
  armor: Armor;
  weapon: Weapon;
  shield: Shield;
  skin: RampName;
  cloth: RampName;
  metal: RampName;
  hair: RampName;
}

export type WeaponStyle = 'chop' | 'thrust' | 'bow';

export function weaponStyle(weapon: Weapon): WeaponStyle {
  if (weapon === 'spear') return 'thrust';
  if (weapon === 'bow') return 'bow';
  return 'chop';
}

/** Bows need both hands, so they never come with a shield. */
export function effectiveShield(p: UnitParams): Shield {
  return p.weapon === 'bow' ? 'none' : p.shield;
}

const BASE: UnitParams = {
  seed: 1,
  height: 1,
  bulk: 1,
  headSize: 1,
  helmet: 'cap',
  armor: 'chain',
  weapon: 'sword',
  shield: 'kite',
  skin: 'skin',
  cloth: 'team',
  metal: 'steel',
  hair: 'hair',
};

export const PRESETS: Record<string, UnitParams> = {
  swordsman: { ...BASE, helmet: 'full', armor: 'chain', weapon: 'sword', shield: 'kite' },
  axeman: {
    ...BASE,
    bulk: 1.25,
    headSize: 1.1,
    helmet: 'horned',
    armor: 'leather',
    weapon: 'axe',
    shield: 'round',
    skin: 'greenSkin',
    metal: 'bronze',
  },
  spearman: { ...BASE, height: 1.05, bulk: 0.9, helmet: 'cap', armor: 'leather', weapon: 'spear', shield: 'round' },
  archer: { ...BASE, bulk: 0.85, helmet: 'hood', armor: 'leather', weapon: 'bow', shield: 'none', skin: 'paleSkin' },
  knight: { ...BASE, bulk: 1.15, helmet: 'full', armor: 'plate', weapon: 'hammer', shield: 'kite', metal: 'gold' },
};

export function randomUnit(seed: number): UnitParams {
  const rng = mulberry32(seed);
  const weapon = pick(rng, WEAPONS);
  return {
    seed,
    height: round2(range(rng, 0.9, 1.12)),
    bulk: round2(range(rng, 0.85, 1.3)),
    headSize: round2(range(rng, 0.9, 1.2)),
    helmet: pick(rng, HELMETS),
    armor: pick(rng, ARMORS),
    weapon,
    shield: weapon === 'bow' ? 'none' : pick(rng, SHIELDS),
    skin: pick(rng, SKIN_RAMPS),
    cloth: 'team',
    metal: pick(rng, METAL_RAMPS),
    hair: pick(rng, ['hair', 'dark', 'yellow', 'bone'] as RampName[]),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
