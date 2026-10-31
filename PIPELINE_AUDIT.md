# Sprite post-processing pipeline: audit

What turns a supersampled 3D render into an indexed sprite frame, where it loses information, and what's worth trying to make small sprites read better.

> The first two proposals, ridge-preserving coverage (§4 A) and the colored outer outline (§5 1), are now implemented as opt-in options, along with two refinements of the outline (`stableColored`, `gapBlack`). The results are in [QUALITY_EXPERIMENTS.md](QUALITY_EXPERIMENTS.md). Nothing described here changes what's exported yet. The only code changes so far are a behaviour-preserving split of `shadeFrame` into stages, a dev-only diagnostics panel, and tests.

## 1. The pipeline as it is

Verified against the code. Line references are to the files as of this audit.

| # | Stage | Where | What it does |
|---|-------|-------|--------------|
| 0 | Sprite shader | `materials.ts` fragment shader | In sprite mode, writes `R = (ramp + 1) * ID_STEP` (8), `G = light = clamp(ambient + diffuse·max(n·l, 0) + fill·max(n.z, 0), minLight, 1)`, `B = 0` (unused), `A = 1`. Lighting is in view space, so every direction is lit the same. |
| 1 | Supersampled render | `SpriteRenderer.frame` | Orthographic camera, target `frameSize·ss` square, **no MSAA** (ids must not blend), depth test on but depth never read back. `ss` defaults to 8, at most 15 (8-bit counters), with the target capped at 2048 px (so 256 px frames get 8×). The ground anchor and the frame's centre line fall on pixel boundaries. |
| 2 | Gather (`sampleFrame`) | `postprocess.ts` | Per output pixel, it counts all covered samples and, per ramp, the samples and their summed light. It keeps **only** the ramp with the most samples (on a tie, the first seen in WebGL order: the bottom sample row of the block, left to right), that ramp's count and its light sum. All other ramps' counts and light are dropped. The result, `FrameSamples`, is kept so the frame can be reshaded without rendering it again. |
| 3 | Shade (`shadePixels`) | `postprocess.ts` | A pixel is opaque if `covered ≥ max(1, round(ss²·coverage))` (default 0.3 → 19 of 64 samples). Coverage counts **every** ramp, but colour and light come from the dominant ramp alone. The shade is the dominant ramp's average light against `thresholds` (default 0.4 / 0.62 / 0.86): four shades. |
| 4 | Outline (`outline`) | `postprocess.ts` | Works on the binary silhouette only, with 4-neighbours. **inner**: an opaque pixel with a transparent 4-neighbour drops to shade 0 of its own ramp. **outer**: a transparent pixel with an opaque 4-neighbour becomes `OUTLINE_INDEX` (`dark` shade 0 = `#000000`). Outside the frame counts as transparent. |
| 5 | Dither (`dither`) | `postprocess.ts` | Only when opacity < 1. A 4×4 Bayer matrix with the pattern shifted by `phase` = frame index. Glow ramps (`MAGIC_RAMPS`) fade half as fast. It runs **after** the outline, so outline pixels are dithered too. |
| 6 | Mirror, pack | `mirrorFrame`, `packer.ts` | W, SW and NW are E, SE and NE flipped. Frames are packed into the indexed sheet unchanged. |

Notes beyond the brief:

- The default outline is **`inner`**, not `outer` (`DEFAULT_SPRITE_SETTINGS`).
- Portraits and the effects sheet go through the same `shadeSprite`, so any change to stages 2–5 changes them too. That includes arrows, whose shafts are about 1 px wide.
- The render already writes nothing to the blue channel, and the depth buffer is never read: two free sources of information.
- The geometry already works around losses by hand. For example, `parts.ts:85` has a nose guard "wide enough to keep its pixel at 32 px".

## 2. Where information is lost

In rough order of how much it hurts readability at 32 px.

