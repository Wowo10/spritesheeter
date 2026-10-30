import GUI, { type Controller } from 'lil-gui';
import { BUILDING_ROWS } from './anim/building-anims';
import { buildEffects, disposeEffects, type Effects } from './effects/effects';
import { ANIMATION_NAMES, DEFAULT_FRAME_COUNTS, type AnimationName } from './anim/humanoid-anims';
import { frameTime } from './anim/types';
import { loadModelFiles, MODEL_EXTENSIONS } from './custom/load';
import { CustomModel, DEFAULT_MODEL_HEIGHT, guessRows } from './custom/model';
import { downloadBinary, downloadImage, downloadJson, downloadPng, downloadTeamMask, imageFields, sheetToCanvas } from './export/download';
import { exportGlb, rowDuration } from './export/model';
import { packSheet, packStrip, teamMeta, type AnimationFrames, type Sheet } from './export/packer';
import { openPlayground } from './playground/playground';
import { clearDecay } from './render/decay';
import { DEFAULT_LIGHTING, MaterialLibrary } from './render/materials';
import { PALETTE, RAMP_NAMES, TEAM_COLOR_NAMES, teamPalette, teamRgb, type RampName, type TeamColor } from './render/palette';
import { DEFAULT_PORTRAIT, PORTRAIT_BACKGROUNDS, PORTRAIT_SIZES, type PortraitSettings } from './render/portrait';
import { framePortrait, type FrameSamples, type IndexedFrame, type Outline } from './render/postprocess';
import { anchorOf, DEFAULT_SPRITE_SETTINGS, shadeSprite, shadeSprites, SpriteRenderer, type Direction, type SpriteSettings } from './render/spriteRenderer';
import { UndoHistory } from './history';
import { decodeSettings, encodeSettings, mergeSettings, SHARE_PARAM } from './share';
import { customSubject, kindDef, KINDS, type AnyParams, type Kind, type Playable, type Subject } from './subjects';
import { DEFAULT_BUILDING, ROOFS, type BuildingParams } from './unit/building-params';
import { BACKS, BARDINGS, BEAST_PRESETS, EARS, HORNS, WINGS, type BeastParams } from './unit/beast-params';
import { copyMounted, MOUNT_BARDINGS, MOUNTED_PRESETS, type MountedParams } from './unit/mounted';
import { ARMORS, BEARDS, BODIES, CAPES, EAR_STYLES, FACES, GAITS, HAIR_STYLES, HAND_ITEMS, HELMETS, PRESETS, TEETH, type UnitParams } from './unit/params';
import { VEHICLE_PRESETS, WEAPONS, type VehicleParams } from './unit/vehicle-params';
import { MAX_ZOOM, MIN_ZOOM, Preview3D } from './ui/preview3d';
import { CompassPreview, StripPreview } from './ui/spritePreview';
import { beastControllers, buildingControllers, humanoidControllers, presetOf, rememberOpen, restoreOpen, vehicleControllers } from './ui/controls';
import { initSplitter } from './ui/splitter';
import './style.css';

/** One-shot animations hold their last frame this long (in frames) before replaying. */
const HOLD_FRAMES = 4;
/** The previews play decay this fast, rather than a stage every few seconds as in the game. */
const PREVIEW_DECAY_FPS = 2;

const NO_CLIP = '(none)';

/** Animations an export includes until unchecked; the rest (spells, work) only for units that need them. */
const BASIC_ANIMS: readonly AnimationName[] = ['idle', 'walk', 'attack', 'death', 'build'];

// the big sizes are for buildings and other large models
const FRAME_SIZES = [32, 48, 64, 96, 128, 160, 192, 256];
const OUTLINES: Outline[] = ['none', 'inner', 'outer'];
const SUPERSAMPLES = [4, 8, 12];

const state = {
  /** Which procedural generator is in use; each keeps its own settings. */
  kind: 'humanoid' as Kind,
  preset: 'swordsman',
  unit: { ...PRESETS.swordsman } as UnitParams,
  beast: { ...BEAST_PRESETS.wolf } as BeastParams,
  mounted: copyMounted(MOUNTED_PRESETS.knight),
  vehicle: { ...VEHICLE_PRESETS.catapult } as VehicleParams,
  /** Buildings have no presets: the seed lays them out. */
  building: { ...DEFAULT_BUILDING } as BuildingParams,
  frames: { ...DEFAULT_FRAME_COUNTS },
  /** Seconds each decay stage lies on the ground for. */
  decayHold: 8,
  sprite: { ...DEFAULT_SPRITE_SETTINGS, thresholds: [...DEFAULT_SPRITE_SETTINGS.thresholds] } as SpriteSettings,
  lighting: {
    ambient: DEFAULT_LIGHTING.ambient,
    diffuse: DEFAULT_LIGHTING.diffuse,
    azimuth: DEFAULT_LIGHTING.azimuth,
    elevation: DEFAULT_LIGHTING.elevation,
    fill: DEFAULT_LIGHTING.fill,
  },
  /** The close-up for a selection panel or command card. */
  portrait: { ...DEFAULT_PORTRAIT } as PortraitSettings,
  previewAnim: 'walk' as AnimationName,
  /** Which rows go into the exported sheet; the previews always show them all. */
  exportAnims: Object.fromEntries(ANIMATION_NAMES.map((n) => [n, BASIC_ANIMS.includes(n)])) as Record<AnimationName, boolean>,
  /** Also export the team mask: the team-coloured pixels, grey per shade. */
  teamMask: false,
  team: 'red' as TeamColor,
  /** What the sheet shows: the procedural unit or the loaded custom model. */
  source: 'unit' as 'unit' | 'model',
  model: {
    height: DEFAULT_MODEL_HEIGHT,
    facing: 0,
    /** Clip name per sheet row, or NO_CLIP. */
    rows: Object.fromEntries(ANIMATION_NAMES.map((n) => [n, NO_CLIP])) as Record<AnimationName, string>,
  },
};

