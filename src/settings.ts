/**
 * The settings a share link carries (and undo records): what the page opens with, the values
 * fields that take one of a set may have, and the range of number fields. See shareLink.ts for
 * how links record them.
 */
import { ANIMATION_NAMES, DEFAULT_FRAME_COUNTS, type AnimationName } from './anim/humanoid-anims';
import { DEFAULT_LIGHTING } from './render/materials';
import { RAMP_NAMES, TEAM_COLOR_NAMES, type TeamColor } from './render/palette';
import { DEFAULT_PORTRAIT, PORTRAIT_BACKGROUNDS, PORTRAIT_SIZES, type PortraitSettings } from './render/portrait';
import type { Downsample, Outline, Pinholes } from './render/postprocess';
import { DEFAULT_SPRITE_SETTINGS, type SpriteSettings } from './render/spriteRenderer';
import { kindDef, KINDS, type AnyParams, type Kind } from './subjects';
import { BACKS, BARDINGS, BEAST_PRESETS, EARS, HORNS, WINGS, type BeastParams } from './unit/beast-params';
import { DEFAULT_BUILDING, ROOFS, type BuildingParams } from './unit/building-params';
import { copyMounted, MOUNTED_PRESETS } from './unit/mounted';
import { ARMORS, BEARDS, BODIES, CAPES, EAR_STYLES, FACES, GAITS, HAIR_STYLES, HAND_ITEMS, HELMETS, PRESETS, TEETH, type UnitParams } from './unit/params';
import { VEHICLE_PRESETS, WEAPONS, type VehicleParams } from './unit/vehicle-params';

/** Animations an export includes until unchecked; the rest (spells, work) only for units that need them. */
export const BASIC_ANIMS: readonly AnimationName[] = ['idle', 'walk', 'attack', 'death', 'build'];

// the big sizes are for buildings and other large models
export const FRAME_SIZES = [32, 48, 64, 96, 128, 160, 192, 256];
export const OUTLINES: Outline[] = ['none', 'inner', 'outer', 'colored', 'stableColored', 'gapBlack'];
export const DOWNSAMPLES: Downsample[] = ['classic', 'ridge'];
export const PINHOLES: Pinholes[] = ['fill', 'open'];
export const SUPERSAMPLES = [4, 8, 12];

/**
 * Everything a share link carries, as the page opens with it: the procedural unit of each kind
 * and how it's rendered. A custom model stays behind, since its file can't travel in a URL.
 * A new object every call.
 */
export function defaultSettings() {
  return {
    /** Which procedural generator is in use; each keeps its own settings. */
    kind: 'humanoid' as Kind,
    preset: 'swordsman',
    unit: { ...PRESETS.swordsman } as UnitParams,
    beast: { ...BEAST_PRESETS.wolf } as BeastParams,
    mounted: copyMounted(MOUNTED_PRESETS.knight),
    vehicle: { ...VEHICLE_PRESETS.catapult } as VehicleParams,
    /** Buildings have no presets: the seed lays them out. */
    building: { ...DEFAULT_BUILDING } as BuildingParams,
    frames: { ...DEFAULT_FRAME_COUNTS },
    /** Seconds each decay stage lies on the ground for. */
    decayHold: 8,
    sprite: { ...DEFAULT_SPRITE_SETTINGS, thresholds: [...DEFAULT_SPRITE_SETTINGS.thresholds] } as SpriteSettings,
    lighting: {
      ambient: DEFAULT_LIGHTING.ambient,
      diffuse: DEFAULT_LIGHTING.diffuse,
      azimuth: DEFAULT_LIGHTING.azimuth,
      elevation: DEFAULT_LIGHTING.elevation,
      fill: DEFAULT_LIGHTING.fill,
    },
    /** The close-up for a selection panel or command card. */
    portrait: { ...DEFAULT_PORTRAIT } as PortraitSettings,
    previewAnim: 'walk' as AnimationName,
    /** Which rows go into the exported sheet; the previews always show them all. */
    exportAnims: Object.fromEntries(ANIMATION_NAMES.map((n) => [n, BASIC_ANIMS.includes(n)])) as Record<AnimationName, boolean>,
    /** Also export the team mask: the team-coloured pixels, grey per shade. */
    teamMask: false,
    team: 'red' as TeamColor,
  };
}

export type SharedSettings = ReturnType<typeof defaultSettings>;

