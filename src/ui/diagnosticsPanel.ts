import type GUI from 'lil-gui';
import { indexedToRgba } from '../export/packer';
import { compactRaw, coverageToRgba, diffToRgba, frameDiff, frameStats, purityToRgba, rampToRgba, rawToRgba, type RawFrame } from '../render/diagnostics';
import { ID_STEP } from '../render/materials';
import type { RGB } from '../render/palette';
import { minCovered, type FrameSamples, type IndexedFrame, type PostprocessSettings } from '../render/postprocess';
import { DIRECTIONS, shadeSpriteStages, type Direction } from '../render/spriteRenderer';

/** What the panel shows: the previewed row as rendered, before it's shaded. */
export interface DiagnosticsSource {
  row(): { name: string; loop: boolean; frames: Map<Direction, FrameSamples[]> } | undefined;
  settings(): PostprocessSettings;
  palette(): RGB[];
  /** Renders everything again, keeping the previewed row's supersampled passes. */
  rerender(): void;
}

/** Most memory the kept supersampled passes may take; big frames keep only the first few. */
const RAW_BUDGET_BYTES = 64 * 1024 * 1024;

const STAGES = ['supersampled', 'coverage', 'ramp', 'ramp purity', 'shaded', 'outlined', 'final', 'Δ prev frame'] as const;
type Stage = (typeof STAGES)[number];

const COLUMNS = 4;
const GAP = 6;

/**
 * Development only (opened with ?diag): one frame of the previewed row at every step of its
 * post-processing, side by side, with counts of what each step lost. Changing the outline,
 * coverage or thresholds shades it again without rendering; the supersampled pass is kept for
 * the previewed row only, as it's rendered.
 */
export class DiagnosticsPanel {
  private readonly view = { direction: 'S' as Direction, frame: 0 };
  private readonly raws = new Map<FrameSamples, RawFrame>();
  private rawBytes = 0;
  private readonly canvases = new Map<Stage, HTMLCanvasElement>();
  private readonly captions = new Map<Stage, HTMLElement>();
  private readonly title: HTMLElement;
  private readonly stats: HTMLElement;
  private maxWidth = 400;
  private frameSize = 32;

  constructor(
    gui: GUI,
    side: HTMLElement,
    private readonly src: DiagnosticsSource,
  ) {
    const panel = document.createElement('div');
    panel.className = 'panel diagnostics';
    panel.innerHTML = '<h2>Diagnostics <span></span></h2><div class="diagGrid"></div><pre class="diagStats"></pre>';
    this.title = panel.querySelector('h2 span')!;
    this.stats = panel.querySelector('.diagStats')!;
    const grid = panel.querySelector('.diagGrid')!;
    for (const stage of STAGES) {
      const fig = document.createElement('figure');
      const canvas = document.createElement('canvas');
      const caption = document.createElement('figcaption');
      caption.textContent = stage;
      fig.append(canvas, caption);
      grid.append(fig);
      this.canvases.set(stage, canvas);
      this.captions.set(stage, caption);
    }
    side.prepend(panel);

    const folder = gui.addFolder('Diagnostics (dev)');
    folder.add(this.view, 'direction', [...DIRECTIONS]).onChange(() => this.update());
    folder.add(this.view, 'frame', 0, 11, 1).onChange(() => this.update());
    folder.add({ rerender: () => src.rerender() }, 'rerender').name('↻ render again, keeping passes');
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

  update(): void {
    const row = this.src.row();
    const frames = row?.frames.get(this.view.direction);
    if (!row || !frames?.length) {
      this.title.textContent = 'nothing rendered yet';
      return;
    }
    const s = this.src.settings();
    const palette = this.src.palette();
    const i = Math.min(this.view.frame, frames.length - 1);
    const f = frames[i];
    const finals = frames.map((g) => shadeSpriteStages(g, s).final);
    const stages = shadeSpriteStages(f, s);
    // a loop's first frame follows its last; a one-shot's has nothing before it
    const prevIndex = i > 0 ? i - 1 : row.loop && frames.length > 1 ? frames.length - 1 : -1;
    const prev = prevIndex >= 0 ? finals[prevIndex] : null;

    this.frameSize = f.width;
    const raw = this.raws.get(f);
    this.put('supersampled', raw ? rawToRgba(raw, s.thresholds, palette) : null, raw?.width ?? 1, raw?.height ?? 1);
    this.captions.get('supersampled')!.textContent = raw ? `supersampled ${f.ss}×` : 'supersampled (not kept: render again)';
    this.put('coverage', coverageToRgba(f, s.coverage), f.width, f.height);
    this.put('ramp', rampToRgba(f, palette), f.width, f.height);
    this.put('ramp purity', purityToRgba(f), f.width, f.height);
    this.putFrame('shaded', stages.shaded, palette);
    this.putFrame('outlined', stages.outlined, palette);
    this.putFrame('final', stages.final, palette);
    this.put('Δ prev frame', prev ? diffToRgba(stages.final, prev, palette) : null, f.width, f.height);
    this.layout();

    this.title.textContent = `${row.name} · ${this.view.direction} · frame ${i + 1}/${frames.length}`;
    const st = frameStats(f, s);
    const d = prev && frameDiff(prev, stages.final);
    // how much the row changes from frame to frame in this direction, wrapping for loops
    let changes = 0;
    let steps = 0;
    for (let k = row.loop ? 0 : 1; k < finals.length && finals.length > 1; k++, steps++) {
      const c = frameDiff(finals[(k + finals.length - 1) % finals.length], finals[k]);
      changes += c.appeared + c.disappeared + c.recoloured;
    }
    this.stats.textContent = [
      `min coverage ${minCovered(f.ss, s.coverage)}/${f.ss * f.ss} samples · opacity ${f.opacity} · dither phase ${f.phase}`,
      `touched ${st.touched} px · drawn ${st.opaque} · dropped ${st.dropped} (pink)`,
      `mixed ${st.mixed} px · ${(st.lostSamples * 100).toFixed(1)}% of drawn samples were of a losing ramp`,
      d ? `vs frame ${prevIndex + 1}: +${d.appeared} −${d.disappeared} ~${d.recoloured} px` : 'first frame of a one-shot: nothing before it',
      steps ? `row average: ${(changes / steps).toFixed(1)} px changed per frame` : '',
    ].join('\n');
  }

  private putFrame(stage: Stage, f: IndexedFrame, palette: RGB[]): void {
    this.put(stage, indexedToRgba(f.data, palette), f.width, f.height);
  }

  private put(stage: Stage, data: Uint8ClampedArray | null, w: number, h: number): void {
    const canvas = this.canvases.get(stage)!;
    canvas.width = w;
    canvas.height = h;
    if (data) canvas.getContext('2d')!.putImageData(new ImageData(data, w, h), 0, 0);
  }

  /** Whole-pixel zoom for every stage, so a sprite pixel is as big in each, the supersampled one included. */
  private layout(): void {
    const column = Math.floor((this.maxWidth - (COLUMNS - 1) * GAP) / COLUMNS);
    const fs = this.frameSize;
    const px = column >= fs ? Math.floor(column / fs) * fs : column;
    for (const canvas of this.canvases.values()) canvas.style.width = `${px}px`;
  }
}