// --- share links ------------------------------------------------------------

/** Values a shared link may set for fields that take one of a set; see mergeSettings. */
const UNIT_CHOICES: Record<string, readonly unknown[]> = {
  helmet: HELMETS,
  face: FACES,
  beard: BEARDS,
  teeth: TEETH,
  ears: EAR_STYLES,
  armor: ARMORS,
  rightHand: HAND_ITEMS,
  leftHand: HAND_ITEMS,
  hairStyle: HAIR_STYLES,
  cape: CAPES,
  gait: GAITS,
  body: BODIES,
  ...Object.fromEntries(['skin', 'cloth', 'metal', 'hair', 'magic', 'capeColor'].map((k) => [k, RAMP_NAMES])),
};
const BEAST_CHOICES: Record<string, readonly unknown[]> = {
  ears: EARS,
  horns: HORNS,
  back: BACKS,
  barding: BARDINGS,
  wings: WINGS,
  ...Object.fromEntries(['hide', 'belly', 'accent', 'metal', 'magic', 'wingColor'].map((k) => [k, RAMP_NAMES])),
};
const prefixed = (prefix: string, choices: Record<string, readonly unknown[]>) =>
  Object.fromEntries(Object.entries(choices).map(([k, v]) => [prefix + k, v]));

const SHARE_CHOICES: Record<string, readonly unknown[]> = {
  kind: KINDS,
  preset: [...Object.keys(PRESETS), ...Object.keys(BEAST_PRESETS), ...Object.keys(MOUNTED_PRESETS), ...Object.keys(VEHICLE_PRESETS), 'random'],
  previewAnim: ANIMATION_NAMES,
  team: TEAM_COLOR_NAMES,
  ...prefixed('unit.', UNIT_CHOICES),
  ...prefixed('beast.', BEAST_CHOICES),
  ...prefixed('mounted.rider.', UNIT_CHOICES),
  ...prefixed('mounted.mount.', BEAST_CHOICES),
  'vehicle.weapon': WEAPONS,
  ...Object.fromEntries(['wood', 'metal', 'cloth', 'flame'].map((k) => [`vehicle.${k}`, RAMP_NAMES])),
  'building.roof': ROOFS,
  ...Object.fromEntries(['walls', 'trim', 'roofColor', 'light'].map((k) => [`building.${k}`, RAMP_NAMES])),
  'sprite.frameSize': FRAME_SIZES,
  'sprite.outline': OUTLINES,
  'sprite.supersample': SUPERSAMPLES,
  'portrait.size': PORTRAIT_SIZES,
  'portrait.background': PORTRAIT_BACKGROUNDS,
};

/**
 * Everything a share link carries: the procedural unit and how it's rendered. A custom model
 * stays behind, since its file can't travel in a URL. The objects are state's own.
 */
function sharedSettings() {
  const { kind, preset, unit, beast, mounted, vehicle, building, frames, decayHold, sprite, lighting, portrait, previewAnim, exportAnims, teamMask, team } = state;
  return { kind, preset, unit, beast, mounted, vehicle, building, frames, decayHold, sprite, lighting, portrait, previewAnim, exportAnims, teamMask, team };
}

/** Applies the settings of a share link the page was opened from, before the GUI is built. */
function loadSharedSettings(): void {
  const text = new URLSearchParams(location.search).get(SHARE_PARAM);
  if (!text) return;
  try {
    const shared = sharedSettings();
    mergeSettings(shared, decodeSettings(text), SHARE_CHOICES);
    Object.assign(state, shared);
  } catch (e) {
    alert(`Couldn't read the shared settings in this link: ${(e as Error).message}`);
  }
}
loadSharedSettings();

/** Puts the current settings in the address bar and copies the link. */
async function copyShareLink(): Promise<void> {
  const url = new URL(location.href);
  url.hash = '';
  url.searchParams.set(SHARE_PARAM, encodeSettings({ v: 1, ...sharedSettings() }));
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url.href);
    shareController.name('✓ link copied');
    setTimeout(() => shareController.name(SHARE_LABEL), 1500);
  } catch {
    // no clipboard outside secure contexts (e.g. the dev server opened by LAN address)
    prompt('Copy this link to share these settings:', url.href);
  }
}

const view = new Preview3D(document.getElementById('view3d')!);
const mats = new MaterialLibrary();
const sprites = new SpriteRenderer(view.renderer, view.scene, mats);
const compass = new CompassPreview(document.getElementById('compass') as HTMLCanvasElement);
const sheetCanvas = document.getElementById('sheet') as HTMLCanvasElement;
const effectsCanvas = document.getElementById('effects') as HTMLCanvasElement;
const portraitPreview = new StripPreview(document.getElementById('portrait') as HTMLCanvasElement);
const side = document.getElementById('side')!;

/** A row as rendered, before it's shaded. */
type SampledAnimation = Omit<AnimationFrames, 'frames'> & { frames: Map<Direction, FrameSamples[]> };

/** What the sheet is rendered from: the procedural unit, or the loaded model. */
let subject: Subject | null = null;
/** The loaded model, kept while the procedural unit is shown. */
let custom: CustomModel | null = null;
let playables: Playable[] = [];
/** The rows as rendered, before they're shaded into `rendered` with the outline, coverage and thresholds. */
let sampled: SampledAnimation[] = [];
let rendered: AnimationFrames[] = [];
let sheet: Sheet | null = null;

function rebuild(): void {
  subject?.dispose();
  subject =
    state.source === 'model' && custom
      ? customSubject(custom, mats, (row) => state.model.rows[row], () => state.model.height)
      : kindDef(state.kind).build(procedural(), mats);
  view.scene.add(subject.root);
  regenerate();
}

