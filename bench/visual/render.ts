// Render: the comparison images, from the captured samples.
// - sheets/<unit>-<row>-<ground>[-team_<team>].png: per direction one row per configuration, every
//   frame left to right, zoomed, then the same frames at 1x.
// - field/: every unit in every direction at game scale (1x, 2x), one panel per configuration,
//   per frame, plus an animated GIF of the cycle (with ImageMagick).
// - edge-cases/: chosen frames cropped to the sprite and zoomed, one panel per configuration and a
//   panel marking where they differ.
// Every configuration shades the same samples, so camera, scale, pose and timing are identical.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import type { TeamColor } from '../../src/render/palette';
import { BG, CONFIGS, DIRS, GROUNDS, hasMagick, loadUnit, palette, REFERENCES, stagesFor, TEAM_VARIANTS, UNITS, writeLabelled, type Config, type Dir, type Text, type Unit } from './lib';

const LABEL = 168;
const TITLE = 40;
const DIRH = 22;
const GAP = 4;
const BLOCK_GAP = 12;
const NATIVE_GAP = 24;

async function sheet(u: Unit, rowName: string, ground: string, out: string, team: TeamColor) {
  const row = u.rows.find((r) => r.name === rowName)!;
  const { width: fw, height: fh } = row.frames.S[0];
  const n = row.frames.S.length;
  const Z = fw <= 32 ? 3 : 2;
  const [cw, ch] = [fw * Z, fh * Z];
  const framesW = n * (cw + GAP) - GAP;
  const nativeW = n * (fw + 2) - 2;
  const W = LABEL + framesW + NATIVE_GAP + nativeW + 12;
  const blockH = DIRH + CONFIGS.length * (ch + GAP) - GAP;
  const H = TITLE + DIRS.length * (blockH + BLOCK_GAP);
  const pal = palette(team);
  const G = pal.length;
  pal.push(GROUNDS[ground], BG);
  const img = new Uint8Array(W * H).fill(G + 1);
  const texts: Text[] = [{ x: 8, y: 26, s: `${u.name} · ${rowName} · ${ground} · ${fw}px frame, ${u.sprite.pixelsPerUnit} px/unit · team ${team}`, size: 16, bold: true, color: '#ffffff' }];
  const put = (x0: number, y0: number, data: Uint8Array, z: number) => {
    for (let y = 0; y < fh * z; y++) for (let x = 0; x < fw * z; x++) img[(y0 + y) * W + x0 + x] = data[Math.floor(y / z) * fw + Math.floor(x / z)] || G;
  };
  DIRS.forEach((dir, di) => {
    const by = TITLE + di * (blockH + BLOCK_GAP);
    texts.push({ x: 8, y: by + 16, s: `direction ${dir}`, bold: true, color: '#ffd27a' });
    for (let k = 0; k < n; k++) texts.push({ x: LABEL + k * (cw + GAP) + 2, y: by + 16, s: `f${k + 1}`, size: 12, color: '#9aa3b2' });
    texts.push({ x: LABEL + framesW + NATIVE_GAP, y: by + 16, s: '1x', size: 12, color: '#9aa3b2' });
    CONFIGS.forEach((c, ci) => {
      const ry = by + DIRH + ci * (ch + GAP);
      texts.push({ x: 8, y: ry + Math.round(ch / 2) + 5, s: c.name });
      row.frames[dir].forEach((f, k) => {
        const s = stagesFor(u, f, c).final;
        put(LABEL + k * (cw + GAP), ry, s.data, Z);
        put(LABEL + framesW + NATIVE_GAP + k * (fw + 2), ry + Math.round((ch - fh) / 2), s.data, 1);
      });
    });
  });
  await writeLabelled(out, W, H, img, pal, texts);
}

const CELL = 48;
const PGAP = 12;
const HEAD = 14;

