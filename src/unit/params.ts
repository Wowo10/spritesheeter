import { mulberry32, pick, range } from '../rng';
import { MAGIC_RAMPS, METAL_RAMPS, SKIN_RAMPS, type RampName } from '../render/palette';

export const HELMETS = [
  'none',
  'cap',
  'full',
  'horned',
  'viking',
  'hood',
  'tricorn',
  'bandana',
  'wizard',
  'crown',
  'strawHat',
  'featherCap',
  'plagueMask',
  'chefHat',
] as const;
/**
 * Worn on the face, under or over any headgear; a full helm or a mask hides all but the eyepatch
 * and third eye. bandit: a cloth over the nose and mouth; warPaint: stripes down through the eyes
 * in the cloth colour; thirdEye: a glowing eye on the brow, in the magic colour.
 */
export const FACES = ['none', 'eyepatch', 'monocle', 'spectacles', 'goggles', 'blindfold', 'bandit', 'scar', 'warPaint', 'earrings', 'thirdEye'] as const;
/** In the hair colour; a full helm or a mask leaves only what hangs below the chin. */
export const BEARDS = ['none', 'moustache', 'goatee', 'full', 'long'] as const;
/** tusks: up from the lower jaw, orc-style; fangs: down from the upper lip. */
export const TEETH = ['none', 'tusks', 'fangs'] as const;
/** plain: none sticking out; pointed: short points; long: big ears out to the sides. */
export const EAR_STYLES = ['plain', 'pointed', 'long'] as const;
export const ARMORS = ['none', 'leather', 'chain', 'plate', 'robe'] as const;
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
  'sabre',
  'axe',
  'doubleAxe',
  'hammer',
  'mace',
  'club',
  'dagger',
  'cleaver',
  'flail',
  'warhammer',
  'practiceSword',
  'boneClub',
  'hook',
  // tools, also swung
  'pickaxe',
  'shovel',
  'torch',
  // swung in both hands, though listed here, so random units keep their weapons
  'scythe',
  'sickle',
  'fryingPan',
  // polearms: the pointed ones thrust, the blunt ones (banner on) are swung like a staff
  'spear',
  'halberd',
  'lance',
  'trident',
  'glaive',
  'banner',
  'pitchfork',
  'broom',
  'rake',
  'crook',
  'fishingRod',
  'staff',
  // floats above an open palm, glowing in the magic colour
  'orb',
  'skull',
  'lantern',
  'spellbook',
  'roundShield',
  'kiteShield',
  'towerShield',
  'buckler',
  'boardShield',
  'bow',
  'crossbow',
  // two-handed
  'greatsword',
  'maul',
  'greataxe',
  // thrown, then another drawn
  'javelin',
  'bomb',
  'throwingAxe',
  // fired: a flash at the muzzle, then smoke
  'musket',
  'pistol',
] as const;

export type Helmet = (typeof HELMETS)[number];
export type Armor = (typeof ARMORS)[number];
export type Face = (typeof FACES)[number];
export type Beard = (typeof BEARDS)[number];
export type Teeth = (typeof TEETH)[number];
export type EarStyle = (typeof EAR_STYLES)[number];
export type HandItem = (typeof HAND_ITEMS)[number];
export type Cape = (typeof CAPES)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type Gait = (typeof GAITS)[number];
export type Body = (typeof BODIES)[number];
export type ShieldItem = 'roundShield' | 'kiteShield' | 'towerShield' | 'buckler' | 'boardShield';
/** Held over the open palm, glowing in the magic colour. */
export type OrbItem = 'orb' | 'skull' | 'lantern' | 'spellbook';
/** Swung in both hands. */
export type HeavyItem = 'greatsword' | 'maul' | 'greataxe' | 'scythe';
/** Thrown at the enemy. */
export type ThrowItem = 'javelin' | 'bomb' | 'throwingAxe';
export type WeaponItem = Exclude<HandItem, 'none' | 'bow' | 'crossbow' | 'musket' | 'pistol' | OrbItem | ShieldItem>;
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
  face: Face;
  beard: Beard;
  teeth: Teeth;
  ears: EarStyle;
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

