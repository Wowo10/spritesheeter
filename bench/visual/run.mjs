#!/usr/bin/env node
// The visual benchmark: captures the units with the app (Vite dev server + headless Firefox), then
// renders the comparison images and the metrics from what was captured. See README.md.
//
//   node bench/visual/run.mjs [--out DIR] [--skip-capture] [--capture-only] [--only unit,unit] [--firefox PATH]
import { writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { capture, freePort } from './capture.mjs';
import { UNITS } from './presets.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const outDir = resolve(root, value('--out', 'bench-output/visual'));
const only = value('--only', '')
  .split(',')
  .filter(Boolean);
const firefox = value('--firefox', process.env.FIREFOX ?? 'firefox');
const log = (s) => console.error(s);
const unknown = only.filter((n) => !UNITS.some((u) => u.name === n));
if (unknown.length) throw new Error(`unknown units: ${unknown.join(', ')} (see presets.mjs)`);

const port = await freePort();
const server = await createServer({ root, logLevel: 'warn', clearScreen: false, server: { port, strictPort: true, host: '127.0.0.1' } });
await server.listen();
const t0 = performance.now();
try {
  if (!flag('--skip-capture')) {
    log(`capture → ${relative(root, outDir)}/samples (Firefox: ${firefox})`);
    await capture({ baseUrl: `http://127.0.0.1:${port}/`, units: UNITS.filter((u) => !only.length || only.includes(u.name)), outDir, firefox, log });
  } else if (!existsSync(join(outDir, 'samples'))) {
    throw new Error(`--skip-capture: nothing captured in ${outDir}/samples yet`);
  }
  if (!flag('--capture-only')) {
    // the offline steps are TypeScript importing the app's modules: load them through Vite, as the app is
    log('render');
    const { render } = await server.ssrLoadModule('/bench/visual/render.ts');
    await render({ outDir, only: only.length ? only : undefined, log });
    if (!only.length) {
      log('metrics');
      const { metrics } = await server.ssrLoadModule('/bench/visual/metrics.ts');
      metrics(outDir, log);
    }
  }
  // hashes of everything written, to check a later run reproduces this one
  const { sha256 } = await server.ssrLoadModule('/bench/visual/lib.ts');
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (f.startsWith('.')) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (f !== 'manifest.json') files.push(p);
    }
  };
  walk(outDir);
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(Object.fromEntries(files.map((f) => [relative(outDir, f), sha256(f)])), null, 1));
  log(`done in ${((performance.now() - t0) / 1000).toFixed(0)} s: ${relative(root, outDir)}/ (${files.length} files, hashes in manifest.json)`);
} finally {
  await server.close();
}
