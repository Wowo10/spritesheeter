import { Mesh, ShaderMaterial, Vector3, type Object3D } from 'three';
import { METAL_RAMPS, rampIndex, rampRgb, type RampName, type RGB } from './palette';

/**
 * One shader serves two passes, switched globally through a shared uniform:
 * - PREVIEW: lit and posterised straight to the ramp colours (what the 3D view shows);
 * - SPRITE:  ramp id in the red channel, to pick the ramp per sprite pixel, and light intensity
 *            in the green channel, to pick its shade.
 * Lighting is in view space, so every sprite direction is lit the same way.
 * The preview also dithers by uOpacity, like the sprites; the sprite passes leave that to postprocessing.
 */
export const ShadeMode = { Preview: 0, Sprite: 1 } as const;
export type ShadeMode = (typeof ShadeMode)[keyof typeof ShadeMode];

/** Ramps that glow: their light never drops below this, whichever way they face. */
const MIN_LIGHT: Partial<Record<RampName, number>> = { fire: 0.75, arcane: 0.75, holy: 0.75, venom: 0.75 };

/** Ramp ids are written as (index + 1) * ID_STEP: exact in 8 bits (no MSAA), with room to round, for up to 63 ramps. */
export const ID_STEP = 4;

/**
 * Rust patches on metal parts: value noise over each part's own space, `RUST_SCALE` cells per
 * world unit (at 14 px a unit, a patch is a few pixels), rusted wherever it's above `RUST_LEVEL`.
 */
const RUST_SCALE = 6;
const RUST_LEVEL = 0.59;
/** Cache key suffix of a rust-patched material. */
const RUSTY = '+rust';

/** Lighting is relative to the camera, so it is identical for every sprite direction. */
export interface Lighting {
  ambient: number;
  diffuse: number;
  /** Where the key light comes from, in degrees: 0 = from the camera, -90 = from the left, 90 = from the right. */
  azimuth: number;
  /** Key light height in degrees: 0 = level with the camera, 90 = straight from above the screen. */
  elevation: number;
  /** Soft extra light from the camera itself; brightens whatever faces the viewer. */
  fill: number;
  /** Intensity thresholds between shades 0|1, 1|2 and 2|3. */
  thresholds: [number, number, number];
}

export const DEFAULT_LIGHTING: Lighting = {
  ambient: 0.32,
  diffuse: 0.85,
  azimuth: -35,
  elevation: 27,
  // a little light from the viewer keeps faces turned to the camera readable
  fill: 0.15,
  thresholds: [0.4, 0.62, 0.86],
};

/** View-space direction toward the key light. */
export function lightDirection(azimuthDeg: number, elevationDeg: number): Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

// three's chunks add skinning and morph targets, so rigged custom models deform; they compile
// to nothing for plain meshes
const vertexShader = /* glsl */ `
  #include <common>
  #include <morphtarget_pars_vertex>
  #include <skinning_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vLocal;
  void main() {
    // where on the part, in its own space: rust patches stay put as the part moves
    vLocal = position;
    #include <morphinstance_vertex>
    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    vNormal = normalize(normalMatrix * objectNormal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uMode;
  uniform float uId;
  uniform vec3 uRamp[4];
  uniform vec3 uLightDir;
  uniform float uAmbient;
  uniform float uDiffuse;
  uniform float uFill;
  uniform float uMinLight;
  uniform vec3 uThresholds;
  uniform float uOpacity;
  uniform float uRust;
  uniform float uRustId;
  uniform vec3 uRustRamp[4];
  varying vec3 vNormal;
  varying vec3 vLocal;
  // 4x4 ordered dither threshold in [0, 1)
  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
  // smooth 3D value noise in [0, 1]
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1) * 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // blotches a few sprite pixels across, ragged at the edges
  bool rusted() {
    if (uRust < 0.5) return false;
    float n = 0.7 * noise3(vLocal * ${RUST_SCALE.toFixed(1)}) + 0.3 * noise3(vLocal * ${(RUST_SCALE * 2.7).toFixed(1)} + 17.0);
    return n > ${RUST_LEVEL.toFixed(2)};
  }
  void main() {
    // glowing ramps fade half as fast, as in the sprites
    float opacity = uMinLight > 0.0 ? 2.0 * uOpacity : uOpacity;
    if (uMode < 0.5 && bayer4(gl_FragCoord.xy / 2.0) >= opacity) discard;
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    float light = clamp(uAmbient + uDiffuse * max(dot(n, uLightDir), 0.0) + uFill * max(n.z, 0.0), uMinLight, 1.0);
    bool rust = rusted();
    if (uMode > 0.5) {
      gl_FragColor = vec4((rust ? uRustId : uId) / 255.0, light, 0.0, 1.0);
    } else {
      int s = light < uThresholds.x ? 0 : light < uThresholds.y ? 1 : light < uThresholds.z ? 2 : 3;
      vec3 c = s == 0 ? (rust ? uRustRamp[0] : uRamp[0])
             : s == 1 ? (rust ? uRustRamp[1] : uRamp[1])
             : s == 2 ? (rust ? uRustRamp[2] : uRamp[2])
             : (rust ? uRustRamp[3] : uRamp[3]);
      gl_FragColor = vec4(c, 1.0);
    }
  }
`;

