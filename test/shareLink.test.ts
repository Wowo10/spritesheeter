import { describe, expect, it } from 'vitest';
import { downscaleFrame, type PostprocessSettings } from '../src/render/postprocess';
import { decodeSettings, encodeSettings, mergeSettings, SHARE_PARAM } from '../src/share';
import { FORMATS, readShareLink, SHARE_VERSION, ShareLinkError, shareLinkSettings, shareParam, withShareParam } from '../src/shareLink';
import { defaultSettings, paramsKey, presetParams, SHARE_CHOICES, SHARED_KEYS, type SharedSettings } from '../src/settings';
import { KINDS, type AnyParams, type Kind } from '../src/subjects';
import { UNVERSIONED, V1, V2 } from './fixtures/shareLinks';
import { art, STEP } from './passes';

const startup = () => defaultSettings();
const read = (payload: unknown) => readShareLink(encodeSettings(payload), startup());
const PARAMS_KEYS = new Set<string>(KINDS.map(paramsKey));
/** Every version a link can have: none, then 1 to the current one. */
const VERSIONS = [undefined, ...Array.from({ length: SHARE_VERSION }, (_, i) => i + 1)];
const versioned = (v: number | undefined, payload: object) => (v === undefined ? payload : { v, ...payload });

/**
 * The decoder before links were versioned (main.ts, c6acb81), but onto a copy of `start`
 * rather than the page's state: links without v, or with any v but 2, merged onto the startup
 * settings; v2 links merged onto the unit their preset and seed give.
 */
function preVersioningRead(text: string, start: SharedSettings): SharedSettings {
  const decoded = decodeSettings(text);
  const shared = structuredClone(start) as unknown as Record<string, unknown>;
  mergeSettings(shared, decoded, SHARE_CHOICES);
  if ((decoded as { v?: unknown }).v === 2) {
    const kind = shared.kind as Kind;
    const key = paramsKey(kind);
    shared[key] = presetParams(kind, shared.preset as string, (shared[key] as AnyParams).seed);
    mergeSettings(shared, decoded, SHARE_CHOICES);
  }
  return shared as unknown as SharedSettings;
}

describe('defaults', () => {
  it('new projects use Ridge + Gap Black, pinholes filled', () => {
    expect(startup().sprite).toMatchObject({ outline: 'gapBlack', downsample: 'ridge', pinholes: 'fill' });
  });

  it('records every shared setting in the order undo and links always had', () => {
    expect(SHARED_KEYS).toEqual(['kind', 'preset', 'unit', 'beast', 'mounted', 'vehicle', 'building', 'frames', 'decayHold', 'sprite', 'lighting', 'portrait', 'previewAnim', 'exportAnims', 'teamMask', 'team']);
  });

  it('the startup settings can be copied as they are', () => {
    expect(structuredClone(startup())).toEqual(startup());
  });
});

describe('share link formats', () => {
  it('writes new links as v4', () => {
    expect(SHARE_VERSION).toBe(4);
    expect(shareLinkSettings(startup(), startup())).toEqual({ v: 4, unit: { seed: 1 } });
  });

  it('reads every version from none to the current one', () => {
    expect(Object.keys(FORMATS).sort()).toEqual([...VERSIONS.slice(1).map(String), 'unversioned'].sort());
    for (const v of VERSIONS) expect(read(versioned(v, {})).format.version).toBe(v ?? null);
  });

  it.each(VERSIONS)('v%s: what a link leaves out takes the current defaults', (v) => {
    const { settings } = read(versioned(v, {}));
    expect(settings).toEqual(startup());
    expect(settings.sprite).toMatchObject({ outline: 'gapBlack', downsample: 'ridge', pinholes: 'fill' });
  });

  it.each(VERSIONS)('v%s: explicit outline, downsample and pinholes are kept', (v) => {
    for (const outline of ['none', 'inner', 'outer', 'colored', 'stableColored', 'gapBlack'])
      for (const downsample of ['classic', 'ridge'])
        for (const pinholes of ['fill', 'open']) {
          const { settings } = read(versioned(v, { sprite: { outline, downsample, pinholes } }));
          expect([settings.sprite.outline, settings.sprite.downsample, settings.sprite.pinholes]).toEqual([outline, downsample, pinholes]);
        }
    // each alone: the others at the defaults
    expect(read(versioned(v, { sprite: { outline: 'inner' } })).settings.sprite).toMatchObject({ outline: 'inner', downsample: 'ridge', pinholes: 'fill' });
    expect(read(versioned(v, { sprite: { downsample: 'classic' } })).settings.sprite).toMatchObject({ outline: 'gapBlack', downsample: 'classic', pinholes: 'fill' });
    expect(read(versioned(v, { sprite: { outline: 'gapBlack' } })).settings.sprite.pinholes).toBe('fill');
    expect(read(versioned(v, { sprite: { pinholes: 'open' } })).settings.sprite).toMatchObject({ outline: 'gapBlack', downsample: 'ridge', pinholes: 'open' });
  });
});

