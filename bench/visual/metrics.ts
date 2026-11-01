// Metrics: per row and direction, in every configuration (and Gap Black with pinholes left open,
// for reference), the diagnostics' row stats and edge contrast, plus what the images are checked for:
// enclosed holes, silhouette changes from Ridge, and invariants of Gap Black. Writes metrics.json and
// metrics.md. Aggregates are computed as FINAL_VISUAL_VALIDATION.md computed them, so they compare.
import { writeFileSync } from 'node:fs';
import { edgeContrast, stageStats, type RowStats } from '../../src/render/diagnostics';
import { holes } from '../../src/render/gapOutline';
import type { IndexedFrame, ShadeStages } from '../../src/render/postprocess';
import { CONFIGS, DIRS, GROUNDS, loadUnit, palette, REFERENCES, stagesFor, UNITS, type Config } from './lib';

const ALL: Config[] = [...CONFIGS, ...REFERENCES];

/** 8-connected pieces of drawn pixels, and how many of them are a single pixel. */
function pieces(f: IndexedFrame) {
  const { width: w, height: h, data: d } = f;
  const seen = new Uint8Array(w * h);
  let count = 0;
  let isolated = 0;
  for (let p = 0; p < d.length; p++) {
    if (!d[p] || seen[p]) continue;
    count++;
    let n = 0;
    const stack = [p];
    seen[p] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      n++;
      const [x, y] = [q % w, Math.floor(q / w)];
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const r = yy * w + xx;
          if (d[r] && !seen[r]) (seen[r] = 1), stack.push(r);
        }
    }
    if (n === 1) isolated++;
  }
  return { count, isolated };
}

function bbox(f: IndexedFrame) {
  let [x0, y0, x1, y1] = [1e9, 1e9, -1, -1];
  f.data.forEach((v, i) => {
    if (!v) return;
    const [x, y] = [i % f.width, Math.floor(i / f.width)];
    [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  });
  return [x1 - x0 + 1, y1 - y0 + 1];
}

/** Whether all 8 neighbours of pixel i are drawn: shut in diagonally as well. */
function shutIn8(f: IndexedFrame, i: number): boolean {
  const { width: w, data: d } = f;
  const [x, y] = [i % w, Math.floor(i / w)];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !d[(y + dy) * w + x + dx]) return false;
  return true;
}

interface FrameEvent {
  unit: string;
  row: string;
  dir: string;
  frame: number;
  /** Per configuration: enclosed 1 px holes still open in the final frame. */
  pinholesOpen: number[];
  /** Enclosed holes in the silhouette (classic), by size up to 4. */
  holes: number[];
  /** Of the 1 px ones: shut in on all 8 sides. */
  pinholes8: number;
}

export interface Metrics {
  configs: string[];
  rows: { unit: string; row: string; frameSize: number; ppu: number; stats: Record<string, RowStats[]>; contrast: Record<string, { contrast: number; lost: number }[][]> }[];
  events: FrameEvent[];
  ridge: { isolated: [number, number]; pieces: [number, number]; drawn: [number, number]; added: number; removed: number; bboxChanged: number; bboxFrames: string[] };
  pinholePersistence: { holes: number; stillThereNextFrame: number };
  invariants: Record<string, number>;
}

