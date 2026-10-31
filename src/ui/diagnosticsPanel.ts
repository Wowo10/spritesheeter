import type GUI from 'lil-gui';
import { indexedToRgba } from '../export/packer';
import { COMPARISONS, compactRaw, coverageToRgba, diffToRgba, edgeContrast, frameDiff, frameStats, purityToRgba, rampToRgba, rawToRgba, rowStats, type RawFrame, type RowStats } from '../render/diagnostics';
import { ID_STEP } from '../render/materials';
import type { RGB } from '../render/palette';
import { minCovered, type FrameSamples, type IndexedFrame, type PostprocessSettings } from '../render/postprocess';
import { DIRECTIONS, GLOW_RAMPS, shadeSprite, shadeSpriteStages, type Direction } from '../render/spriteRenderer';

/** A row as rendered, before it's shaded. */
export interface DiagnosticsRow {
  name: string;
  loop: boolean;
  frames: Map<Direction, FrameSamples[]>;
}

/** What the panel shows: the rows as rendered, before they're shaded. */
export interface DiagnosticsSource {
  /** Every rendered row: the sheet's, and the effects' as `fx:<name>`. */
  rows(): DiagnosticsRow[];
  /** The row the panel shows: the previewed animation. */
  previewed(): string;
  settings(): PostprocessSettings;
  palette(): RGB[];
  /** Renders everything again, keeping the previewed row's supersampled passes. */
  rerender(): void;
  /**
   * Renders the previewed row's first frame `steps` times, moved a little further each time,
   * to a pixel right and down: the pose never changes, so whatever does is aliasing.
   */
  renderShifted(steps: number): Promise<Map<Direction, FrameSamples[]> | null>;
}

/** The compared configurations' stats for one row: per direction, and averaged over the directions. */
export interface RowReport {
  row: string;
  configs: string[];
  directions: Partial<Record<Direction, RowStats[]>>;
  all: RowStats[];
}

/** Most memory the kept supersampled passes may take; big frames keep only the first few. */
const RAW_BUDGET_BYTES = 64 * 1024 * 1024;

/** The row renderShifted renders, as report() names it. */
export const SHIFTED = 'shifted';

type Mode = 'stages' | 'compare' | typeof SHIFTED;

const STAGES = ['supersampled', 'coverage', 'ramp', 'ramp purity', 'shaded', 'outlined', 'final', 'Δ prev frame'] as const;
type Stage = (typeof STAGES)[number];

/** What the compare view draws the sprites over: outlines read differently on each. */
const GROUNDS: Record<string, RGB | null> = { checker: null, grass: [0x4f, 0x7a, 0x3a], sand: [0xc8, 0xb0, 0x7a], dark: [0x1c, 0x1f, 0x24] };

type ComparisonSet = keyof typeof COMPARISONS;

const COLUMNS = 4;
const GAP = 6;

/** The stats the compare view lists, and how. */
const STAT_ROWS: [keyof RowStats, string, number][] = [
  ['drawn', 'drawn px (before outline)', 0],
  ['dropped', 'covered but not drawn', 1],
  ['thin', '1 px wide px', 1],
  ['outline', 'outline px', 0],
  ['black', 'pure black px', 0],
  ['filled', 'outline px filling gaps', 1],
  ['bare', 'edge sides left bare', 1],
  ['edges', 'edge sides', 1],
  ['gapsOpen', 'narrow gap px left open', 1],
  ['gaps', 'narrow gap px', 1],
  ['dentsOpen', 'of them dents, open', 1],
  ['dents', 'of them dents', 1],
  ['partGapsOpen', 'between parts, open', 1],
  ['partGaps', 'between parts', 1],
  ['disappeared', 'px disappearing per frame', 1],
  ['changed', 'px changing per frame', 1],
  ['outlineRecoloured', 'outline px recoloured/frame', 1],
];