describe('legacy links', () => {
  const all = { UNVERSIONED, ...Object.fromEntries(Object.entries(V1).map(([k, v]) => [`v1 ${k}`, v])), ...Object.fromEntries(Object.entries(V2).map(([k, v]) => [`v2 ${k}`, v])) };

  it.each(Object.entries(all))('%s decodes as the pre-versioning decoder would over the current defaults', (_, text) => {
    expect(readShareLink(text, startup()).settings).toEqual(preVersioningRead(text, startup()));
  });

  it('takes the text as it is, and leaves the startup settings alone', () => {
    const start = startup();
    const text = V2.mage;
    readShareLink(text, start);
    expect(text).toBe(V2.mage);
    expect(start).toEqual(startup());
  });

  it('a link without v is unversioned: its fields go over the startup settings, the unit included', () => {
    const { format, settings } = readShareLink(UNVERSIONED, startup());
    expect(format).toBe(FORMATS.unversioned);
    expect(settings.preset).toBe('mage');
    // not regenerated from the preset: as before, a link without v carries its unit itself
    expect(settings.unit).toEqual(startup().unit);
    expect(settings.sprite).toEqual({ ...startup().sprite, outline: 'outer' });
    expect(settings.team).toBe('blue');
  });

  it("v1: everything as the link has it; what it predates (downsample, pinholes) at today's defaults", () => {
    const { format, settings } = readShareLink(V1.archer, startup());
    expect(format).toBe(FORMATS[1]);
    const link = decodeSettings(V1.archer) as Record<string, Record<string, unknown>>;
    expect(settings.preset).toBe('archer');
    expect(settings.unit).toEqual({ ...startup().unit, ...link.unit });
    expect(settings.sprite).toEqual({ ...link.sprite, downsample: 'ridge', pinholes: 'fill' });
    expect(settings.lighting).toEqual(link.lighting);
    expect(settings.previewAnim).toBe('attack');
    expect(settings.team).toBe('blue');
    const d = startup();
    expect(settings.frames).toEqual({ ...d.frames, ...link.frames });
    expect([settings.kind, settings.decayHold, settings.portrait, settings.exportAnims, settings.teamMask]).toEqual([d.kind, d.decayHold, d.portrait, d.exportAnims, d.teamMask]);
  });

  it('v1 unchanged keeps the Inner outline it spells out, with Ridge it predates', () => {
    expect(readShareLink(V1.defaults, startup()).settings).toEqual({ ...startup(), sprite: { ...startup().sprite, outline: 'inner' } });
  });

  it('v2 unchanged, which spells out nothing, opens with the current defaults: Ridge + Gap Black', () => {
    expect(readShareLink(V2.defaults, startup()).settings).toEqual(startup());
  });

  it("v2: the preset's unit at the seed, and what the link changes", () => {
    const { format, settings } = readShareLink(V2.mage, startup());
    expect(format).toBe(FORMATS[2]);
    expect(settings.unit).toEqual(presetParams('humanoid', 'mage', 7));
    expect(settings.sprite).toEqual({ ...startup().sprite, outline: 'outer' });
    expect(settings.team).toBe('green');
    expect(settings.portrait.zoom).toBe(1.5);
    expect(settings.exportAnims).toEqual({ ...startup().exportAnims, cast: true });
  });

  it('v2 of another kind', () => {
    const { settings } = readShareLink(V2.wolf, startup());
    expect(settings.kind).toBe('beast');
    expect(settings.beast).toEqual(presetParams('beast', 'wolf', 42));
    expect(settings.frames.walk).toBe(7);
    expect(settings.unit).toEqual(startup().unit);
  });

  it('v2 Gap Black now fills pinholes', () => {
    const { settings } = readShareLink(V2.gapBlackRidge, startup());
    expect(settings.sprite).toEqual({ ...startup().sprite, outline: 'gapBlack', downsample: 'ridge', pinholes: 'fill' });
    expect(settings.unit).toEqual(presetParams('humanoid', 'swordsman', 3));
  });
});

