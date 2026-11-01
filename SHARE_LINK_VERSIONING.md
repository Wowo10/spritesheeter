# Share-link versioning

The defaults are now **Ridge downsampling + Gap Black outline, pinholes filled**. New share links are written as **v4**.

Older link formats are all still accepted: unversioned, v1, v2 and v3.

- **Omitted settings take the current application defaults,** whichever version made the link.
- **Explicit settings are kept,** as long as their value is still supported.

**Existing links may therefore render differently after this update.** A link that left the outline or the downsampling out, because they were at the old defaults (Inner, Classic), now opens with Ridge + Gap Black. Share links do not promise visual backward compatibility.

Malformed versions and versions newer than v4 are refused with a clear message, never read as another version.

The code is in [src/shareLink.ts](src/shareLink.ts) (formats, reading, writing, URL) and [src/settings.ts](src/settings.ts) (what a link carries: startup settings, choices, ranges). The defaults are `DEFAULT_SPRITE_SETTINGS` in [src/render/spriteRenderer.ts](src/render/spriteRenderer.ts). The tests are in [test/shareLink.test.ts](test/shareLink.test.ts), with real old links in [test/fixtures/shareLinks.ts](test/fixtures/shareLinks.ts).

## The format

The settings travel in the `s` query parameter.

- **Encoding:** `s` is URL-safe base64 (`-` `_`, no padding) of the UTF-8 JSON of an object. The reader also accepts standard, padded base64.
- **Version:** the object's `v` field is the format version.
- **What a link carries:** everything in `SharedSettings`, nothing else. The custom model and the view state stay behind.

| field | what |
|---|---|
| `kind` | `humanoid`, `beast`, `mounted`, `vehicle`, `building` |
| `preset` | the kind's preset name, or `random` |
| `unit` / `beast` / `mounted` / `vehicle` / `building` | the kind's own parameters (`unit` for humanoids), with `seed` |
| `frames` | frames per animation row |
| `decayHold` | seconds per decay stage |
| `sprite` | `frameSize`, `pixelsPerUnit`, `elevation`, `anchorY`, `supersample`, `coverage`, `thresholds`, `outline`, `downsample`, `pinholes` |
| `lighting` | `ambient`, `diffuse`, `azimuth`, `elevation`, `fill` |
| `portrait` | `size`, `zoom`, `turn`, `elevation`, `frames`, `background`, `border` |
| `previewAnim`, `exportAnims`, `teamMask`, `team` | preview row, exported rows, team mask export, team colour |

### Sprite defaults

| setting | default | other values |
|---|---|---|
| `outline` | `gapBlack` | `none`, `inner`, `outer`, `colored`, `stableColored` |
| `downsample` | `ridge` | `classic` |
| `pinholes` | `fill` | `open` (only matters with `gapBlack`) |

The rest of `sprite` and the other settings keep their defaults. Every rendering mode is still available. The **gap black pinholes** control in the Sprite folder appears whenever the outline is Gap Black, which is now the case for a new project.

## Versions