/**
 * Development only (opened with ?diag). Two views of the previewed row:
 * - stages: one frame at every step of its post-processing, side by side, with counts of what
 *   each step lost. The supersampled pass is kept for the previewed row only, as it's rendered.
 * - compare: every frame of a direction shaded with each configuration of a set in COMPARISONS,
 *   from the same rendered frames, with their stats for this direction and over all of them, and
 *   how their edges stand out from the ground they're shown on.
 * Changing the outline, coverage or thresholds shades it again without rendering.
 */
export class DiagnosticsPanel {
  private readonly view = { mode: 'stages' as Mode, direction: 'S' as Direction, frame: 0, ground: 'grass', set: 'outline' as ComparisonSet };
  /** The previewed row's first frame moved across a pixel, once renderShifted has rendered it. */
  private shifted: DiagnosticsRow | null = null;
  private readonly raws = new Map<FrameSamples, RawFrame>();
  private rawBytes = 0;
  private readonly canvases = new Map<Stage, HTMLCanvasElement>();
  private readonly captions = new Map<Stage, HTMLElement>();
  private readonly title: HTMLElement;
  private readonly stages: HTMLElement;
  private readonly compare: HTMLElement;
  private readonly stats: HTMLElement;
  private compareCanvases: HTMLCanvasElement[] = [];
  private maxWidth = 400;
  private frameSize = 32;

  constructor(
    gui: GUI,
    side: HTMLElement,
    private readonly src: DiagnosticsSource,
  ) {
    const panel = document.createElement('div');
    panel.className = 'panel diagnostics';
    panel.innerHTML = '<h2>Diagnostics <span></span></h2><div class="diagGrid"></div><div class="diagGrid diagCompare"></div><pre class="diagStats"></pre>';
    this.title = panel.querySelector('h2 span')!;
    this.stats = panel.querySelector('.diagStats')!;
    [this.stages, this.compare] = panel.querySelectorAll<HTMLElement>('.diagGrid');
    for (const stage of STAGES) {
      const [fig, canvas, caption] = figure(stage);
      this.stages.append(fig);
      this.canvases.set(stage, canvas);
      this.captions.set(stage, caption);
    }
    side.prepend(panel);

    const folder = gui.addFolder('Diagnostics (dev)');
    const mode = folder.add(this.view, 'mode', ['stages', 'compare', SHIFTED]).onChange(() => this.update());
    folder.add(this.view, 'direction', [...DIRECTIONS]).onChange(() => this.update());
    folder.add(this.view, 'frame', 0, 11, 1).onChange(() => this.update());
    folder.add(this.view, 'ground', Object.keys(GROUNDS)).name('compare ground').onChange(() => this.update());
    folder.add(this.view, 'set', Object.keys(COMPARISONS)).name('compare set').onChange(() => this.update());
    folder.add({ rerender: () => src.rerender() }, 'rerender').name('↻ render again, keeping passes');
    folder
      .add({ shift: () => void this.shift().then(() => mode.updateDisplay()) }, 'shift')
      .name('⇘ shift frame 1 across a pixel');
  }

  /** Forgets the kept passes; call before rendering the row whose passes keepRaw should keep. */
  beginCapture(): void {
    this.raws.clear();
    this.rawBytes = 0;
  }

  /** For SpriteRenderer.onRawFrame. */
  readonly keepRaw = (f: FrameSamples, buf: Uint8Array): void => {
    const bytes = f.width * f.height * f.ss * f.ss * 2;
    if (this.rawBytes + bytes > RAW_BUDGET_BYTES) return;
    this.rawBytes += bytes;
    this.raws.set(f, compactRaw(buf, f.width, f.height, f.ss, ID_STEP));
  };

  fitWidth(width: number): void {
    this.maxWidth = width;
    this.layout();
  }

  /** Renders the shifted row (see renderShifted) and shows it. */
  async shift(steps = 8): Promise<void> {
    const frames = await this.src.renderShifted(steps);
    if (!frames) return;
    this.shifted = { name: `${this.src.previewed()} frame 1, shifted`, loop: false, frames };
    this.view.mode = SHIFTED;
    this.update();
  }

  /** Shows a view of the previewed row, as scripts comparing configurations need. */
  show(mode: Mode, direction: Direction, frame = 0, ground = this.view.ground, set = this.view.set): void {
    Object.assign(this.view, { mode, direction, frame, ground, set });
    this.update();
  }

