/** Query parameter that carries shared settings. */
export const SHARE_PARAM = 's';

/** Settings as URL-safe base64 of their JSON. */
export function encodeSettings(settings: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(settings));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Reverses encodeSettings; also takes plain base64. Throws on anything that isn't valid. */
export function decodeSettings(text: string): unknown {
  const b64 = text.trim().replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The fields of `current` whose value differs from `base`'s, nested as in `current`, or
 * undefined if none do. An array goes in whole if any of it differs, as mergeSettings only
 * takes arrays whole.
 */
export function diffSettings(current: Record<string, unknown>, base: unknown): Record<string, unknown> | undefined {
  const from = isObject(base) ? base : {};
  const diff: Record<string, unknown> = {};
  for (const [key, cur] of Object.entries(current)) {
    const old = from[key];
    if (isObject(cur)) {
      const inner = diffSettings(cur, old);
      if (inner) diff[key] = inner;
    } else if (Array.isArray(cur)) {
      if (!Array.isArray(old) || old.length !== cur.length || cur.some((v, i) => v !== old[i])) diff[key] = cur;
    } else if (cur !== old) {
      diff[key] = cur;
    }
  }
  return Object.keys(diff).length ? diff : undefined;
}

export interface MergeOptions {
  /**
   * Inclusive [min, max] of number fields, by dotted path ('sprite.coverage'); for an array
   * field, of each of its numbers. A number outside its range is skipped.
   */
  ranges?: Record<string, readonly [number, number]>;
  /** Collects the dotted paths of the values in `source` that were skipped, unknown keys included. */
  skipped?: string[];
}

/**
 * Copies values from `source` into `target`, in place, but only for keys `target` already has
 * and only when the type matches, so a link from an older or newer version (or a hand-edited
 * one) can't put anything unexpected into the app's state. Arrays must keep their length.
 * Numbers must be finite. `choices` lists the allowed values of fields that take one of a set,
 * by dotted path ('unit.helmet'); a value outside its list is skipped, as is a number outside
 * its range in `options.ranges`. Whatever is skipped leaves the target's value as it was.
 */
export function mergeSettings(
  target: Record<string, unknown>,
  source: unknown,
  choices: Record<string, readonly unknown[]> = {},
  { ranges = {}, skipped }: MergeOptions = {},
): void {
  mergeAt(target, source, choices, ranges, skipped, '');
}

function mergeAt(
  target: Record<string, unknown>,
  source: unknown,
  choices: Record<string, readonly unknown[]>,
  ranges: Record<string, readonly [number, number]>,
  skipped: string[] | undefined,
  path: string,
): void {
  if (!isObject(source)) return;
  const inRange = (v: unknown, at: string) => typeof v !== 'number' || (Number.isFinite(v) && (!ranges[at] || (v >= ranges[at][0] && v <= ranges[at][1])));
  if (skipped) for (const key of Object.keys(source)) if (!Object.hasOwn(target, key)) skipped.push(path + key);
  for (const [key, cur] of Object.entries(target)) {
    const next = source[key];
    const at = path + key;
    if (next === undefined) continue;
    if (Array.isArray(cur)) {
      if (Array.isArray(next) && next.length === cur.length && next.every((v, i) => typeof v === typeof cur[i] && inRange(v, at))) {
        next.forEach((v, i) => (cur[i] = v));
      } else skipped?.push(at);
    } else if (isObject(cur)) {
      if (isObject(next)) mergeAt(cur, next, choices, ranges, skipped, at + '.');
      else skipped?.push(at);
    } else if (typeof next === typeof cur && inRange(next, at) && (!choices[at] || choices[at].includes(next))) {
      target[key] = next;
    } else skipped?.push(at);
  }
}
