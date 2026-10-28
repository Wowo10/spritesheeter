import { AnimationClip, Color, Mesh, MeshStandardMaterial, Object3D, QuaternionKeyframeTrack, SRGBColorSpace, VectorKeyframeTrack, type KeyframeTrack } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MAGIC_RAMPS, METAL_RAMPS, RAMP_NAMES, rampIndex, teamPalette, type RampName, type TeamColor } from '../render/palette';

/** One clip of the exported model: a sheet row, played over `duration` seconds. */
export interface ModelAnimation {
  name: string;
  /** Seconds; loops end where they started, so t = 1 repeats t = 0. */
  duration: number;
  /** Poses the live unit at normalised time t. */
  apply: (t: number) => unknown;
}

export interface ModelOptions {
  team: TeamColor;
  /** See-through units get transparent materials; the sprites' fade-outs aren't carried over. */
  opacity: number;
}

/** Keyframes per second of baked animation. */
const SAMPLE_RATE = 30;

/** Shade of each ramp used as the material colour: the second lightest, the ramp's main tone. */
const BASE_SHADE = 2;

/** Seconds a sheet row takes to play, matching how the sprites are timed. */
export function rowDuration(frames: number, fps: number, loop: boolean): number {
  return (loop ? frames : Math.max(1, frames - 1)) / fps;
}

interface Sample {
  position: number[];
  quaternion: number[];
  scale: number[];
}

/**
 * Copies the unit for export and bakes its animations into clips. Every node is sampled
 * while the live unit is posed; the copy is left in the first animation's first pose. Hidden
 * parts (spell effect, carried load) are kept, scaled to zero while hidden, since glTF has
 * no visibility. Palette shaders become plain materials in each ramp's colour, the team ramp
 * in the team's. The ground shadow is left out.
 */
export function bakeModel(root: Object3D, anims: ModelAnimation[], options: ModelOptions): { model: Object3D; clips: AnimationClip[] } {
  const live = nodes(root);
  const samples = anims.map((a) => {
    const count = Math.max(2, Math.round(a.duration * SAMPLE_RATE) + 1);
    return Array.from({ length: count }, (_, i) => {
      a.apply(i / (count - 1));
      return live.map(sample);
    });
  });
  anims[0]?.apply(0);

  const model = root.clone(true);
  const copies = nodes(model);
  const used = new Set<string>();
  copies.forEach((o, i) => {
    // track names address nodes by name, so every animated node needs its own
    let name = o.name || `node${i}`;
    if (used.has(name)) name = `${name}_${i}`;
    used.add(name);
    o.name = name;
    if (!o.visible) {
      o.visible = true;
      o.scale.setScalar(0);
    }
  });

  const materials = new Map<string, MeshStandardMaterial>();
  const meshes: Mesh[] = [];
  model.traverse((o) => {
    if (o instanceof Mesh) meshes.push(o);
  });
  for (const mesh of meshes) {
    if (mesh.name === 'shadow') {
      mesh.removeFromParent();
      continue;
    }
    const ramp = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name;
    let mat = materials.get(ramp);
    if (!mat) {
      mat = paletteMaterial(ramp, options);
      materials.set(ramp, mat);
    }
    mesh.material = mat;
  }

  // only nodes that ever differ from the first pose get tracks, in every clip, so no clip
  // inherits a pose from the one before (the sack is shown all through carry, hidden elsewhere)
  const first = samples[0]?.[0] ?? [];
  const moving = copies.map((_, n) => samples.some((frames) => frames.some((f) => !sameSample(f[n], first[n]))));
  const clips = anims.map((a, k) => {
    const frames = samples[k];
    const times = frames.map((_, i) => (a.duration * i) / (frames.length - 1));
    const tracks: KeyframeTrack[] = [];
    copies.forEach((o, n) => {
      if (!moving[n]) return;
      const values = (key: keyof Sample) => frames.flatMap((f) => f[n][key]);
      tracks.push(
        new VectorKeyframeTrack(`${o.name}.position`, times, values('position')),
        new QuaternionKeyframeTrack(`${o.name}.quaternion`, times, values('quaternion')),
        new VectorKeyframeTrack(`${o.name}.scale`, times, values('scale')),
      );
    });
    return new AnimationClip(a.name, a.duration, tracks);
  });
  return { model, clips };
}

/** Bakes the unit and writes it as binary glTF. */
export async function exportGlb(root: Object3D, anims: ModelAnimation[], options: ModelOptions): Promise<ArrayBuffer> {
  const { model, clips } = bakeModel(root, anims, options);
  const glb = await new GLTFExporter().parseAsync(model, { binary: true, animations: clips, onlyVisible: false });
  return glb as ArrayBuffer;
}

/** Everything that can move: the nodes below the root, meshes aside, in a fixed order. */
function nodes(root: Object3D): Object3D[] {
  const out: Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && !(o instanceof Mesh)) out.push(o);
  });
  return out;
}

function sample(o: Object3D): Sample {
  const s = o.visible ? o.scale.toArray() : [0, 0, 0];
  return { position: o.position.toArray(), quaternion: o.quaternion.toArray(), scale: s };
}

function sameSample(a: Sample, b: Sample): boolean {
  const same = (x: number[], y: number[]) => x.every((v, i) => Math.abs(v - y[i]) < 1e-6);
  return same(a.position, b.position) && same(a.quaternion, b.quaternion) && same(a.scale, b.scale);
}

function paletteMaterial(ramp: string, { team, opacity }: ModelOptions): MeshStandardMaterial {
  const known = (RAMP_NAMES as string[]).includes(ramp);
  const [r, g, b] = known ? teamPalette(team)[1 + rampIndex(ramp as RampName) * 4 + BASE_SHADE] : [255, 0, 255];
  const color = new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
  const glow = MAGIC_RAMPS.includes(ramp as RampName);
  const metal = METAL_RAMPS.includes(ramp as RampName);
  return new MeshStandardMaterial({
    name: ramp,
    color,
    emissive: glow ? color : new Color(0, 0, 0),
    metalness: metal ? 0.6 : 0,
    roughness: metal ? 0.45 : 0.9,
    transparent: opacity < 1,
    opacity,
  });
}