  /** The compared configurations' stats for a row (the previewed one by default), with the current coverage and thresholds. */
  report(name = this.src.previewed(), set = this.view.set): RowReport | null {
    const row = this.row(name);
    if (!row) return null;
    const compared = COMPARISONS[set];
    const configs = compared.map((c) => ({ ...this.src.settings(), ...c }));
    const directions: RowReport['directions'] = {};
    for (const [dir, frames] of row.frames) directions[dir] = configs.map((s) => rowStats(frames, row.loop, s, GLOW_RAMPS));
    const per = Object.values(directions);
    const all = configs.map((_, k) => {
      const sum = { ...per[0][k] };
      for (const key of Object.keys(sum) as (keyof RowStats)[]) sum[key] = per.reduce((n, d) => n + d[k][key], 0) / per.length;
      return sum;
    });
    return { row: name, configs: compared.map((c) => c.name), directions, all };
  }

  /** A rendered row by name, or the shifted one as SHIFTED. */
  private row(name: string): DiagnosticsRow | undefined {
    return name === SHIFTED ? (this.shifted ?? undefined) : this.src.rows().find((r) => r.name === name);
  }

  update(): void {
    const row = this.row(this.view.mode === SHIFTED ? SHIFTED : this.src.previewed());
    const frames = row?.frames.get(this.view.direction);
    if (!row || !frames?.length) {
      this.title.textContent = this.view.mode === SHIFTED ? 'press ⇘ shift to render it' : 'nothing rendered yet';
      return;
    }
    this.frameSize = frames[0].width;
    this.stages.hidden = this.view.mode !== 'stages';
    this.compare.hidden = this.view.mode === 'stages';
    if (this.view.mode !== 'stages') this.updateCompare(row, frames);
    else this.updateStages(row, frames);
    this.layout();
  }

  private updateStages(row: DiagnosticsRow, frames: FrameSamples[]): void {
    const s = this.src.settings();
    const palette = this.src.palette();
    const i = Math.min(this.view.frame, frames.length - 1);
    const f = frames[i];
    const finals = frames.map((g) => shadeSprite(g, s));
    const stages = shadeSpriteStages(f, s);
    // a loop's first frame follows its last; a one-shot's has nothing before it
    const prevIndex = i > 0 ? i - 1 : row.loop && frames.length > 1 ? frames.length - 1 : -1;
    const prev = prevIndex >= 0 ? finals[prevIndex] : null;

    const raw = this.raws.get(f);
    put(this.canvases.get('supersampled')!, raw ? rawToRgba(raw, s.thresholds, palette) : null, raw?.width ?? 1, raw?.height ?? 1);
    this.captions.get('supersampled')!.textContent = raw ? `supersampled ${f.ss}×` : 'supersampled (not kept: render again)';
    put(this.canvases.get('coverage')!, coverageToRgba(f, s), f.width, f.height);
    put(this.canvases.get('ramp')!, rampToRgba(f, palette), f.width, f.height);
    put(this.canvases.get('ramp purity')!, purityToRgba(f), f.width, f.height);
    putFrame(this.canvases.get('shaded')!, stages.shaded, palette);
    putFrame(this.canvases.get('outlined')!, stages.outlined, palette);
    putFrame(this.canvases.get('final')!, stages.final, palette);
    put(this.canvases.get('Δ prev frame')!, prev ? diffToRgba(stages.final, prev, palette) : null, f.width, f.height);

    this.title.textContent = `${row.name} · ${this.view.direction} · frame ${i + 1}/${frames.length}`;
    const st = frameStats(f, s);
    const d = prev && frameDiff(prev, stages.final);
    const r = rowStats(frames, row.loop, s, GLOW_RAMPS);
    this.stats.textContent = [
      `min coverage ${minCovered(f.ss, s.coverage)}/${f.ss * f.ss} samples · ${s.downsample ?? 'classic'} · opacity ${f.opacity} · dither phase ${f.phase}`,
      `touched ${st.touched} px · drawn ${st.opaque} · dropped ${st.dropped} (pink) · under the threshold but drawn: cyan`,
      `mixed ${st.mixed} px · ${(st.lostSamples * 100).toFixed(1)}% of drawn samples were of a losing ramp`,
      d ? `vs frame ${prevIndex + 1}: +${d.appeared} −${d.disappeared} ~${d.recoloured} px` : 'first frame of a one-shot: nothing before it',
      frames.length > 1 ? `row average: ${r.changed.toFixed(1)} px changed per frame` : '',
    ].join('\n');
  }

