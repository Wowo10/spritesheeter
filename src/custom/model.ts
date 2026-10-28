import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Color,
  Group,
  LoopOnce,
  Mesh,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { ANIMATION_NAMES, type AnimationName } from '../anim/humanoid-anims';
import type { MaterialLibrary } from '../render/materials';
import { MAGIC_RAMPS, RAMP_NAMES, rampRgb, type RampName, type RGB } from '../render/palette';

/** About the height of the procedural units, so custom models fit the same sprite settings. */
export const DEFAULT_MODEL_HEIGHT = 1.8;

/** One of the model's own materials, drawn with a palette ramp instead. */
export interface ModelMaterial {
  name: string;
  /** Its base colour (texture average included), which picked the initial ramp. */
  color: RGB;
  ramp: RampName;
  slots: { mesh: Mesh; index: number | null }[];
}

/**
 * An imported model, made to behave like a procedural unit: standing on the origin, facing +Z,
 * drawn in palette materials, and posed by sampling its own animation clips.
 */
export class CustomModel {
  /** Turned per sprite direction. */
  readonly root = new Group();
  readonly materials: ModelMaterial[] = [];
  readonly clips: AnimationClip[] = [];
  private readonly facing = new Group();
  /** Scales and centres the model; the source scene sits inside untouched. */
  private readonly fit = new Group();
  private readonly mixer: AnimationMixer;
  /** Bind-pose bounds in the scene's own space. */
  private readonly bounds: Box3;
  private readonly rest: { node: Object3D; position: Vector3; quaternion: Quaternion; scale: Vector3 }[] = [];
  private readonly inPlace = new Map<AnimationClip, AnimationClip>();
  private readonly originals = new Set<Material>();

  constructor(
    readonly name: string,
    private readonly scene: Object3D,
    clips: AnimationClip[],
    private readonly mats: MaterialLibrary,
  ) {
    this.root.name = 'customModel';
    this.root.add(this.facing);
    this.facing.add(this.fit);
    this.fit.add(scene);
    scene.traverse((node) => {
      this.rest.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() });
    });
    this.bounds = bindPoseBounds(scene);
    this.adoptMaterials();
    this.mixer = new AnimationMixer(scene);
    this.addClips(clips);
    this.setHeight(DEFAULT_MODEL_HEIGHT);
  }

  /** Adds clips, renaming any whose name is already taken. Returns them as added. */
  addClips(clips: AnimationClip[]): AnimationClip[] {
    const added = clips.map((c) => {
      let name = c.name || 'clip';
      for (let i = 2; this.clips.some((o) => o.name === name); i++) name = `${c.name} ${i}`;
      const clip = name === c.name ? c : Object.assign(c.clone(), { name });
      this.clips.push(clip);
      return clip;
    });
    return added;
  }

  clip(name: string): AnimationClip | undefined {
    return this.clips.find((c) => c.name === name);
  }

  /** Scales the model to this height, standing on the origin and centred on it. */
  setHeight(height: number): void {
    const size = this.bounds.getSize(new Vector3());
    const s = size.y > 0 ? height / size.y : 1;
    const c = this.bounds.getCenter(new Vector3());
    this.fit.scale.setScalar(s);
    this.fit.position.set(-c.x * s, -this.bounds.min.y * s, -c.z * s);
  }

  /** Turns the model, for ones that don't face +Z (the glTF convention) to start with. */
  setFacing(degrees: number): void {
    this.facing.rotation.y = (degrees * Math.PI) / 180;
  }

  setRamp(material: ModelMaterial, ramp: RampName): void {
    material.ramp = ramp;
    const mat = this.mats.get(ramp);
    for (const { mesh, index } of material.slots) {
      if (index === null) mesh.material = mat;
      else (mesh.material as Material[])[index] = mat;
    }
  }

  /**
   * Poses the model at normalised time t of a clip, or in its bind pose without one.
   * Looping clips play in place: any net travel over the loop is taken out, so a walk
   * with root motion stays on the spot.
   */
  sample(clip: AnimationClip | null, t: number, loop: boolean): void {
    this.mixer.stopAllAction();
    for (const r of this.rest) {
      r.node.position.copy(r.position);
      r.node.quaternion.copy(r.quaternion);
      r.node.scale.copy(r.scale);
    }
    if (!clip) return;
    const played = loop ? this.inPlaceClip(clip) : clip;
    const action = this.mixer.clipAction(played);
    // held on the last frame, so a one-shot's t = 1 shows its final pose
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    this.mixer.setTime(t * played.duration);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.scene);
    this.root.removeFromParent();
    this.scene.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    for (const m of this.originals) {
      for (const value of Object.values(m)) if ((value as Texture | null)?.isTexture) (value as Texture).dispose();
      m.dispose();
    }
  }

  private inPlaceClip(clip: AnimationClip): AnimationClip {
    let c = this.inPlace.get(clip);
    if (!c) {
      c = withoutDrift(clip);
      this.inPlace.set(clip, c);
    }
    return c;
  }

  /** Swaps every material for a palette one, grouping meshes by the material they had. */
  private adoptMaterials(): void {
    const byMaterial = new Map<Material, ModelMaterial>();
    const meshes: Mesh[] = [];
    this.scene.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
      // lines and points don't survive pixel-art downscaling
      else if ('isLine' in o || 'isPoints' in o) o.visible = false;
    });
    for (const mesh of meshes) {
      // animations can move a skinned mesh far from its bind-pose bounds
      mesh.frustumCulled = false;
      if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      list.forEach((source, i) => {
        let entry = byMaterial.get(source);
        if (!entry) {
          const color = baseColor(source);
          entry = { name: uniqueName(source.name, this.materials), color, ramp: guessRamp(source.name, color, isGlowing(source)), slots: [] };
          byMaterial.set(source, entry);
          this.materials.push(entry);
          this.originals.add(source);
        }
        entry.slots.push({ mesh, index: Array.isArray(mesh.material) ? i : null });
      });
    }
    for (const m of this.materials) this.setRamp(m, m.ramp);
  }
}

