import { Mesh, Vector3, type Material, type Object3D } from 'three';
import { mulberry32 } from '../rng';
import type { MaterialLibrary } from './materials';
import { MAGIC_RAMPS, METAL_RAMPS, RAMP_NAMES, type RampName } from './palette';

/**
 * How a corpse rots, by ramp. Each mesh first rots (recoloured, or gone if it glows) and later
 * is left bare; flesh is then bone, thinned to the bones inside it, and everything else is
 * gone or recoloured. Meshes marked as body parts count as flesh whatever they're dressed in,
 * unless they're armour.
 */
export interface DecayRecipe {
  /** Ramps that rot down to what's under them: skin to bone, timber to charred beams. */
  flesh: RampName[];
  /** What flesh turns as it rots, and once it's bare. */
  rotted: RampName;
  bare: RampName;
  /** Width a bare body part keeps across its length; 1 keeps its shape. */
  thin: number;
  /** Ramps left as they are: armour, weapons, bone. */
  keep: RampName[];
  /** What everything else turns as it rots, and then once bare ('hide': it's gone). */
  soft: { rot: RampName; bare: RampName | 'hide' };
}

/**
 * Only rods, at least this much longer than they're wide, are thinned; heads, hands, plates
 * and wheels shrink evenly instead, into skulls, knuckles and ribcages.
 */
const ROD = 1.6;
const SKULL = 0.8;

interface Undo {
  material: Material | Material[];
  scale: Vector3;
  visible: boolean;
}

/** Counts this mesh as part of the body: when bare, it's a bone, whatever it's dressed in. */
export function markBody<M extends Mesh>(mesh: M): M {
  mesh.userData.body = true;
  return mesh;
}

/**
 * Rots everything under `root` by d, 0 (as it fell) to 1 (bare bones). Each mesh rots and is
 * left bare at a moment of its own, so a corpse falls apart piece by piece. Undone by
 * clearDecay, which must run before the next pose so the pose sets what it controls itself.
 */
export function applyDecay(root: Object3D, d: number, mats: MaterialLibrary, recipe: DecayRecipe): void {
  if (d <= 0) return;
  let i = 0;
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const rng = mulberry32(++i * 7919);
    const rotAt = 0.05 + 0.3 * rng();
    const bareAt = 0.4 + 0.45 * rng();
    if (d < rotAt) return;
    const bare = d >= bareAt;
    const swap = (ramp: RampName): RampName | 'hide' | null => {
      const flesh = recipe.flesh.includes(ramp) || (o.userData.body === true && !METAL_RAMPS.includes(ramp));
      if (flesh) return bare ? recipe.bare : ramp === recipe.bare ? null : recipe.rotted;
      if (MAGIC_RAMPS.includes(ramp)) return 'hide';
      if (recipe.keep.includes(ramp)) return null;
      return bare ? recipe.soft.bare : recipe.soft.rot;
    };
    const undo: Undo = { material: o.material, scale: o.scale.clone(), visible: o.visible };
    let changed = false;
    const recolour = (m: Material): Material => {
      const ramp = rampOf(m);
      const to = ramp && swap(ramp);
      if (!to) return m;
      changed = true;
      // a slot can't be hidden on its own, so it goes dark
      return mats.get(to === 'hide' ? 'dark' : to);
    };
    if (Array.isArray(o.material)) {
      o.material = o.material.map(recolour);
    } else {
      const ramp = rampOf(o.material);
      const to = ramp && swap(ramp);
      if (to === 'hide') {
        o.visible = false;
        changed = true;
      } else if (to) {
        o.material = mats.get(to);
        changed = true;
      }
      if (bare && to === recipe.bare && recipe.thin < 1) {
        thinOut(o, recipe.thin);
        changed = true;
      }
    }
    if (changed && !o.userData.decayUndo) o.userData.decayUndo = undo;
  });
}

/** Puts back everything applyDecay changed under `root`. */
export function clearDecay(root: Object3D): void {
  root.traverse((o) => {
    const undo = o.userData.decayUndo as Undo | undefined;
    if (!(o instanceof Mesh) || !undo) return;
    o.material = undo.material;
    o.scale.copy(undo.scale);
    o.visible = undo.visible;
    delete o.userData.decayUndo;
  });
}

function rampOf(m: Material): RampName | null {
  return (RAMP_NAMES as string[]).includes(m.name) ? (m.name as RampName) : null;
}

/** Narrows a rod across its length, about its middle; anything stockier shrinks evenly. */
function thinOut(mesh: Mesh, thin: number): void {
  const geo = mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new Vector3()).multiply(mesh.scale);
  const dims = [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)];
  const [, mid, long] = [...dims].sort((a, b) => a - b);
  if (long <= mid * ROD) {
    mesh.scale.multiplyScalar(SKULL);
    return;
  }
  const axis = dims.indexOf(long);
  mesh.scale.set(mesh.scale.x * (axis === 0 ? 1 : thin), mesh.scale.y * (axis === 1 ? 1 : thin), mesh.scale.z * (axis === 2 ? 1 : thin));
}