| Loss | Stage | Consequence | Evidence |
|------|-------|-------------|----------|
| **Fixed coverage threshold** binarises each pixel on its own | 3 | Parts near 1 px wide come out 1 or 2 px depending on where they fall between pixels. Parts ≤ ½ px wide vanish at some offsets. Many weapon parts are 0.04 world units ≈ 0.56 px at 14 px/unit; arrow shafts are ≈ 0.98 px. | Test *known limitations*: a 1 px bar at the 8 sub-pixel offsets draws `1 1 1 2 2 2 1 1` px wide; a ⅜ px bar draws `1 1 1 1 1 1 0 0`. |
| **Dominant-ramp vote** drops minority materials | 2 | A thin line of one material over a larger one (belt, hilt, strap, eye, shield rim) never wins a block and disappears. Mixed pixels are shaded from the winner's light only. The vote is by area, with no notion of importance or of what's in front. | Test *dominant ramp › loses a thin line*. In the swordsman's S walk frame 1, 69 of 174 drawn px are mixed, and 11.1% of drawn samples belonged to a losing ramp (diagnostics panel). |
| **No depth or part information** | 0–2 | Overlapping parts of the same ramp (an arm in front of a same-coloured torso) merge into one blob. Inner contours can't be recovered in post-processing. | `B = 0`; depth is not read. |
| **4-neighbour, silhouette-only outline** | 4 | **outer**: a one-pixel silhouette change becomes 3 changed pixels; 1 px gaps (between legs) fill with black; a 1 px diagonal becomes a 3 px staircase; every material gets the same pure black outline. **inner**: parts ≤ 2 px wide lose their colour completely (only shade 0 is left), which is likely why outer reads better at small sizes. | Tests *outer outline (the baseline to keep)* and *inner outline*. |
| **Light averaged, then quantised to 4 shades** | 3 | A tiny change of normal near a threshold flips a pixel's shade, so shade boundaries crawl between frames. | — |
| **Tie-break direction** | 2 | Ties go to the bottom-left samples, so a mirrored E frame isn't what rendering W would give. This is minor, but it biases every direction the same way. | Test *dominant ramp › west-facing render*. |
| **Dither phase period 4** | 5 | A loop with a frame count that isn't a multiple of 4 has two consecutive frames with the same pattern at the wrap (5-frame walk: phases 0 1 2 3 0). The outline of a see-through unit gets holes. | Tests *dither › repeats every 4 phases*, *outer › is dithered along*. |

## 3. Post-processing alone, or the sampling stage too?

**Solvable entirely in post-processing** (the data is already in `FrameSamples`; reshading needs no render):

- Coverage decisions that look at neighbours' `covered`: ridge-preserving thresholds, picking one of two half-covered pixels (§4 A).
- Temporal hysteresis across a direction's frames: `shadeSprites` has them all (§4 B).
- Every outline variant that works on the silhouette and ramp map: 8-neighbour, selective/coloured, light-side, internal lines at **material** boundaries (§5 1–3).
- Shade hysteresis between frames (light sums are kept).
- Dither phase choices (for example, phase from `i·4/frames`, or a per-row period).

**Needs the sampling stage** (`sampleFrame` / `FrameSamples` extended; still CPU, and existing exports stay valid):

- Anything using **secondary materials**: keep the top 2–3 ramps per pixel with their counts and light, instead of only the winner (§4 C).
- Weighted (tent or Gaussian) sample filters instead of a box (§4 E).
- Sub-pixel positions: a coverage centroid per pixel, to place thin parts consistently.
- Outlines computed at the supersampled resolution (§5 4) and sample-level thinning or dilation.

**Needs the shader too** (`materials.ts`, sprite mode only; the preview is unaffected):

- Depth (or a part id) in the free blue channel, for depth-aware voting (§4 D) and internal contours at depth discontinuities (§5 3).

## 4. Downsampling strategies worth testing

Keep the current box filter + majority vote + fixed threshold as the reference (`classic`). Every candidate below can sit next to it as an option and be compared in the diagnostics panel.

- **A. Ridge-preserving coverage** (post only). A pixel is drawn if `covered ≥ t`, or if `covered ≥ t_low` and it's a local maximum of coverage across the part (along x or y). Of two half-covered neighbours, only the stronger is drawn (ties broken consistently). Thin parts then always come out exactly 1 px, never 0 or 2. Targets the bar-width flicker directly. One 3×3 pass over `covered`.
- **B. Temporal hysteresis** (post only). For pixels whose coverage is within ε of the threshold, reuse the previous frame's decision; loops wrap with two passes. Cuts blinking of near-threshold pixels, at the risk of a frame of lag. It must stay within one row and one direction.
- **C. Weighted material vote** (sampling stage: top 2–3 ramps per pixel). Score = `count × w(ramp)`, with `w` favouring small, high-contrast materials (metal, skin, gold, magic, eyes) or the inverse of a ramp's share of the frame. Alternatively, a minority ramp wins if it forms a thin connected line across neighbouring blocks. Brings back belts, hilts and eyes.
- **D. Nearest-surface vote** (shader + sampling). With 8-bit depth in B, a ramp that is in front and has at least k samples beats a larger ramp behind it, so a weapon held in front of the body survives.
- **E. Tent or Gaussian sample weights** (sampling stage). Samples near the block centre count more, so coverage changes smoothly with sub-pixel motion instead of in steps. Cheap: a precomputed `ss × ss` weight table, with 16-bit sums.
- **F. Centre-sample point sampling** (reference only). The crispest, most aliased baseline, useful to see what supersampling buys.