/**
 * The sheet rows for whatever is shown, ending in decay for anything that leaves a corpse.
 * Every row first puts back what decay rotted, so the next pose starts from the whole unit.
 */
function sheetRows(subject: Subject): Playable[] {
  const { root } = subject;
  const { rows, rot } = subject.rows(state.frames);
  const corpse = rows.find((r) => r.name === 'death');
  const all = corpse && rot ? [...rows, decayRow(corpse, rot)] : rows;
  return all.map((r) => ({
    ...r,
    apply: (t: number) => {
      clearDecay(root);
      return r.apply(t);
    },
  }));
}

/** The corpse the death row ends on, rotting by t, a stage per frame held decayHold seconds each. */
function decayRow(death: Playable, rot: (t: number) => void): Playable {
  const hold = Math.max(0.1, state.decayHold);
  return {
    name: 'decay',
    frames: state.frames.decay,
    fps: 1 / hold,
    loop: false,
    hold,
    apply: (t) => {
      const opacity = death.apply(1);
      rot(t);
      return opacity;
    },
  };
}

/** Bumped by every render, so one still going knows it's been overtaken and stops. */
let renderId = 0;
/** The render in progress, or the last one. */
let rendering: Promise<void> = Promise.resolve();
/** How long a render works before letting the page paint and respond. */
const RENDER_SLICE_MS = 30;

/** Renders the sheet, effects and portrait again, a slice at a time, then shades and shows them. */
function regenerate(): void {
  rendering = renderAll(++renderId);
}

/** Settles once nothing is being rendered, however many renders take over from each other meanwhile. */
async function renderSettled(): Promise<void> {
  let current: Promise<void>;
  do {
    current = rendering;
    await current;
  } while (current !== rendering);
}

async function renderAll(id: number): Promise<void> {
  if (!subject) return;
  const { root } = subject;
  mats.setLighting({ ...state.lighting, thresholds: state.sprite.thresholds });
  sprites.configureCamera(view.ortho, state.sprite);
  view.fitOrtho();

  let sliceStart = performance.now();
  /** Lets the page paint if this slice has run long; false once a newer render has taken over. */
  const goOn = async (): Promise<boolean> => {
    if (id !== renderId) return false;
    if (performance.now() - sliceStart > RENDER_SLICE_MS) {
      await new Promise(requestAnimationFrame);
      sliceStart = performance.now();
    }
    return id === renderId;
  };

  playables = sheetRows(subject);
  const rows = playables;
  const done: SampledAnimation[] = [];
  // the previewed row first, so the change shows there soonest
  const preview = Math.max(0, rows.findIndex((a) => a.name === state.previewAnim));
  const order = [preview, ...rows.keys()].filter((i, k, all) => all.indexOf(i) === k);
  for (const [k, i] of order.entries()) {
    const a = rows[i];
    const frames = await sprites.renderFrames(root, a.frames, (f) => a.apply(frameTime(a, f)), state.sprite, goOn);
    if (!frames) return;
    done[i] = { name: a.name, fps: a.fps, loop: a.loop, hold: a.hold, frames };
    if (k === 0 && a.name === state.previewAnim) compass.setFrames(shadeSprites(done[i].frames, state.sprite), teamPalette(state.team));
    document.getElementById('sheetInfo')!.textContent = `rendering… ${k + 1}/${rows.length} rows`;
  }
  if (!(await renderEffects(goOn))) return;
  if (!(await goOn())) return;
  renderPortrait();
  sampled = done;
  shade();
}

/**
 * Shades what was rendered with the current outline, coverage and thresholds, and shows it:
 * changing just those needs no rendering.
 */
function shade(): void {
  // the 3D preview posterises by the thresholds too
  mats.setLighting({ ...state.lighting, thresholds: state.sprite.thresholds });
  if (sampled.length === 0) return;
  rendered = sampled.map((a) => ({ ...a, frames: shadeSprites(a.frames, state.sprite) }));
  sheet = packSheet(rendered, anchorOf(state.sprite));
  const ss = sprites.supersampleFor(state.sprite);
  document.getElementById('sheetInfo')!.textContent =
    `${sheet.width}×${sheet.height} · ${sheet.meta.columns}×${sheet.meta.rows} frames of ${state.sprite.frameSize}px` +
    (ss < state.sprite.supersample ? ` · supersample ${ss} (max for this frame size)` : '');
  shadeEffects();
  shadePortrait();
  applyTeam();
}

// --- portrait: a head-and-shoulders close-up ------------------------------------

/** The portrait as rendered, and shaded with its background and border. */
let portraitSampled: FrameSamples[] = [];
let portraitFrames: IndexedFrame[] = [];
/** Plays the portrait's loop in the time the idle row takes. */
let portraitFps = 1;

/**
 * Renders the portrait from the idle row (the first row if there's none): its first frame for
 * a still, or the whole loop over the portrait's frames. shadePortrait finishes it.
 */
function renderPortrait(): void {
  const row = playables.find((a) => a.name === 'idle') ?? playables[0];
  if (!subject || !row) return;
  const p = state.portrait;
  portraitSampled = sprites.renderPortrait(subject.root, {
    count: p.frames,
    setFrame: (i) => row.apply(frameTime({ frames: p.frames, loop: true }, i)),
    head: subject.portraitHead,
    hide: subject.portraitHide,
    portrait: p,
    sprite: state.sprite,
  });
  portraitFps = Math.round(((row.fps * p.frames) / row.frames) * 100) / 100;
  document.getElementById('portraitInfo')!.textContent =
    `${p.size}×${p.size}` + (p.frames > 1 ? ` · ${p.frames} frames at ${portraitFps} fps` : '');
}

