import GUI, { type Controller } from 'lil-gui';
import { beastAnimations } from './anim/beast-anims';
import { ANIMATION_NAMES, DEFAULT_FRAME_COUNTS, humanoidAnimations, type AnimationName } from './anim/humanoid-anims';
import { frameTime } from './anim/types';
import { loadModelFiles, MODEL_EXTENSIONS } from './custom/load';
import { CustomModel, DEFAULT_MODEL_HEIGHT, guessRows } from './custom/model';
import { downloadJson, downloadPng, sheetToCanvas } from './export/download';
import { packSheet, type AnimationFrames, type Sheet } from './export/packer';
import { DEFAULT_LIGHTING, MaterialLibrary } from './render/materials';
import { CLOTH_RAMPS, HIDE_RAMPS, MAGIC_RAMPS, METAL_RAMPS, RAMP_NAMES, SKIN_RAMPS, TEAM_COLOR_NAMES, UNDEAD_SKIN_RAMPS, teamPalette, teamRgb, type RampName, type TeamColor } from './render/palette';
import type { Outline } from './render/postprocess';
import { anchorOf, DEFAULT_SPRITE_SETTINGS, SpriteRenderer, type SpriteSettings } from './render/spriteRenderer';
import { decodeSettings, encodeSettings, mergeSettings, SHARE_PARAM } from './share';
import { applyBeastPose, buildBeast, disposeBeast, type Beast } from './unit/beast';
import { BACKS, BARDINGS, BEAST_PRESETS, EARS, HORNS, randomBeast, WINGS, type BeastParams } from './unit/beast-params';
import { applyPose, buildHumanoid, disposeHumanoid, type Humanoid } from './unit/humanoid';
import { ARMORS, BODIES, CAPES, GAITS, HAIR_STYLES, HAND_ITEMS, HELMETS, PRESETS, randomUnit, type HandItem, type UnitParams } from './unit/params';
import { Preview3D } from './ui/preview3d';
import { CompassPreview } from './ui/spritePreview';
import { initSplitter } from './ui/splitter';
import './style.css';

/** One-shot animations hold their last frame this long (in frames) before replaying. */
const HOLD_FRAMES = 4;

const NO_CLIP = '(none)';

// the big sizes are for buildings and other large models
const FRAME_SIZES = [32, 48, 64, 96, 128, 160, 192, 256];
const OUTLINES: Outline[] = ['none', 'inner', 'outer'];
const SUPERSAMPLES = [4, 8, 12];

/** A sheet row: how many frames, and how to put the subject at normalised time t. */
interface Playable {
  name: string;
  frames: number;
  fps: number;
  loop: boolean;
  /** Returns the frame's opacity, if not 1. */
  apply: (t: number) => number | void;
}

const KINDS = ['humanoid', 'beast'] as const;
type Kind = (typeof KINDS)[number];