/** The fields of SharedSettings, in the order links and undo record them. */
export const SHARED_KEYS = Object.keys(defaultSettings()) as (keyof SharedSettings)[];

/** The field of the settings (and of a share link) that holds the settings of a kind. */
export const paramsKey = (kind: Kind) => (kind === 'humanoid' ? 'unit' : kind);

/** The unit a preset gives, or the random one for the seed if it's not one of the kind's presets. */
export function presetParams(kind: Kind, preset: string, seed: number): AnyParams {
  const def = kindDef(kind);
  return Object.hasOwn(def.presets, preset) ? def.preset(preset, seed) : def.random(seed);
}

/** Values a shared link may set for fields that take one of a set; see mergeSettings. */
const UNIT_CHOICES: Record<string, readonly unknown[]> = {
  helmet: HELMETS,
  face: FACES,
  beard: BEARDS,
  teeth: TEETH,
  ears: EAR_STYLES,
  armor: ARMORS,
  rightHand: HAND_ITEMS,
  leftHand: HAND_ITEMS,
  hairStyle: HAIR_STYLES,
  cape: CAPES,
  gait: GAITS,
  body: BODIES,
  ...Object.fromEntries(['skin', 'cloth', 'metal', 'hair', 'magic', 'capeColor'].map((k) => [k, RAMP_NAMES])),
};
const BEAST_CHOICES: Record<string, readonly unknown[]> = {
  ears: EARS,
  horns: HORNS,
  back: BACKS,
  barding: BARDINGS,
  wings: WINGS,
  ...Object.fromEntries(['hide', 'belly', 'accent', 'metal', 'magic', 'wingColor'].map((k) => [k, RAMP_NAMES])),
};
const prefixed = (prefix: string, choices: Record<string, readonly unknown[]>) =>
  Object.fromEntries(Object.entries(choices).map(([k, v]) => [prefix + k, v]));

export const SHARE_CHOICES: Record<string, readonly unknown[]> = {
  kind: KINDS,
  preset: [...Object.keys(PRESETS), ...Object.keys(BEAST_PRESETS), ...Object.keys(MOUNTED_PRESETS), ...Object.keys(VEHICLE_PRESETS), 'random'],
  previewAnim: ANIMATION_NAMES,
  team: TEAM_COLOR_NAMES,
  ...prefixed('unit.', UNIT_CHOICES),
  ...prefixed('beast.', BEAST_CHOICES),
  ...prefixed('mounted.rider.', UNIT_CHOICES),
  ...prefixed('mounted.mount.', BEAST_CHOICES),
  'vehicle.weapon': WEAPONS,
  ...Object.fromEntries(['wood', 'metal', 'cloth', 'flame'].map((k) => [`vehicle.${k}`, RAMP_NAMES])),
  'building.roof': ROOFS,
  ...Object.fromEntries(['walls', 'trim', 'roofColor', 'light'].map((k) => [`building.${k}`, RAMP_NAMES])),
  'sprite.frameSize': FRAME_SIZES,
  'sprite.outline': OUTLINES,
  'sprite.downsample': DOWNSAMPLES,
  'sprite.pinholes': PINHOLES,
  'sprite.supersample': SUPERSAMPLES,
  'portrait.size': PORTRAIT_SIZES,
  'portrait.background': PORTRAIT_BACKGROUNDS,
};

/**
 * The range of the number settings outside the unit's own, as their controls allow: [min, max].
 * The controls are built from these, so nothing the page can be set to falls outside them.
 */
export const SHARE_RANGES = {
  ...(Object.fromEntries(ANIMATION_NAMES.map((n) => [`frames.${n}`, [1, 12]])) as Record<`frames.${AnimationName}`, [number, number]>),
  decayHold: [1, 60],
  'sprite.pixelsPerUnit': [6, 80],
  'sprite.elevation': [10, 70],
  'sprite.anchorY': [0.5, 0.95],
  'sprite.coverage': [0.1, 0.9],
  'sprite.thresholds': [0, 1],
  'lighting.azimuth': [-180, 180],
  'lighting.elevation': [-30, 90],
  'lighting.diffuse': [0, 1.5],
  'lighting.fill': [0, 0.8],
  'lighting.ambient': [0, 1],
  'portrait.zoom': [0.5, 2],
  'portrait.turn': [-90, 90],
  'portrait.elevation': [0, 45],
  'portrait.frames': [1, 12],
} satisfies Record<string, [number, number]>;