export function measure(outDir: string, log = console.error): Metrics {
  const pal = palette();
  const m: Metrics = {
    configs: ALL.map((c) => c.name),
    rows: [],
    events: [],
    ridge: { isolated: [0, 0], pieces: [0, 0], drawn: [0, 0], added: 0, removed: 0, bboxChanged: 0, bboxFrames: [] },
    pinholePersistence: { holes: 0, stillThereNextFrame: 0 },
    invariants: { 'Gap Black outline px the outer outline would not draw': 0, 'Gap Black px differing from pinholes-open other than at a 1 px hole': 0, 'Gap Black silhouette px differing from Outer': 0, 'useful gap px (between parts) closed by the pinhole fill': 0 },
  };
  for (const spec of UNITS) {
    const u = loadUnit(outDir, spec.name);
    for (const row of u.rows) {
      const r: Metrics['rows'][number] = { unit: u.name, row: row.name, frameSize: u.sprite.frameSize, ppu: u.sprite.pixelsPerUnit, stats: {}, contrast: {} };
      for (const dir of DIRS) {
        const frames = row.frames[dir];
        const st: ShadeStages[][] = ALL.map((c) => frames.map((f) => stagesFor(u, f, c)));
        r.stats[dir] = st.map((s) => stageStats(s, row.loop));
        r.contrast[dir] = st.map((s) =>
          Object.values(GROUNDS).map((g) => {
            const e = s.map((x) => edgeContrast(x.final, pal, g));
            return { contrast: e.reduce((a, b) => a + b.contrast, 0) / e.length, lost: e.reduce((a, b) => a + b.lost, 0) / e.length };
          }),
        );
        const hs = st[0].map((s) => holes(s.shaded));
        frames.forEach((_, k) => {
          const [co, cg, ro, rg, cgRef, rgRef] = st.map((s) => s[k]);
          const h = hs[k];
          const sizes = [0, 0, 0, 0];
          let pinholes8 = 0;
          h.forEach((n, i) => {
            if (!n || n > 4) return;
            if (n === 1) {
              if (shutIn8(co.shaded, i)) pinholes8++;
              m.pinholePersistence.holes++;
              if (hs[(k + 1) % hs.length][i] === 1) m.pinholePersistence.stillThereNextFrame++;
            }
            // each of a hole's n pixels counts 1/n of it
            sizes[n - 1] += 1 / n;
          });
          const pinOpen = (s: ShadeStages) => {
            const ph = s === ro || s === rg || s === rgRef ? holes(s.shaded) : h;
            let n = 0;
            ph.forEach((v, i) => v === 1 && !s.final.data[i] && n++);
            return n;
          };
          m.events.push({ unit: u.name, row: row.name, dir, frame: k + 1, pinholesOpen: [co, cg, ro, rg, cgRef, rgRef].map(pinOpen), holes: sizes, pinholes8 });

          // Ridge against Classic, before the outline
          const [pc, pr] = [pieces(co.shaded), pieces(ro.shaded)];
          m.ridge.isolated[0] += pc.isolated;
          m.ridge.isolated[1] += pr.isolated;
          m.ridge.pieces[0] += pc.count;
          m.ridge.pieces[1] += pr.count;
          co.shaded.data.forEach((v, i) => {
            const w = ro.shaded.data[i];
            if (v) m.ridge.drawn[0]++;
            if (w) m.ridge.drawn[1]++;
            if (!v && w) m.ridge.added++;
            if (v && !w) m.ridge.removed++;
          });
          const [bc, br] = [bbox(co.shaded), bbox(ro.shaded)];
          if (bc[0] !== br[0] || bc[1] !== br[1]) {
            m.ridge.bboxChanged++;
            m.ridge.bboxFrames.push(`${u.name}/${row.name}/${dir}/f${k + 1}: ${bc.join('×')} → ${br.join('×')}`);
          }

          // Gap Black invariants, on both coverages
          for (const [outer, gb, ref] of [
            [co, cg, cgRef],
            [ro, rg, rgRef],
          ]) {
            const ph = holes(gb.shaded);
            gb.outlined.data.forEach((v, i) => {
              if (gb.shaded.data[i] !== outer.shaded.data[i]) m.invariants['Gap Black silhouette px differing from Outer']++;
              if (v && !gb.shaded.data[i] && outer.outlined.data[i] !== v) m.invariants['Gap Black outline px the outer outline would not draw']++;
              if (v !== ref.outlined.data[i] && ph[i] !== 1) m.invariants['Gap Black px differing from pinholes-open other than at a 1 px hole']++;
            });
          }
        });
        // a pinhole's sides always join, so filling it never closes a gap between separate parts
        for (const [gb, ref] of [
          [3, 5],
          [1, 4],
        ]) {
          const d = r.stats[dir][ref].partGapsOpen - r.stats[dir][gb].partGapsOpen;
          if (Math.abs(d) > 1e-9) m.invariants['useful gap px (between parts) closed by the pinhole fill'] += d * frames.length;
        }
      }
      m.rows.push(r);
    }
    log(`  measured ${spec.name}`);
  }
  return m;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const pct = (a: number, b: number) => `${a / b - 1 >= 0 ? '+' : '−'}${Math.abs((a / b - 1) * 100).toFixed(2)}%`;

/** The summary FINAL_VISUAL_VALIDATION.md reports, from the same aggregates. */
export function summarise(m: Metrics): string {
  const n = m.configs.length;
  const rowAvg = (r: Metrics['rows'][number], k: number, key: keyof RowStats) => avg(DIRS.map((d) => r.stats[d][k][key]));
  const out: string[] = ['# Visual benchmark metrics', '', `${m.rows.length} rows, ${m.events.length} frames per configuration. Generated by \`npm run bench:visual\`; see bench/visual/README.md.`, ''];

  const changed = Array.from({ length: n }, (_, k) => m.rows.reduce((s, r) => s + rowAvg(r, k, 'changed'), 0));
  const sum = (k: number, key: keyof RowStats) => m.rows.reduce((s, r) => s + rowAvg(r, k, key), 0);
  const frames = (pred: (e: FrameEvent) => boolean) => m.events.filter(pred).length;
  out.push('## Totals', '', `| | ${m.configs.join(' | ')} |`, `|---|${'---|'.repeat(n)}`);
  out.push(`| px changing per frame step (sum over rows) | ${changed.map((c, k) => `${c.toFixed(1)}${k ? ` (${pct(c, changed[0])})` : ''}`).join(' | ')} |`);
  out.push(`| enclosed 1 px holes left open (px, all frames) | ${Array.from({ length: n }, (_, k) => m.events.reduce((s, e) => s + e.pinholesOpen[k], 0)).join(' | ')} |`);
  out.push(`| frames with a 1 px hole left open | ${Array.from({ length: n }, (_, k) => frames((e) => e.pinholesOpen[k] > 0)).join(' | ')} |`);
  for (const [key, label] of [
    ['gapsOpen', 'narrow-gap px open per frame (sum over rows)'],
    ['gaps', 'narrow-gap px per frame'],
    ['partGapsOpen', 'of them between separate parts, open'],
    ['dentsOpen', 'of them dents, open'],
    ['filled', 'outline px filling gaps or holes'],
    ['bare', 'edge sides left bare'],
    ['thin', '1 px wide px'],
  ] as [keyof RowStats, string][])
    out.push(`| ${label} | ${Array.from({ length: n }, (_, k) => sum(k, key).toFixed(1)).join(' | ')} |`);
  Object.keys(GROUNDS).forEach((g, gi) => {
    const v = Array.from({ length: n }, (_, k) => {
      const cs = m.rows.flatMap((r) => DIRS.map((d) => r.contrast[d][k][gi]));
      return `${avg(cs.map((c) => c.contrast)).toFixed(3)} / ${(avg(cs.map((c) => c.lost)) * 100).toFixed(1)}%`;
    });
    out.push(`| edge contrast on ${g} (mean \\|Δluma\\| / edge px lost) | ${v.join(' | ')} |`);
  });

  out.push('', '## Changing px per frame step, per row (mean over directions)', '', `| row | ${m.configs.join(' | ')} |`, `|---|${'---|'.repeat(n)}`);
  for (const r of m.rows) {
    const c = Array.from({ length: n }, (_, k) => rowAvg(r, k, 'changed'));
    out.push(`| ${r.unit} ${r.row} | ${c.map((x, k) => (k ? pct(x, c[0]) : x.toFixed(1))).join(' | ')} |`);
  }

  const hs = [0, 1, 2, 3].map((s) => m.events.reduce((a, e) => a + e.holes[s], 0));
  const p8 = m.events.reduce((a, e) => a + e.pinholes8, 0);
  out.push(
    '',
    '## Enclosed holes (Classic silhouette)',
    '',
    `- Frames with an enclosed hole of 1–4 px: ${frames((e) => e.holes.some(Boolean))} of ${m.events.length}.`,
    `- Holes by size 1 / 2 / 3 / 4 px: ${hs.join(' / ')}.`,
    `- 1 px holes in ${frames((e) => e.holes[0] > 0)} frames; ${m.pinholePersistence.stillThereNextFrame} of ${m.pinholePersistence.holes} still a 1 px hole at the same pixel in the next frame.`,
    `- Of the 1 px holes, ${p8} are shut in on all 8 sides, ${hs[0] - p8} open to another transparent pixel diagonally.`,
  );

  out.push(
    '',
    '## Ridge against Classic (silhouette before the outline, all frames)',
    '',
    `- Isolated pixels: ${m.ridge.isolated.join(' → ')}; separate pieces: ${m.ridge.pieces.join(' → ')}.`,
    `- Drawn px: ${m.ridge.drawn.join(' → ')} (${m.ridge.added} added, ${m.ridge.removed} removed, ${pct(m.ridge.drawn[1], m.ridge.drawn[0])}).`,
    `- Bounding box changed in ${m.ridge.bboxChanged} frames.`,
  );

  out.push('', '## Invariants (should all be 0)', '');
  for (const [k, v] of Object.entries(m.invariants)) out.push(`- ${k}: ${Math.round(v)}`);

  const left = m.events.filter((e) => e.pinholesOpen[1] || e.pinholesOpen[3]);
  out.push('', `## Frames where Gap Black still leaves a 1 px hole open (${left.length})`, '');
  for (const e of left.slice(0, 60)) out.push(`- ${e.unit} ${e.row} ${e.dir} f${e.frame}: classic ${e.pinholesOpen[1]}, ridge ${e.pinholesOpen[3]}`);
  if (left.length > 60) out.push(`- … ${left.length - 60} more in metrics.json`);
  return out.join('\n') + '\n';
}

export function metrics(outDir: string, log = console.error): void {
  const m = measure(outDir, log);
  writeFileSync(`${outDir}/metrics.json`, JSON.stringify(m));
  writeFileSync(`${outDir}/metrics.md`, summarise(m));
  log(`  metrics.json, metrics.md`);
}