const state = {
  /** Which procedural generator is in use; each keeps its own settings. */
  kind: 'humanoid' as Kind,
  preset: 'swordsman',
  unit: { ...PRESETS.swordsman } as UnitParams,
  beast: { ...BEAST_PRESETS.wolf } as BeastParams,
  frames: { ...DEFAULT_FRAME_COUNTS },
  sprite: { ...DEFAULT_SPRITE_SETTINGS, thresholds: [...DEFAULT_SPRITE_SETTINGS.thresholds] } as SpriteSettings,
  lighting: {
    ambient: DEFAULT_LIGHTING.ambient,
    diffuse: DEFAULT_LIGHTING.diffuse,
    azimuth: DEFAULT_LIGHTING.azimuth,
    elevation: DEFAULT_LIGHTING.elevation,
    fill: DEFAULT_LIGHTING.fill,
  },
  previewAnim: 'walk' as AnimationName,
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
const SHARE_CHOICES: Record<string, readonly unknown[]> = {
  kind: KINDS,
  preset: [...Object.keys(PRESETS), ...Object.keys(BEAST_PRESETS), 'random'],
  previewAnim: ANIMATION_NAMES,
  team: TEAM_COLOR_NAMES,
  'unit.helmet': HELMETS,
  'unit.armor': ARMORS,
  'unit.rightHand': HAND_ITEMS,
  'unit.leftHand': HAND_ITEMS,
  'unit.hairStyle': HAIR_STYLES,
  'unit.cape': CAPES,
  'unit.gait': GAITS,
  'unit.body': BODIES,
  ...Object.fromEntries(['skin', 'cloth', 'metal', 'hair', 'magic', 'capeColor'].map((k) => [`unit.${k}`, RAMP_NAMES])),
  'beast.ears': EARS,
  'beast.horns': HORNS,
  'beast.back': BACKS,
  'beast.barding': BARDINGS,
  'beast.wings': WINGS,
  ...Object.fromEntries(['hide', 'belly', 'accent', 'metal', 'magic', 'wingColor'].map((k) => [`beast.${k}`, RAMP_NAMES])),
  'sprite.frameSize': FRAME_SIZES,
  'sprite.outline': OUTLINES,
  'sprite.supersample': SUPERSAMPLES,
};

/**
 * Everything a share link carries: the procedural unit and how it's rendered. A custom model
 * stays behind, since its file can't travel in a URL. The objects are state's own.
 */
function sharedSettings() {
  const { kind, preset, unit, beast, frames, sprite, lighting, previewAnim, team } = state;
  return { kind, preset, unit, beast, frames, sprite, lighting, previewAnim, team };
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
const side = document.getElementById('side')!;

let unit: Humanoid | null = null;
let beast: Beast | null = null;
let custom: CustomModel | null = null;
let playables: Playable[] = [];
let rendered: AnimationFrames[] = [];
let sheet: Sheet | null = null;

function rebuild(): void {
  if (unit) disposeHumanoid(unit);
  if (beast) disposeBeast(beast);
  unit = null;
  beast = null;
  custom?.root.removeFromParent();
  if (state.source === 'model' && custom) {
    view.scene.add(custom.root);
  } else if (state.kind === 'beast') {
    beast = buildBeast(state.beast, mats);
    view.scene.add(beast.root);
  } else {
    unit = buildHumanoid(state.unit, mats);
    view.scene.add(unit.root);
  }
  regenerate();
}

/**
 * The sheet rows for whatever is shown. A custom model gets the rows it has clips for, with
 * the procedural rows' timing; without any it's a static model, one frame per direction.
 */
function sheetRows(): Playable[] {
  const defs = humanoidAnimations(state.frames);
  const m = custom;
  if (state.source === 'model' && m) {
    const rows = defs.flatMap((d): Playable[] => {
      const clip = m.clip(state.model.rows[d.name as AnimationName]);
      return clip ? [{ name: d.name, frames: d.frames, fps: d.fps, loop: d.loop, apply: (t) => m.sample(clip, t, d.loop) }] : [];
    });
    return rows.length > 0 ? rows : [{ name: 'idle', frames: 1, fps: 1, loop: true, apply: () => m.sample(null, 0, true) }];
  }
  const b = beast;
  if (b) {
    return beastAnimations(state.frames).map((d) => ({
      ...d,
      apply: (t: number) => {
        const pose = d.pose(t, state.beast, b.hipHeight);
        applyBeastPose(b, pose);
        return pose.opacity;
      },
    }));
  }
  const u = unit!;
  return defs.map((d) => ({
    ...d,
    apply: (t: number) => {
      const pose = d.pose(t, state.unit, u.hipHeight);
      applyPose(u, pose);
      return pose.opacity;
    },
  }));
}

function regenerate(): void {
  const root = state.source === 'model' ? custom?.root : (unit ?? beast)?.root;
  if (!root) return;
  mats.setLighting({ ...state.lighting, thresholds: state.sprite.thresholds });
  sprites.configureCamera(view.ortho, state.sprite);
  view.fitOrtho();

  playables = sheetRows();
  rendered = playables.map((a) => ({
    name: a.name,
    fps: a.fps,
    loop: a.loop,
    frames: sprites.renderFrames(root, a.frames, (i) => a.apply(frameTime(a, i)), state.sprite),
  }));
  sheet = packSheet(rendered, anchorOf(state.sprite));
  const ss = sprites.supersampleFor(state.sprite);
  document.getElementById('sheetInfo')!.textContent =
    `${sheet.width}×${sheet.height} · ${sheet.meta.columns}×${sheet.meta.rows} frames of ${state.sprite.frameSize}px` +
    (ss < state.sprite.supersample ? ` · supersample ${ss} (max for this frame size)` : '');
  applyTeam();
}

/** Team colour is a pure palette swap: recolour the previews without rendering anything again. */
function applyTeam(): void {
  mats.setRampColors('team', teamRgb(state.team));
  if (sheet) sheetToCanvas(sheet, teamPalette(state.team), sheetCanvas);
  showPreviewAnim();
  fitPreviews();
}

/** Zooms the sprite and sheet previews by whole pixels to fill the side panel's width. */
function fitPreviews(): void {
  // the side panel's and each preview panel's horizontal padding
  const avail = side.clientWidth - 2 * 12 - 2 * 10;
  compass.fitWidth(avail);
  // sheets wider than the panel (big frames) are shown scaled down
  if (sheet) sheetCanvas.style.width = `${sheet.width > avail ? avail : sheet.width * Math.floor(avail / sheet.width)}px`;
}

function showPreviewAnim(): void {
  const r = rendered.find((a) => a.name === state.previewAnim);
  if (r) compass.setFrames(r.frames, teamPalette(state.team));
  else compass.setFrames(new Map(), teamPalette(state.team));
  document.getElementById('animLabel')!.textContent = r ? state.previewAnim : `${state.previewAnim} — not in this sheet`;
}

let regenQueued = false;
function queueRegenerate(): void {
  if (regenQueued) return;
  regenQueued = true;
  requestAnimationFrame(() => {
    regenQueued = false;
    regenerate();
  });
}

function exportName(): string {
  if (state.source === 'model' && custom) return custom.name.replace(/[^\w.-]+/g, '_');
  return `${state.preset}-${procedural().seed}`;
}

/** What the sheet was made from, for the JSON. */
function exportSource(): Record<string, unknown> {
  if (state.source !== 'model' || !custom) return state.kind === 'beast' ? { beast: state.beast } : { unit: state.unit };
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

function exportSheet(): void {
  if (!sheet) return;
  const name = exportName();
  const image = `${name}-${state.team}.png`;
  downloadPng(sheet, image, teamPalette(state.team));
  downloadJson({ ...sheet.meta, image, imageTeam: state.team, ...exportSource() }, `${name}.json`);
}

/** One PNG per team colour, plus a JSON listing them. Downloads are staggered so browsers accept them. */
function exportAllTeams(): void {
  if (!sheet) return;
  const s = sheet;
  const name = exportName();
  const images = Object.fromEntries(TEAM_COLOR_NAMES.map((t) => [t, `${name}-${t}.png`]));
  TEAM_COLOR_NAMES.forEach((t, i) => setTimeout(() => downloadPng(s, images[t], teamPalette(t)), i * 250));
  downloadJson({ ...s.meta, images, ...exportSource() }, `${name}.json`);
}

// --- GUI --------------------------------------------------------------------

const gui = new GUI({ title: 'menu' });
// randomizing and sharing get their own panel, in the 3D view's corner
const tools = new GUI({ title: 'Randomize & share', container: document.getElementById('view3d')! });
const refreshGui = () => [gui, tools].forEach((g) => g.controllersRecursive().forEach((c: Controller) => c.updateDisplay()));

// --- which folders are closed, remembered across visits (by title, which are all unique)

const CLOSED_KEY = 'ssheet.closedFolders';

function loadClosed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '{}');
  } catch {
    // storage may be unavailable (private mode) or hold junk
    return {};
  }
}
const closedFolders = loadClosed();

