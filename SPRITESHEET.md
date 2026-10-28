# Using an ssheet sprite sheet in your game

Every export produces two files:

| File | What it is |
|------|------------|
| `<name>-<team>.png` | The sprite sheet (RGBA PNG, transparent background). **💾 export all team colors** writes one PNG per team colour. |
| `<name>.json` | The atlas data: frame size, layout, animations (row, frame count, fps, loop), directions, ground anchor, palette and team colours. |

You need both. The PNG holds the pixels and the JSON tells you where each frame is. Don't hardcode frame counts or rows. They change with the frame-count settings, and a custom model sheet only includes the animations that have a clip assigned.

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

Example from a default humanoid (32 px frames, default frame counts; the palette is truncated here):

```json
{
  "frameWidth": 32,
  "frameHeight": 32,
  "columns": 5,
  "rows": 28,
  "directions": ["N", "NE", "E", "SE", "S"],
  "mirrored": { "NW": "NE", "W": "E", "SW": "SE" },
  "anchor": { "x": 16, "y": 25 },
  "animations": {
    "idle":   { "row": 0,  "frames": 4, "fps": 4, "loop": true  },
    "walk":   { "row": 4,  "frames": 5, "fps": 8, "loop": true  },
    "attack": { "row": 9,  "frames": 5, "fps": 8, "loop": false },
    "cast":   { "row": 14, "frames": 6, "fps": 8, "loop": false },
    "death":   { "row": 20, "frames": 4, "fps": 6, "loop": false },
    "channel": { "row": 24, "frames": 4, "fps": 6, "loop": true  }
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
| `palette` | Every colour the sprites can use. Index 0 is transparent. |
| `team` | Team-colour recolouring info (see below). |
| `image` / `imageTeam` | Single-team export: the PNG's filename and which team colour it was drawn in. |
| `images` | "Export all team colors": a map of team name → PNG filename (replaces `image`). |
| `unit` / `model` | What the sheet was generated from. Your game can ignore these. |

## Playing animations

```
frameIndex = floor(elapsedSeconds * fps)
if loop: frameIndex = frameIndex mod frames
else:    frameIndex = min(frameIndex, frames - 1)   // hold the last frame
```

One-shot animations (`attack`, `cast`, `death`) are rendered so the last frame is the end pose. For `death`, hold that frame as the corpse. A ghost's last death frame is empty, because it fades away and leaves no corpse. For `attack` and `cast`, switch back to `idle` or `walk` once the last frame has played, and trigger the hit or spell on a frame of your choice (often around 60% of the way through).

Looping animations (`idle`, `walk`, `channel`) are rendered without a duplicate end frame, so they wrap straight from the last frame back to frame 0.

`channel` is a sustained spell: the unit holds both hands out with a pulsing spell in front of them. Play it for as long as the unit is channelling, such as for a beam, a heal over time or a summon, then switch back to `idle`. A game will usually draw the beam or other target effect itself, starting from the spell's position.

Beast sheets have the same rows: `attack` is a bite, `cast` a roar or, for beasts with magic breath, a spat spell, and `channel` a snarl or a steady breath stream. Their last `death` frame is the body lying on its side, or on its back for lizards and crocodiles.

New animations are added after the existing ones (`channel` comes after `death`), so the rows of animations that were already in a sheet don't move when you re-export.

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

## Team colours

Units use a reserved 4-shade "team" ramp for their team-coloured parts. There are two ways to get coloured units into your game:

1. **One PNG per team (simplest).** Use **💾 export all team colors**. The JSON's `images` map gives the PNG for each team. Load the one you need.
2. **Recolour at runtime from a single PNG.** The PNG is RGBA rather than indexed, so you swap colours by RGB value. Every pixel whose colour equals `team.colors[imageTeam][s]` becomes `team.colors[targetTeam][s]`, for shades `s = 0..3`. Do this once per team, when loading or in a shader, and cache the result.

   Caveat: the `red` team ramp has the same RGB values as the regular `red` cloth ramp. If a unit uses `red` for non-team cloth, export with a non-red `imageTeam` (e.g. blue) before recolouring at runtime. Otherwise the red cloth will be recoloured too.

`team.indices` and `palette` are palette indices, kept for tools that convert the sheet to an indexed or paletted format. They aren't needed for normal RGBA use.
