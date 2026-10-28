/**
 * Fixed 90s-style palette built from 4-shade ramps (dark -> light).
 * Palette index 0 is transparent; ramp r, shade s lives at 1 + r * 4 + s.
 */

export const SHADES = 4;

export const RAMPS = {
  team: ['#3a0a0a', '#7a1414', '#b82424', '#e85a4a'],
  skin: ['#5a3a22', '#9a6a44', '#d19a6a', '#f0c896'],
  greenSkin: ['#1e3a14', '#3d6b24', '#6a9a3a', '#a6c95e'],
  paleSkin: ['#6a5a5a', '#a8948a', '#d8c4b4', '#f4e8dc'],
  steel: ['#2a2e38', '#5a6270', '#9aa4b0', '#d8e0e8'],
  gold: ['#4a3008', '#8a6014', '#d0a030', '#f8e080'],
  bronze: ['#3a2210', '#7a4a20', '#b07838', '#e0b070'],
  leather: ['#2a180c', '#5a3418', '#8a5428', '#b47e48'],
  wood: ['#3a2410', '#6a4420', '#9a6a34', '#c8985a'],
  red: ['#3a0a0a', '#7a1414', '#b82424', '#e85a4a'],
  blue: ['#0a1440', '#18307a', '#3058c0', '#6a98ec'],
  green: ['#0a2a10', '#18501e', '#2e8a34', '#6ac46a'],
  purple: ['#2a0a3a', '#521a70', '#8030a8', '#b870dc'],
  yellow: ['#4a3a04', '#8a7010', '#d0b028', '#f8e470'],
  bone: ['#5a5240', '#9a8e70', '#d0c4a0', '#f4ecd4'],
  hair: ['#1a120a', '#3a2614', '#5e4022', '#8a6236'],
  dark: ['#000000', '#141414', '#282828', '#3c3c3c'],
} as const satisfies Record<string, readonly [string, string, string, string]>;

export type RampName = keyof typeof RAMPS;

export const RAMP_NAMES = Object.keys(RAMPS) as RampName[];

export const SKIN_RAMPS: RampName[] = ['skin', 'greenSkin', 'paleSkin'];
export const CLOTH_RAMPS: RampName[] = ['team', 'red', 'blue', 'green', 'purple', 'yellow'];
export const METAL_RAMPS: RampName[] = ['steel', 'gold', 'bronze'];

export type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rampIndex(name: RampName): number {
  return RAMP_NAMES.indexOf(name);
}

export function paletteIndex(ramp: number, shade: number): number {
  return 1 + ramp * SHADES + shade;
}

/** Palette as RGB triples; entry 0 (transparent) is black. */
export const PALETTE: RGB[] = [
  [0, 0, 0],
  ...RAMP_NAMES.flatMap((name) => RAMPS[name].map(hexToRgb)),
];

export const OUTLINE_INDEX = paletteIndex(rampIndex('dark'), 0);

export function rampRgb(name: RampName): RGB[] {
  return RAMPS[name].map(hexToRgb);
}