/** Opens or closes a GUI or folder as it was last left. */
function restoreOpen(folder: GUI, closedByDefault = false): GUI {
  return folder.open(!(closedFolders[folder._title] ?? closedByDefault));
}

for (const g of [gui, tools]) {
  g.onOpenClose((changed) => {
    closedFolders[changed._title] = changed._closed;
    try {
      localStorage.setItem(CLOSED_KEY, JSON.stringify(closedFolders));
    } catch {
      // not remembered, then
    }
  });
  restoreOpen(g);
}

const addTeamController = (folder: GUI) => folder.add(state, 'team', TEAM_COLOR_NAMES).name('team color').onChange(applyTeam);

/** The settings of the procedural generator in use. */
function procedural(): UnitParams | BeastParams {
  return state.kind === 'beast' ? state.beast : state.unit;
}

const presetNames = (kind: Kind) => Object.keys(kind === 'beast' ? BEAST_PRESETS : PRESETS);

function applyPreset(name: string): void {
  if (state.kind === 'beast') state.beast = { ...BEAST_PRESETS[name], seed: state.beast.seed };
  else state.unit = { ...PRESETS[name], seed: state.unit.seed };
}

function randomize(seed: number): void {
  state.preset = 'random';
  if (state.kind === 'beast') state.beast = randomBeast(seed);
  else state.unit = randomUnit(seed);
}

