# Visual benchmark

Renders a fixed set of units with the app and compares how they come out in four post-processing configurations:

| | downsample | outline |
|---|---|---|
| Classic + Outer | `classic` | `outer` |
| Classic + Gap Black | `classic` | `gapBlack` |
| Ridge + Outer | `ridge` | `outer` |
| Ridge + Gap Black | `ridge` | `gapBlack` |

The metrics also include Gap Black with pinholes left open (`fillPinholes: false`), as it was before they were filled, for reference.

It is optional and separate from the app. Nothing here is imported by `src/`, and the production build doesn't include it. FINAL_VISUAL_VALIDATION.md and FINAL_VISUAL_VALIDATION_PART2.md were made with it.

## Prerequisites

- **Node 22 or later**, for the global `WebSocket`. Run `npm install` first.
- **Firefox** (tested with 159), run headless and driven over WebDriver BiDi. The units are rendered by the app itself in WebGL, so a real browser is needed. Pass another executable with `--firefox PATH` or `FIREFOX=PATH`.
- **ImageMagick 7** (`magick`) with the DejaVu Sans font, *optional*. It draws the labels, the 2× field views and the GIFs. Without it, everything is still written, unlabelled, and the GIFs and 2× views are skipped.

Nothing else is needed. The dev server runs inside the script, on a free port, through Vite's API.

## Run

```sh
npm run bench:visual
```

This writes `bench-output/visual/`, which is gitignored. It takes about 1.5 minutes. Options go after `--`:

| option | |
|---|---|
| `--out DIR` | another output folder (default `bench-output/visual`) |
| `--skip-capture` | reuse the samples already in the output folder: only render and measure again (e.g. after changing post-processing) |
| `--capture-only` | only capture |
| `--only swordsman,mage` | capture and render only these units' sheets (no field, edge cases or metrics) |
| `--firefox PATH` | the Firefox executable |

## What it does

1. **Capture** ([capture.mjs](capture.mjs)):
   - starts Vite's dev server;
   - opens each unit of [presets.mjs](presets.mjs) in headless Firefox as a share link with `?diag`, which turns on the dev-only diagnostics hook `window.ssheetDev`;
   - waits for rendering to settle;
   - saves the rendered rows as `FrameSamples` (`samples/<unit>.json`), with the sprite settings they were rendered with.

   `FrameSamples` are what the app shades from, before coverage, outline and dithering.
2. **Render** ([render.ts](render.ts)) shades the samples with the app's own `shadeStages` in each configuration. Every configuration shades the same samples, so camera, scale, pose and timing are identical.
3. **Metrics** ([metrics.ts](metrics.ts)) uses the diagnostics' `stageStats` and `edgeContrast`, plus enclosed holes, Ridge's silhouette changes and Gap Black invariants.

### The units

All are existing presets, at seed 1, with the app's default settings (32 px frame, 14 px/unit, 8× supersampling, coverage 0.3) unless noted:

- swordsman, spearman, guard, mage, archer, militia, monk, pirate: walk and idle
- spearman and guard: attack too
- wolf: walk and idle
- mounted knight (48 px frame): walk and idle
- swordsman, spearman, guard, mage and archer at 9 px/unit: walk and idle

That is all 5 rendered directions (the west-facing ones are mirrors), every frame (walk 5, idle 4, attack 5): 32 rows, 725 frames per configuration. Sheets are in team red. The swordsman, mage and knight are also in white, and the swordsman and pirate in black (a palette swap, no capture of their own).

## Output

| | |
|---|---|
| `samples/` | the captured `FrameSamples`, one JSON per unit (~10 MB) |
| `sheets/<unit>-<row>-<ground>[-team_<team>].png` | per direction one row per configuration, every frame at 3× (2× for 48 px), then at 1×; grounds grass `#4f7a3a`, sand `#c8b07a`, dark `#1c1f24` |
| `field/<row>-<ground>-f<n>-1x.png`, `-2x.png`, `<row>-<ground>-2x.gif` | game scale: every unit in every direction, one panel per configuration; the GIF plays the cycle at the row's rate |
| `edge-cases/*.png` | chosen frames cropped and zoomed, with a diff panel. `pinholes-*` compare Gap Black with pinholes open and filled |
| `metrics.md`, `metrics.json` | totals, per-row flicker, holes, Ridge vs Classic, invariants, frames with 1 px holes still open |
| `manifest.json` | SHA-256 of every file written |

## Reproducibility

On one machine the output is byte-for-byte the same from run to run, captures included: two full runs give identical `manifest.json` hashes. Rendering is fixed by the presets, seed, settings and camera, and the PNG encoding (the app's own, then ImageMagick with `-strip`) carries no timestamps.

Across machines, the WebGL rasterisation can differ slightly with the GPU, driver or Firefox version. That would show as small differences in `samples/` and in the metrics. To compare two machines, compare `metrics.md` rather than hashes. ImageMagick and font versions can change the label pixels only.