/** Shades the rendered portrait, and puts in its background and border. */
function shadePortrait(): void {
  const p = state.portrait;
  portraitFrames = portraitSampled.map((f) => framePortrait(shadeSprite(f, state.sprite), p.background, p.border));
}

function showPortrait(): void {
  portraitPreview.setFrames(portraitFrames, teamPalette(state.team));
}

// --- effects sheet: projectiles and hit effects ---------------------------------

let effects: Effects | null = null;
let effectsSampled: SampledAnimation[] = [];
let effectsSheet: Sheet | null = null;
/** What the effects sheet was last rendered from; body edits don't change it, so they skip the work. */
let effectsKey = '';
/** Effects sit centred in their frames: the frame centre is the projectile's position. */
const effectsSprite = () => ({ ...state.sprite, anchorY: 0.5 });

/**
 * Renders the effects in the unit's magic colour, at the unit's scale and with its sprite and
 * lighting settings, unless they're as last rendered; shadeEffects finishes them. False if a
 * newer render took over (see renderFrames).
 */
async function renderEffects(goOn: () => Promise<boolean>): Promise<boolean> {
  const magic = magicColor();
  // shading settings aside: shadeEffects applies those
  const { outline: _, coverage: __, thresholds: ___, ...shape } = state.sprite;
  const key = JSON.stringify({ magic, sprite: shape, lighting: state.lighting });
  if (key === effectsKey) return true;
  // until they're all rendered again, they're not as last rendered
  effectsKey = '';
  if (effects) disposeEffects(effects);
  effects = buildEffects(mats, magic);
  // kept in the scene only to be rendered
  effects.root.visible = false;
  view.scene.add(effects.root);

  const { root, defs } = effects;
  const anims: SampledAnimation[] = [];
  for (const d of defs) {
    const frames = await sprites.renderFrames(root, d.frames, (i) => d.apply(frameTime(d, i)), effectsSprite(), goOn);
    if (!frames) return false;
    anims.push({ name: d.name, fps: d.fps, loop: d.loop, frames });
  }
  effectsSampled = anims;
  effectsKey = key;
  return true;
}

function shadeEffects(): void {
  const s = effectsSprite();
  effectsSheet = packSheet(
    effectsSampled.map((a) => ({ ...a, frames: shadeSprites(a.frames, s) })),
    anchorOf(s),
  );
  document.getElementById('effectsInfo')!.textContent =
    `${effectsSheet.width}×${effectsSheet.height} · ${effectsSheet.meta.columns}×${effectsSheet.meta.rows} frames · ${magicColor()}`;
}

/** Team colour is a pure palette swap: recolour the previews without rendering anything again. */
function applyTeam(): void {
  mats.setRampColors('team', teamRgb(state.team));
  if (sheet) sheetToCanvas(sheet, teamPalette(state.team), sheetCanvas);
  if (effectsSheet) sheetToCanvas(effectsSheet, teamPalette(state.team), effectsCanvas);
  showPortrait();
  showPreviewAnim();
  fitPreviews();
}

/** Zooms the sprite and sheet previews by whole pixels to fill the side panel's width. */
function fitPreviews(): void {
  // the side panel's and each preview panel's horizontal padding
  const avail = side.clientWidth - 2 * 12 - 2 * 10;
  compass.fitWidth(avail);
  portraitPreview.fitWidth(avail);
  // sheets wider than the panel (big frames) are shown scaled down
  for (const [s, canvas] of [[sheet, sheetCanvas], [effectsSheet, effectsCanvas]] as const) {
    if (s) canvas.style.width = `${s.width > avail ? avail : s.width * Math.floor(avail / s.width)}px`;
  }
}

function showPreviewAnim(): void {
  const r = rendered.find((a) => a.name === state.previewAnim);
  if (r) compass.setFrames(r.frames, teamPalette(state.team));
  else compass.setFrames(new Map(), teamPalette(state.team));
  document.getElementById('animLabel')!.textContent = r ? state.previewAnim : `${state.previewAnim} — not in this sheet`;
}

/** What settings changed since the last frame call for: rendering it all again, or just shading it. */
let queued: 'render' | 'shade' | null = null;
function queue(what: 'render' | 'shade'): void {
  if (queued === null) {
    requestAnimationFrame(() => {
      const run = queued === 'render' ? regenerate : shade;
      queued = null;
      run();
    });
  }
  if (queued !== 'render') queued = what;
}
const queueRegenerate = () => queue('render');
const queueShade = () => queue('shade');

function exportName(): string {
  if (state.source === 'model' && custom) return custom.name.replace(/[^\w.-]+/g, '_');
  // buildings have no preset to name them by
  if (state.kind === 'building') return `building-${state.building.seed}`;
  return `${state.preset}-${procedural().seed}`;
}

/** What the sheet was made from, for the JSON. */
function exportSource(): Record<string, unknown> {
  if (state.source !== 'model' || !custom) return { [state.kind === 'humanoid' ? 'unit' : state.kind]: procedural() };
  return {
    model: {
      file: custom.name,
      height: state.model.height,
      facing: state.model.facing,
      clips: Object.fromEntries(Object.entries(state.model.rows).filter(([, c]) => c !== NO_CLIP)),
      materials: Object.fromEntries(custom.materials.map((m) => [m.name, m.ramp])),
    },
  };
}

/** The sheet as exported: only the checked animations, their rows packed without gaps. */
function exportedSheet(): Sheet | null {
  if (!sheet) return null;
  const anims = rendered.filter((a) => state.exportAnims[a.name as AnimationName]);
  if (anims.length === 0) {
    alert(`None of the checked animations are in this sheet (it has ${rendered.map((a) => a.name).join(', ')}).`);
    return null;
  }
  return packSheet(anims, anchorOf(state.sprite));
}

