// What the visual benchmark renders: the units (existing presets, seed 1), their rows, and the
// team-colour variants. Shared by the capture (run.mjs) and the offline steps (render.ts, metrics.ts).

/** Small scale: pixels per world unit, against the default 14. */
const SMALL = { sprite: { pixelsPerUnit: 9 } };

/**
 * name: file name of the unit's samples; kind and preset: as the app names them; rows: the
 * animation rows captured; sprite: settings that differ from the app's defaults.
 */
export const UNITS = [
  { name: 'swordsman', kind: 'humanoid', preset: 'swordsman', rows: ['walk', 'idle'] },
  { name: 'spearman', kind: 'humanoid', preset: 'spearman', rows: ['walk', 'idle', 'attack'] },
  { name: 'guard', kind: 'humanoid', preset: 'guard', rows: ['walk', 'idle', 'attack'] },
  { name: 'mage', kind: 'humanoid', preset: 'mage', rows: ['walk', 'idle'] },
  { name: 'archer', kind: 'humanoid', preset: 'archer', rows: ['walk', 'idle'] },
  { name: 'militia', kind: 'humanoid', preset: 'militia', rows: ['walk', 'idle'] },
  { name: 'monk', kind: 'humanoid', preset: 'monk', rows: ['walk', 'idle'] },
  { name: 'pirate', kind: 'humanoid', preset: 'pirate', rows: ['walk', 'idle'] },
  { name: 'wolf', kind: 'beast', preset: 'wolf', rows: ['walk', 'idle'] },
  { name: 'knight48', kind: 'mounted', preset: 'knight', rows: ['walk', 'idle'], extra: { sprite: { frameSize: 48 } } },
  ...['swordsman', 'spearman', 'guard', 'mage', 'archer'].map((preset) => ({ name: `small-${preset}`, kind: 'humanoid', preset, rows: ['walk', 'idle'], extra: SMALL })),
];

/** Team-colour variants of the sheets: the team ramp is a palette swap, so no capture of their own. */
export const TEAM_VARIANTS = [
  { team: 'white', units: ['swordsman', 'mage', 'knight48'] },
  { team: 'black', units: ['swordsman', 'pirate'] },
];

/** Where each kind keeps its parameters in a share link. */
const PARAMS_KEY = { humanoid: 'unit', beast: 'beast', mounted: 'mounted', vehicle: 'vehicle' };

/** The page that shows a unit: a share link (format v4, seed 1, the first row previewed) with the diagnostics on. */
export function unitUrl(base, u) {
  const settings = { v: 4, kind: u.kind, preset: u.preset, [PARAMS_KEY[u.kind]]: { seed: 1 }, previewAnim: u.rows[0], ...u.extra };
  const s = Buffer.from(JSON.stringify(settings)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base}?diag&s=${s}`;
}
