import GUI, { type Controller } from 'lil-gui';
import { ANIMATION_NAMES, DEFAULT_FRAME_COUNTS, humanoidAnimations, type AnimationName } from './anim/humanoid-anims';
import { frameTime } from './anim/types';
import { loadModelFiles, MODEL_EXTENSIONS } from './custom/load';
import { CustomModel, DEFAULT_MODEL_HEIGHT, guessRows } from './custom/model';
import { downloadJson, downloadPng, sheetToCanvas } from './export/download';
import { packSheet, type AnimationFrames, type Sheet } from './export/packer';
import { DEFAULT_LIGHTING, MaterialLibrary } from './render/materials';
import { CLOTH_RAMPS, MAGIC_RAMPS, METAL_RAMPS, RAMP_NAMES, SKIN_RAMPS, TEAM_COLOR_NAMES, teamPalette, teamRgb, type RampName, type TeamColor } from './render/palette';
import { anchorOf, DEFAULT_SPRITE_SETTINGS, SpriteRenderer, type SpriteSettings } from './render/spriteRenderer';
import { applyPose, buildHumanoid, disposeHumanoid, type Humanoid } from './unit/humanoid';
import { ARMORS, CAPES, HAIR_STYLES, HAND_ITEMS, HELMETS, PRESETS, randomUnit, type HandItem, type UnitParams } from './unit/params';
import { Preview3D } from './ui/preview3d';
import { CompassPreview } from './ui/spritePreview';
import { initSplitter } from './ui/splitter';
import './style.css';

/** One-shot animations hold their last frame this long (in frames) before replaying. */
const HOLD_FRAMES = 4;

const NO_CLIP = '(none)';

/** A sheet row: how many frames, and how to put the subject at normalised time t. */
interface Playable {
  name: string;
  frames: number;
  fps: number;
  loop: boolean;
  apply: (t: number) => void;
}