async function exportSheet(): Promise<void> {
  await renderSettled();
  const s = exportedSheet();
  if (s) downloadImage(s, exportName(), state.team, state.teamMask, s.meta, exportSource());
}

/** One PNG per team colour, plus a JSON listing them. Downloads are staggered so browsers accept them. */
async function exportAllTeams(): Promise<void> {
  await renderSettled();
  const s = exportedSheet();
  if (!s) return;
  const name = exportName();
  const images = Object.fromEntries(TEAM_COLOR_NAMES.map((t) => [t, `${name}-${t}.png`]));
  const fields = imageFields(name, state.teamMask);
  TEAM_COLOR_NAMES.forEach((t, i) => setTimeout(() => void downloadPng(s, images[t], teamPalette(t)), i * 250));
  // the mask is the same for every team, so it's written once
  if (fields.teamMask) setTimeout(() => void downloadTeamMask(s, fields.teamMask!), TEAM_COLOR_NAMES.length * 250);
  downloadJson({ ...s.meta, images, ...fields, ...exportSource() }, `${name}.json`);
}

// --- playground -------------------------------------------------------------

/** Two of the unit, in the team colour and a rival's, to order around on a grid. */
async function showPlayground(): Promise<void> {
  await renderSettled();
  if (!sheet || !subject) return;
  const unit = subject.playground();
  if (!unit) {
    alert("The playground is for units that move and fight; buildings don't, yet.");
    return;
  }
  openPlayground({
    name: state.source === 'model' && custom ? custom.name : state.preset,
    sheet,
    effects: effectsSheet,
    teams: [state.team, state.team === 'blue' ? 'red' : 'blue'],
    pixelsPerUnit: state.sprite.pixelsPerUnit,
    elevation: state.sprite.elevation,
    ...unit,
  });
}

// --- GUI --------------------------------------------------------------------

const gui = new GUI({ title: 'menu' });
// randomizing and sharing get their own panel, in the 3D view's corner
const tools = new GUI({ title: 'Randomize & share', container: document.getElementById('view3d')! });
const refreshGui = () => [gui, tools].forEach((g) => g.controllersRecursive().forEach((c: Controller) => c.updateDisplay()));
rememberOpen(gui);
rememberOpen(tools);

const addTeamController = (folder: GUI) => folder.add(state, 'team', TEAM_COLOR_NAMES).name('team color').onChange(applyTeam);

/** The settings of the procedural generator in use. */
function procedural(): AnyParams {
  return { humanoid: state.unit, beast: state.beast, mounted: state.mounted, vehicle: state.vehicle, building: state.building }[state.kind];
}

/** Replaces the settings of the procedural generator in use. */
function setProcedural(p: AnyParams): void {
  if (state.kind === 'humanoid') state.unit = p as UnitParams;
  else state[state.kind] = p as never;
}

/** The spell colour of the procedural unit. */
const magicColor = (): RampName => kindDef(state.kind).magic(procedural());

/** The procedural unit's opacity. */
const unitOpacity = (): number => kindDef(state.kind).opacity(procedural());

const presetNames = (kind: Kind) => Object.keys(kindDef(kind).presets);

function applyPreset(name: string): void {
  setProcedural(kindDef(state.kind).preset(name, procedural().seed));
}

function randomize(seed: number): void {
  state.preset = 'random';
  setProcedural(kindDef(state.kind).random(seed));
}

/** The preset last picked for each type, so switching back and forth keeps its name. */
const lastPreset: Record<Kind, string> = { humanoid: 'swordsman', beast: 'wolf', mounted: 'knight', vehicle: 'catapult', building: 'random', [state.kind]: state.preset };
/** The type whose settings the Unit folder shows. */
let shownKind: Kind = state.kind;

const unitFolder = restoreOpen(gui.addFolder('Unit'));
unitFolder
  .add(state, 'kind', KINDS)
  .name('type')
  .onChange((kind: Kind) => {
    lastPreset[shownKind] = state.preset;
    state.preset = lastPreset[kind];
    state.sprite.frameSize = Math.max(state.sprite.frameSize, kindDef(kind).minFrameSize);
    // buildings have only some of the rows
    if (kind === 'building' && ![...BUILDING_ROWS, 'decay'].includes(state.previewAnim)) state.previewAnim = 'idle';
    rebindUnit();
    rebuild();
  });
/**
 * The procedural unit as a binary glTF in the selected team colour, with every animation as a
 * clip (not just the checked ones), timed like the sheet. A loaded model already has a file.
 */
async function exportModel(): Promise<void> {
  await renderSettled();
  if (state.source === 'model' || !subject) {
    alert('Export model works on the procedural unit. Switch "show" to the procedural unit to export it.');
    return;
  }
  // decay swaps ramps, which a glTF clip can't
  const anims = playables.filter((a) => a.name !== 'decay').map((a) => ({ name: a.name, duration: rowDuration(a.frames, a.fps, a.loop), apply: a.apply }));
  const glb = await exportGlb(subject.root, anims, { team: state.team, opacity: unitOpacity() });
  downloadBinary(glb, `${exportName()}-${state.team}.glb`, 'model/gltf-binary');
}

/** The effects sheet in the selected team colour (only the arrow's fletching is team-coloured). */
async function exportEffects(): Promise<void> {
  await renderSettled();
  const s = effectsSheet;
  if (s) downloadImage(s, `${exportName()}-effects`, state.team, state.teamMask, s.meta, { magic: magicColor() });
}

/** The portrait in the selected team colour: a still, or its loop as a strip, left to right. */
async function exportPortrait(): Promise<void> {
  await renderSettled();
  if (portraitFrames.length === 0) return;
  const p = state.portrait;
  const meta = {
    frameWidth: p.size,
    frameHeight: p.size,
    frames: portraitFrames.length,
    fps: portraitFps,
    loop: true,
    background: p.background,
    border: p.border,
    palette: PALETTE,
    team: teamMeta(),
  };
  downloadImage(packStrip(portraitFrames), `${exportName()}-portrait`, state.team, state.teamMask, meta, exportSource());
}

