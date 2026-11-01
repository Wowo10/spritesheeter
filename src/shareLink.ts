/**
 * Share links: the settings in the `s` query parameter, as URL-safe base64 of JSON (share.ts),
 * with a format version `v`. A link records what differs from the app's defaults; whatever it
 * leaves out takes the app's current defaults, whichever version made it, so links render with
 * today's defaults where they don't say otherwise. The versions differ only in how the unit
 * travels. See SHARE_LINK_VERSIONING.md.
 */
import { decodeSettings, diffSettings, encodeSettings, mergeSettings, SHARE_PARAM } from './share';
import { paramsKey, presetParams, SHARE_CHOICES, SHARE_RANGES, type SharedSettings } from './settings';
import { KINDS, type AnyParams } from './subjects';

/** The version new links are written in. */
export const SHARE_VERSION = 4;

export interface LinkFormat {
  /** null for a link without one. */
  version: number | null;
  /**
   * v2 on: the unit is its preset's (or for a name that isn't a preset, the random one) for the
   * link's seed, and the link records only its changes from that. Before: the link's unit
   * fields go over the page's starting unit.
   */
  fromPreset: boolean;
}

/** Every format a link can be in; all are read. */
export const FORMATS = {
  /** Hand-made, or cut short: never written by the app (v1 already had `v`). Read as v1. */
  unversioned: { version: null, fromPreset: false },
  /** Every setting there was then, the unit's params in full. */
  1: { version: 1, fromPreset: false },
  /** Only what differs from the defaults and from the unit the preset and seed give; the seed always. */
  2: { version: 2, fromPreset: true },
  /** As v2 (written while the defaults were Classic + Inner; sprite.pinholes added). */
  3: { version: 3, fromPreset: true },
  /** As v2 (written since the defaults are Ridge + Gap Black). */
  4: { version: 4, fromPreset: true },
} satisfies Record<string, LinkFormat>;

/** A link the app can't open: not a link's settings, or a version it doesn't know. */
export class ShareLinkError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The format of a decoded link, by its `v`. No `v` at all is an unversioned link; anything else
 * that isn't a version this app knows throws, rather than being read as some other version.
 */
export function formatOf(payload: Record<string, unknown>): LinkFormat {
  if (!Object.hasOwn(payload, 'v')) return FORMATS.unversioned;
  const v = payload.v;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new ShareLinkError(`its format version (${JSON.stringify(v) ?? String(v)}) isn't a valid one.`);
  }
  if (v > SHARE_VERSION) {
    throw new ShareLinkError(`it was made with a newer version of this app (link format v${v}; this one reads v1 to v${SHARE_VERSION}).`);
  }
  return FORMATS[v as keyof typeof FORMATS];
}

export interface ReadLink {
  format: LinkFormat;
  /** The settings to open with: a new object, `startup` with the link's settings over it. */
  settings: SharedSettings;
  /** Dotted paths of what the link holds that wasn't taken: unknown fields, wrong types, values out of range. */
  skipped: string[];
}

/**
 * A link's settings over the page's starting ones. `startup` is what the page opens with
 * (defaultSettings()); it isn't changed. Throws a ShareLinkError for a version this app can't
 * read, and decodeSettings' error for text that isn't a link's.
 */
export function readShareLink(text: string, startup: SharedSettings): ReadLink {
  const payload = decodeSettings(text);
  if (!isObject(payload)) throw new ShareLinkError("it doesn't hold any settings.");
  const format = formatOf(payload);
  const settings = structuredClone(startup);
  const target = settings as unknown as Record<string, unknown>;
  let skipped: string[] = [];
  mergeSettings(target, payload, SHARE_CHOICES, { ranges: SHARE_RANGES, skipped });
  if (format.fromPreset) {
    // the unit the link's changes apply to; then the changes again, onto it
    const key = paramsKey(settings.kind);
    target[key] = presetParams(settings.kind, settings.preset, (target[key] as AnyParams).seed);
    skipped = [];
    mergeSettings(target, payload, SHARE_CHOICES, { ranges: SHARE_RANGES, skipped });
  }
  return { format, settings, skipped: skipped.filter((p) => p !== 'v') };
}

/**
 * What a link records of `current` in the current format: the kind in use and only what
 * differs from `startup` (what the page opens with, as for readShareLink) and from the unit
 * its preset and seed give, its unit's seed always.
 */
export function shareLinkSettings(current: SharedSettings, startup: SharedSettings): Record<string, unknown> {
  const key = paramsKey(current.kind);
  const shared: Record<string, unknown> = { ...current };
  // only the kind in use travels
  for (const kind of KINDS) if (paramsKey(kind) !== key) delete shared[paramsKey(kind)];
  const seed = (current[key] as AnyParams).seed;
  const base = { ...startup, [key]: presetParams(current.kind, current.preset, seed) };
  const diff = diffSettings(shared, base) ?? {};
  // the seed always, since the unit the changes apply to comes from it
  return { v: SHARE_VERSION, ...diff, [key]: { ...(diff[key] as object), seed } };
}

/** The current settings as a link's `s` parameter. */
export const encodeShareLink = (current: SharedSettings, startup: SharedSettings) => encodeSettings(shareLinkSettings(current, startup));

/** The `s` parameter of a query string (location.search), or null. */
export const shareParam = (search: string) => new URLSearchParams(search).get(SHARE_PARAM);

/**
 * `href` with its `s` parameter set to `value`. The rest of the URL is left as it is, byte for
 * byte: the other parameters, their order and encoding, and the fragment. An `s` already there
 * is replaced where it is (later ones dropped, so the one read is this one); else `s` goes last.
 */
export function withShareParam(href: string, value: string): string {
  const url = new URL(href);
  const query = url.search.slice(1);
  const parts = query ? query.split('&') : [];
  const param = `${SHARE_PARAM}=${encodeURIComponent(value)}`;
  const isShare = (part: string) => {
    const name = part.split('=')[0].replace(/\+/g, ' ');
    try {
      return decodeURIComponent(name) === SHARE_PARAM;
    } catch {
      return false;
    }
  };
  let placed = false;
  const out: string[] = [];
  for (const part of parts) {
    if (!isShare(part)) out.push(part);
    else if (!placed) {
      out.push(param);
      placed = true;
    }
  }
  if (!placed) out.push(param);
  url.search = `?${out.join('&')}`;
  return url.href;
}