| `v` | written by | unit | omitted settings | explicit settings |
|---|---|---|---|---|
| none | never by the app (hand-made, or cut short) | link fields over the startup unit | current defaults | kept |
| `1` | `7b7eed2` … `93e8651^` | link fields over the startup unit | current defaults | kept |
| `2` | `93e8651` … before versioning | the preset's unit for the seed, link fields over it | current defaults | kept |
| `3` | versioning, before this update | as v2 | current defaults | kept |
| `4` | from now on | as v2 | current defaults | kept |
| other | — | refused: [errors](#errors) | | |

The versions now differ only in how the unit travels:

- **v1 and unversioned links** carry unit fields that go over the page's startup unit.
- **v2 onward** names a `preset` and `seed`. The unit those give is rebuilt, and the link's changes go over it.

That difference is structural, not about appearance, so it stays.

v2, v3 and v4 are read the same way. v3 and v4 mark which defaults were current when a link was written (Classic + Inner, then Ridge + Gap Black). That tells a reader which settings the writer left out, but it changes nothing in how the link opens.

There are no per-version defaults tables any more. The previous update kept frozen copies of the old defaults so old links looked as they did. That code is gone, along with the rule that kept Gap Black's pinholes open for old links.

### What old links do now

- **Unversioned:**
  - Whatever the link spells out is kept.
  - Everything else takes the current defaults: Ridge + Gap Black + filled pinholes unless the link names an outline, downsampling or pinholes value.
- **v1:**
  - These links spell out every setting that existed then, including `outline` (`inner`, `outer` or `none`), so they keep their outline.
  - v1 predates `downsample` and `pinholes`, so they now open with **Ridge**, and Gap Black (if chosen in the GUI) fills pinholes.
- **v2 and v3:**
  - These record only what differed from the defaults of their time. A v2/v3 link made with the old defaults (Inner, Classic) didn't spell them out, so it **now opens with Ridge + Gap Black**.
  - A link that chose a different outline or downsampling spelled it out and keeps it. For example, `outline: 'outer'` stays Outer with Ridge, and `downsample: 'ridge'` stays Ridge with Gap Black.
- **Old Gap Black links** (v2 from `d8e6477` on, or v3 without `pinholes`) **now fill pinholes.**
- **Explicit `pinholes: 'open'`** (v3 or v4) stays open.

In short: everything an old link says is honoured, and everything it doesn't say is today's default. This is exactly the rule links followed before versioning: merged onto the page's startup settings. A test checks every old fixture against a copy of that pre-versioning decoder.

### Reading a link

`readShareLink(text, startup)`:

1. Decode base64 and JSON. Failure → error.
2. The payload must be an object. Otherwise → error.
3. Pick the format by `v` (`formatOf`).
   - No `v` key → unversioned.
   - An integer from 1 to 4 → that version.
   - An integer above 4 → error: "newer version".
   - Anything else → error: "not a valid version".
4. Start from a copy of the startup settings (the current defaults).
5. Merge the link over that. Unknown fields and invalid values are skipped (see [Malformed values](#malformed-values)).
6. v2 and later only: replace the active kind's params with the unit its `preset` and `seed` give, then merge the link again.

The result is a new object. Nothing is applied unless reading succeeded, so a failed link changes nothing; the page keeps its defaults.

### Writing a link

`shareLinkSettings(current, startup)` writes `{ v: 4, ...diff, [key]: { ...diff[key], seed } }`:

- `diff` holds what differs from the current defaults and from the unit the preset and seed give.
- Only the active kind's params travel.
- The `seed` is always written.

A link that picks Classic or Inner therefore spells it out. Every setting round-trips.

An old link that is opened and shared again becomes a v4 link that opens the same way. A v2 Ridge + Gap Black link, now all defaults, becomes `{"v":4,"unit":{"seed":3}}`.

## Malformed values

Handled the same way in every version: a value that can't be taken is skipped, and the field keeps its default. The rest of the link applies.

- Unknown fields: skipped.
- Wrong type, `Infinity` (in arrays too), a misshapen array, a value outside its choice list: skipped.
  - An outline or downsampling value the app doesn't support is skipped like this, so the field falls back to Gap Black or Ridge.
- A number outside the range its control allows: skipped.
  - The ranges are `SHARE_RANGES` in settings.ts: frames 1–12, `decayHold` 1–60, `pixelsPerUnit` 6–80, sprite and portrait angles, coverage, thresholds, lighting, portrait zoom and frames.
  - The GUI builds those controls from the same table.

What was skipped is logged with `console.warn`, as dotted paths. The link still opens.

## Errors

The link isn't applied and the page opens with its defaults. The alert reads:

> Couldn't read the shared settings in this link: *reason*. The page opened with its default settings.

| link | reason |
|---|---|
| not base64 / not JSON | the browser's decode or parse message |
| JSON that isn't an object | it doesn't hold any settings. |
| `v` above 4 | it was made with a newer version of this app (link format v5; this one reads v1 to v4). |
| `v` not a positive integer (`"2"`, `2.5`, `0`, `-1`, `null`, `true`, `{}`, `[2]`, `1e999`) | its format version ("2") isn't a valid one. |

No link is refused only because it is old.

## The URL

- **Opening a link never rewrites it.** The address stays byte-for-byte as it was. Only the share button writes the address.
- **Sharing** sets `s` with `withShareParam`. It works on the raw query string, so everything else stays byte-for-byte:
  - the other parameters, their order and their encoding (`?diag` stays `?diag`);
  - the `#fragment`.
- If an `s` is already there, it is replaced in place, and later duplicates are dropped.

## What is guaranteed

1. Links of every format from unversioned to v4 are accepted.
2. Every setting a link spells out is applied, as long as its value is still supported. Inner stays Inner, Classic stays Classic, `pinholes: 'open'` stays open.
3. Every setting a link leaves out takes the current defaults, whichever version made it.
4. Links from a newer or unknown version, malformed versions, and links that aren't settings are refused with a message and change nothing.
5. Malformed fields are skipped one by one, the same way in every version.
6. Opening a link leaves the address as it is. Sharing leaves the rest of the URL as it is.
7. Every setting round-trips through a new link.

What is **not** guaranteed: that a link looks the same after the defaults change. Old links that relied on the old defaults now look different. So will links that leave a setting out, whenever its default changes again.

### Limitations

- **The unit generator isn't versioned.**
  - v2 to v4 links rebuild the unit from `preset` + `seed` with the current presets and random generator.
  - v1 and unversioned links take the unit fields they lack from the current startup unit.
  - Explicit unit fields are always kept.
- **Choice lists should only grow.** Removing a value makes links that use it fall back to the default for that field.
- **Ranges** cover the rendering settings only, not the unit's params.

## Changing defaults again

Change the default in `DEFAULT_SPRITE_SETTINGS` (or wherever it lives). Every link that leaves the setting out follows the change.

- **A new version** is only needed when the *format* changes: how a field is written or read, or a field whose meaning changes. In that case:
  - add an entry to `FORMATS` in shareLink.ts;
  - set `SHARE_VERSION`;
  - put the version-specific reading in `readShareLink`.
- **If a future change must keep old links looking the same,** per-version defaults would have to come back. That means a frozen table per version of the settings it left out, merged over the startup settings before the link; it was in place for v3 until this update.

## The audit before versioning

Kept for reference: what share links did before formats were versioned.

| commit | what links were written as | how links were read |
|---|---|---|
| `7b7eed2` | **v1**: `{ v: 1, ...sharedSettings() }`, every setting in full | merged onto the startup settings, whatever `v` was |
| `93e8651` | **v2**: only what differs from the startup settings (`diffSettings`), the active kind's params diffed against the unit `preset` and `seed` give, the `seed` always | `v === 2`: merged, unit regenerated from preset and seed, merged again. Anything else, missing `v` included: as v1 |

- **v1 omitted nothing,** but lacked what didn't exist yet:
  - `kind`, the other kinds' params, `decayHold`, `portrait`, `exportAnims`, `teamMask`;
  - 7 of the `frames` rows;
  - `sprite.downsample`;
  - later unit fields.
- **Field handling:** missing fields kept the startup value. Unknown keys and invalid values (wrong type, non-finite, wrong-length arrays, outside the choice list) were ignored. Numbers had no range check. A payload that wasn't an object was silently ignored.
- **Versions:**
  - The app never wrote a link without `v`; such links could only be hand-made or cut short. They were read like v1.
  - Unknown versions (`v: 3`, `v: 99`, `v: "2"`) were silently read like v1.
- **Defaults** didn't change from v1 to the versioning change, except that `sprite.downsample: 'classic'` was added.
- **Choice lists** only grew:
  - `outline` gained `colored`, `stableColored`, `gapBlack`;
  - `downsample` was added;
  - unit lists gained values.
- **Gap Black's meaning changed:** it left pinholes open until the pinhole fix.

## Tests

[test/shareLink.test.ts](test/shareLink.test.ts) (52 tests), [test/share.test.ts](test/share.test.ts) and [test/diagnostics.test.ts](test/diagnostics.test.ts) cover:

- **Defaults:** new projects use Ridge + Gap Black with pinholes filled. `DEFAULT_SPRITE_SETTINGS` holds exactly those.
- **Formats:**
  - new links are v4;
  - every version from none to v4 is read;
  - for each of them, an empty link opens with the current defaults;
  - for each of them, every explicit outline × downsample × pinholes combination is kept;
  - for each of them, explicit Inner alone, explicit Classic alone, Gap Black alone (pinholes filled) and `pinholes: 'open'` alone each come through.
- **Old links (real fixtures):**
  - each decodes exactly as the pre-versioning decoder would over the current defaults;
  - unversioned and v1 merge onto the startup unit;
  - the v1 default link keeps its explicit Inner and gets Ridge;
  - the v2 default link opens with Ridge + Gap Black;
  - v2 Outer stays Outer;
  - v2 other kinds;
  - the old Gap Black link fills pinholes.
- **Rendering:** a pinhole is filled under an old Gap Black link's settings and left open under `pinholes: 'open'`. Other outlines don't depend on `pinholes`.
- **Versions:**
  - malformed versions;
  - future versions (v5, v99);
  - payloads that aren't objects;
  - text that isn't base64.
- **Malformed values:** wrong types, choices, ranges and unknown fields are skipped and reported, in v4 and in old links.
- **Writing:**
  - round-trips for every kind and every outline/downsample/pinholes combination;
  - minimal output;
  - old links re-shared as v4 open the same.
- **URL:** other parameters, order, encoding and fragment kept; `s` replaced in place; reading back.

The fixtures in [test/fixtures/shareLinks.ts](test/fixtures/shareLinks.ts) were generated by running each old commit's own encoder (`7b7eed2` for v1; `93e8651` and `c6acb81` for v2). The unversioned one is hand-made, since the app never wrote one.

### Checked in the app

These were checked in headless Firefox against the dev server:

| URL | opens with (outline / downsample / pinholes) |
|---|---|
| no link | gapBlack / ridge / fill; the GUI shows the same, with the pinholes control visible |
| v1 unchanged (spells out `inner`) | inner / ridge / fill |
| v2 unchanged (spells out nothing) | gapBlack / ridge / fill |
| v2 Gap Black + Ridge | gapBlack / ridge / fill |
| v2 mage (spells out `outer`) | outer / ridge / fill; mage, seed 7, green, zoom 1.5 |
| unversioned, `downsample: 'classic'` | gapBlack / classic / fill |
| v3 with `pinholes: 'open'` | gapBlack / ridge / open |
| v4, nothing spelled out | gapBlack / ridge / fill |
| v5, `v: "2"` | the alerts above, defaults |
| share, after opening the v2 Gap Black link at `?diag&keep=a%20b&s=…#frag` | `?diag&keep=a%20b&s=<v4>#frag`, where `<v4>` is `{"v":4,"unit":{"seed":3}}` |

In every case, opening the link left the address unchanged.

## Example links

`https://example.com/ssheet/` stands for wherever the app is hosted.

**Old v2, defaults of then** (Classic + Inner, not spelled out). It now opens with Ridge + Gap Black:

```
https://example.com/ssheet/?s=eyJ2IjoyLCJ1bml0Ijp7InNlZWQiOjF9fQ
{"v":2,"unit":{"seed":1}}
```

**Old v2, Ridge + Gap Black spelled out.** Same look, but pinholes are now filled:

```
https://example.com/ssheet/?s=eyJ2IjoyLCJzcHJpdGUiOnsib3V0bGluZSI6ImdhcEJsYWNrIiwiZG93bnNhbXBsZSI6InJpZGdlIn0sInVuaXQiOnsic2VlZCI6M319
{"v":2,"sprite":{"outline":"gapBlack","downsample":"ridge"},"unit":{"seed":3}}
```

**Old v3, pinholes open spelled out.** It stays open:

```
https://example.com/ssheet/?s=eyJ2IjozLCJzcHJpdGUiOnsib3V0bGluZSI6ImdhcEJsYWNrIiwiZG93bnNhbXBsZSI6InJpZGdlIiwicGluaG9sZXMiOiJvcGVuIn0sInVuaXQiOnsic2VlZCI6M319
{"v":3,"sprite":{"outline":"gapBlack","downsample":"ridge","pinholes":"open"},"unit":{"seed":3}}
```

**Old v1:** every setting that existed then, about 1 kB, including `outline`. It keeps its outline and gets Ridge. See `V1` in the fixtures.

**New v4, defaults** (Ridge + Gap Black, pinholes filled):

```
https://example.com/ssheet/?s=eyJ2Ijo0LCJ1bml0Ijp7InNlZWQiOjF9fQ
{"v":4,"unit":{"seed":1}}
```

**New v4, Classic + Inner:**

```
https://example.com/ssheet/?s=eyJ2Ijo0LCJzcHJpdGUiOnsib3V0bGluZSI6ImlubmVyIiwiZG93bnNhbXBsZSI6ImNsYXNzaWMifSwidW5pdCI6eyJzZWVkIjoxfX0
{"v":4,"sprite":{"outline":"inner","downsample":"classic"},"unit":{"seed":1}}
```

**New v4, Gap Black with pinholes open:**

```
https://example.com/ssheet/?s=eyJ2Ijo0LCJzcHJpdGUiOnsicGluaG9sZXMiOiJvcGVuIn0sInVuaXQiOnsic2VlZCI6MX19
{"v":4,"sprite":{"pinholes":"open"},"unit":{"seed":1}}
```

**A future version.** Refused with "made with a newer version of this app":

```
https://example.com/ssheet/?s=eyJ2Ijo1LCJ1bml0Ijp7InNlZWQiOjF9fQ
{"v":5,"unit":{"seed":1}}
```
