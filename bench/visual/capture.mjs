// Capture: drives headless Firefox over WebDriver BiDi against the dev server's ?diag page and saves
// each unit's rendered rows as FrameSamples (the input to shading, before outline and coverage),
// with the sprite settings the page rendered them with.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { unitUrl } from './presets.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A TCP port nothing is listening on right now. */
export function freePort() {
  return new Promise((ok, no) => {
    const s = createServer();
    s.on('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** Serialises the page's rows: typed arrays as plain arrays. Runs in the page. */
const SERIALISE = `(rows) => JSON.stringify(rows.map((r) => ({
  name: r.name,
  loop: r.loop,
  frames: Object.fromEntries([...r.frames].map(([d, fs]) => [d, fs.map((f) => ({ ...f, ramp: [...f.ramp], covered: [...f.covered], count: [...f.count], light: [...f.light] }))])),
})))`;

/**
 * Captures `units` from the app at `baseUrl` into `<outDir>/samples/<name>.json`.
 * `firefox` is the browser's executable; `profileDir` a scratch profile, deleted afterwards.
 */
export async function capture({ baseUrl, units, outDir, firefox = 'firefox', log = console.error }) {
  const samplesDir = `${outDir}/samples`;
  mkdirSync(samplesDir, { recursive: true });
  const profile = `${outDir}/.firefox-profile`;
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const port = await freePort();
  const ff = spawn(firefox, ['--headless', '--no-remote', '--window-size=1800,1500', '--profile', profile, `--remote-debugging-port=${port}`], { stdio: 'ignore' });
  let exited = null;
  ff.on('exit', (code) => (exited = code ?? 'signal'));
  ff.on('error', (e) => (exited = e.message));
  try {
    let ws = null;
    for (let i = 0; i < 60 && !ws; i++) {
      await sleep(500);
      if (exited !== null) throw new Error(`Firefox (${firefox}) exited before it could be driven: ${exited}`);
      try {
        const sock = new WebSocket(`ws://127.0.0.1:${port}/session`);
        await new Promise((ok, no) => ((sock.onopen = ok), (sock.onerror = no)));
        ws = sock;
      } catch {
        // not listening yet
      }
    }
    if (!ws) throw new Error(`Firefox's WebDriver BiDi endpoint didn't come up on port ${port}`);
    let id = 0;
    const waiting = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)(m);
        waiting.delete(m.id);
      }
    };
    const send = (method, params) =>
      new Promise((ok, no) => {
        const i = ++id;
        waiting.set(i, (m) => (m.type === 'error' ? no(new Error(`${method}: ${m.error} ${m.message}`)) : ok(m.result)));
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    await send('session.new', { capabilities: {} });
    const context = (await send('browsingContext.getTree', {})).contexts[0].context;
    const evaluate = async (expression) => {
      const r = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' });
      if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };

    for (const u of units) {
      const url = unitUrl(baseUrl, u);
      await send('browsingContext.navigate', { context, url, wait: 'complete' });
      let ready = false;
      for (let i = 0; i < 240 && !ready; i++) {
        ready = await evaluate('!!window.ssheetDev');
        if (!ready) await sleep(250);
      }
      if (!ready) throw new Error(`${u.name}: the page never exposed ssheetDev (is it the dev server, with ?diag?)`);
      // the panel renders again once it's loaded; wait for every render to settle
      await evaluate('(async () => { await new Promise((r) => setTimeout(r, 300)); await ssheetDev.settled(); return 1 })()');
      const rows = JSON.parse(await evaluate(`(${SERIALISE})(ssheetDev.diagnostics.src.rows().filter((r) => ${JSON.stringify(u.rows)}.includes(r.name)))`));
      const missing = u.rows.filter((r) => !rows.some((x) => x.name === r));
      if (missing.length) throw new Error(`${u.name}: rows not rendered: ${missing.join(', ')}`);
      // rows in the order the benchmark lists them, whatever order the page has them in
      rows.sort((a, b) => u.rows.indexOf(a.name) - u.rows.indexOf(b.name));
      const sprite = JSON.parse(await evaluate('JSON.stringify(ssheetDev.state.sprite)'));
      const lighting = JSON.parse(await evaluate('JSON.stringify(ssheetDev.state.lighting)'));
      writeFileSync(`${samplesDir}/${u.name}.json`, JSON.stringify({ name: u.name, kind: u.kind, preset: u.preset, url: url.slice(url.indexOf('?')), sprite, lighting, rows }));
      log(`  captured ${u.name}: ${rows.map((r) => `${r.name} ${Object.keys(r.frames).length}×${r.frames.S?.length}`).join(', ')} · ${sprite.frameSize} px, ${sprite.pixelsPerUnit} px/unit`);
    }
    ws.close();
  } finally {
    ff.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}
