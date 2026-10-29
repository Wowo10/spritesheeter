import GUI, { type Controller } from 'lil-gui';
import { beastAnimations } from './anim/beast-anims';
import { mountedAnimations } from './anim/mounted-anims';
import { vehicleAnimations } from './anim/vehicle-anims';
import { buildEffects, disposeEffects, type Effects } from './effects/effects';
import { ANIMATION_NAMES, DEFAULT_FRAME_COUNTS, humanoidAnimations, type AnimationName } from './anim/humanoid-anims';
import { frameTime } from './anim/types';
import { loadModelFiles, MODEL_EXTENSIONS } from './custom/load';
import { CustomModel, DEFAULT_MODEL_HEIGHT, guessRows } from './custom/model';
import { downloadBinary, downloadJson, downloadPng, downloadTeamMask, sheetToCanvas } from './export/download';
import { exportGlb, rowDuration } from './export/model';
import { packSheet, type AnimationFrames, type Sheet } from './export/packer';
import { openPlayground, type PlaygroundOptions, type Projectile } from './playground/playground';
import { DEFAULT_LIGHTING, MaterialLibrary } from './render/materials';
import { CLOTH_RAMPS, HIDE_RAMPS, MAGIC_RAMPS, METAL_RAMPS, RAMP_NAMES, SKIN_RAMPS, TEAM_COLOR_NAMES, UNDEAD_SKIN_RAMPS, teamPalette, teamRgb, type RampName, type TeamColor } from './render/palette';
import type { Outline } from './render/postprocess';
import { anchorOf, DEFAULT_SPRITE_SETTINGS, SpriteRenderer, type SpriteSettings } from './render/spriteRenderer';
import { UndoHistory } from './history';
import { decodeSettings, encodeSettings, mergeSettings, SHARE_PARAM } from './share';
import { applyBeastPose, buildBeast, disposeBeast, type Beast } from './unit/beast';
import { BACKS, BARDINGS, BEAST_PRESETS, EARS, HORNS, randomBeast, WINGS, type BeastParams } from './unit/beast-params';
import { applyMountedPose, buildMounted, copyMounted, disposeMounted, MOUNT_BARDINGS, MOUNTED_PRESETS, randomMounted, type Mounted, type MountedParams } from './unit/mounted';
import { applyPose, buildHumanoid, disposeHumanoid, type Humanoid } from './unit/humanoid';
import { ARMORS, BODIES, CAPES, GAITS, HAIR_STYLES, HAND_ITEMS, handItems, HELMETS, PRESETS, randomUnit, type HandItem, type UnitParams } from './unit/params';
import { applyVehiclePose, buildVehicle, disposeVehicle, type Vehicle } from './unit/vehicle';
import { randomVehicle, VEHICLE_PRESETS, WEAPONS, WOOD_RAMPS, type VehicleParams } from './unit/vehicle-params';
import { MAX_ZOOM, MIN_ZOOM, Preview3D } from './ui/preview3d';
import { CompassPreview } from './ui/spritePreview';
import { initSplitter } from './ui/splitter';
import './style.css';

/** One-shot animations hold their last frame this long (in frames) before replaying. */
const HOLD_FRAMES = 4;

const NO_CLIP = '(none)';

/** Animations an export includes until unchecked; the rest (spells, work) only for units that need them. */
const BASIC_ANIMS: readonly AnimationName[] = ['idle', 'walk', 'attack', 'death'];

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

const KINDS = ['humanoid', 'beast', 'mounted', 'vehicle'] as const;
type Kind = (typeof KINDS)[number];

const state = {
  /** Which procedural generator is in use; each keeps its own settings. */
  kind: 'humanoid' as Kind,
  preset: 'swordsman',
  unit: { ...PRESETS.swordsman } as UnitParams,
  beast: { ...BEAST_PRESETS.wolf } as BeastParams,
  mounted: copyMounted(MOUNTED_PRESETS.knight),
  vehicle: { ...VEHICLE_PRESETS.catapult } as VehicleParams,
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
  'sprite.frameSize': FRAME_SIZES,
  'sprite.outline': OUTLINES,
  'sprite.supersample': SUPERSAMPLES,
};

/**
 * Everything a share link carries: the procedural unit and how it's rendered. A custom model
 * stays behind, since its file can't travel in a URL. The objects are state's own.
 */