describe('pinholes as rendered', () => {
  // a ring of ramp A around a pinhole: a 1 px transparent hole
  const ring = ['.....', '.AAA.', '.A.A.', '.AAA.', '.....'];
  const shade = (s: PostprocessSettings) => {
    const f = downscaleFrame(art(ring), 5, 5, 1, STEP, s);
    return Array.from({ length: f.height }, (_, y) => Array.from(f.data.subarray(y * f.width, (y + 1) * f.width), (v) => (v ? 'X' : '.')).join(''));
  };

  it('an old Gap Black link fills them; one that says open leaves them open', () => {
    const old = readShareLink(V2.gapBlackRidge, startup()).settings.sprite;
    const open = read({ v: 3, sprite: { outline: 'gapBlack', pinholes: 'open' }, unit: { seed: 1 } }).settings.sprite;
    // classic, so the 1 px ring stays as drawn at 1x
    expect(shade({ ...old, downsample: 'classic' })[2]).toBe('XXXXX');
    expect(shade({ ...open, downsample: 'classic' })[2]).toBe('XX.XX');
    // and without a setting at all
    expect(shade({ coverage: 0.3, thresholds: [0.4, 0.62, 0.86], outline: 'gapBlack' })[2]).toBe('XXXXX');
  });

  it('other outlines are the same whatever pinholes says', () => {
    for (const outline of ['none', 'inner', 'outer', 'colored', 'stableColored'] as const) {
      const s = { coverage: 0.3, thresholds: [0.4, 0.62, 0.86] as [number, number, number], outline };
      expect(shade({ ...s, pinholes: 'open' })).toEqual(shade({ ...s, pinholes: 'fill' }));
    }
  });
});