const actions = {
  randomize() {
    randomize(Math.floor(Math.random() * 1e6));
    rebindUnit();
    rebuild();
  },
  export: exportSheet,
  exportAllTeams,
  exportModel,
  exportEffects,
  exportPortrait,
};

/** The seed of the generator in use, so one controller serves both. */
const seedOf = {
  get seed() {
    return procedural().seed;
  },
  set seed(seed: number) {
    procedural().seed = seed;
  },
};

/**
 * A mounted unit's Rider and Mount folders: each starts with a preset to copy from any
 * humanoid or beast preset, then that rig's own controls.
 */
function mountedFolders(m: MountedParams): GUI[] {
  const riderFolder = restoreOpen(unitFolder.addFolder('Rider'));
  riderFolder
    .add({ preset: presetOf(m.rider, PRESETS) }, 'preset', Object.keys(PRESETS))
    .name('rider preset')
    .onChange((name: string) => {
      m.rider = { ...PRESETS[name], seed: m.rider.seed };
      setTimeout(rebindUnit);
      rebuild();
    });
  humanoidControllers(m.rider, riderFolder, rebuild, true);

  const mountFolder = restoreOpen(unitFolder.addFolder('Mount'));
  // made to wear a seat here, so it reads as that preset in the dropdown afterwards
  const asMount = (b: BeastParams): BeastParams => ({ ...b, barding: MOUNT_BARDINGS.includes(b.barding) ? b.barding : 'saddle' });
  const mountPresets = Object.fromEntries(Object.entries(BEAST_PRESETS).map(([k, b]) => [k, asMount(b)]));
  mountFolder
    .add({ preset: presetOf(m.mount, mountPresets) }, 'preset', Object.keys(BEAST_PRESETS))
    .name('mount preset')
    .onChange((name: string) => {
      m.mount = { ...mountPresets[name], seed: m.mount.seed };
      setTimeout(rebindUnit);
      rebuild();
    });
  beastControllers(m.mount, mountFolder, rebuild, true);
  return [riderFolder, mountFolder];
}

let unitControllers: Controller[] = [];
let unitFolders: GUI[] = [];
function rebindUnit(): void {
  unitControllers.forEach((c) => c.destroy());
  unitFolders.forEach((f) => f.destroy());
  unitFolders = [];
  shownKind = state.kind;
  // rebinding destroys the very controller whose callback triggered it, so leave that first;
  // buildings have no presets, only seeds
  const preset =
    state.kind === 'building'
      ? []
      : [
          unitFolder.add(state, 'preset', presetNames(state.kind)).onChange((name: string) => {
            applyPreset(name);
            setTimeout(rebindUnit);
            rebuild();
          }),
        ];
  const team = addTeamController(unitFolder);
  let params: Controller[] = [];
  if (state.kind === 'beast') params = beastControllers(state.beast, unitFolder, rebuild);
  else if (state.kind === 'mounted') unitFolders = mountedFolders(state.mounted);
  else if (state.kind === 'vehicle') params = vehicleControllers(state.vehicle, unitFolder, rebuild);
  else if (state.kind === 'building') params = buildingControllers(state.building, unitFolder, rebuild);
  else params = humanoidControllers(state.unit, unitFolder, rebuild);
  unitControllers = [...preset, team, ...params];
  refreshGui();
}
rebindUnit();

// undo and redo share a row: redo's button moves into undo's, and each is greyed out by its
// own disabled attribute, since lil-gui's disable() would grey out (and block) the whole row
const undoController = tools.add({ undo: () => stepHistory('undo') }, 'undo').name('↶ undo');
const redoController = tools.add({ redo: () => stepHistory('redo') }, 'redo').name('↷ redo');
const [undoButton, redoButton] = [undoController, redoController].map((c) => c.domElement.querySelector('button')!);
undoController.domElement.classList.add('buttonRow');
undoController.domElement.querySelector('.widget')!.append(redoButton);
redoController.domElement.remove();
tools.add(actions, 'randomize').name('🎲 randomize');
tools.add(seedOf, 'seed').onFinishChange((seed: number) => {
  randomize(seed);
  rebindUnit();
  rebuild();
});
const SHARE_LABEL = '🔗 share';
const shareController = tools.add({ share: copyShareLink }, 'share').name(SHARE_LABEL);
tools.add({ playground: showPlayground }, 'playground').name('🎮 playground');

const animFolder = restoreOpen(gui.addFolder('Animation'));
animFolder.add(state, 'previewAnim', ANIMATION_NAMES).name('preview').onChange(showPreviewAnim);
for (const name of ANIMATION_NAMES) {
  animFolder.add(state.frames, name, 1, 12, 1).name(`${name} frames`).onFinishChange(queueRegenerate);
}
animFolder.add(state, 'decayHold', 1, 60, 1).name('decay hold (s)').onFinishChange(queueRegenerate);

const spriteFolder = restoreOpen(gui.addFolder('Sprite'), true);
spriteFolder.add(state.sprite, 'frameSize', FRAME_SIZES).onFinishChange(queueRegenerate);
spriteFolder.add(state.sprite, 'pixelsPerUnit', 6, 80, 0.5).name('pixels / unit').onFinishChange(queueRegenerate);
spriteFolder.add(state.sprite, 'elevation', 10, 70, 1).onFinishChange(queueRegenerate);
spriteFolder.add(state.sprite, 'anchorY', 0.5, 0.95, 0.01).name('ground anchor').onFinishChange(queueRegenerate);
spriteFolder.add(state.sprite, 'outline', OUTLINES).onFinishChange(queueShade);
spriteFolder.add(state.sprite, 'coverage', 0.1, 0.9, 0.05).name('min coverage').onFinishChange(queueShade);
spriteFolder.add(state.sprite, 'supersample', SUPERSAMPLES).onFinishChange(queueRegenerate);