/**
 * How an item is held and swung; drives both the model and the animations. Shouldered items
 * (crossbow, musket) are aimed from the shoulder, held level.
 */
export type ItemKind = 'none' | 'chop' | 'thrust' | 'staff' | 'shield' | 'bow' | 'shouldered' | 'pistol' | 'heavy' | 'throw' | 'orb';

export function itemKind(item: HandItem): ItemKind {
  switch (item) {
    case 'sword':
    case 'sabre':
    case 'axe':
    case 'doubleAxe':
    case 'hammer':
    case 'mace':
    case 'club':
    case 'dagger':
    case 'cleaver':
    case 'flail':
    case 'warhammer':
    case 'practiceSword':
    case 'boneClub':
    case 'hook':
    case 'pickaxe':
    case 'shovel':
    case 'torch':
    case 'sickle':
    case 'fryingPan':
      return 'chop';
    case 'spear':
    case 'halberd':
    case 'lance':
    case 'trident':
    case 'glaive':
    case 'pitchfork':
      return 'thrust';
    // blunt poles: held upright like a spear, but swung to whack
    case 'banner':
    case 'broom':
    case 'rake':
    case 'crook':
    case 'fishingRod':
    case 'staff':
      return 'staff';
    case 'roundShield':
    case 'kiteShield':
    case 'towerShield':
    case 'buckler':
    case 'boardShield':
      return 'shield';
    case 'skull':
    case 'lantern':
    case 'spellbook':
      return 'orb';
    case 'greatsword':
    case 'maul':
    case 'greataxe':
    case 'scythe':
      return 'heavy';
    case 'javelin':
    case 'bomb':
    case 'throwingAxe':
      return 'throw';
    case 'crossbow':
    case 'musket':
      return 'shouldered';
    default:
      return item;
  }
}

export const otherHand = (h: Hand): Hand => (h === 'L' ? 'R' : 'L');

/** A bow (the other hand draws the string), a musket (it steadies the barrel) or a weapon swung in both hands. */
export const twoHanded = (item: HandItem) => item === 'bow' || item === 'musket' || itemKind(item) === 'heavy';

/**
 * How far from the lead fist, toward the pommel (the hand's +Y), the other fist grips a
 * two-handed weapon: touching on a sword's long grip, further apart on a haft.
 */
export const SECOND_GRIP: Record<HeavyItem, number> = { greatsword: 0.14, maul: 0.24, greataxe: 0.24, scythe: 0.26 };

/**
 * What each hand actually holds. A two-handed item empties the other hand; with two of them
 * the left one wins. A crossbow or pistol is held in one: the other keeps whatever it holds,
 * and steadies a crossbow only if it's empty.
 */
export function handItems(p: UnitParams): Record<Hand, HandItem> {
  if (twoHanded(p.leftHand)) return { L: p.leftHand, R: 'none' };
  if (twoHanded(p.rightHand)) return { L: 'none', R: p.rightHand };
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
  face: 'none',
  beard: 'none',
  teeth: 'none',
  ears: 'plain',
};