/** The preset last picked for each type, so switching back and forth keeps its name. */
const lastPreset: Record<Kind, string> = { humanoid: 'swordsman', beast: 'wolf', [state.kind]: state.preset };

const unitFolder = restoreOpen(gui.addFolder('Unit'));
unitFolder
  .add(state, 'kind', KINDS)
  .name('type')
  .onChange((kind: Kind) => {
    lastPreset[kind === 'beast' ? 'humanoid' : 'beast'] = state.preset;
    state.preset = lastPreset[kind];
    rebindUnit();
    rebuild();
  });
const actions = {
  randomize() {
    randomize(Math.floor(Math.random() * 1e6));
    rebindUnit();
    rebuild();
  },
  export: exportSheet,
  exportAllTeams,
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
 * A bow takes both hands: picking one empties the other hand, and picking
 * anything for the other hand puts the bow away.
 */
function onHandChange(key: 'rightHand' | 'leftHand', item: HandItem): void {
  const other = key === 'rightHand' ? 'leftHand' : 'rightHand';
  if (item === 'bow' || (item !== 'none' && state.unit[other] === 'bow')) {
    state.unit[other] = 'none';
    refreshGui();
  }
  rebuild();
}

function humanoidControllers(u: UnitParams): Controller[] {
  const hand = (key: 'rightHand' | 'leftHand', label: string) =>
    unitFolder.add(u, key, HAND_ITEMS).name(label).onChange((item: HandItem) => onHandChange(key, item));
  const plain: Controller[] = [
    unitFolder.add(u, 'height', 0.8, 1.25, 0.01),
    unitFolder.add(u, 'bulk', 0.75, 1.45, 0.01),
    unitFolder.add(u, 'headSize', 0.7, 1.5, 0.01).name('head size'),
    unitFolder.add(u, 'torsoLength', 0.75, 1.3, 0.01).name('torso length'),
    unitFolder.add(u, 'shoulderWidth', 0.75, 1.4, 0.01).name('shoulder width'),
    unitFolder.add(u, 'armLength', 0.75, 1.3, 0.01).name('arm length'),
    unitFolder.add(u, 'armThickness', 0.7, 1.5, 0.01).name('arm thickness'),
    unitFolder.add(u, 'legLength', 0.75, 1.3, 0.01).name('leg length'),
    unitFolder.add(u, 'helmet', HELMETS),
    unitFolder.add(u, 'hairStyle', HAIR_STYLES).name('hair style'),
    unitFolder.add(u, 'armor', ARMORS),
  ];
  const hands = [hand('rightHand', 'right hand'), hand('leftHand', 'left hand')];
  const colors = [
    unitFolder.add(u, 'skin', [...SKIN_RAMPS, ...UNDEAD_SKIN_RAMPS]),
    unitFolder.add(u, 'cloth', [...CLOTH_RAMPS, 'ghost']),
    unitFolder.add(u, 'metal', METAL_RAMPS),
    unitFolder.add(u, 'hair', RAMP_NAMES).name('hair color'),
    unitFolder.add(u, 'magic', MAGIC_RAMPS).name('magic color'),
    unitFolder.add(u, 'cape', CAPES),
    unitFolder.add(u, 'capeColor', CLOTH_RAMPS).name('cape color'),
  ];
  const spooky = [
    unitFolder.add(u, 'gait', GAITS),
    unitFolder.add(u, 'body', BODIES),
    unitFolder.add(u, 'opacity', 0.25, 1, 0.25),
    unitFolder.add(u, 'glowEyes').name('glowing eyes'),
    unitFolder.add(u, 'shadow').name('ground shadow'),
  ];
  [...plain, ...colors, ...spooky].forEach((c) => c.onFinishChange(rebuild));
  return [...plain, ...hands, ...colors, ...spooky];
}

function beastControllers(b: BeastParams): Controller[] {
  const controllers = [
    unitFolder.add(b, 'size', 0.6, 1.5, 0.01),
    unitFolder.add(b, 'bulk', 0.7, 1.6, 0.01),
    unitFolder.add(b, 'bodyLength', 0.6, 1.5, 0.01).name('body length'),
    unitFolder.add(b, 'bodyDepth', 0.5, 1.4, 0.01).name('body depth'),
    unitFolder.add(b, 'legLength', 0.4, 1.4, 0.01).name('leg length'),
    unitFolder.add(b, 'sprawl', 0, 1, 0.05),
    unitFolder.add(b, 'neckLength', 0, 1.6, 0.01).name('neck length'),
    unitFolder.add(b, 'headSize', 0.7, 1.5, 0.01).name('head size'),
    unitFolder.add(b, 'snoutLength', 0.4, 2.2, 0.01).name('snout length'),
    unitFolder.add(b, 'beak'),
    unitFolder.add(b, 'tailLength', 0, 1.6, 0.01).name('tail length'),
    unitFolder.add(b, 'tailThickness', 0.3, 1.6, 0.01).name('tail thickness'),
    unitFolder.add(b, 'ears', EARS),
    unitFolder.add(b, 'horns', HORNS),
    unitFolder.add(b, 'back', BACKS),
    unitFolder.add(b, 'barding', BARDINGS),
    unitFolder.add(b, 'wings', WINGS),
    unitFolder.add(b, 'wingSize', 0.6, 1.4, 0.01).name('wing size'),
    unitFolder.add(b, 'wingColor', HIDE_RAMPS).name('wing color'),
    unitFolder.add(b, 'flying'),
    unitFolder.add(b, 'hide', HIDE_RAMPS),
    unitFolder.add(b, 'belly', HIDE_RAMPS),
    unitFolder.add(b, 'accent', HIDE_RAMPS).name('mane / spikes'),
    unitFolder.add(b, 'metal', METAL_RAMPS),
    unitFolder.add(b, 'magic', MAGIC_RAMPS).name('magic color'),
    unitFolder.add(b, 'breath').name('magic breath'),
    unitFolder.add(b, 'opacity', 0.25, 1, 0.25),
    unitFolder.add(b, 'glowEyes').name('glowing eyes'),
    unitFolder.add(b, 'shadow').name('ground shadow'),
  ];
  controllers.forEach((c) => c.onFinishChange(rebuild));
  return controllers;
}

let unitControllers: Controller[] = [];
function rebindUnit(): void {
  unitControllers.forEach((c) => c.destroy());
  // rebinding destroys the very controller whose callback triggered it, so leave that first
  const preset = unitFolder.add(state, 'preset', presetNames(state.kind)).onChange((name: string) => {
    applyPreset(name);
    setTimeout(rebindUnit);
    rebuild();
  });
  const team = addTeamController(unitFolder);
  const params = state.kind === 'beast' ? beastControllers(state.beast) : humanoidControllers(state.unit);
  unitControllers = [preset, team, ...params];
  refreshGui();
}
rebindUnit();

tools.add(actions, 'randomize').name('🎲 randomize');
tools.add(seedOf, 'seed').onFinishChange((seed: number) => {
  randomize(seed);
  rebindUnit();
  rebuild();
});
const SHARE_LABEL = '🔗 share';
const shareController = tools.add({ share: copyShareLink }, 'share').name(SHARE_LABEL);

const animFolder = restoreOpen(gui.addFolder('Animation'));
animFolder.add(state, 'previewAnim', ANIMATION_NAMES).name('preview').onChange(showPreviewAnim);
for (const name of ANIMATION_NAMES) {
  animFolder.add(state.frames, name, 1, 12, 1).name(`${name} frames`).onFinishChange(queueRegenerate);
}

const spriteFolder = restoreOpen(gui.addFolder('Sprite'), true);
spriteFolder.add(state.sprite, 'frameSize', FRAME_SIZES).onFinishChange(queueRegenerate);
spriteFolder.add(state.sprite, 'pixelsPerUnit', 6, 80, 0.5).name('pixels / unit').onFinishChange(queueRegenerate);
spriteFolder.add(state.sprite, 'elevation', 10, 70, 1).onFinishChange(queueRegenerate);
spriteFolder.add(state.sprite, 'anchorY', 0.5, 0.95, 0.01).name('ground anchor').onFinishChange(queueRegenerate);
spriteFolder.add(state.sprite, 'outline', OUTLINES).onFinishChange(queueRegenerate);
spriteFolder.add(state.sprite, 'coverage', 0.1, 0.9, 0.05).name('min coverage').onFinishChange(queueRegenerate);
spriteFolder.add(state.sprite, 'supersample', SUPERSAMPLES).onFinishChange(queueRegenerate);

const lightFolder = restoreOpen(gui.addFolder('Lighting'), true);
lightFolder.add(state.lighting, 'azimuth', -180, 180, 1).name('light from ← →').onFinishChange(queueRegenerate);
lightFolder.add(state.lighting, 'elevation', -30, 90, 1).name('light height').onFinishChange(queueRegenerate);
lightFolder.add(state.lighting, 'diffuse', 0, 1.5, 0.01).name('light strength').onFinishChange(queueRegenerate);
lightFolder.add(state.lighting, 'fill', 0, 0.8, 0.01).name('front fill').onFinishChange(queueRegenerate);
lightFolder.add(state.lighting, 'ambient', 0, 1, 0.01).onFinishChange(queueRegenerate);
state.sprite.thresholds.forEach((_, i) =>
  lightFolder.add(state.sprite.thresholds, String(i) as '0', 0, 1, 0.01).name(`shade ${i}|${i + 1}`).onFinishChange(queueRegenerate),
);

const viewFolder = restoreOpen(gui.addFolder('View'), true);
viewFolder.add(view, 'spriteView').name('sprite camera');

gui.add(actions, 'export').name('💾 export PNG + JSON');
gui.add(actions, 'exportAllTeams').name('💾 export all team colors');

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

const modelFolder = restoreOpen(gui.addFolder('Custom model'));
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
  for (const row of ANIMATION_NAMES) rows.add(state.model.rows, row, clipNames).name(`${row} clip`).onFinishChange(queueRegenerate);

  const materials = restoreOpen(modelFolder.addFolder('Materials → palette'));
  for (const mat of m.materials) {
    materials
      .add({ ramp: mat.ramp }, 'ramp', RAMP_NAMES)
      .name(mat.name)
      .onChange((ramp: RampName) => {
        m.setRamp(mat, ramp);
        queueRegenerate();
      });
  }
  modelFolders = [rows, materials];
}
rebindModel();

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
    const phase = ((now - start) / 1000) * anim.fps;
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
  view.render();
  requestAnimationFrame(tick);
}

initSplitter(document.getElementById('splitter')!, fitPreviews);
rebuild();
requestAnimationFrame(tick);
