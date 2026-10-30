# Using an ssheet sprite sheet in your game

Every export produces two files, plus a third if you ask for it:

| File | What it is |
|------|------------|
| `<name>-<team>.png` | The sprite sheet: an indexed (palette) PNG whose palette is the JSON's `palette`, with index 0 transparent. Any image loader reads it like a normal PNG. **💾 export all team colors** writes one PNG per team colour. |
| `<name>.json` | The atlas data: frame size, layout, animations (row, frame count, fps, loop), directions, ground anchor, palette and team colours. |
| `<name>-team-mask.png` | Only with **team mask** ticked: the team-coloured pixels on their own, for recolouring in a shader (see [Team colours](#team-colours)). |

You need the first two. The PNG holds the pixels and the JSON tells you where each frame is. Don't hardcode frame counts or rows. They change with the frame-count settings and with the animations checked in the **Export** folder (by default `idle`, `walk`, `attack` and `death`). A custom model sheet also only includes the animations that have a clip assigned.

## Sheet layout

The sheet is a uniform grid of `frameWidth × frameHeight` cells:

- **Columns = directions**, always in the order of `directions`: `N, NE, E, SE, S`.
- **Rows = frames**, with animations stacked top to bottom. Animation `a` takes rows `a.row` through `a.row + a.frames - 1`.

```
          N     NE    E     SE    S
row 0   [idle0][idle0][idle0][idle0][idle0]
row 1   [idle1] ...
row 2   [idle2] ...
row 3   [idle3] ...
row 4   [walk0] ...          <- animations.walk.row = 4
...
```

The source rectangle of frame `i` of animation `anim`, facing `dir`:

```
col = directions.indexOf(dir)
x   = col * frameWidth
y   = (animations[anim].row + i) * frameHeight
w   = frameWidth
h   = frameHeight
```

### Directions and mirroring

Only five directions are rendered. The west-facing ones are the east-facing frames flipped horizontally, as listed in `mirrored`:

| Wanted | Draw column | Flip X |
|--------|-------------|--------|
| NW | NE | yes |
| W  | E  | yes |
| SW | SE | yes |

`S` faces the camera (toward the viewer) and `N` faces away. On screen, N is up and E is right.

### Ground anchor

`anchor` is the pixel inside every frame where the unit's feet touch the ground. `anchor.x` is always `frameWidth / 2`, so flipped frames keep the same anchor. To place a unit at world/screen position `(px, py)`:

```
drawX = px - anchor.x
drawY = py - anchor.y
```

Use `py` (the foot position) for depth sorting.

## The JSON file

Example from a default humanoid (32 px frames, default frame counts, every animation checked; the palette is truncated here):

```json
{
  "frameWidth": 32,
  "frameHeight": 32,
  "columns": 5,
  "rows": 57,
  "directions": ["N", "NE", "E", "SE", "S"],
  "mirrored": { "NW": "NE", "W": "E", "SW": "SE" },
  "anchor": { "x": 16, "y": 25 },
  "animations": {
    "idle":   { "row": 0,  "frames": 4, "fps": 4, "loop": true  },
    "walk":   { "row": 4,  "frames": 5, "fps": 8, "loop": true  },
    "attack": { "row": 9,  "frames": 5, "fps": 8, "loop": false },
    "cast":   { "row": 14, "frames": 6, "fps": 8, "loop": false },
    "death":   { "row": 20, "frames": 4, "fps": 6,  "loop": false },
    "channel": { "row": 24, "frames": 4, "fps": 6,  "loop": true  },
    "hit":     { "row": 28, "frames": 3, "fps": 10, "loop": false },
    "run":     { "row": 31, "frames": 6, "fps": 12, "loop": true  },
    "work":    { "row": 37, "frames": 5, "fps": 8,  "loop": true  },
    "carry":   { "row": 42, "frames": 5, "fps": 8,  "loop": true  },
    "taunt":   { "row": 47, "frames": 6, "fps": 8,  "loop": false },
    "decay":   { "row": 53, "frames": 4, "fps": 0.125, "loop": false, "hold": 8 }
  },
  "palette": [[0, 0, 0], [58, 10, 10], "..."],
  "team": {
    "indices": [1, 2, 3, 4],
    "colors": {
      "red":  [[58, 10, 10], [122, 20, 20], [184, 36, 36], [232, 90, 74]],
      "blue": [[12, 22, 80], [28, 56, 160], [52, 98, 224], [122, 166, 255]],
      "...": []
    }
  },
  "image": "knight-1234-red.png",
  "imageTeam": "red",
  "imageFormat": "indexed",
  "unit": { "...": "generator settings, for reference only" }
}
```

| Field | Meaning |
|-------|---------|
| `frameWidth`, `frameHeight` | Size of one cell in pixels. |
| `columns`, `rows` | Grid size. Sheet size is `columns × frameWidth` by `rows × frameHeight`. |
| `directions` | Column order. |
| `mirrored` | Directions not in the sheet → the column to draw flipped. |
| `anchor` | Ground contact point inside a frame. |
| `animations.<name>.row` | First row of the animation. |
| `animations.<name>.frames` | Number of frames (rows) in the animation. |
| `animations.<name>.fps` | Intended playback speed. |
| `animations.<name>.loop` | `true` = loop forever; `false` = one-shot that stops on its last frame. |
| `animations.<name>.hold` | Only on `decay`: seconds to show each frame. `fps` is `1 / hold`, so the usual playback below works unchanged. |
| `palette` | Every colour the sprites can use. Index 0 is transparent. |
| `team` | Team-colour recolouring info (see below). |
| `image` / `imageTeam` | Single-team export: the PNG's filename and which team colour it was drawn in. |
| `images` | "Export all team colors": a map of team name → PNG filename (replaces `image`). |
| `imageFormat` | `"indexed"`: the PNGs store palette indices. Older exports without this field are RGBA. |
| `teamMask` | The team mask's filename, when one was exported. |
| `unit` / `model` | What the sheet was generated from. Your game can ignore these. |

## Playing animations

```
frameIndex = floor(elapsedSeconds * fps)
if loop: frameIndex = frameIndex mod frames
else:    frameIndex = min(frameIndex, frames - 1)   // hold the last frame
```

One-shot animations (`attack`, `cast`, `death`, `hit`, `taunt`) are rendered so the last frame is the end pose. For `death`, hold that frame as the corpse, or play `decay` after it (see below). A ghost's last death frame is empty, because it fades away and leaves no corpse. For `attack`, `cast`, `hit` and `taunt`, switch back to `idle` or `walk` once the last frame has played, and trigger the hit or spell on a frame of your choice (often around 60% of the way through).

Looping animations (`idle`, `walk`, `channel`, `run`, `work`, `carry`) are rendered without a duplicate end frame, so they wrap straight from the last frame back to frame 0.

`decay` is optional (check it in the **Export** folder). It is the corpse rotting away in stages, one stage per frame. Its frame 0 is the same body as `death`'s last frame, and its last frame is bare bones. Switch to it as soon as `death` has played. Show each frame for `hold` seconds, which is what `fps` gives you, and remove the corpse once the last frame has been shown for `hold` seconds too, `frames × hold` seconds after `death` ended:

```
t = secondsSinceDeathEnded
if t >= decay.frames * decay.hold: remove the corpse
else: frameIndex = floor(t / decay.hold)
```

A unit that leaves no corpse (a ghost, or any see-through unit, which fades away as it dies) has no `decay` row. For vehicles, `decay` is the wreck burning out to charred beams; for buildings, the ruins weathering and settling.

`channel` is a sustained spell: the unit holds both hands out with a pulsing spell in front of them. Play it for as long as the unit is channelling, such as for a beam, a heal over time or a summon, then switch back to `idle`. A game will usually draw the beam or other target effect itself, starting from the spell's position.

`hit` is a short flinch: the unit is knocked back and recovers to its standing pose. Play it over whatever the unit was doing when it takes damage, then go back to that. `run` is a faster gait than `walk`, for charging or fleeing; its legs cover more ground per loop, so move the unit faster while it plays. `work` swings the unit's tool or weapon down into the ground in front of it, so it reads as mining, chopping, digging or building. `carry` is a walk with a sack over the shoulder of the empty hand, for workers taking resources home. `taunt` is a challenge: the unit raises its weapon overhead and shakes it, shouting, while an empty free hand beckons. Play it on a command or when idle units spot an enemy.

Beast sheets have the same rows: `attack` is a bite, `cast` a roar or, for beasts with magic breath, a spat spell, `channel` a snarl or a steady breath stream, `hit` a yelp and recoil, `run` a gallop (a fast scramble for lizards and crocodiles), `work` digging with the front paws, `carry` a plodding walk with packs on the back, and `taunt` rearing up to paw the air (lizards and crocodiles snap and lash their tails instead; winged beasts spread their wings). Their last `death` frame is the body lying on its side, or on its back for lizards and crocodiles.

Animations are always stacked in the same order (`idle`, `walk`, `attack`, `cast`, `death`, `channel`, `hit`, `run`, `work`, `carry`, `taunt`, and `decay` always last), but unchecked ones leave no gap, so a row number depends on which animations were exported. Always read `row` from the JSON. If an animation isn't in `animations`, it wasn't exported.

### Picking a direction from movement

With screen coordinates where y points down:

```ts
const DIRS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

function directionOf(dx: number, dy: number): (typeof DIRS8)[number] {
  const angle = Math.atan2(dx, -dy);              // 0 = up (N), clockwise
  const sector = Math.round(angle / (Math.PI / 4));
  return DIRS8[(sector + 8) % 8];
}
```

## Example: loading and drawing (TypeScript + Canvas 2D)

This works in any engine that can draw a sub-rectangle of a texture, optionally flipped.

```ts
interface SheetMeta {
  frameWidth: number;
  frameHeight: number;
  directions: string[];
  mirrored: Record<string, string>;
  anchor: { x: number; y: number };
  animations: Record<string, { row: number; frames: number; fps: number; loop: boolean }>;
}

async function loadSheet(jsonUrl: string, pngUrl: string) {
  const meta: SheetMeta = await (await fetch(jsonUrl)).json();
  const image = new Image();
  image.src = pngUrl;
  await image.decode();
  return { meta, image };
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  sheet: { meta: SheetMeta; image: HTMLImageElement },
  anim: string,
  dir: string,          // any of the 8 directions
  elapsed: number,      // seconds since the animation started
  x: number,            // foot position on screen
  y: number,
) {
  const { meta, image } = sheet;
  const a = meta.animations[anim];
  if (!a) return;       // animation not in this sheet

  let frame = Math.floor(elapsed * a.fps);
  frame = a.loop ? frame % a.frames : Math.min(frame, a.frames - 1);

  const flip = dir in meta.mirrored;
  const col = meta.directions.indexOf(flip ? meta.mirrored[dir] : dir);

  const sx = col * meta.frameWidth;
  const sy = (a.row + frame) * meta.frameHeight;
  const { frameWidth: w, frameHeight: h, anchor } = meta;

  ctx.save();
  ctx.imageSmoothingEnabled = false;   // keep pixels crisp
  ctx.translate(Math.round(x), Math.round(y));
  if (flip) ctx.scale(-1, 1);          // anchor.x is the frame centre, so this flips in place
  ctx.drawImage(image, sx, sy, w, h, -anchor.x, -anchor.y, w, h);
  ctx.restore();
}
```

### Engine notes

- **Phaser / PixiJS / Godot / Unity / etc.**: slice the PNG as a uniform grid of `frameWidth × frameHeight`. The frame number in a row-major grid is `(row * columns) + col`. Build one animation per `(animation, direction)` pair from the `row`/`frames` values. For the west directions, reuse the east animation with the sprite's horizontal flip turned on.
- Set the sprite's origin/pivot to `anchor`, in pixels, or as the fraction `(anchor.x / frameWidth, anchor.y / frameHeight)`.
- Use nearest-neighbour filtering and integer positions or scales to keep the pixel art sharp.

## The effects sheet

**💾 export effects** writes a second sheet of projectiles and hit effects: `<name>-effects-<team>.png` and `<name>-effects.json`. It has the same grid, JSON fields and palette as a unit sheet, so the same loading code reads it. Rows are effects instead of animations: `arrow`, `bolt`, `fireball`, `impact`, `puff`, `stone` and `javelin`, in that order. The JSON's `magic` names the colour the spells were drawn in.

Differences from a unit sheet:

- **The anchor is the frame centre, not the feet.** Draw an effect with its `anchor` at the projectile's position, `drawX = px - anchor.x`, `drawY = py - anchor.y`. Projectiles fly at whatever height your game gives them; the sheet doesn't bake one in.
- **Columns are flight directions.** Projectiles point the way they're flying. Pick the column with `directionOf(dx, dy)` from [Picking a direction from movement](#picking-a-direction-from-movement), using the projectile's velocity, and mirror the west-facing ones as for units. The sprites are drawn level, with no tilt for an arrow's arc, so either draw the same frame all the way or rotate it slightly in your engine.
- **`impact` and `puff` look the same from every direction.** Use any column, `S` for example.
- **One-shots end faint, not empty.** `impact` and `puff` play once and fade to about a quarter of their opacity by the last frame. Remove the effect once that frame has played. Don't hold it as you would a corpse.
- **Team colour:** only the arrow's fletching uses the team ramp, so recolour it per player in the same ways as units ([Team colours](#team-colours)).

## The portrait

**💾 export portrait** writes a close-up of the unit for a selection panel or command card: `<name>-portrait-<team>.png` and `<name>-portrait.json`. It's indexed with the same palette as the sheet, so it recolours per team the same ways ([Team colours](#team-colours)).

- **One direction, no anchor.** A portrait is a single square view, so there are no direction columns or ground anchor to deal with. Draw it where your UI wants it.
- **A still or a strip.** `frames` is 1 for a still. Otherwise the frames run left to right, `frameWidth` apart, and loop at `fps` (the unit's `idle`, close up). Frame `i` is at `x = i * frameWidth`, `y = 0`.
- **The background is part of the image.** With `background` set to `dark` or `team` the frame is filled, so it's opaque. A `team` background uses the darkest team shade, which means it's in the team mask and swaps with the rest of the team colour. `border` is a 1 px bevel drawn over the edge pixels in steel shades.

```json
{
  "frameWidth": 64, "frameHeight": 64,
  "frames": 4, "fps": 4, "loop": true,
  "background": "dark", "border": true,
  "palette": [[0, 0, 0], ...],
  "team": { "indices": [...], "colors": { ... } },
  "image": "swordsman-1-portrait-red.png", "imageTeam": "red", "imageFormat": "indexed"
}
```

## Team colours

Units use a reserved 4-shade "team" ramp for their team-coloured parts. There are three ways to get coloured units into your game:

1. **One PNG per team (simplest).** Use **💾 export all team colors**. The JSON's `images` map gives the PNG for each team. Load the one you need.
2. **Swap palette entries.** The PNG is indexed, and its team-coloured pixels use the palette entries `team.indices` (4 entries, dark to light). To recolour a unit for team `t`, replace palette entry `team.indices[s]` with `team.colors[t][s]` for shades `s = 0..3` before decoding the image, or in a palette shader. Nothing else in the sheet uses those entries.
3. **Recolour in a shader with the team mask.** Tick **team mask** before exporting to also get `<name>-team-mask.png`. It's the size of the sheet and transparent everywhere except the team-coloured pixels. There, the grey value gives the shade: 0, 85, 170 and 255 for shades 0–3. Sample the sheet and the mask at the same UV:

   ```glsl
   vec4 m = texture(teamMask, uv);
   if (m.a > 0.5) {
     int s = int(round(m.r * 3.0));      // 0..3
     color.rgb = teamColors[s];          // team.colors[t][s], passed in as uniforms
   }
   ```

   The mask is the same for every team, so one mask serves all of them.

Ways 2 and 3 pick out the team pixels by palette index rather than by colour. That avoids a trap in recolouring by RGB value: the `red` team ramp has the same colours as the regular `red` cloth ramp, so a colour-based swap would recolour red cloth too. If you do recolour by RGB value, for instance from an older RGBA export, export with a non-red `imageTeam` first.