/** Every unit (rows) in every direction (columns) at 1x, one panel per configuration; one image per frame. */
async function field(us: Unit[], rowName: string, ground: string, outDir: string): Promise<string[]> {
  const pw = DIRS.length * CELL;
  const W = CONFIGS.length * (pw + PGAP) - PGAP;
  const H = HEAD + us.length * CELL;
  const pal = palette();
  const G = pal.length;
  pal.push(GROUNDS[ground], BG);
  const rows = us.map((u) => u.rows.find((r) => r.name === rowName)!);
  const frames = Math.max(...rows.map((r) => r.frames.S.length));
  const files: string[] = [];
  for (let k = 0; k < frames; k++) {
    const img = new Uint8Array(W * H).fill(G + 1);
    CONFIGS.forEach((c, ci) => {
      const px = ci * (pw + PGAP);
      for (let y = HEAD; y < H; y++) img.fill(G, y * W + px, y * W + px + pw);
      us.forEach((u, ui) =>
        DIRS.forEach((d, di) => {
          const fs = rows[ui].frames[d];
          const f = stagesFor(u, fs[k % fs.length], c).final;
          // feet on a common baseline: the frame's bottom centre at the cell's
          const ox = px + di * CELL + Math.floor((CELL - f.width) / 2);
          const oy = HEAD + ui * CELL + (CELL - f.height);
          for (let y = 0; y < f.height; y++)
            for (let x = 0; x < f.width; x++) {
              const v = f.data[y * f.width + x];
              if (v) img[(oy + y) * W + ox + x] = v;
            }
        }),
      );
    });
    const out = `${outDir}/${rowName}-${ground}-f${k + 1}-1x.png`;
    await writeLabelled(out, W, H, img, pal, CONFIGS.map((c, ci) => ({ x: ci * (pw + PGAP) + 2, y: 11, s: c.name, size: 10 })));
    files.push(out);
  }
  return files;
}

export interface FocusCase {
  file: string;
  unit: string;
  row: string;
  dir: Dir;
  frames: number[];
  ground: string;
  zoom: number;
  team?: TeamColor;
  /** The panels, CONFIGS by default. */
  configs?: Config[];
}

/** Frames cropped to the sprite and zoomed, one panel per configuration, then a diff panel. */
async function focus(u: Unit, c: FocusCase, out: string) {
  const configs = c.configs ?? CONFIGS;
  const all = u.rows.find((r) => r.name === c.row)!.frames[c.dir];
  const { width: fw, height: fh } = all[0];
  const Z = c.zoom;
  const pal = palette(c.team);
  const G = pal.length;
  pal.push(GROUNDS[c.ground], BG, [255, 0, 200], [0, 230, 255], [90, 90, 90], [255, 200, 0]);
  const [B, MAG, CY, GREY, AMBER] = [G + 1, G + 2, G + 3, G + 4, G + 5];
  const shaded = c.frames.map((k) => configs.map((cfg) => stagesFor(u, all[k - 1], cfg)));
  // one crop over every frame and panel
  let [x0, y0, x1, y1] = [fw, fh, 0, 0];
  for (const fr of shaded)
    for (const s of fr)
      s.final.data.forEach((v, i) => {
        if (!v) return;
        const [x, y] = [i % fw, Math.floor(i / fw)];
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      });
  [x0, y0, x1, y1] = [Math.max(0, x0 - 2), Math.max(0, y0 - 2), Math.min(fw - 1, x1 + 2), Math.min(fh - 1, y1 + 2)];
  const [cw, ch] = [(x1 - x0 + 1) * Z, (y1 - y0 + 1) * Z];
  const LEFT = 60;
  const TOP = 46;
  const PG = 8;
  const W = LEFT + (configs.length + 1) * (cw + PG);
  const H = TOP + c.frames.length * (ch + PG);
  const img = new Uint8Array(W * H).fill(B);
  const texts: Text[] = [{ x: 8, y: 18, s: `${c.unit} · ${c.row} · ${c.dir} · ${c.ground}${c.team ? ` · team ${c.team}` : ''}`, size: 15, color: '#ffffff' }];
  configs.forEach((cfg, k) => texts.push({ x: LEFT + k * (cw + PG), y: 40, s: cfg.name, size: 11 }));
  const legend = c.configs ? `diff: amber = ${configs[1].name} vs ${configs[2].name}` : 'diff: magenta Gap Black opens, cyan Ridge';
  texts.push({ x: LEFT + configs.length * (cw + PG), y: 40, s: legend, size: 10 });
  shaded.forEach((fr, r) => {
    const oy = TOP + r * (ch + PG);
    texts.push({ x: 8, y: oy + Math.round(ch / 2) + 5, s: `f${c.frames[r]}`, size: 14, color: '#ffd27a' });
    const base = fr[0].final.data;
    const diff = c.configs
      ? base.map((v, i) => (fr[1].final.data[i] !== fr[2].final.data[i] ? AMBER : v ? GREY : 0))
      : base.map((v, i) => (fr[0].shaded.data[i] !== fr[2].shaded.data[i] ? CY : v && !fr[1].final.data[i] ? MAG : v ? GREY : 0));
    [...fr.map((s) => s.final.data), diff].forEach((data, k) => {
      const ox = LEFT + k * (cw + PG);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) img[(oy + y) * W + ox + x] = data[(y0 + Math.floor(y / Z)) * fw + x0 + Math.floor(x / Z)] || G;
    });
  });
  await writeLabelled(out, W, H, img, pal, texts);
}