/** Portrait controls only re-render the portrait, not the sheet; its background and border only re-shade it. */
const updatePortrait = () => {
  renderPortrait();
  reframePortrait();
};
const reframePortrait = () => {
  shadePortrait();
  showPortrait();
};
const portraitFolder = restoreOpen(gui.addFolder('Portrait'), true);
portraitFolder.add(state.portrait, 'size', PORTRAIT_SIZES).onFinishChange(updatePortrait);
portraitFolder.add(state.portrait, 'zoom', 0.5, 2, 0.05).onFinishChange(updatePortrait);
portraitFolder.add(state.portrait, 'turn', -90, 90, 1).name('turn (°)').onFinishChange(updatePortrait);
portraitFolder.add(state.portrait, 'elevation', 0, 45, 1).onFinishChange(updatePortrait);
portraitFolder.add(state.portrait, 'frames', 1, 12, 1).onFinishChange(updatePortrait);
portraitFolder.add(state.portrait, 'background', PORTRAIT_BACKGROUNDS).onFinishChange(reframePortrait);
portraitFolder.add(state.portrait, 'border').onFinishChange(reframePortrait);

const lightFolder = restoreOpen(gui.addFolder('Lighting'), true);
lightFolder.add(state.lighting, 'azimuth', -180, 180, 1).name('light from ← →').onFinishChange(queueRegenerate);
lightFolder.add(state.lighting, 'elevation', -30, 90, 1).name('light height').onFinishChange(queueRegenerate);
lightFolder.add(state.lighting, 'diffuse', 0, 1.5, 0.01).name('light strength').onFinishChange(queueRegenerate);
lightFolder.add(state.lighting, 'fill', 0, 0.8, 0.01).name('front fill').onFinishChange(queueRegenerate);
lightFolder.add(state.lighting, 'ambient', 0, 1, 0.01).onFinishChange(queueRegenerate);
state.sprite.thresholds.forEach((_, i) =>
  lightFolder.add(state.sprite.thresholds, String(i) as '0', 0, 1, 0.01).name(`shade ${i}|${i + 1}`).onFinishChange(queueShade),
);

const viewFolder = restoreOpen(gui.addFolder('View'), true);
viewFolder.add(view, 'spriteView').name('sprite camera');
// wheel over the view zooms too, double-click resets
viewFolder.add(view.ortho, 'zoom', MIN_ZOOM, MAX_ZOOM, 0.01).name('sprite zoom').onChange((z: number) => view.setSpriteZoom(z)).listen();

const exportFolder = restoreOpen(gui.addFolder('Export'));
for (const name of ANIMATION_NAMES) exportFolder.add(state.exportAnims, name);
exportFolder.add(state, 'teamMask').name('team mask');
exportFolder.add(actions, 'export').name('💾 export PNG + JSON');
exportFolder.add(actions, 'exportAllTeams').name('💾 export all team colors');
exportFolder.add(actions, 'exportModel').name('💾 export 3D model (.glb)');
exportFolder.add(actions, 'exportEffects').name('💾 export effects');
exportFolder.add(actions, 'exportPortrait').name('💾 export portrait');

// --- custom model -------------------------------------------------------------

function filePicker(accept: string, onPick: (files: File[]) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = accept;
  input.addEventListener('change', () => {
    onPick([...(input.files ?? [])]);
    // picking the same file again should load it again
    input.value = '';
  });
  return input;
}

const modelExtensions = MODEL_EXTENSIONS.map((e) => '.' + e).join(',');
// side files: a .gltf's buffers and textures
const modelPicker = filePicker(`${modelExtensions},.bin,.png,.jpg,.jpeg,.webp`, (f) => openFiles(f, 'model'));
const animPicker = filePicker(modelExtensions, (f) => openFiles(f, 'anims'));

/**
 * Loads a model, or adds the clips of an animation file to the loaded one. With 'auto' (files
 * dropped on the page) a file without meshes is taken for animations.
 */
async function openFiles(files: File[], mode: 'model' | 'anims' | 'auto'): Promise<void> {
  if (files.length === 0) return;
  try {
    const loaded = await loadModelFiles(files);
    if (mode === 'anims' || (mode === 'auto' && !loaded.hasMeshes && custom)) {
      if (!custom) throw new Error('load a model first');
      if (loaded.clips.length === 0) throw new Error('it has no animations');
      const added = custom.addClips(loaded.clips).map((c) => c.name);
      // fill only rows that have no clip yet
      const guess = guessRows(added);
      for (const row of ANIMATION_NAMES) {
        if (state.model.rows[row] === NO_CLIP && guess[row]) state.model.rows[row] = guess[row]!;
      }
    } else {
      if (!loaded.hasMeshes) throw new Error('it has no meshes (to add animations, load the model first)');
      custom?.dispose();
      custom = new CustomModel(loaded.name, loaded.scene, loaded.clips, mats);
      state.model.height = DEFAULT_MODEL_HEIGHT;
      state.model.facing = 0;
      const guess = guessRows(custom.clips.map((c) => c.name));
      for (const row of ANIMATION_NAMES) state.model.rows[row] = guess[row] ?? NO_CLIP;
      state.source = 'model';
    }
    rebindModel();
    rebuild();
  } catch (e) {
    alert(`Couldn't load ${files.map((f) => f.name).join(', ')}: ${(e as Error).message}`);
  }
}

