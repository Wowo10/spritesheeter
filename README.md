# ssheet

A browser tool that renders retro, 90s-RTS-style unit sprite sheets from 3D. It builds a procedural humanoid, or loads your own model, poses it through a set of animations, and renders every frame from 5 directions. The frames are downsampled into crisp pixel art on a fixed palette with team colours. You export a PNG sheet and a JSON atlas that your game can read.

## Quick start

```sh
npm install
npm run dev       # open the URL Vite prints
```

Other scripts:

| Command | What it does |
|---------|--------------|
| `npm run build` | Type-checks and builds a static site into `dist/` |
| `npm run preview` | Serves the built `dist/` |
| `npm test` | Runs the unit tests (Vitest) |

## The interface

- **Left:** a 3D preview of the unit. Turn on **View → sprite camera** to look through the camera the sprites are rendered with.
- **Right, top:** the selected animation playing in all 8 directions, as it will look in game.
- **Right, below that:** the whole sprite sheet, and under it the [effects sheet](#effects).
- **Control panel:** every setting. The sheet re-renders as soon as you change something.

Drag the divider to resize the panels. Double-click it to reset.

### Unit

Pick a **type**: `humanoid`, `beast` (four-legged animals, see [Beasts](#beasts)), `mounted` (a humanoid riding a beast, see [Mounted units](#mounted-units)) or `vehicle` (siege engines, see [Vehicles](#vehicles)).

Pick a **preset** (swordsman, axeman, spearman, archer, knight, berserker, duelist, shieldbearer, worker, militia, mage, warlock, priest, shaman, guard, brute, ghost, zombie) or **🎲 randomize**. Typing a **seed** gives a repeatable random unit. You can then tweak:

- **Body:** height, bulk, head size, torso, shoulders, arm and leg proportions
- **Gear:** helmet, hair style, armour, cape, and an item in each hand (swords, axes, hammers, polearms, tools, torch, staff, magic orb, shields, bow). A bow takes both hands.
- **Colours:** skin, cloth, metal, hair, magic glow and cape. Every colour comes from a palette ramp.
- **Undead:**
  - **gait:** `walk`, `float` (hovers off the ground with the legs dangling) or `shamble` (lurches along dragging one leg, arms held out)
  - **body:** `normal`, or `ghost` (no legs; the body trails off into a wisp, and it fades away when it dies)
  - **opacity:** below 1 the sprite is drawn see-through as a dither pattern that shimmers between frames. Glowing colours (magic, eyes) stay more solid.
  - **glowing eyes:** eyes in the magic colour
  - **ground shadow:** a dark blob under the unit, which shrinks as the unit rises; it makes floating units readable

### Beasts

With **type** set to `beast`, the unit is a four-legged animal. Presets: wolf, hound, warhound, hellhound, ghostWolf, bear, boar, lion, panther, horse, rat, crocodile, lizard, dragon, griffin, salamander. **🎲 randomize** varies one of the basic body plans. You can then tweak:

- **Body:** size, bulk, body length and depth, leg length, neck, head, snout (or a hooked **beak**) and tail
- **sprawl:** `0` puts the legs straight under the body (dogs, bears); `1` splays them out to the sides (lizards, crocodiles). Sprawled beasts swing their body side to side as they walk, and roll onto their backs when they die.
- **Features:** ears (pointed, floppy, round), horns or tusks, and a back of mane, spikes, a bristly ridge, or a horse's crest along the neck
- **barding:** the team-coloured gear that shows whose beast it is: a collar, a saddle cloth, or armour plates over a team-coloured skirt
- **wings:** `bat` (membrane between finger bones) or `feathered`, with their size and colour. Grounded beasts keep them folded along their sides and spread them to bite, roar and snarl.
- **flying:** with wings, the beast stays in the air the whole time, flapping once per loop, its legs tucked up and its tail streaming behind. It drops to the ground when it dies. Turn on **ground shadow** so it reads as airborne. Spread wings are wide, so flying beasts look best at 48 px or larger.
- **Colours:** hide, belly, mane/spikes, metal and magic
- **magic breath:** the beast spits its spell in `cast` and breathes a steady stream of it in `channel`
- **opacity, glowing eyes, ground shadow:** as for humanoids. A see-through beast fades away when it dies.

Beasts fill the same sheet rows as humanoids: `attack` is a bite, `cast` is a roar (or spitting the spell, with magic breath), `death` keels over, `channel` is a snarling crouch (or the breath stream), `hit` is a yelp and recoil, `run` is a gallop (or a fast scramble for sprawled beasts), `work` digs with the front paws, `carry` plods along with packs on its back, and `taunt` rears up pawing the air (sprawled beasts snap and lash the tail instead; winged ones spread their wings). Long beasts like crocodiles nearly fill a 32 px frame; use 48 px or larger to give them room.

### Mounted units

With **type** set to `mounted`, a humanoid rides a beast. Presets: knight (on an armoured horse), wolfRider (an orc on a big wolf), griffinRider (a spearman on a flying griffin). **🎲 randomize** puts a random humanoid on a random horse, wolf, bear, boar or lion.

The **Rider** and **Mount** folders each start with a preset, to put any humanoid preset on any beast preset, followed by the usual controls for that unit. A few things are fixed by riding:

- The rider always sits the same way, so it has no gait, body, opacity or shadow controls.
- The mount always wears a seat: its **barding** is `saddle` or `armor`.
- The mount sets the opacity of the whole unit, and casts the only ground shadow. A ghost wolf makes its rider see-through too.
- Spells, and the effects sheet, use the rider's **magic color**.

The rider sits astride the saddle, knees out over the mount's flanks; on a low mount like a lizard, the legs stretch out forward instead. It moves with the mount, leaning forward when it rears. Each row plays a mount animation and a rider animation together:

| Row | Mount | Rider |
|-----|-------|-------|
| `idle` | idle | idle |
| `walk`, `carry` | walk, carry (with packs) | sits still, bobbing with the saddle |
| `run` | run | leans forward |
| `attack` | walks on | attacks with what it holds |
| `cast`, `channel` | stands | casts, channels |
| `hit` | flinches | flinches |
| `work` | digs | sits still |
| `taunt` | rears | shakes its weapon overhead |
| `death` | keels over | is thrown off and lands on the ground beside it |

A rider on its mount is far taller than a unit on foot, so switching to `mounted` raises the **frameSize** to 64 px. A wolf rider fits in 48 px.

### Vehicles

With **type** set to `vehicle`, the unit is a wheeled siege engine, without a crew. Presets: ram, catapult, ballista, flamethrower. **🎲 randomize** varies one of them. You can then tweak:

- **weapon:** what the frame carries:
  - `ram`: an iron-headed log hung on ropes from two A-frames
  - `catapult`: a throwing arm on a torsion axle, its cup holding a stone, with a winch at the back
  - `ballista`: a giant crossbow on a post, loaded with a javelin
  - `flamethrower`: a tank with a pump lever and a nozzle ending in a beast's head
- **Frame:** size, length and width, wheels per side (1–3) and their size
- **roof:** a peaked roof of hides over the deck. Only the ram and flamethrower get one; it would be in the way of a throwing arm or a bow.
- **banner:** a flag on a pole at a back corner
- **Colours:** wood, metal, roof and flag (team by default), and the flamethrower's **flame color**

Vehicles fill the same rows as units:

| Row | Vehicle |
|-----|---------|
| `idle` | stands still, the flag stirring; a flamethrower keeps a pilot light burning |
| `walk`, `carry` | rolls along, jolting, the wheels turning a quarter turn per loop |
| `run` | rolls twice as fast |
| `attack`, `cast` | fires: the ram swings back and strikes; the catapult's arm whips up against its crossbar and is winched back down; the ballista looses and is wound back; the flamethrower pumps out a burst of fire |
| `channel` | a flamethrower pours out a steady stream; anything else stands ready |
| `hit` | jolts and shudders |
| `work` | stands still |
| `taunt` | waves its flag; a flamethrower spurts fire |
| `death` | breaks down: the wheels on one side give way and it tips onto the ground, the flag pole falling |

The wheels have four spokes, so a quarter turn per loop repeats seamlessly. To keep them from skidding, move a walking vehicle about 0.4 of a wheel's height per loop.

The stone and javelin a catapult or ballista shoots are on the [effects sheet](#effects). Vehicles are long, so switching to `vehicle` raises the **frameSize** to 64 px.

### Custom model

Load a **.glb / .gltf / .fbx / .obj** with **📂 load**, or drag it onto the page. For a `.gltf`, pick or drop its `.bin` and textures along with it.

- **add animations from file:** adds clips from animation-only files, such as Mixamo "without skin" downloads. Dropping such a file on the page does the same.
- **Sheet rows:** choose which clip fills each sheet row (idle, walk, attack, cast, death, channel, hit, run, work, carry, taunt). Rows are guessed from the clip names, and rows set to `(none)` are left out of the sheet. Looping clips are rendered in place, so root motion doesn't move the unit out of frame.
- **height / turn:** scale the model, and fix its facing if it was exported pointing the wrong way.
- **Materials → palette:** map each of the model's materials to a palette ramp. Map a material to `team` to make it team-coloured.

Use **show** to switch between the procedural unit and the loaded model.

### Animation

Pick which animation to **preview**, and set the frame count (1–12) for each one: `idle`, `walk`, `attack`, `cast`, `death`, `channel`, `hit`, `run`, `work`, `carry`, `taunt`.

- `channel`: a looping, sustained spell pose.
- `hit`: a quick flinch when the unit takes damage, ending back in its stance.
- `run`: a faster gait than `walk`, leaning forward with long strides. Floaters rush along, and shamblers lurch.
- `work`: the tool or weapon hand swings its item overhead and down into the ground, with an empty other hand gripping it too. It reads as mining, chopping, digging or building.
- `carry`: walks with a sack over the shoulder of the empty hand (the left if both or neither are empty).
- `taunt`: plays once. Raises the weapon overhead and shakes it twice, shouting, while an empty free hand beckons.

### Sprite

| Setting | Effect |
|---------|--------|
| frameSize | Cell size: 32, 48, 64 or 96 px for units; 128, 160, 192 or 256 px for buildings and other large models |
| pixels / unit | How large the unit is drawn inside the cell |
| elevation | Camera angle above the ground |
| ground anchor | Height in the cell where the feet stand |
| outline | None, inner or outer dark outline |
| min coverage | How much of a pixel must be covered for it to be drawn. Higher values drop thin details. |
| supersample | Render resolution per output pixel. Higher values are smoother but slower. Big frames use less (256 px frames get at most 8×); the sheet info line shows when that happens. |

### Lighting

Light direction, height and strength, front fill, ambient, and the thresholds that split the lighting into the 4 shades of each ramp.

### Effects

The **Effects** panel shows a second, small sheet of what units fire and leave behind. It's drawn the same way as the unit, with the same palette, outline, lighting and scale:

| Effect | What it is | Frames |
|--------|------------|--------|
| `arrow` | wood shaft, steel head, team-coloured fletching | 1 |
| `bolt` | a spell shard trailing sparks, spinning | 4, looping |
| `fireball` | a glowing ball with flames streaming behind (breath attacks) | 4, looping |
| `impact` | the burst where a bolt or fireball hits | 5, plays once |
| `puff` | a cloud of grey dust where a unit fell | 5, plays once |
| `stone` | a boulder from a catapult, tumbling | 4, looping |
| `javelin` | a ballista's javelin, team-coloured fletching | 1 |

`bolt`, `fireball` and `impact` use the unit's **magic color** (a vehicle's **flame color**), so they match its cast effect. The effects sheet follows the **Sprite** and **Lighting** settings. It doesn't re-render when you change the unit's body, so tweaking a unit stays quick.

## Undo

**↶ undo** and **↷ redo**, at the top of the **Randomize & share** panel, step back and forth through your changes: every slider (once, when you let go), choice, preset, 🎲 randomize and seed. Ctrl+Z (⌘Z on a Mac) undoes. Ctrl+Shift+Z or Ctrl+Y redoes. Inside a text or number field those keys edit the text as usual. Undo covers the same settings as a share link, so a loaded custom model's settings aren't included. It keeps the last 100 steps, for as long as the page is open.

## Sharing settings

**🔗 copy share link** puts every setting in the address bar and copies the link: the unit, frame counts, sprite and lighting settings, preview animation and team colour. Anyone who opens the link gets the same unit, rendered the same way. Bookmark it to keep a unit you like.

The settings travel as URL-safe base64 of their JSON in the `s` query parameter (`?s=eyJ2IjoxLCJwcmVzZXQiOi...`). To read or edit one by hand, decode it with `atob` (after swapping `-`/`_` back to `+`/`/`). When a link is loaded, only settings this version of the app knows about are applied, and only with valid values. Anything else is ignored, so links made with an older or newer version still load.

A custom model isn't included in the link, because its file can't travel in a URL. The link still carries the sprite, lighting and animation settings.

## Exporting

The **Export** folder has a checkbox for each animation. Only the checked ones go into the exported sheet, packed top to bottom without gaps. By default that's `idle`, `walk`, `attack` and `death`. Check `cast` and `channel` for spellcasters, and `work` and `carry` for workers. The previews always show every animation. The checkboxes are saved in share links too.

- **💾 export PNG + JSON:** writes `<name>-<team>.png` in the selected **team color**, plus `<name>.json`. The PNG is indexed: its palette is the JSON's `palette`, so a game can recolour a team by swapping 4 palette entries.
- **team mask:** also writes `<name>-team-mask.png`: the team-coloured pixels alone, grey per shade, for recolouring in a shader. It's saved in share links.
- **💾 export all team colors:** writes one PNG per team colour (red, blue, green, violet, orange, black, white, yellow) and a single JSON that lists them all.
- **💾 export effects:** writes the effects sheet as `<name>-effects-<team>.png` (indexed, like the unit sheet) and `<name>-effects.json`. **team mask** works for it too.
- **💾 export 3D model (.glb):** writes the procedural unit as `<name>-<team>.glb`, a binary glTF you can open in Blender, Godot, Unity and most 3D tools. Every animation is in it as a clip with the row's name (all of them, not just the checked ones), lasting as long as the row plays in the sheet and sampled at 30 keyframes a second. The unit is made of rigid parts on a node hierarchy rather than a skinned mesh, with one plain material per palette ramp in that ramp's colour. The team ramp gets the selected team colour, magic ramps glow and metal ramps are shiny. Parts that only show up sometimes, like the spell effect and the carried sack, are scaled to zero while hidden. The ground shadow is left out. See-through units get transparent materials, but the fade-outs in their death animations aren't carried over. A loaded custom model can't be exported this way; you already have its file.

**See [SPRITESHEET.md](SPRITESHEET.md) for how to use the exported sheet in a game:** the grid layout, the JSON fields, direction mirroring, the ground anchor, animation playback and team colours.

In short, columns are the directions `N, NE, E, SE, S`, and the west-facing ones are drawn mirrored. Rows are frames, with animations stacked top to bottom. The JSON gives each animation's starting row, frame count, fps and loop flag.

## Project layout

```
src/
  main.ts              app wiring, GUI, export actions
  unit/                procedural humanoid, beast, mounted unit and vehicle: parameters, presets, body parts
  anim/                humanoid, beast, mounted and vehicle poses, animation definitions
  custom/              loading and posing imported models
  effects/             projectiles and hit effects for the effects sheet
  render/              palette, palette materials, sprite camera, pixel downsampling
  export/              sheet packing, PNG/JSON download
  ui/                  3D preview, direction preview, panel splitter
test/                  Vitest tests
```

Built with [three.js](https://threejs.org/), [lil-gui](https://lil-gui.georgealways.com/), TypeScript and Vite.