/** The edge cases FINAL_VISUAL_VALIDATION.md documents, under the same names. */
export const EDGE_CASES: FocusCase[] = [
  { file: 'benchmark-swordsman-walk-S-grass', unit: 'swordsman', row: 'walk', dir: 'S', frames: [1, 2, 3, 4, 5], ground: 'grass', zoom: 9 },
  { file: 'holes-and-crossing-legs-swordsman-walk-E-grass', unit: 'swordsman', row: 'walk', dir: 'E', frames: [1, 2, 3, 4, 5], ground: 'grass', zoom: 8 },
  { file: 'staff-gap-and-1px-holes-mage-walk-E-sand', unit: 'mage', row: 'walk', dir: 'E', frames: [1, 2, 3, 4, 5], ground: 'sand', zoom: 9 },
  { file: 'thin-spear-and-2x2-hole-spearman-attack-E-grass', unit: 'spearman', row: 'attack', dir: 'E', frames: [1, 2, 3, 4, 5], ground: 'grass', zoom: 8 },
  { file: 'thin-diagonal-spear-spearman-attack-SE-grass', unit: 'spearman', row: 'attack', dir: 'SE', frames: [1, 2, 3, 4, 5], ground: 'grass', zoom: 8 },
  { file: 'thin-diagonal-spear-spearman-attack-SE-f2-16x', unit: 'spearman', row: 'attack', dir: 'SE', frames: [2], ground: 'grass', zoom: 16 },
  { file: 'pale-horse-legs-knight48-walk-E-sand', unit: 'knight48', row: 'walk', dir: 'E', frames: [1, 2, 3, 4, 5], ground: 'sand', zoom: 6 },
  { file: 'bow-hand-holes-archer-walk-E-sand', unit: 'archer', row: 'walk', dir: 'E', frames: [1, 2, 3, 4, 5], ground: 'sand', zoom: 9 },
  { file: 'small-halberd-and-feet-small-guard-walk-N-grass', unit: 'small-guard', row: 'walk', dir: 'N', frames: [1, 2, 3, 4, 5], ground: 'grass', zoom: 12 },
  { file: 'pale-on-dark-mage-idle-SE-dark', unit: 'mage', row: 'idle', dir: 'SE', frames: [1, 2, 3, 4], ground: 'dark', zoom: 10 },
  { file: 'white-team-on-sand-swordsman-walk-SE', unit: 'swordsman', row: 'walk', dir: 'SE', frames: [1, 2, 3, 4, 5], ground: 'sand', zoom: 8, team: 'white' },
  { file: 'thin-diagonal-halberd-guard-attack-SE-sand', unit: 'guard', row: 'attack', dir: 'SE', frames: [1, 2, 3, 4, 5], ground: 'sand', zoom: 8 },
  { file: 'small-staff-small-mage-walk-SE-grass', unit: 'small-mage', row: 'walk', dir: 'SE', frames: [1, 2, 3, 4, 5], ground: 'grass', zoom: 12 },
];