  private updateCompare(row: DiagnosticsRow, frames: FrameSamples[]): void {
    const s = this.src.settings();
    const palette = this.src.palette();
    this.compare.replaceChildren();
    this.compareCanvases = [];
    const ground = GROUNDS[this.view.ground];
    const compared = COMPARISONS[this.view.set];
    this.compare.classList.toggle('ground', !!ground);
    if (ground) this.compare.style.setProperty('--ground', `rgb(${ground.join(' ')})`);
    for (const c of compared) {
      const head = document.createElement('div');
      head.className = 'diagHead';
      head.textContent = c.name;
      this.compare.append(head);
    }
    const contrast = compared.map(() => ({ contrast: 0, lost: 0 }));
    for (const f of frames) {
      compared.forEach((c, k) => {
        const canvas = document.createElement('canvas');
        const final = shadeSprite(f, { ...s, ...c });
        putFrame(canvas, final, palette);
        if (ground) {
          const e = edgeContrast(final, palette, ground);
          contrast[k].contrast += e.contrast / frames.length;
          contrast[k].lost += e.lost / frames.length;
        }
        this.compare.append(canvas);
        this.compareCanvases.push(canvas);
      });
    }
    this.title.textContent = `${row.name} · ${this.view.direction} · ${frames.length} frames`;
    const report = this.report(this.view.mode === SHIFTED ? SHIFTED : row.name)!;
    const here = report.directions[this.view.direction]!;
    const lines = [`${'per frame'.padEnd(27)}${compared.map((c) => c.name.padStart(19)).join('')}`, `${''.padEnd(27)}${'   this dir / all'.padStart(19).repeat(compared.length)}`];
    for (const [key, label, digits] of STAT_ROWS) {
      lines.push(label.padEnd(27) + here.map((h, k) => `${h[key].toFixed(digits)} / ${report.all[k][key].toFixed(digits)}`.padStart(19)).join(''));
    }
    if (ground) {
      lines.push(`edge contrast on ${this.view.ground}`.padEnd(27) + contrast.map((c) => c.contrast.toFixed(3).padStart(19)).join(''));
      lines.push('edge px lost on it'.padEnd(27) + contrast.map((c) => `${(c.lost * 100).toFixed(0)}%`.padStart(19)).join(''));
    }
    this.stats.textContent = lines.join('\n');
  }

  /** Whole-pixel zoom for every stage, so a sprite pixel is as big in each, the supersampled one included. */
  private layout(): void {
    const column = Math.floor((this.maxWidth - (COLUMNS - 1) * GAP) / COLUMNS);
    const fs = this.frameSize;
    const px = column >= fs ? Math.floor(column / fs) * fs : column;
    for (const canvas of [...this.canvases.values(), ...this.compareCanvases]) canvas.style.width = `${px}px`;
  }
}

function figure(caption: string): [HTMLElement, HTMLCanvasElement, HTMLElement] {
  const fig = document.createElement('figure');
  const canvas = document.createElement('canvas');
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  fig.append(canvas, cap);
  return [fig, canvas, cap];
}

function putFrame(canvas: HTMLCanvasElement, f: IndexedFrame, palette: RGB[]): void {
  put(canvas, indexedToRgba(f.data, palette), f.width, f.height);
}

function put(canvas: HTMLCanvasElement, data: Uint8ClampedArray | null, w: number, h: number): void {
  canvas.width = w;
  canvas.height = h;
  if (data) canvas.getContext('2d')!.putImageData(new ImageData(data, w, h), 0, 0);
}