function uniqueName(name: string, taken: ModelMaterial[]): string {
  const base = name.trim() || `material ${taken.length + 1}`;
  let n = base;
  for (let i = 2; taken.some((m) => m.name === n); i++) n = `${base} ${i}`;
  return n;
}

/** Bounds of the meshes as skinned in the bind pose (skeletons must be updated to see it). */
function bindPoseBounds(scene: Object3D): Box3 {
  scene.updateMatrixWorld(true);
  const box = new Box3();
  scene.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    let local: Box3 | null;
    if (o instanceof SkinnedMesh) {
      o.skeleton.update();
      o.computeBoundingBox();
      local = o.boundingBox;
    } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      local = o.geometry.boundingBox;
    }
    if (local) box.union(local.clone().applyMatrix4(o.matrixWorld));
  });
  if (box.isEmpty()) box.set(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5));
  return box;
}

/**
 * Removes the net travel of every position track: each key is shifted back along the line from
 * the first key to the last. A properly looping track (last key = first) is left as it was.
 */
export function withoutDrift(clip: AnimationClip): AnimationClip {
  const c = clip.clone();
  for (const track of c.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const { times, values } = track;
    const n = times.length;
    if (n < 2 || times[n - 1] <= times[0]) continue;
    const span = times[n - 1] - times[0];
    const drift = [0, 1, 2].map((k) => values[(n - 1) * 3 + k] - values[k]);
    for (let i = 0; i < n; i++) {
      const f = (times[i] - times[0]) / span;
      for (let k = 0; k < 3; k++) values[i * 3 + k] -= drift[k] * f;
    }
  }
  return c;
}

/** The ramps a material can be guessed onto: the team ramp only by name, glowing ones only for glowing materials. */
const PLAIN_RAMPS = RAMP_NAMES.filter((r) => r !== 'team' && !MAGIC_RAMPS.includes(r));