/** Gap Black before and after pinholes were filled, on the frames where Task 4 found the specks. */
const PINHOLE_PANELS: Config[] = [CONFIGS[0], REFERENCES[0], CONFIGS[1], CONFIGS[3]];
export const PINHOLE_CASES: FocusCase[] = [
  { file: 'pinholes-swordsman-walk-E-sand', unit: 'swordsman', row: 'walk', dir: 'E', frames: [1, 2, 3, 4, 5], ground: 'sand', zoom: 8 },
  { file: 'pinholes-archer-walk-E-sand', unit: 'archer', row: 'walk', dir: 'E', frames: [1, 2, 3, 4, 5], ground: 'sand', zoom: 8 },
  { file: 'pinholes-spearman-attack-E-sand', unit: 'spearman', row: 'attack', dir: 'E', frames: [1, 2, 3, 4, 5], ground: 'sand', zoom: 8 },
  { file: 'pinholes-mage-walk-E-sand', unit: 'mage', row: 'walk', dir: 'E', frames: [1, 2, 3, 4, 5], ground: 'sand', zoom: 8 },
].map((c) => ({ ...c, dir: c.dir as Dir, configs: PINHOLE_PANELS }));

export interface RenderOptions {
  outDir: string;
  /** Only these units' sheets (the field and edge cases need all of them). */
  only?: string[];
  log?: (s: string) => void;
}

export async function render({ outDir, only, log = console.error }: RenderOptions): Promise<void> {
  if (!hasMagick()) log('  ImageMagick (magick) not found: images are written without labels, and no GIFs');
  const cache = new Map<string, Unit>();
  const unit = (name: string) => {
    if (!cache.has(name)) cache.set(name, loadUnit(outDir, name));
    return cache.get(name)!;
  };
  const names = UNITS.map((u) => u.name).filter((n) => !only || only.includes(n));

  mkdirSync(`${outDir}/sheets`, { recursive: true });
  let count = 0;
  for (const name of names) {
    const u = unit(name);
    const teams: TeamColor[] = ['red', ...TEAM_VARIANTS.filter((t) => t.units.includes(name)).map((t) => t.team as TeamColor)];
    for (const team of teams)
      for (const r of u.rows)
        for (const g of Object.keys(GROUNDS)) {
          await sheet(u, r.name, g, `${outDir}/sheets/${name}-${r.name}-${g}${team === 'red' ? '' : `-team_${team}`}.png`, team);
          count++;
        }
  }
  log(`  ${count} sheets`);
  if (only) return;

  mkdirSync(`${outDir}/field`, { recursive: true });
  const us = UNITS.map((u) => unit(u.name));
  for (const row of ['walk', 'idle'])
    for (const g of Object.keys(GROUNDS)) {
      const files = await field(us, row, g, `${outDir}/field`);
      if (!hasMagick()) continue;
      // 2x, nearest neighbour; the GIF at the row's own rate (walk 8 fps, idle 4 fps)
      for (const f of files) execFileSync('magick', [f, '-filter', 'point', '-resize', '200%', '-strip', f.replace('-1x.png', '-2x.png')]);
      const delay = row === 'walk' ? '13' : '25';
      execFileSync('magick', ['-delay', delay, '-loop', '0', ...files, '-filter', 'point', '-resize', '200%', `${outDir}/field/${row}-${g}-2x.gif`]);
    }
  log('  field views');

  mkdirSync(`${outDir}/edge-cases`, { recursive: true });
  for (const c of [...EDGE_CASES, ...PINHOLE_CASES]) await focus(unit(c.unit), c, `${outDir}/edge-cases/${c.file}.png`);
  log(`  ${EDGE_CASES.length + PINHOLE_CASES.length} edge-case views`);
}
