import GUI, { type Controller } from 'lil-gui';
import { ANIMATION_NAMES, DEFAULT_FRAME_COUNTS, humanoidAnimations, type AnimationName } from './anim/humanoid-anims';
import { frameTime, type AnimationDef } from './anim/types';
import { downloadJson, downloadPng, sheetToCanvas } from './export/download';
import { packSheet, type AnimationFrames, type Sheet } from './export/packer';
import { DEFAULT_LIGHTING, MaterialLibrary } from './render/materials';
import { CLOTH_RAMPS, METAL_RAMPS, RAMP_NAMES, SKIN_RAMPS } from './render/palette';
import { anchorOf, DEFAULT_SPRITE_SETTINGS, SpriteRenderer, type SpriteSettings } from './render/spriteRenderer';
import { applyPose, buildHumanoid, disposeHumanoid, type Humanoid } from './unit/humanoid';
import { ARMORS, HAND_ITEMS, HELMETS, PRESETS, randomUnit, type HandItem, type UnitParams } from './unit/params';
import { Preview3D } from './ui/preview3d';
import { CompassPreview } from './ui/spritePreview';
import './style.css';

/** One-shot animations hold their last frame this long (in frames) before replaying. */
const HOLD_FRAMES = 4;

const state = {
  preset: 'swordsman',
  unit: { ...PRESETS.swordsman } as UnitParams,
  frames: { ...DEFAULT_FRAME_COUNTS },
  sprite: { ...DEFAULT_SPRITE_SETTINGS, thresholds: [...DEFAULT_SPRITE_SETTINGS.thresholds] } as SpriteSettings,
  lighting: { ambient: DEFAULT_LIGHTING.ambient, diffuse: DEFAULT_LIGHTING.diffuse },
  previewAnim: 'walk' as AnimationName,
};

const view = new Preview3D(document.getElementById('view3d')!);
const mats = new MaterialLibrary();
const sprites = new SpriteRenderer(view.renderer, view.scene, mats);
const compass = new CompassPreview(document.getElementById('compass') as HTMLCanvasElement);
const sheetCanvas = document.getElementById('sheet') as HTMLCanvasElement;

let unit: Humanoid | null = null;
let anims: AnimationDef[] = [];
let rendered: AnimationFrames[] = [];
let sheet: Sheet | null = null;

function rebuild(): void {
  if (unit) disposeHumanoid(unit);
  unit = buildHumanoid(state.unit, mats);
  view.scene.add(unit.root);
  regenerate();
}

function regenerate(): void {
  if (!unit) return;
  mats.setLighting({ ...state.lighting, thresholds: state.sprite.thresholds });
  sprites.configureCamera(view.ortho, state.sprite);
  view.fitOrtho();

  anims = humanoidAnimations(state.frames);
  rendered = anims.map((a) => {
    const poses = Array.from({ length: a.frames }, (_, i) => a.pose(frameTime(a, i), state.unit, unit!.hipHeight));
    return { name: a.name, fps: a.fps, loop: a.loop, frames: sprites.renderFrames(unit!, poses, state.sprite) };
  });
  sheet = packSheet(rendered, anchorOf(state.sprite));

  sheetToCanvas(sheet, sheetCanvas);
  sheetCanvas.style.width = `${sheet.width * 2}px`;
  document.getElementById('sheetInfo')!.textContent =
    `${sheet.width}×${sheet.height} · ${sheet.meta.columns}×${sheet.meta.rows} frames of ${state.sprite.frameSize}px`;
  showPreviewAnim();
}

function showPreviewAnim(): void {
  const r = rendered.find((a) => a.name === state.previewAnim);
  if (r) compass.setFrames(r.frames);
  document.getElementById('animLabel')!.textContent = state.previewAnim;
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

function exportSheet(): void {
  if (!sheet) return;
  const name = `${state.preset}-${state.unit.seed}`;
  downloadPng(sheet, `${name}.png`);
  downloadJson({ ...sheet.meta, image: `${name}.png`, unit: state.unit }, `${name}.json`);
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
    unitFolder.add(u, 'headSize', 0.8, 1.4, 0.01),
    unitFolder.add(u, 'helmet', HELMETS),
    unitFolder.add(u, 'armor', ARMORS),
  ];
  const hands = [hand('rightHand', 'right hand'), hand('leftHand', 'left hand')];
  const colors = [
    unitFolder.add(u, 'skin', SKIN_RAMPS),
    unitFolder.add(u, 'cloth', CLOTH_RAMPS),
    unitFolder.add(u, 'metal', METAL_RAMPS),
    unitFolder.add(u, 'hair', RAMP_NAMES),
  ];
  [...plain, ...colors].forEach((c) => c.onChange(rebuild));
  unitControllers = [seed, ...plain, ...hands, ...colors];
  refreshGui();
}
rebindUnit();

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

const lightFolder = gui.addFolder('Shading').close();
lightFolder.add(state.lighting, 'ambient', 0, 1, 0.01).onChange(queueRegenerate);
lightFolder.add(state.lighting, 'diffuse', 0, 1.5, 0.01).onChange(queueRegenerate);
state.sprite.thresholds.forEach((_, i) =>
  lightFolder.add(state.sprite.thresholds, String(i) as '0', 0, 1, 0.01).name(`shade ${i}|${i + 1}`).onChange(queueRegenerate),
);

const viewFolder = gui.addFolder('View');
viewFolder.add(view, 'spriteView').name('sprite camera');

gui.add(actions, 'export').name('💾 export PNG + JSON');

// --- main loop --------------------------------------------------------------

const start = performance.now();
function tick(now: number): void {
  const anim = anims.find((a) => a.name === state.previewAnim);
  if (unit && anim) {
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
    applyPose(unit, anim.pose(t, state.unit, unit.hipHeight));
    compass.draw(frame);
  }
  view.render();
  requestAnimationFrame(tick);
}

rebuild();
requestAnimationFrame(tick);