function sharedSettings() {
  const { kind, preset, unit, beast, mounted, vehicle, frames, sprite, lighting, previewAnim, exportAnims, teamMask, team } = state;
  return { kind, preset, unit, beast, mounted, vehicle, frames, sprite, lighting, previewAnim, exportAnims, teamMask, team };
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
const side = document.getElementById('side')!;

let unit: Humanoid | null = null;
let beast: Beast | null = null;
let mounted: Mounted | null = null;
let vehicle: Vehicle | null = null;
let custom: CustomModel | null = null;
let playables: Playable[] = [];
let rendered: AnimationFrames[] = [];
let sheet: Sheet | null = null;

function rebuild(): void {
  if (unit) disposeHumanoid(unit);
  if (beast) disposeBeast(beast);
  if (mounted) disposeMounted(mounted);
  if (vehicle) disposeVehicle(vehicle);
  unit = null;
  beast = null;
  mounted = null;
  vehicle = null;
  custom?.root.removeFromParent();
  if (state.source === 'model' && custom) {
    view.scene.add(custom.root);
  } else if (state.kind === 'beast') {
    beast = buildBeast(state.beast, mats);
    view.scene.add(beast.root);
  } else if (state.kind === 'mounted') {
    mounted = buildMounted(state.mounted, mats);
    view.scene.add(mounted.root);
  } else if (state.kind === 'vehicle') {
    vehicle = buildVehicle(state.vehicle, mats);
    view.scene.add(vehicle.root);
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
  const m2 = mounted;
  if (m2) {
    return mountedAnimations(state.frames).map((d) => ({
      ...d,
      apply: (t: number) => {
        const pose = d.pose(t, state.mounted, 0);
        applyMountedPose(m2, pose);
        return pose.opacity;
      },
    }));
  }
  const v = vehicle;
  if (v) {
    return vehicleAnimations(state.frames).map((d) => ({
      ...d,
      apply: (t: number) => applyVehiclePose(v, d.pose(t, state.vehicle, 0)),
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
  const root = state.source === 'model' ? custom?.root : (unit ?? beast ?? mounted ?? vehicle)?.root;
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
  renderEffects();
  applyTeam();
}

// --- effects sheet: projectiles and hit effects ---------------------------------

let effects: Effects | null = null;
let effectsSheet: Sheet | null = null;
/** What the effects sheet was last rendered from; body edits don't change it, so they skip the work. */
let effectsKey = '';

/**
 * Renders the effects in the unit's magic colour, centred in their frames (the frame centre
 * is the projectile's position), at the unit's scale and with its sprite and lighting settings.
 */
function renderEffects(): void {
  const magic = magicColor();
  const key = JSON.stringify({ magic, sprite: state.sprite, lighting: state.lighting });
  if (key === effectsKey) return;
  effectsKey = key;
  if (effects) disposeEffects(effects);
  effects = buildEffects(mats, magic);
  view.scene.add(effects.root);

  const s = { ...state.sprite, anchorY: 0.5 };
  const root = effects.root;
  const anims = effects.defs.map((d) => ({
    name: d.name,
    fps: d.fps,
    loop: d.loop,
    frames: sprites.renderFrames(root, d.frames, (i) => d.apply(frameTime(d, i)), s),
  }));
  // kept in the scene only to be rendered
  root.visible = false;
  effectsSheet = packSheet(anims, anchorOf(s));
  document.getElementById('effectsInfo')!.textContent =
    `${effectsSheet.width}×${effectsSheet.height} · ${effectsSheet.meta.columns}×${effectsSheet.meta.rows} frames · ${magic}`;
}

/** Team colour is a pure palette swap: recolour the previews without rendering anything again. */
function applyTeam(): void {
  mats.setRampColors('team', teamRgb(state.team));
  if (sheet) sheetToCanvas(sheet, teamPalette(state.team), sheetCanvas);
  if (effectsSheet) sheetToCanvas(effectsSheet, teamPalette(state.team), effectsCanvas);
  showPreviewAnim();
  fitPreviews();
}

/** Zooms the sprite and sheet previews by whole pixels to fill the side panel's width. */
function fitPreviews(): void {
  // the side panel's and each preview panel's horizontal padding
  const avail = side.clientWidth - 2 * 12 - 2 * 10;
  compass.fitWidth(avail);
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

/** JSON fields about the image files: always indexed, plus the team mask when it's written. */
function imageFields(name: string): Record<string, unknown> {
  return { imageFormat: 'indexed', ...(state.teamMask ? { teamMask: `${name}-team-mask.png` } : {}) };
}

function exportSheet(): void {
  const s = exportedSheet();
  if (!s) return;
  const name = exportName();
  const image = `${name}-${state.team}.png`;
  const fields = imageFields(name);
  void downloadPng(s, image, teamPalette(state.team));
  if (fields.teamMask) setTimeout(() => void downloadTeamMask(s, fields.teamMask as string), 250);
  downloadJson({ ...s.meta, image, imageTeam: state.team, ...fields, ...exportSource() }, `${name}.json`);
}

/** One PNG per team colour, plus a JSON listing them. Downloads are staggered so browsers accept them. */
function exportAllTeams(): void {
  const s = exportedSheet();
  if (!s) return;
  const name = exportName();
  const images = Object.fromEntries(TEAM_COLOR_NAMES.map((t) => [t, `${name}-${t}.png`]));
  const fields = imageFields(name);
  TEAM_COLOR_NAMES.forEach((t, i) => setTimeout(() => void downloadPng(s, images[t], teamPalette(t)), i * 250));
  // the mask is the same for every team, so it's written once
  if (fields.teamMask) setTimeout(() => void downloadTeamMask(s, fields.teamMask as string), TEAM_COLOR_NAMES.length * 250);
  downloadJson({ ...s.meta, images, ...fields, ...exportSource() }, `${name}.json`);
}

// --- playground -------------------------------------------------------------

/** What a vehicle's weapon shoots, whether it attacks or "casts"; a ram strikes up close. */
const VEHICLE_SHOTS: Record<VehicleParams['weapon'], Projectile | null> = { ram: null, catapult: 'stone', ballista: 'javelin', flamethrower: 'fireball' };

const hasBow = (u: UnitParams) => Object.values(handItems(u)).includes('bow');

/**
 * How far the unit gets per loop of walk and run (from its leg length and how far its legs
 * swing), and what it shoots, so it moves and fights in the playground as it looks.
 */
function playgroundUnit(): Pick<PlaygroundOptions, 'stride' | 'attack' | 'cast' | 'channel'> {
  // legs swinging ±28° walking cover about 1.9 leg lengths a loop; running, with a moment in the air, about 2.8
  const legs = (hip: number) => ({ walk: 1.9 * hip, run: 2.8 * hip });
  if (state.source === 'model' && custom) return { stride: legs(state.model.height / 2), attack: null, cast: 'bolt', channel: true };
  if (beast) return { stride: legs(beast.hipHeight), attack: null, cast: state.beast.breath ? 'fireball' : null, channel: state.beast.breath };
  if (mounted) return { stride: legs(mounted.beast.hipHeight), attack: hasBow(state.mounted.rider) ? 'arrow' : null, cast: 'bolt', channel: true };
  if (vehicle) {
    // the wheels turn a quarter turn a loop walking, half a turn running
    const r = vehicle.dims.wheelR;
    const shot = VEHICLE_SHOTS[state.vehicle.weapon];
    return { stride: { walk: (Math.PI * r) / 2, run: Math.PI * r }, attack: shot, cast: shot, channel: state.vehicle.weapon === 'flamethrower' };
  }
  return { stride: legs(unit!.hipHeight), attack: hasBow(state.unit) ? 'arrow' : null, cast: 'bolt', channel: true };
}

/** Two of the unit, in the team colour and a rival's, to order around on a grid. */
function showPlayground(): void {
  if (!sheet) return;
  openPlayground({
    name: state.source === 'model' && custom ? custom.name : state.preset,
    sheet,
    effects: effectsSheet,
    teams: [state.team, state.team === 'blue' ? 'red' : 'blue'],
    pixelsPerUnit: state.sprite.pixelsPerUnit,
    elevation: state.sprite.elevation,
    ...playgroundUnit(),
  });
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
function procedural(): UnitParams | BeastParams | MountedParams | VehicleParams {
  return { humanoid: state.unit, beast: state.beast, mounted: state.mounted, vehicle: state.vehicle }[state.kind];
}

/** The spell colour of the procedural unit; a mounted unit's rider casts, a vehicle's is its fire. */
function magicColor(): RampName {
  if (state.kind === 'mounted') return state.mounted.rider.magic;
  if (state.kind === 'vehicle') return state.vehicle.flame;
  return (procedural() as UnitParams | BeastParams).magic;
}

/** The procedural unit's opacity; a mounted unit's is its mount's, and vehicles are solid. */
function unitOpacity(): number {
  if (state.kind === 'mounted') return state.mounted.mount.opacity;
  if (state.kind === 'vehicle') return 1;
  return (procedural() as UnitParams | BeastParams).opacity;
}

const PRESETS_OF: Record<Kind, Record<string, unknown>> = { humanoid: PRESETS, beast: BEAST_PRESETS, mounted: MOUNTED_PRESETS, vehicle: VEHICLE_PRESETS };
const presetNames = (kind: Kind) => Object.keys(PRESETS_OF[kind]);

function applyPreset(name: string): void {
  if (state.kind === 'beast') state.beast = { ...BEAST_PRESETS[name], seed: state.beast.seed };
  else if (state.kind === 'mounted') state.mounted = { ...copyMounted(MOUNTED_PRESETS[name]), seed: state.mounted.seed };
  else if (state.kind === 'vehicle') state.vehicle = { ...VEHICLE_PRESETS[name], seed: state.vehicle.seed };
  else state.unit = { ...PRESETS[name], seed: state.unit.seed };
}

function randomize(seed: number): void {
  state.preset = 'random';
  if (state.kind === 'beast') state.beast = randomBeast(seed);
  else if (state.kind === 'mounted') state.mounted = randomMounted(seed);
  else if (state.kind === 'vehicle') state.vehicle = randomVehicle(seed);
  else state.unit = randomUnit(seed);
}

/** The preset last picked for each type, so switching back and forth keeps its name. */
const lastPreset: Record<Kind, string> = { humanoid: 'swordsman', beast: 'wolf', mounted: 'knight', vehicle: 'catapult', [state.kind]: state.preset };
/** The type whose settings the Unit folder shows. */
let shownKind: Kind = state.kind;

const unitFolder = restoreOpen(gui.addFolder('Unit'));
unitFolder
  .add(state, 'kind', KINDS)
  .name('type')
  .onChange((kind: Kind) => {
    lastPreset[shownKind] = state.preset;
    state.preset = lastPreset[kind];
    // a rider on its mount (or flying on it) is well over twice as tall as a unit on foot,
    // and siege engines are about as long
    if ((kind === 'mounted' || kind === 'vehicle') && state.sprite.frameSize < 64) state.sprite.frameSize = 64;
    rebindUnit();
    rebuild();
  });
/**
 * The procedural unit as a binary glTF in the selected team colour, with every animation as a
 * clip (not just the checked ones), timed like the sheet. A loaded model already has a file.
 */
async function exportModel(): Promise<void> {
  const subject = unit ?? beast ?? mounted ?? vehicle;
  if (state.source === 'model' || !subject) {
    alert('Export model works on the procedural unit. Switch "show" to the procedural unit to export it.');
    return;
  }
  const anims = playables.map((a) => ({ name: a.name, duration: rowDuration(a.frames, a.fps, a.loop), apply: a.apply }));
  const glb = await exportGlb(subject.root, anims, { team: state.team, opacity: unitOpacity() });
  downloadBinary(glb, `${exportName()}-${state.team}.glb`, 'model/gltf-binary');
}

/** The effects sheet in the selected team colour (only the arrow's fletching is team-coloured). */
function exportEffects(): void {
  const s = effectsSheet;
  if (!s) return;
  const name = `${exportName()}-effects`;
  const image = `${name}-${state.team}.png`;
  const fields = imageFields(name);
  void downloadPng(s, image, teamPalette(state.team));
  if (fields.teamMask) setTimeout(() => void downloadTeamMask(s, fields.teamMask as string), 250);
  downloadJson({ ...s.meta, image, imageTeam: state.team, ...fields, magic: magicColor() }, `${name}.json`);
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
function onHandChange(u: UnitParams, key: 'rightHand' | 'leftHand', item: HandItem): void {
  const other = key === 'rightHand' ? 'leftHand' : 'rightHand';
  if (item === 'bow' || (item !== 'none' && u[other] === 'bow')) {
    u[other] = 'none';
    refreshGui();
  }
  rebuild();
}

/** A humanoid's controls in `folder`; a rider leaves out gait, body, opacity and shadow, which riding fixes. */
function humanoidControllers(u: UnitParams, folder: GUI, rider = false): Controller[] {
  const hand = (key: 'rightHand' | 'leftHand', label: string) =>
    folder.add(u, key, HAND_ITEMS).name(label).onChange((item: HandItem) => onHandChange(u, key, item));
  const plain: Controller[] = [
    folder.add(u, 'height', 0.8, 1.25, 0.01),
    folder.add(u, 'bulk', 0.75, 1.45, 0.01),
    folder.add(u, 'headSize', 0.7, 1.5, 0.01).name('head size'),
    folder.add(u, 'torsoLength', 0.75, 1.3, 0.01).name('torso length'),
    folder.add(u, 'shoulderWidth', 0.75, 1.4, 0.01).name('shoulder width'),
    folder.add(u, 'armLength', 0.75, 1.3, 0.01).name('arm length'),
    folder.add(u, 'armThickness', 0.7, 1.5, 0.01).name('arm thickness'),
    folder.add(u, 'legLength', 0.75, 1.3, 0.01).name('leg length'),
    folder.add(u, 'helmet', HELMETS),
    folder.add(u, 'hairStyle', HAIR_STYLES).name('hair style'),
    folder.add(u, 'armor', ARMORS),
  ];
  const hands = [hand('rightHand', 'right hand'), hand('leftHand', 'left hand')];
  const colors = [
    folder.add(u, 'skin', [...SKIN_RAMPS, ...UNDEAD_SKIN_RAMPS]),
    folder.add(u, 'cloth', [...CLOTH_RAMPS, 'ghost']),
    folder.add(u, 'metal', METAL_RAMPS),
    folder.add(u, 'hair', RAMP_NAMES).name('hair color'),
    folder.add(u, 'magic', MAGIC_RAMPS).name('magic color'),
    folder.add(u, 'cape', CAPES),
    folder.add(u, 'capeColor', CLOTH_RAMPS).name('cape color'),
  ];
  const spooky = rider
    ? [folder.add(u, 'glowEyes').name('glowing eyes')]
    : [
        folder.add(u, 'gait', GAITS),
        folder.add(u, 'body', BODIES),
        folder.add(u, 'opacity', 0.25, 1, 0.25),
        folder.add(u, 'glowEyes').name('glowing eyes'),
        folder.add(u, 'shadow').name('ground shadow'),
      ];
  [...plain, ...colors, ...spooky].forEach((c) => c.onFinishChange(rebuild));
  return [...plain, ...hands, ...colors, ...spooky];
}

/** A beast's controls in `folder`; a mount always wears a seat, so its barding is a saddle or armour. */
function beastControllers(b: BeastParams, folder: GUI, mount = false): Controller[] {
  const controllers = [
    folder.add(b, 'size', 0.6, 1.5, 0.01),
    folder.add(b, 'bulk', 0.7, 1.6, 0.01),
    folder.add(b, 'bodyLength', 0.6, 1.5, 0.01).name('body length'),
    folder.add(b, 'bodyDepth', 0.5, 1.4, 0.01).name('body depth'),
    folder.add(b, 'legLength', 0.4, 1.4, 0.01).name('leg length'),
    folder.add(b, 'sprawl', 0, 1, 0.05),
    folder.add(b, 'neckLength', 0, 1.6, 0.01).name('neck length'),
    folder.add(b, 'headSize', 0.7, 1.5, 0.01).name('head size'),
    folder.add(b, 'snoutLength', 0.4, 2.2, 0.01).name('snout length'),
    folder.add(b, 'beak'),
    folder.add(b, 'tailLength', 0, 1.6, 0.01).name('tail length'),
    folder.add(b, 'tailThickness', 0.3, 1.6, 0.01).name('tail thickness'),
    folder.add(b, 'ears', EARS),
    folder.add(b, 'horns', HORNS),
    folder.add(b, 'back', BACKS),
    folder.add(b, 'barding', mount ? MOUNT_BARDINGS : BARDINGS),
    folder.add(b, 'wings', WINGS),
    folder.add(b, 'wingSize', 0.6, 1.4, 0.01).name('wing size'),
    folder.add(b, 'wingColor', HIDE_RAMPS).name('wing color'),
    folder.add(b, 'flying'),
    folder.add(b, 'hide', HIDE_RAMPS),
    folder.add(b, 'belly', HIDE_RAMPS),
    folder.add(b, 'accent', HIDE_RAMPS).name('mane / spikes'),
    folder.add(b, 'metal', METAL_RAMPS),
    folder.add(b, 'magic', MAGIC_RAMPS).name('magic color'),
    folder.add(b, 'breath').name('magic breath'),
    folder.add(b, 'opacity', 0.25, 1, 0.25),
    folder.add(b, 'glowEyes').name('glowing eyes'),
    folder.add(b, 'shadow').name('ground shadow'),
  ];
  controllers.forEach((c) => c.onFinishChange(rebuild));
  return controllers;
}

function vehicleControllers(v: VehicleParams, folder: GUI): Controller[] {
  const controllers = [
    folder.add(v, 'weapon', WEAPONS),
    folder.add(v, 'size', 0.6, 1.4, 0.01),
    folder.add(v, 'length', 0.6, 1.4, 0.01),
    folder.add(v, 'width', 0.6, 1.4, 0.01),
    folder.add(v, 'wheels', 1, 3, 1).name('wheels per side'),
    folder.add(v, 'wheelSize', 0.6, 1.5, 0.01).name('wheel size'),
    folder.add(v, 'roof').name('roof (ram, flamethrower)'),
    folder.add(v, 'banner'),
    folder.add(v, 'wood', WOOD_RAMPS),
    folder.add(v, 'metal', METAL_RAMPS),
    folder.add(v, 'cloth', CLOTH_RAMPS).name('roof / flag'),
    folder.add(v, 'flame', MAGIC_RAMPS).name('flame color'),
  ];
  controllers.forEach((c) => c.onFinishChange(rebuild));
  return controllers;
}

/** The preset among `presets` that `params` were made from, if they haven't been changed since. */
function presetOf(params: object, presets: Record<string, object>): string | undefined {
  const { seed: _, ...p } = params as { seed: number };
  return Object.keys(presets).find((name) => {
    const { seed: __, ...q } = presets[name] as { seed: number };
    return JSON.stringify(p) === JSON.stringify(q);
  });
}

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
  humanoidControllers(m.rider, riderFolder, true);

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
  beastControllers(m.mount, mountFolder, true);
  return [riderFolder, mountFolder];
}

let unitControllers: Controller[] = [];
let unitFolders: GUI[] = [];
function rebindUnit(): void {
  unitControllers.forEach((c) => c.destroy());
  unitFolders.forEach((f) => f.destroy());
  unitFolders = [];
  shownKind = state.kind;
  // rebinding destroys the very controller whose callback triggered it, so leave that first
  const preset = unitFolder.add(state, 'preset', presetNames(state.kind)).onChange((name: string) => {
    applyPreset(name);
    setTimeout(rebindUnit);
    rebuild();
  });
  const team = addTeamController(unitFolder);
  let params: Controller[] = [];
  if (state.kind === 'beast') params = beastControllers(state.beast, unitFolder);
  else if (state.kind === 'mounted') unitFolders = mountedFolders(state.mounted);
  else if (state.kind === 'vehicle') params = vehicleControllers(state.vehicle, unitFolder);
  else params = humanoidControllers(state.unit, unitFolder);
  unitControllers = [preset, team, ...params];
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
// wheel over the view zooms too, double-click resets
viewFolder.add(view.ortho, 'zoom', MIN_ZOOM, MAX_ZOOM, 0.01).name('sprite zoom').onChange((z: number) => view.setSpriteZoom(z)).listen();

const exportFolder = restoreOpen(gui.addFolder('Export'));
for (const name of ANIMATION_NAMES) exportFolder.add(state.exportAnims, name);
exportFolder.add(state, 'teamMask').name('team mask');
exportFolder.add(actions, 'export').name('💾 export PNG + JSON');
exportFolder.add(actions, 'exportAllTeams').name('💾 export all team colors');
exportFolder.add(actions, 'exportModel').name('💾 export 3D model (.glb)');
exportFolder.add(actions, 'exportEffects').name('💾 export effects');

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
