// Shared by the offline steps: the captured samples, the configurations compared, shading them with
// the app's own pipeline, and writing labelled PNGs.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { encodePng } from '../../src/export/png';
import { gapBlackOutline, type GapBlackOptions } from '../../src/render/gapOutline';
import { teamPalette, type RGB, type TeamColor } from '../../src/render/palette';
import { dither, shadePixels, shadeStages, type Downsample, type FrameSamples, type Outline, type PostprocessSettings, type ShadeStages } from '../../src/render/postprocess';
import { GLOW_RAMPS } from '../../src/render/spriteRenderer';
import { TEAM_VARIANTS, UNITS } from './presets.mjs';

export { TEAM_VARIANTS, UNITS };

/** The rendered directions; the west-facing ones are mirrors of their east twins. */
export const DIRS = ['N', 'NE', 'E', 'SE', 'S'] as const;
export type Dir = (typeof DIRS)[number];

/** The grounds sprites are judged on (as in the diagnostics panel's compare view). */
export const GROUNDS: Record<string, RGB> = { grass: [0x4f, 0x7a, 0x3a], sand: [0xc8, 0xb0, 0x7a], dark: [0x1c, 0x1f, 0x24] };

export interface Config {
  name: string;
  downsample: Downsample;
  outline: Outline;
  /** Gap Black with other options than the app's: for reference rows, never a setting the app has. */
  gapBlack?: GapBlackOptions;
}

/** The four configurations under test, in sheet order. */
export const CONFIGS: Config[] = [
  { name: 'Classic + Outer', downsample: 'classic', outline: 'outer' },
  { name: 'Classic + Gap Black', downsample: 'classic', outline: 'gapBlack' },
  { name: 'Ridge + Outer', downsample: 'ridge', outline: 'outer' },
  { name: 'Ridge + Gap Black', downsample: 'ridge', outline: 'gapBlack' },
];

/** Gap Black as it was before pinholes were filled (pinhole 0), to compare against. */
export const REFERENCES: Config[] = [
  { name: 'Classic + Gap Black, pinholes open', downsample: 'classic', outline: 'gapBlack', gapBlack: { fillPinholes: false } },
  { name: 'Ridge + Gap Black, pinholes open', downsample: 'ridge', outline: 'gapBlack', gapBlack: { fillPinholes: false } },
];

export interface Row {
  name: string;
  loop: boolean;
  frames: Record<Dir, FrameSamples[]>;
}
export interface Unit {
  name: string;
  sprite: PostprocessSettings & { frameSize: number; pixelsPerUnit: number };
  rows: Row[];
}

export function loadUnit(outDir: string, name: string): Unit {
  const d = JSON.parse(readFileSync(`${outDir}/samples/${name}.json`, 'utf8'));
  const fix = (f: FrameSamples): FrameSamples => ({ ...f, ramp: Uint8Array.from(f.ramp), covered: Uint8Array.from(f.covered), count: Uint8Array.from(f.count), light: Uint16Array.from(f.light) });
  d.rows = d.rows.map((r: Row) => ({ ...r, frames: Object.fromEntries(Object.entries(r.frames).map(([k, fs]) => [k, fs.map(fix)])) }));
  return d;
}

/** A frame shaded in a configuration, with the unit's own coverage and thresholds, step by step. */
export function stagesFor(u: Unit, f: FrameSamples, c: Config): ShadeStages {
  // Gap Black as the app has it now, whatever the samples were captured with
  const settings: PostprocessSettings = { ...u.sprite, downsample: c.downsample, outline: c.outline, pinholes: 'fill' };
  if (!c.gapBlack) return shadeStages(f, settings, GLOW_RAMPS);
  const shaded = shadePixels(f, settings);
  const outlined = gapBlackOutline(shaded, c.gapBlack);
  return { shaded, outlined, final: dither(outlined, f.opacity, f.phase, GLOW_RAMPS) };
}

export const palette = (team: TeamColor = 'red'): RGB[] => [...teamPalette(team)];

export interface Text {
  x: number;
  y: number;
  s: string;
  size?: number;
  bold?: boolean;
  color?: string;
}

let magick: boolean | null = null;
/** Whether ImageMagick 7 (`magick`) is there to draw the labels and the GIFs. */
export function hasMagick(): boolean {
  magick ??= spawnSync('magick', ['-version'], { stdio: 'ignore' }).status === 0;
  return magick;
}

/** Writes an indexed image as a PNG, with the labels drawn on when ImageMagick is there (else without). */
export async function writeLabelled(out: string, width: number, height: number, data: Uint8Array, pal: RGB[], texts: Text[]): Promise<void> {
  const png = await encodePng({ width, height, colorType: 3, data, palette: pal });
  if (!hasMagick() || !texts.length) {
    writeFileSync(out, png);
    return;
  }
  const raw = `${out}.raw.png`;
  writeFileSync(raw, png);
  const args = [raw];
  for (const t of texts) args.push('-font', t.bold ? 'DejaVu-Sans-Bold' : 'DejaVu-Sans', '-pointsize', String(t.size ?? 13), '-fill', t.color ?? '#d8dce4', '-annotate', `+${t.x}+${t.y}`, t.s);
  // no timestamps or other metadata, so the same pixels make the same file
  args.push('-strip', '-define', 'png:exclude-chunks=date,time', `${out}.tmp.png`);
  execFileSync('magick', args);
  renameSync(`${out}.tmp.png`, out);
  execFileSync('rm', [raw]);
}

export const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

export const BG: RGB = [0x16, 0x18, 0x1d];