export const PRESETS: Record<string, UnitParams> = {
  swordsman: { ...BASE, helmet: 'full', armor: 'chain', rightHand: 'sword', leftHand: 'kiteShield' },
  axeman: {
    ...BASE,
    teeth: 'tusks',
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
    teeth: 'tusks',
    bulk: 1.3,
    headSize: 1.1,
    helmet: 'horned',
    armor: 'none',
    rightHand: 'axe',
    leftHand: 'axe',
    skin: 'greenSkin',
  },
  duelist: { ...BASE, beard: 'goatee', bulk: 0.9, helmet: 'none', armor: 'leather', rightHand: 'sword', leftHand: 'sword', hairStyle: 'long', hair: 'yellow' },
  shieldbearer: { ...BASE, bulk: 1.2, helmet: 'full', armor: 'plate', rightHand: 'none', leftHand: 'kiteShield' },
  worker: { ...BASE, bulk: 0.95, helmet: 'none', armor: 'none', rightHand: 'pickaxe', leftHand: 'none', hairStyle: 'afro', hair: 'dark' },
  militia: { ...BASE, beard: 'moustache', helmet: 'hood', armor: 'none', rightHand: 'pitchfork', leftHand: 'torch', hair: 'hair' },
  mage: {
    ...BASE,
    beard: 'long',
    hair: 'bone',
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
    teeth: 'fangs',
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
    beard: 'long',
    helmet: 'none',
    armor: 'robe',
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
    teeth: 'tusks',
    bulk: 1.1,
    helmet: 'horned',
    armor: 'leather',
    rightHand: 'staff',
    leftHand: 'none',
    skin: 'greenSkin',
    metal: 'bronze',
    magic: 'venom',
  },
  guard: { ...BASE, beard: 'moustache', height: 1.05, helmet: 'cap', armor: 'chain', rightHand: 'halberd', leftHand: 'none' },
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
  brute: { ...BASE, teeth: 'tusks', ears: 'pointed', bulk: 1.4, headSize: 1.15, shoulderWidth: 1.15, armLength: 1.12, armThickness: 1.2, legLength: 0.9, helmet: 'none', hairStyle: 'mohawk', armor: 'leather', rightHand: 'club', leftHand: 'none', skin: 'greenSkin' },
  pirate: { ...BASE, beard: 'full', bulk: 0.95, helmet: 'tricorn', face: 'eyepatch', armor: 'none', rightHand: 'sabre', leftHand: 'none', hairStyle: 'long', hair: 'dark' },
  monk: { ...BASE, bulk: 0.95, helmet: 'none', armor: 'robe', rightHand: 'crook', leftHand: 'none', hairStyle: 'bald', magic: 'holy' },
  crossbowman: { ...BASE, helmet: 'cap', armor: 'chain', rightHand: 'crossbow', leftHand: 'none' },
  champion: { ...BASE, bulk: 1.15, helmet: 'full', armor: 'plate', rightHand: 'greatsword', leftHand: 'none', cape: 'broad' },
  crusher: { ...BASE, face: 'warPaint', teeth: 'tusks', ears: 'pointed', bulk: 1.3, headSize: 1.1, helmet: 'none', hairStyle: 'mohawk', armor: 'leather', rightHand: 'maul', leftHand: 'none', skin: 'greenSkin' },
  skirmisher: { ...BASE, bulk: 0.9, helmet: 'cap', armor: 'leather', rightHand: 'javelin', leftHand: 'roundShield' },
  bomber: { ...BASE, face: 'goggles', helmet: 'bandana', armor: 'none', rightHand: 'bomb', leftHand: 'none', hairStyle: 'short', hair: 'dark' },
  buccaneer: { ...BASE, face: 'earrings', beard: 'moustache', bulk: 0.95, helmet: 'tricorn', armor: 'none', rightHand: 'pistol', leftHand: 'sabre', hairStyle: 'long', hair: 'dark' },
  musketeer: { ...BASE, helmet: 'featherCap', armor: 'chain', rightHand: 'musket', leftHand: 'none', cape: 'long' },
};

/**
 * Everything that's swung or thrust. The scythe stays from before it took both hands, and
 * the sickle, added later, is drawn last (see randomUnit), so every seed keeps its weapon.
 */
