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

/**
 * Copies values from `source` into `target`, in place, but only for keys `target` already has
 * and only when the type matches, so a link from an older or newer version (or a hand-edited
 * one) can't put anything unexpected into the app's state. Arrays must keep their length.
 * `choices` lists the allowed values of fields that take one of a set, by dotted path
 * ('unit.helmet'); a value outside its list is skipped.
 */
export function mergeSettings(
  target: Record<string, unknown>,
  source: unknown,
  choices: Record<string, readonly unknown[]> = {},
  path = '',
): void {
  if (!isObject(source)) return;
  for (const [key, cur] of Object.entries(target)) {
    const next = source[key];
    const at = path + key;
    if (next === undefined) continue;
    if (Array.isArray(cur)) {
      if (Array.isArray(next) && next.length === cur.length && next.every((v, i) => typeof v === typeof cur[i])) {
        next.forEach((v, i) => (cur[i] = v));
      }
    } else if (isObject(cur)) {
      mergeSettings(cur, next, choices, at + '.');
    } else if (
      typeof next === typeof cur &&
      (typeof next !== 'number' || Number.isFinite(next)) &&
      (!choices[at] || choices[at].includes(next))
    ) {
      target[key] = next;
    }
  }
}