const state = {
  preset: 'swordsman',
  unit: { ...PRESETS.swordsman } as UnitParams,
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

const view = new Preview3D(document.getElementById('view3d')!);
const mats = new MaterialLibrary();
const sprites = new SpriteRenderer(view.renderer, view.scene, mats);
const compass = new CompassPreview(document.getElementById('compass') as HTMLCanvasElement);
const sheetCanvas = document.getElementById('sheet') as HTMLCanvasElement;
const side = document.getElementById('side')!;

let unit: Humanoid | null = null;
let custom: CustomModel | null = null;
let playables: Playable[] = [];
let rendered: AnimationFrames[] = [];
let sheet: Sheet | null = null;

function rebuild(): void {
  if (unit) disposeHumanoid(unit);
  unit = null;
  custom?.root.removeFromParent();
  if (state.source === 'model' && custom) {
    view.scene.add(custom.root);
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
  const u = unit!;
  return defs.map((d) => ({ ...d, apply: (t: number) => applyPose(u, d.pose(t, state.unit, u.hipHeight)) }));
}

function regenerate(): void {
  const root = state.source === 'model' ? custom?.root : unit?.root;
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
  document.getElementById('sheetInfo')!.textContent =
    `${sheet.width}×${sheet.height} · ${sheet.meta.columns}×${sheet.meta.rows} frames of ${state.sprite.frameSize}px`;
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
  if (sheet) sheetCanvas.style.width = `${sheet.width * Math.max(1, Math.floor(avail / sheet.width))}px`;
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
  return `${state.preset}-${state.unit.seed}`;
}

/** What the sheet was made from, for the JSON. */
function exportSource(): Record<string, unknown> {
  if (state.source !== 'model' || !custom) return { unit: state.unit };
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

const gui = new GUI({ title: 'ssheet' });
const refreshGui = () => gui.controllersRecursive().forEach((c: Controller) => c.updateDisplay());

const unitFolder = gui.addFolder('Unit');
unitFolder
  .add(state, 'preset', Object.keys(PRESETS))
  .onChange((name: string) => {
    state.unit = { ...PRESETS[name], seed: state.unit.seed };
    rebindUnit();
    rebuild();
  });
const actions = {
  randomize() {
    state.preset = 'random';
    state.unit = randomUnit(Math.floor(Math.random() * 1e6));
    rebindUnit();
    rebuild();
  },
  export: exportSheet,
  exportAllTeams,
};
unitFolder.add(actions, 'randomize').name('🎲 randomize');

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

let unitControllers: Controller[] = [];
function rebindUnit(): void {
  unitControllers.forEach((c) => c.destroy());
  const u = state.unit;
  const seed = unitFolder.add(u, 'seed').onFinishChange((seed: number) => {
    state.preset = 'random';
    state.unit = randomUnit(seed);
    // rebinding destroys this very controller, so leave its callback first
    setTimeout(rebindUnit);
    rebuild();
  });
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
    unitFolder.add(u, 'skin', SKIN_RAMPS),
    unitFolder.add(u, 'cloth', CLOTH_RAMPS),
    unitFolder.add(u, 'metal', METAL_RAMPS),
    unitFolder.add(u, 'hair', RAMP_NAMES).name('hair color'),
    unitFolder.add(u, 'magic', MAGIC_RAMPS).name('magic color'),
    unitFolder.add(u, 'cape', CAPES),
    unitFolder.add(u, 'capeColor', CLOTH_RAMPS).name('cape color'),
  ];
  [...plain, ...colors].forEach((c) => c.onChange(rebuild));
  unitControllers = [seed, ...plain, ...hands, ...colors];
  refreshGui();
}
rebindUnit();

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

const modelFolder = gui.addFolder('Custom model');
modelFolder.add({ load: () => modelPicker.click() }, 'load').name('📂 load .glb / .gltf / .fbx / .obj…');
const sourceController = modelFolder
  .add(state, 'source', { 'procedural unit': 'unit', 'custom model': 'model' })
  .name('show')
  .onChange(() => {
    unitFolder.show(state.source === 'unit');
    rebuild();
  });

let modelControllers: Controller[] = [];
let modelFolders: GUI[] = [];
function rebindModel(): void {
  modelControllers.forEach((c) => c.destroy());
  modelFolders.forEach((f) => f.destroy());
  modelControllers = [];
  modelFolders = [];
  sourceController.enable(!!custom).updateDisplay();
  unitFolder.show(state.source === 'unit');
  const m = custom;
  if (!m) return;

  modelControllers.push(
    modelFolder.add({ name: m.name }, 'name').name('model').disable(),
    modelFolder.add({ add: () => animPicker.click() }, 'add').name('➕ add animations from file…'),
    modelFolder.add(state.model, 'height', 0.3, 5, 0.05).onChange((h: number) => {
      m.setHeight(h);
      queueRegenerate();
    }),
    modelFolder.add(state.model, 'facing', [0, 90, 180, 270]).name('turn (°)').onChange((deg: number) => {
      m.setFacing(deg);
      queueRegenerate();
    }),
  );

  const rows = modelFolder.addFolder('Sheet rows');
  const clipNames = [NO_CLIP, ...m.clips.map((c) => c.name)];
  for (const row of ANIMATION_NAMES) rows.add(state.model.rows, row, clipNames).name(`${row} clip`).onChange(queueRegenerate);

  const materials = modelFolder.addFolder('Materials → palette');
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

const animFolder = gui.addFolder('Animation');
animFolder.add(state, 'previewAnim', ANIMATION_NAMES).name('preview').onChange(showPreviewAnim);
for (const name of ANIMATION_NAMES) {
  animFolder.add(state.frames, name, 1, 12, 1).name(`${name} frames`).onFinishChange(queueRegenerate);
}

const spriteFolder = gui.addFolder('Sprite');
spriteFolder.add(state.sprite, 'frameSize', [32, 48, 64, 96]).onChange(queueRegenerate);
spriteFolder.add(state.sprite, 'pixelsPerUnit', 6, 40, 0.5).name('pixels / unit').onChange(queueRegenerate);
spriteFolder.add(state.sprite, 'elevation', 10, 70, 1).onChange(queueRegenerate);
spriteFolder.add(state.sprite, 'anchorY', 0.5, 0.95, 0.01).name('ground anchor').onChange(queueRegenerate);
spriteFolder.add(state.sprite, 'outline', ['none', 'inner', 'outer']).onChange(queueRegenerate);
spriteFolder.add(state.sprite, 'coverage', 0.1, 0.9, 0.05).name('min coverage').onChange(queueRegenerate);
spriteFolder.add(state.sprite, 'supersample', [4, 8, 12]).onChange(queueRegenerate);

const lightFolder = gui.addFolder('Lighting');
lightFolder.add(state.lighting, 'azimuth', -180, 180, 1).name('light from ← →').onChange(queueRegenerate);
lightFolder.add(state.lighting, 'elevation', -30, 90, 1).name('light height').onChange(queueRegenerate);
lightFolder.add(state.lighting, 'diffuse', 0, 1.5, 0.01).name('light strength').onChange(queueRegenerate);
lightFolder.add(state.lighting, 'fill', 0, 0.8, 0.01).name('front fill').onChange(queueRegenerate);
lightFolder.add(state.lighting, 'ambient', 0, 1, 0.01).onChange(queueRegenerate);
state.sprite.thresholds.forEach((_, i) =>
  lightFolder.add(state.sprite.thresholds, String(i) as '0', 0, 1, 0.01).name(`shade ${i}|${i + 1}`).onChange(queueRegenerate),
);

const viewFolder = gui.addFolder('View');
viewFolder.add(view, 'spriteView').name('sprite camera');

gui.add(state, 'team', TEAM_COLOR_NAMES).name('team color').onChange(applyTeam);
gui.add(actions, 'export').name('💾 export PNG + JSON');
gui.add(actions, 'exportAllTeams').name('💾 export all team colors');

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
    anim.apply(t);
    compass.draw(frame);
  }
  view.render();
  requestAnimationFrame(tick);
}

initSplitter(document.getElementById('splitter')!, fitPreviews);
rebuild();
requestAnimationFrame(tick);