const WEAPONS = HAND_ITEMS.filter((i) => (itemKind(i) === 'chop' && i !== 'sickle') || itemKind(i) === 'thrust' || itemKind(i) === 'staff' || i === 'scythe');
/** What an off hand holds when it isn't a second weapon. */
const OFF_HAND: HandItem[] = [
  ...HAND_ITEMS.filter((i) => itemKind(i) === 'shield'),
  'roundShield',
  'kiteShield',
  'none',
  'none',
  'torch',
  ...HAND_ITEMS.filter((i) => itemKind(i) === 'orb'),
];
const HEAVY = HAND_ITEMS.filter((i) => itemKind(i) === 'heavy' && i !== 'scythe');
const THROWN = HAND_ITEMS.filter((i) => itemKind(i) === 'throw');
/** Second weapons: anything swung one-handed (the sickle is drawn last, see WEAPONS). */
const SIDEARMS = HAND_ITEMS.filter((i) => itemKind(i) === 'chop' && i !== 'sickle');

/** The skins random units were first drawn from; the later ones are drawn last, so every seed keeps its other fields. */
const FIRST_SKINS: RampName[] = ['skin', 'greenSkin', 'paleSkin'];
const LATER_SKINS = SKIN_RAMPS.filter((r) => !FIRST_SKINS.includes(r));
/** Faces added after the eyepatch; the blindfold and third eye are kept for special units. */
const RANDOM_FACES: Face[] = ['monocle', 'spectacles', 'goggles', 'bandit', 'scar', 'warPaint', 'earrings'];

export function randomUnit(seed: number): UnitParams {
  const rng = mulberry32(seed);
  const archer = rng() < 0.15;
  const unit: UnitParams = {
    seed,
    height: round2(range(rng, 0.9, 1.12)),
    bulk: round2(range(rng, 0.85, 1.3)),
    headSize: round2(range(rng, 0.9, 1.2)),
    helmet: pick(rng, HELMETS),
    armor: pick(rng, ARMORS),
    rightHand: archer ? 'none' : pick(rng, WEAPONS),
    leftHand: archer ? 'bow' : rng() < 0.65 ? pick(rng, OFF_HAND) : pick(rng, SIDEARMS),
    skin: pick(rng, FIRST_SKINS),
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
    face: rng() < 0.1 ? 'eyepatch' : 'none',
    beard: 'none',
    teeth: 'none',
    ears: 'plain',
  };
  // a third of the archers carry a crossbow instead, its other hand free to steady it
  if (archer && rng() < 0.35) {
    unit.rightHand = 'crossbow';
    unit.leftHand = 'none';
  }
  if (!archer && rng() < 0.1) {
    // a few of the rest swing a weapon in both hands
    unit.rightHand = pick(rng, HEAVY);
    unit.leftHand = 'none';
  } else if (!archer && rng() < 0.1) {
    // and a few others throw theirs, keeping whatever the other hand holds
    unit.rightHand = pick(rng, THROWN);
  }
  // drawn after everything else so they didn't change any earlier field for a given seed
  const green = unit.skin === 'greenSkin';
  if (rng() < 0.3) unit.beard = pick(rng, BEARDS.filter((b) => b !== 'none'));
  if (rng() < (green ? 0.6 : 0.05)) unit.teeth = green ? 'tusks' : 'fangs';
  if (rng() < (green ? 0.5 : 0.1)) unit.ears = rng() < 0.6 ? 'pointed' : 'long';
  // the later skins, last of all; a night elf has long ears and pale, blue or green hair
  if (!green && rng() < 0.25) {
    unit.skin = pick(rng, LATER_SKINS);
    if (unit.skin === 'nightSkin') {
      unit.ears = 'long';
      unit.hair = pick(rng, ['bone', 'blue', 'green'] as RampName[]);
    }
  }
  // the sickle came later still: now and then it stands in for a one-handed weapon
  for (const h of ['rightHand', 'leftHand'] as const) if (itemKind(unit[h]) === 'chop' && unit[h] !== 'torch' && rng() < 0.06) unit[h] = 'sickle';
  // a scythe now takes both hands (handItems already ignored the other)
  if (unit.rightHand === 'scythe') unit.leftHand = 'none';
  // the later faces, after that
  if (unit.face === 'none' && rng() < 0.12) unit.face = pick(rng, RANDOM_FACES);
  return unit;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