export function guessRamp(name: string, color: RGB, glowing = false): RampName {
  if (/team/i.test(name)) return 'team';
  return nearestRamp(color, glowing ? MAGIC_RAMPS : PLAIN_RAMPS);
}

/** The ramp with a shade closest to the colour. */
export function nearestRamp(color: RGB, candidates: RampName[] = PLAIN_RAMPS): RampName {
  let best = candidates[0];
  let bestDist = Infinity;
  for (const ramp of candidates) {
    for (const [r, g, b] of rampRgb(ramp)) {
      // weighted for how the eye sees differences
      const d = 2 * (r - color[0]) ** 2 + 4 * (g - color[1]) ** 2 + 3 * (b - color[2]) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = ramp;
      }
    }
  }
  return best;
}

function isGlowing(m: Material): boolean {
  const e = (m as { emissive?: Color }).emissive;
  const k = (m as { emissiveIntensity?: number }).emissiveIntensity ?? 1;
  return !!e && Math.max(e.r, e.g, e.b) * k > 0.5;
}

function baseColor(m: Material): RGB {
  const c = (isGlowing(m) ? (m as { emissive?: Color }).emissive : (m as { color?: Color }).color)?.clone() ?? new Color(1, 1, 1);
  const tex = averageTextureColor((m as { map?: Texture | null }).map);
  if (tex) c.multiply(tex);
  // getHex gives sRGB, which is what the palette is written in
  const hex = c.getHex();
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** Mean colour of a texture (in linear space, like material colours), or null where it can't be read. */
function averageTextureColor(tex: Texture | null | undefined): Color | null {
  const img = tex?.image as CanvasImageSource | undefined;
  if (!img || typeof document === 'undefined') return null;
  try {
    const size = 16;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, size, size);
    const px = ctx.getImageData(0, 0, size, size).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let i = 0; i < px.length; i += 4) {
      // transparent texels (cut-out leaves, hair cards) shouldn't darken the average
      const w = px[i + 3] / 255;
      r += px[i] * w;
      g += px[i + 1] * w;
      b += px[i + 2] * w;
      a += w;
    }
    if (a === 0) return null;
    return new Color().setRGB(r / a / 255, g / a / 255, b / a / 255, 'srgb');
  } catch {
    return null;
  }
}

/** Preferred clip names per sheet row, best first. */
const ROW_PATTERNS: Record<AnimationName, RegExp[]> = {
  idle: [/idle/i, /stand|breath/i],
  walk: [/walk/i, /jog|run/i, /move|locomot/i],
  attack: [/attack|slash|swing|strike|stab|chop/i, /punch|kick|shoot|hit(?!.*react)/i],
  // a channelled spell belongs on its own row, not the cast one
  cast: [/^(?!.*channel).*(cast|spell|magic)/i],
  death: [/death|dying|\bdie\b|dead/i],
  channel: [/channel/i, /beam|conjur/i],
  hit: [/hit.*react|react|flinch|hurt|damage|impact/i],
  // only once walk has taken its pick, so a lone run clip still fills walk
  run: [/run|sprint/i, /jog/i],
  work: [/work|gather|harvest|mining|\bmine\b|dig|build|hammer/i],
  carry: [/carry/i],
  taunt: [/taunt|challenge|provok/i, /cheer|victory|celebrat|shout|roar|flex/i],
};

/** Picks a clip for each sheet row by name; rows with no likely clip get null. */
export function guessRows(clipNames: string[]): Record<AnimationName, string | null> {
  const rows = Object.fromEntries(ANIMATION_NAMES.map((r) => [r, null])) as Record<AnimationName, string | null>;
  const used = new Set<string>();
  for (const row of ANIMATION_NAMES) {
    for (const re of ROW_PATTERNS[row]) {
      const hit = clipNames.find((n) => !used.has(n) && re.test(n));
      if (hit) {
        rows[row] = hit;
        used.add(hit);
        break;
      }
    }
  }
  // unrecognised names still beat a static sheet
  if (!Object.values(rows).some(Boolean) && clipNames.length > 0) rows.idle = clipNames[0];
  return rows;
}