const modelFolder = restoreOpen(gui.addFolder('Custom model (experimental)'));
modelFolder.add({ load: () => modelPicker.click() }, 'load').name('📂 load .glb / .gltf / .fbx / .obj…');
const sourceController = modelFolder
  .add(state, 'source', { 'procedural unit': 'unit', 'custom model': 'model' })
  .name('show')
  .onChange(() => {
    showSource();
    rebuild();
  });

let modelControllers: Controller[] = [];
/** The custom model's own team colour control, as the unit's is hidden along with its folder. */
let modelTeam: Controller | null = null;

function showSource(): void {
  unitFolder.show(state.source === 'unit');
  modelTeam?.show(state.source === 'model');
}

let modelFolders: GUI[] = [];
function rebindModel(): void {
  modelControllers.forEach((c) => c.destroy());
  modelFolders.forEach((f) => f.destroy());
  modelControllers = [];
  modelFolders = [];
  modelTeam = null;
  sourceController.enable(!!custom).updateDisplay();
  const m = custom;
  if (!m) return showSource();

  const name = modelFolder.add({ name: m.name }, 'name').name('model').disable();
  modelTeam = addTeamController(modelFolder);
  showSource();
  modelControllers.push(
    name,
    modelTeam,
    modelFolder.add({ add: () => animPicker.click() }, 'add').name('➕ add animations from file…'),
    modelFolder.add(state.model, 'height', 0.3, 5, 0.05).onFinishChange((h: number) => {
      m.setHeight(h);
      queueRegenerate();
    }),
    modelFolder.add(state.model, 'facing', [0, 90, 180, 270]).name('turn (°)').onChange((deg: number) => {
      m.setFacing(deg);
      queueRegenerate();
    }),
  );

  const rows = restoreOpen(modelFolder.addFolder('Sheet rows'));
  const clipNames = [NO_CLIP, ...m.clips.map((c) => c.name)];
  // decay has no clip: it rots the death clip's last frame
  for (const row of ANIMATION_NAMES.filter((r) => r !== 'decay')) rows.add(state.model.rows, row, clipNames).name(`${row} clip`).onFinishChange(queueRegenerate);

  const materials = restoreOpen(modelFolder.addFolder('Materials → palette'));
  for (const mat of m.materials) {
    materials
      .add({ ramp: mat.ramp }, 'ramp', RAMP_NAMES)
      .name(mat.name)
      .onChange((ramp: RampName) => {
        // or putting back a rotted corpse would undo the new ramp
        clearDecay(m.root);
        m.setRamp(mat, ramp);
        queueRegenerate();
      });
  }
  modelFolders = [rows, materials];
}
rebindModel();

// --- undo -------------------------------------------------------------------

/** Settings as recorded for undo: everything a share link carries. */
const snapshot = () => JSON.stringify(sharedSettings());
const undoStack = new UndoHistory(snapshot());

function updateUndoButtons(): void {
  undoButton.disabled = !undoStack.canUndo;
  redoButton.disabled = !undoStack.canRedo;
}
updateUndoButtons();

function recordSettings(): void {
  if (undoStack.record(snapshot())) updateUndoButtons();
}

function restoreSettings(text: string): void {
  const saved = JSON.parse(text);
  // whole objects for the unit, whose controllers are rebound below; the rest in place, so
  // their controllers stay bound
  state.unit = saved.unit;
  state.beast = saved.beast;
  state.mounted = saved.mounted;
  state.vehicle = saved.vehicle;
  state.building = saved.building;
  const shared = sharedSettings();
  mergeSettings(shared, saved, SHARE_CHOICES);
  Object.assign(state, shared);
  lastPreset[state.kind] = state.preset;
  rebindUnit();
  rebuild();
  applyTeam();
}

function stepHistory(dir: 'undo' | 'redo'): void {
  const saved = dir === 'undo' ? undoStack.undo() : undoStack.redo();
  if (saved !== null) restoreSettings(saved);
  updateUndoButtons();
}

for (const g of [gui, tools]) {
  // a panel hears of a change before the control's own handler runs (the seed box randomizes
  // in its own), so record once every handler is done; a drag records once, on release
  g.onFinishChange(() => setTimeout(recordSettings));
  // buttons (randomize) only report onChange; the rest (export, undo) leave nothing to record
  g.onChange((e) => {
    if (typeof e.value === 'function') setTimeout(recordSettings);
  });
}

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  // text fields keep their own undo
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
  const key = e.key.toLowerCase();
  const dir = key === 'z' ? (e.shiftKey ? 'redo' : 'undo') : key === 'y' && !e.shiftKey ? 'redo' : null;
  if (!dir) return;
  e.preventDefault();
  stepHistory(dir);
});

// dropping files anywhere loads them: a model, or animations for the loaded one
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  openFiles([...(e.dataTransfer?.files ?? [])], 'auto');
});

// --- main loop --------------------------------------------------------------

const start = performance.now();
function tick(now: number): void {
  const anim = playables.find((a) => a.name === state.previewAnim);
  if (anim) {
    const phase = ((now - start) / 1000) * (anim.hold ? PREVIEW_DECAY_FPS : anim.fps);
    let t: number;
    let frame: number;
    if (anim.loop) {
      const p = phase % anim.frames;
      t = p / anim.frames;
      frame = Math.floor(p);
    } else {
      const last = anim.frames - 1;
      const p = Math.min(phase % (anim.frames + HOLD_FRAMES), last);
      t = last > 0 ? p / last : 0;
      frame = Math.floor(p);
    }
    mats.setOpacity(anim.apply(t) ?? 1);
    compass.draw(frame);
  }
  if (portraitPreview.frameCount > 1) portraitPreview.draw(Math.floor(((now - start) / 1000) * portraitFps));
  view.render();
  requestAnimationFrame(tick);
}

initSplitter(document.getElementById('splitter')!, fitPreviews);
rebuild();
requestAnimationFrame(tick);