export class MaterialLibrary {
  /** Uniform objects shared by every material, so one write updates them all. */
  private readonly shared = {
    uMode: { value: ShadeMode.Preview as ShadeMode },
    uLightDir: { value: lightDirection(DEFAULT_LIGHTING.azimuth, DEFAULT_LIGHTING.elevation) },
    uAmbient: { value: DEFAULT_LIGHTING.ambient },
    uDiffuse: { value: DEFAULT_LIGHTING.diffuse },
    uFill: { value: DEFAULT_LIGHTING.fill },
    uThresholds: { value: new Vector3(...DEFAULT_LIGHTING.thresholds) },
    uOpacity: { value: 1 },
  };
  /** By ramp, and by ramp + RUSTY for the rust-patched ones. */
  private readonly cache = new Map<string, ShaderMaterial>();
  private readonly overrides = new Map<RampName, RGB[]>();

  /**
   * The material for a ramp; `rusty` patches it with the rust ramp. Both are named after the
   * ramp, so whatever reads a part's ramp from its material (decay) sees the metal underneath.
   */
  get(ramp: RampName, rusty = false): ShaderMaterial {
    const key = rusty ? ramp + RUSTY : ramp;
    let mat = this.cache.get(key);
    if (!mat) {
      mat = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          ...this.shared,
          uId: { value: (rampIndex(ramp) + 1) * ID_STEP },
          uMinLight: { value: MIN_LIGHT[ramp] ?? 0 },
          uRamp: { value: toVectors(this.colors(ramp)) },
          uRust: { value: rusty ? 1 : 0 },
          uRustId: { value: (rampIndex('rust') + 1) * ID_STEP },
          uRustRamp: { value: toVectors(this.colors('rust')) },
        },
      });
      mat.name = ramp;
      this.cache.set(key, mat);
    }
    return mat;
  }

  /** Puts rust patches on every metal part under `root`. */
  rustMetal(root: Object3D): void {
    root.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof ShaderMaterial && METAL_RAMPS.includes(o.material.name as RampName)) {
        o.material = this.get(o.material.name as RampName, true);
      }
    });
  }

  private colors(ramp: RampName): RGB[] {
    return this.overrides.get(ramp) ?? rampRgb(ramp);
  }

  /** Recolours a ramp in the preview (e.g. the team ramp); sprite ids are unaffected. */
  setRampColors(ramp: RampName, colors: RGB[]): void {
    this.overrides.set(ramp, colors);
    for (const [key, mat] of this.cache) {
      if (key === ramp || key === ramp + RUSTY) mat.uniforms.uRamp.value = toVectors(colors);
      if (ramp === 'rust') mat.uniforms.uRustRamp.value = toVectors(colors);
    }
  }

  /** See-through preview, dithered like the sprites. */
  setOpacity(opacity: number): void {
    this.shared.uOpacity.value = opacity;
  }

  setMode(mode: ShadeMode): void {
    this.shared.uMode.value = mode;
  }

  setLighting(l: Lighting): void {
    this.shared.uAmbient.value = l.ambient;
    this.shared.uDiffuse.value = l.diffuse;
    this.shared.uFill.value = l.fill;
    this.shared.uLightDir.value.copy(lightDirection(l.azimuth, l.elevation));
    this.shared.uThresholds.value.set(...l.thresholds);
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

function toVectors(colors: RGB[]): Vector3[] {
  return colors.map(([r, g, b]) => new Vector3(r / 255, g / 255, b / 255));
}