describe('versions', () => {
  it('rejects a malformed version instead of reading it as another', () => {
    for (const v of ['2', '', 2.5, 0, -1, null, true, {}, [2]]) {
      expect(() => read({ v, sprite: { outline: 'outer' } }), JSON.stringify(v)).toThrow(ShareLinkError);
      expect(() => read({ v }), JSON.stringify(v)).toThrow(/format version .* isn't a valid one/);
    }
    // 1e999 is Infinity once parsed
    expect(() => readShareLink(btoa('{"v":1e999}'), startup())).toThrow(ShareLinkError);
  });

  it('rejects a version newer than it knows, saying so', () => {
    for (const v of [SHARE_VERSION + 1, 99]) {
      expect(() => read({ v, sprite: { outline: 'outer' } })).toThrow(ShareLinkError);
      expect(() => read({ v })).toThrow(new RegExp(`newer version .*v${v}.* v1 to v${SHARE_VERSION}`));
    }
  });

  it('rejects links that hold no settings', () => {
    for (const payload of [null, 5, 'x', [1, 2], true]) expect(() => read(payload), JSON.stringify(payload)).toThrow(ShareLinkError);
  });

  it('throws on text that is no link at all', () => {
    expect(() => readShareLink('not base64 at all!', startup())).toThrow();
    expect(() => readShareLink(btoa('{oops'), startup())).toThrow();
  });
});

describe('malformed settings', () => {
  it('skips wrong types, values outside their choices or range and unknown fields, keeping the rest', () => {
    const { settings, skipped } = read({
      v: 4,
      unit: { seed: 1, helmet: 'propellerHat', height: '2' },
      sprite: { outline: 'sparkly', downsample: 'classic', pinholes: 'maybe', frameSize: 33, pixelsPerUnit: 1e9, coverage: 0.5, thresholds: [0.1, 0.2, 7] },
      frames: { walk: 0, idle: 6, nope: 3 },
      decayHold: -5,
      lighting: 'bright',
      portrait: { zoom: 100, border: 'yes' },
      team: 'plaid',
      kind: 'dragon',
      extra: { a: 1 },
    });
    const d = startup();
    expect(settings.sprite).toEqual({ ...d.sprite, downsample: 'classic', coverage: 0.5 });
    expect(settings.frames).toEqual({ ...d.frames, idle: 6 });
    expect([settings.decayHold, settings.lighting, settings.portrait, settings.team, settings.kind]).toEqual([d.decayHold, d.lighting, d.portrait, d.team, d.kind]);
    expect(settings.unit).toEqual(d.unit);
    expect(skipped.sort()).toEqual(
      ['unit.helmet', 'unit.height', 'sprite.outline', 'sprite.pinholes', 'sprite.frameSize', 'sprite.pixelsPerUnit', 'sprite.thresholds', 'frames.walk', 'frames.nope', 'decayHold', 'lighting', 'portrait.zoom', 'portrait.border', 'team', 'kind', 'extra'].sort(),
    );
  });

  it('a malformed field in a legacy link is skipped just the same', () => {
    const { settings, skipped } = read({ sprite: { outline: 'inner', coverage: 2 } });
    expect(settings.sprite).toEqual({ ...startup().sprite, outline: 'inner' });
    expect(skipped).toEqual(['sprite.coverage']);
  });
});

describe('writing links', () => {
  /** A state changed from the startup one: of `kind`, with its preset and seed, and its unit and rendering changed. */
  function changed(kind: Kind, preset: string, seed: number): SharedSettings {
    const s = startup();
    s.kind = kind;
    s.preset = preset;
    const key = paramsKey(kind) as 'unit';
    s[key] = presetParams(kind, preset, seed) as SharedSettings['unit'];
    s.sprite = { ...s.sprite, outline: 'inner', downsample: 'classic', pinholes: 'open', frameSize: 64, coverage: 0.45, thresholds: [0.3, 0.6, 0.9] };
    s.lighting.azimuth = 40;
    s.frames.walk = 8;
    s.decayHold = 20;
    s.portrait.background = 'none';
    s.previewAnim = 'idle';
    s.exportAnims.taunt = true;
    s.teamMask = true;
    s.team = 'white';
    return s;
  }
  const roundTrip = (s: SharedSettings) => readShareLink(encodeSettings(shareLinkSettings(s, startup())), startup()).settings;

  it.each([
    ['humanoid', 'mage', 7],
    ['humanoid', 'random', 123],
    ['beast', 'wolf', 42],
    ['mounted', 'knight', 5],
    ['vehicle', 'catapult', 9],
    ['building', 'swordsman', 77],
  ] as [Kind, string, number][])('round-trips every setting of a %s (%s, seed %i)', (kind, preset, seed) => {
    const s = changed(kind, preset, seed);
    // the other kinds' units don't travel: they open as they start
    const others = Object.fromEntries([...PARAMS_KEYS].filter((k) => k !== paramsKey(kind)).map((k) => [k, startup()[k as keyof SharedSettings]]));
    expect(roundTrip(s)).toEqual({ ...s, ...others });
  });

  it("round-trips changes to the unit's own params", () => {
    const s = startup();
    s.unit = { ...presetParams('humanoid', 'swordsman', 11), helmet: 'hood', height: 1.2 } as SharedSettings['unit'];
    expect(roundTrip(s)).toEqual(s);
  });

  it('round-trips every outline, downsample and pinholes', () => {
    for (const outline of ['none', 'inner', 'outer', 'colored', 'stableColored', 'gapBlack'] as const)
      for (const downsample of ['classic', 'ridge'] as const)
        for (const pinholes of ['fill', 'open'] as const) {
          const s = startup();
          s.sprite = { ...s.sprite, outline, downsample, pinholes };
          expect(roundTrip(s).sprite).toEqual(s.sprite);
        }
  });

  it('records only what differs from the defaults, and the seed', () => {
    const s = startup();
    s.sprite.outline = 'inner';
    s.sprite.downsample = 'classic';
    expect(shareLinkSettings(s, startup())).toEqual({ v: 4, sprite: { outline: 'inner', downsample: 'classic' }, unit: { seed: 1 } });
    s.sprite.outline = 'gapBlack';
    s.sprite.pinholes = 'open';
    expect(shareLinkSettings(s, startup())).toEqual({ v: 4, sprite: { downsample: 'classic', pinholes: 'open' }, unit: { seed: 1 } });
  });

  it('an old link opened and shared again opens the same as v4', () => {
    for (const text of [UNVERSIONED, ...Object.values(V1), ...Object.values(V2)]) {
      const opened = readShareLink(text, startup()).settings;
      const again = shareLinkSettings(opened, startup());
      expect(again.v).toBe(4);
      expect(readShareLink(encodeSettings(again), startup()).settings).toEqual(opened);
    }
  });
});

describe('the URL', () => {
  const link = 'eyJ2Ijo0LCJ1bml0Ijp7InNlZWQiOjF9fQ';

  it('adds s after the other parameters, leaving them and the fragment byte for byte', () => {
    const href = 'https://example.com/app/?diag&b=x%20y&c=a+b&d=%E2%9C%A8#frag';
    expect(withShareParam(href, link)).toBe(`https://example.com/app/?diag&b=x%20y&c=a+b&d=%E2%9C%A8&s=${link}#frag`);
  });

  it('replaces s where it is, dropping any later ones', () => {
    expect(withShareParam(`https://example.com/?a=1&s=old&b=2&s=older`, link)).toBe(`https://example.com/?a=1&s=${link}&b=2`);
    expect(withShareParam(`https://example.com/?%73=old&b=2`, link)).toBe(`https://example.com/?s=${link}&b=2`);
  });

  it('works without a query, and keeps other parameters named like s', () => {
    expect(withShareParam('https://example.com/', link)).toBe(`https://example.com/?s=${link}`);
    expect(withShareParam('https://example.com/?ss=1&xs=2', link)).toBe(`https://example.com/?ss=1&xs=2&s=${link}`);
  });

  it('reads back what it wrote', () => {
    const href = withShareParam('https://example.com/?diag', link);
    expect(shareParam(new URL(href).search)).toBe(link);
    expect(new URL(href).searchParams.get(SHARE_PARAM)).toBe(link);
    expect(shareParam('?diag')).toBeNull();
  });
});
