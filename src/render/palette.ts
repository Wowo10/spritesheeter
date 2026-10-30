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
  // new ramps go last: palette indices of exported sheets must not shift
  fire: ['#9a2804', '#e0580c', '#fca828', '#fff4a8'],
  arcane: ['#1a3a9a', '#2e7ae8', '#6ac8ff', '#e0f8ff'],
  holy: ['#a07810', '#e0b830', '#fce878', '#fffce8'],
  venom: ['#1a6a10', '#3aa82a', '#7ee050', '#e8ffc0'],
  rotSkin: ['#262c1c', '#4a5434', '#76805a', '#a4ac84'],
  ghost: ['#34425e', '#6280a4', '#a4c2de', '#e6f6ff'],
  // beast hides: grey fur, sandy big-cat fur, swamp-green scales
  fur: ['#2c2824', '#56504a', '#8a8278', '#c4bcb0'],
  tawny: ['#4e3a1e', '#8c6c3c', '#c4a064', '#ead29a'],
  scales: ['#142218', '#2a4230', '#4a6a48', '#7e9a6a'],
} as const satisfies Record<string, readonly [string, string, string, string]>;

export type RampName = keyof typeof RAMPS;

export const RAMP_NAMES = Object.keys(RAMPS) as RampName[];

export const SKIN_RAMPS: RampName[] = ['skin', 'greenSkin', 'paleSkin'];
/** Skins for the undead; kept apart so random units stay among the living. */
export const UNDEAD_SKIN_RAMPS: RampName[] = ['rotSkin', 'ghost'];
export const CLOTH_RAMPS: RampName[] = ['team', 'red', 'blue', 'green', 'purple', 'yellow'];
export const METAL_RAMPS: RampName[] = ['steel', 'gold', 'bronze'];
/** Fur, hide and scales for beasts. */
export const HIDE_RAMPS: RampName[] = ['fur', 'hair', 'leather', 'tawny', 'dark', 'bone', 'paleSkin', 'scales', 'greenSkin', 'red', 'yellow', 'rotSkin', 'ghost'];
/** Glowing ramps for spell effects. */
export const MAGIC_RAMPS: RampName[] = ['arcane', 'holy', 'venom', 'fire'];

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

/**
 * Classic 8-player team colours. The sprites themselves only ever reference the reserved
 * 'team' ramp, so recolouring a sheet is a palette swap of those four entries.
 */
export const TEAM_COLORS = {
  red: RAMPS.team,
  blue: ['#0c1650', '#1c38a0', '#3462e0', '#7aa6ff'],
  green: ['#08300c', '#105818', '#20a030', '#68e070'],
  violet: ['#2c0c44', '#5a1c88', '#8c3cc8', '#c48cf0'],
  orange: ['#4a1c04', '#94400c', '#e07018', '#ffb060'],
  black: ['#08080c', '#1c1c24', '#34343e', '#54545e'],
  white: ['#6a6a72', '#a4a4ac', '#d4d4dc', '#fcfcfc'],
  yellow: ['#4a3c00', '#9a7c08', '#e0c020', '#fff070'],
} as const satisfies Record<string, readonly [string, string, string, string]>;

export type TeamColor = keyof typeof TEAM_COLORS;

export const TEAM_COLOR_NAMES = Object.keys(TEAM_COLORS) as TeamColor[];

/** Palette indices of the team ramp, dark to light: the entries a game swaps per player. */
export const TEAM_INDICES = [0, 1, 2, 3].map((s) => paletteIndex(rampIndex('team'), s));

export function teamRgb(team: TeamColor): RGB[] {
  return TEAM_COLORS[team].map(hexToRgb);
}

const teamPalettes = new Map<TeamColor, RGB[]>();

/** The palette with the team ramp in the given colours; the same array each time, so don't change it. */
export function teamPalette(team: TeamColor): RGB[] {
  let pal = teamPalettes.get(team);
  if (!pal) {
    pal = PALETTE.slice();
    teamRgb(team).forEach((rgb, s) => (pal![TEAM_INDICES[s]] = rgb));
    teamPalettes.set(team, pal);
  }
  return pal;
}
