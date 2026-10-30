import type GUI from 'lil-gui';
import type { Controller } from 'lil-gui';
import { CLOTH_RAMPS, HIDE_RAMPS, MAGIC_RAMPS, METAL_RAMPS, RAMP_NAMES, SKIN_RAMPS, UNDEAD_SKIN_RAMPS } from '../render/palette';
import { BACKS, BARDINGS, EARS, HORNS, WINGS, type BeastParams } from '../unit/beast-params';
import { LIGHT_RAMPS, ROOF_RAMPS, ROOFS, TRIM_RAMPS, WALL_RAMPS, type BuildingParams } from '../unit/building-params';
import { MOUNT_BARDINGS } from '../unit/mounted';
import { ARMORS, BEARDS, BODIES, CAPES, EAR_STYLES, FACES, GAITS, HAIR_STYLES, HAND_ITEMS, HELMETS, TEETH, twoHanded, type HandItem, type UnitParams } from '../unit/params';
import { WEAPONS, WOOD_RAMPS, type VehicleParams } from '../unit/vehicle-params';

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
export function restoreOpen(folder: GUI, closedByDefault = false): GUI {
  return folder.open(!(closedFolders[folder._title] ?? closedByDefault));
}

/** Opens or closes a GUI as it was last left, and remembers its folders from now on. */
export function rememberOpen(g: GUI): void {
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

// --- the procedural units' controls

/**
 * A humanoid's controls in `folder`, calling `onChange` once one has changed; a rider leaves
 * out gait, body, opacity and shadow, which riding fixes.
 */
export function humanoidControllers(u: UnitParams, folder: GUI, onChange: () => void, rider = false): Controller[] {
  const hands: Controller[] = [];
  // a bow or a two-handed weapon takes both hands: picking one empties the other hand, and
  // picking anything for the other hand puts it away. A crossbow takes one.
  const hand = (key: 'rightHand' | 'leftHand', label: string) =>
    folder
      .add(u, key, HAND_ITEMS)
      .name(label)
      .onChange((item: HandItem) => {
        const other = key === 'rightHand' ? 'leftHand' : 'rightHand';
        if (twoHanded(item) || (item !== 'none' && twoHanded(u[other]))) {
          u[other] = 'none';
          hands.forEach((c) => c.updateDisplay());
        }
        onChange();
      });
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
    folder.add(u, 'face', FACES),
    folder.add(u, 'beard', BEARDS),
    folder.add(u, 'teeth', TEETH),
    folder.add(u, 'ears', EAR_STYLES),
    folder.add(u, 'hairStyle', HAIR_STYLES).name('hair style'),
    folder.add(u, 'armor', ARMORS),
  ];
  hands.push(hand('rightHand', 'right hand'), hand('leftHand', 'left hand'));
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
  [...plain, ...colors, ...spooky].forEach((c) => c.onFinishChange(onChange));
  return [...plain, ...hands, ...colors, ...spooky];
}

/** A beast's controls in `folder`; a mount always wears a seat, so its barding is a saddle or armour. */
export function beastControllers(b: BeastParams, folder: GUI, onChange: () => void, mount = false): Controller[] {
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
  controllers.forEach((c) => c.onFinishChange(onChange));
  return controllers;
}

export function vehicleControllers(v: VehicleParams, folder: GUI, onChange: () => void): Controller[] {
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
  controllers.forEach((c) => c.onFinishChange(onChange));
  return controllers;
}

export function buildingControllers(p: BuildingParams, folder: GUI, onChange: () => void): Controller[] {
  const controllers = [
    folder.add(p, 'size', 0.7, 1.3, 0.01),
    folder.add(p, 'blocks', 1, 5, 1),
    folder.add(p, 'floors', 1, 4, 1).name('storeys'),
    folder.add(p, 'roof', ROOFS),
    folder.add(p, 'windows', 0, 1, 0.05),
    folder.add(p, 'chimneys'),
    folder.add(p, 'banner'),
    folder.add(p, 'walls', WALL_RAMPS),
    folder.add(p, 'trim', TRIM_RAMPS),
    folder.add(p, 'roofColor', ROOF_RAMPS).name('roof color'),
    folder.add(p, 'light', LIGHT_RAMPS).name('light color'),
  ];
  controllers.forEach((c) => c.onFinishChange(onChange));
  return controllers;
}

/** The preset among `presets` that `params` were made from, if they haven't been changed since. */
export function presetOf(params: object, presets: Record<string, object>): string | undefined {
  const { seed: _, ...p } = params as { seed: number };
  return Object.keys(presets).find((name) => {
    const { seed: __, ...q } = presets[name] as { seed: number };
    return JSON.stringify(p) === JSON.stringify(q);
  });
}