## 5. Outline algorithms worth testing

1. **Selective outline ("sel-out")** (post only). It keeps outer's silhouette (the baseline look) but colours each outline pixel from its neighbouring ramp's shade 0 instead of black, optionally pure black only on the shadow side (the key light comes from the upper left, azimuth −35°). It reads lighter and separates materials at the edge. Team-ramp neighbours give team-coloured outline pixels, which recolour per player through `TEAM_INDICES` and the team mask like any team pixel. Decide whether that's wanted.
2. **8-neighbour outer** (post only). Closes the open convex corners of the 4-neighbour ring, so the edge is heavier and blockier. A one-line change worth comparing.
3. **Internal contour lines** (post only for material boundaries; depth needed for same-material overlaps). A dark line where the ramp (or depth) changes inside the silhouette. Draw it on the far or darker side so it's 1 px, and skip parts ≤ 2 px wide so it doesn't eat them (the inner outline's failure).
4. **Supersampled outline** (sampling stage). Dilate the silhouette at sample resolution by `ss` samples and downsample that ring as a lowest-priority "material". The outline then follows the true geometry instead of the already-quantised silhouette, so it doesn't amplify a one-pixel change into three.
5. Variant of 1 or 2: **gap-keeping**. Leave a transparent pixel unfilled when it has opaque neighbours on opposite sides, so legs and arms 1 px apart don't fuse into a black mass.

## 6. Causes of temporal flicker

1. **Sub-pixel motion against the fixed coverage threshold**: widths jump 1↔2 px and thin parts blink. The largest source, measured above.
2. **Outline amplification**: every silhouette pixel that flips changes up to 3 pixels with the outer outline.
3. **Majority flips** at material boundaries where two ramps are near 50%, plus the tie-break order.
4. **Shade quantisation** near the light thresholds as normals turn.
5. **Dither** (intentional shimmer), with the period-4 mismatch at loop wraps.
6. **Whole-body sub-pixel motion** from the animation (hips bob, lean): every edge of the body moves together. Animation is out of scope here; a post-processing fix can only damp it (A, B, E).

In the swordsman's S walk row, 81.8 px change per frame on average, of about 174 drawn px. Watch this number in the diagnostics panel when comparing strategies.

## 7. Diagnostics mode

`npm run dev`, then open the page with `?diag` (e.g. `http://localhost:5173/?diag`). A **Diagnostics** panel appears at the top of the side panel, and a **Diagnostics (dev)** folder in the menu picks the direction and frame of the previewed animation.

| Stage | Shows |
|-------|-------|
| supersampled | The raw pass at `ss×`, each sample posterised to its ramp shade (as the 3D preview draws it). |
| coverage | Covered fraction per pixel, black to white. Pixels the coverage setting drops are pink. |
| ramp | The dominant ramp per pixel, drawn or not. |
| ramp purity | White where the block was all one ramp, shading to orange as more of it belonged to ramps that lost. |
| shaded | Before the outline. |
| outlined | After the outline. |
| final | After dithering: what's exported. |
| Δ prev frame | Green appeared, red disappeared, yellow changed colour since the previous frame (wrapping for loops). |

Below the stages are counts: min coverage in samples, touched, drawn, dropped and mixed pixels, the share of samples lost to the vote, changes against the previous frame, and the row's average change per frame.

Changing outline, min coverage or the shade thresholds reshades every stage without rendering. The raw pass is only kept for the previewed row (64 MB budget: every frame at up to 64 px, 32 frames at 128 px, 8 at 256 px), as it's rendered. After switching the preview, press **↻ render again, keeping passes**. Production builds leave the panel out: the dynamic import sits behind `import.meta.env.DEV`, and the built bundle contains no diagnostics code (checked).

## 8. Tests

`test/postprocess.test.ts` (new suites) and `test/diagnostics.test.ts`; shared builders are in `test/passes.ts`. Passes and frames can be written as text, one character per sample or pixel.

- **Outer outline baseline**: FNV hashes of six noisy frames (sizes 16–32, ss 4–12, opacities 1, 0.5 and 0.25), computed from the code **before** this change, so the outer-outline output is pinned byte for byte. Hand-written cases cover the open corners, the diagonal staircase, gap filling, the uniform black, ×3 change amplification and dithered outlines.
- **shadeStages**: equals `shadeFrame` for every outline mode, steps in order, passes frames through no-op steps.
- **Coverage threshold**: the rounding of `minCovered`, the exact cut-off at 18 and 19 of 64, all ramps counting toward coverage while only the dominant one shades.
- **Dominant ramp**: tie-break order, mirror asymmetry, a lost minority line.
- **Known limitations**: bar width and blinking against sub-pixel offset; the inner outline eating parts ≤ 2 px wide. These record current behaviour and are **expected to change** once a better strategy is chosen for that mode.
- **Dither**: checkerboard, phase shift, period 4, glow ramps.
- **Diagnostics**: `compactRaw` agrees with `sampleFrame` sample for sample, plus the stage images, `frameStats` and `frameDiff`.

## 9. Files the next step will touch

| File | Change |
|------|--------|
| `src/render/postprocess.ts` | New strategies as selectable functions beside the current ones, which stay as `classic`. |
| `src/render/postprocess.ts` → `FrameSamples`, `sampleFrame` | Top-k ramps and their light (C), weighted sums (E: wider counters), optionally depth (D). |
| `src/render/materials.ts` | Depth or part id in B, sprite mode only (D, internal contours). |
| `src/render/spriteRenderer.ts` | `PostprocessSettings` / `DEFAULT_SPRITE_SETTINGS` gain a strategy field. |
| `src/main.ts` | GUI controls; `SHARE_CHOICES` for the new option lists (`sprite.outline` is validated against `OUTLINES`). |
| `src/ui/diagnosticsPanel.ts` | An A/B toggle for strategy overrides that don't touch the export settings. |
| `README.md`, `SPRITESHEET.md` | Document new settings. Export formats don't change: output stays indexed on the same palette. |
| tests | Golden hashes stay for `classic` + outer; the known-limitation tests move to the new strategy's expectations. |

**Compatibility caution:** share links (`share.ts`) store only the differences from the defaults. Changing a **default** (outline, coverage, or a new strategy's default) silently changes what every old link renders. New settings should default to today's behaviour, and the current outline default should stay as is unless that's accepted.

## 10. Performance

Measured on this machine (Node via vite-node, the same code as the browser's CPU side):

| Frame | `sampleFrame` | `shadeFrame` (outer) |
|-------|---------------|----------------------|
| 32 px, ss 8 | 0.45 ms | 0.08 ms |
| 64 px, ss 8 | 1.34 ms | 0.09 ms |
| 128 px, ss 8 | 4.8 ms | 0.28 ms |
| 256 px, ss 8 | 19 ms | 1.1 ms |

A full humanoid sheet is about 60 rows × 5 directions ≈ 300 frames: about 135 ms of gathering per render and about 25 ms per reshade at 32 px. The GPU draw plus the synchronous `readRenderTargetPixels` per frame was not measured here and probably dominates a render.

Expected cost of the candidates:

- **Post-only** (A, B, outlines 1–3, 5): 1–3 extra passes over `w × h`, about +0.05–0.3 ms per 32 px frame. Reshading stays interactive.
- **Top-k ramps** (C): small constant in `sampleFrame`; +3–6 bytes per pixel kept.
- **Weighted samples** (E): about +20–40% of `sampleFrame`, on render only.
- **Supersampled outline** (§5 4): about one more `sampleFrame`-sized pass, on render only (or keep the raw pass: 128 KB per 32 px frame).
- **Depth in B** (D): no extra read; the shader cost is negligible.
- **Diagnostics**: none in production. In dev with `?diag`, one compact copy per previewed frame (about 0.3 ms and 128 KB at 32 px), and the panel reshades one direction's row whenever it updates.

## Recommendation

1. Try **A (ridge-preserving coverage)** together with **sel-out outline** first. Both are post-only and directly target the biggest losses (thin-part width and blinking, heavy black edges), and they can be compared against `classic` outer in the diagnostics panel without re-rendering.
2. Then extend `FrameSamples` with the runner-up ramp and test **C**.
3. Depth in B (**D** and internal contours) last, as it's the only change to the render itself.
