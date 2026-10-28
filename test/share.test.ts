import { describe, expect, it } from 'vitest';
import { decodeSettings, encodeSettings, mergeSettings } from '../src/share';

describe('share links', () => {
  it('round-trips settings through URL-safe base64', () => {
    const settings = { name: 'zoë ✨', n: 1.5, list: [1, 2, 3], deep: { on: true } };
    const text = encodeSettings(settings);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSettings(text)).toEqual(settings);
  });

  it('also reads plain, padded base64', () => {
    expect(decodeSettings(btoa(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
  });

  it('throws on garbage', () => {
    expect(() => decodeSettings('not base64 at all!')).toThrow();
    expect(() => decodeSettings(btoa('{oops'))).toThrow();
  });
});

describe('mergeSettings', () => {
  const target = () => ({ size: 32, mode: 'inner', flag: false, nested: { a: 1, b: 'x' }, list: [0.2, 0.5, 0.8] });

  it('copies known fields of matching type, nested and in arrays', () => {
    const t = target();
    const list = t.list;
    mergeSettings(t, { size: 64, flag: true, nested: { b: 'y' }, list: [0.1, 0.4, 0.9] });
    expect(t).toEqual({ size: 64, mode: 'inner', flag: true, nested: { a: 1, b: 'y' }, list: [0.1, 0.4, 0.9] });
    // updated in place, so anything bound to the old array sees the change
    expect(t.list).toBe(list);
  });

  it('ignores unknown keys, wrong types, non-finite numbers and misshapen arrays', () => {
    const t = target();
    mergeSettings(t, { extra: 1, size: '64', flag: 1, nested: 'x', list: [1, 2], mode: null });
    mergeSettings(t, JSON.parse('{"size": 1e999}'));
    mergeSettings(t, { list: ['a', 'b', 'c'] });
    expect(t).toEqual(target());
  });

  it('skips values outside a field’s choices', () => {
    const t = target();
    const choices = { mode: ['none', 'inner', 'outer'], 'nested.b': ['x', 'y'] };
    mergeSettings(t, { mode: 'sparkly', nested: { b: 'z' } }, choices);
    expect(t).toEqual(target());
    mergeSettings(t, { mode: 'outer', nested: { b: 'y' } }, choices);
    expect(t.mode).toBe('outer');
    expect(t.nested.b).toBe('y');
  });

  it('does nothing with a non-object', () => {
    const t = target();
    for (const v of [null, 5, 'x', [1]]) mergeSettings(t, v);
    expect(t).toEqual(target());
  });
});
