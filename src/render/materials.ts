import { ShaderMaterial, Vector3 } from 'three';
import { rampIndex, rampRgb, type RampName, type RGB } from './palette';

/**
 * One shader serves three passes, switched globally through a shared uniform:
 * - PREVIEW: lit and posterised straight to the ramp colours (what the 3D view shows);
 * - LIGHT:   light intensity in the red channel, used to pick the shade per sprite pixel;
 * - ID:      ramp id in the red channel, used to pick the ramp per sprite pixel.
 * Lighting is in view space, so every sprite direction is lit the same way.
 */
export const ShadeMode = { Preview: 0, Light: 1, Id: 2 } as const;
export type ShadeMode = (typeof ShadeMode)[keyof typeof ShadeMode];

/** Ramps that glow: their light never drops below this, whichever way they face. */
const MIN_LIGHT: Partial<Record<RampName, number>> = { fire: 0.75, arcane: 0.75, holy: 0.75, venom: 0.75 };

/** Ramp ids are written as (index + 1) * ID_STEP so 8-bit rounding can't confuse neighbours. */
export const ID_STEP = 8;

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
  void main() {
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
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    float light = clamp(uAmbient + uDiffuse * max(dot(n, uLightDir), 0.0) + uFill * max(n.z, 0.0), uMinLight, 1.0);
    if (uMode > 1.5) {
      gl_FragColor = vec4(uId / 255.0, 0.0, 0.0, 1.0);
    } else if (uMode > 0.5) {
      gl_FragColor = vec4(light, 0.0, 0.0, 1.0);
    } else {
      vec3 c = light < uThresholds.x ? uRamp[0]
             : light < uThresholds.y ? uRamp[1]
             : light < uThresholds.z ? uRamp[2]
             : uRamp[3];
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
  };
  private readonly cache = new Map<RampName, ShaderMaterial>();
  private readonly overrides = new Map<RampName, RGB[]>();

  get(ramp: RampName): ShaderMaterial {
    let mat = this.cache.get(ramp);
    if (!mat) {
      mat = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          ...this.shared,
          uId: { value: (rampIndex(ramp) + 1) * ID_STEP },
          uMinLight: { value: MIN_LIGHT[ramp] ?? 0 },
          uRamp: { value: toVectors(this.overrides.get(ramp) ?? rampRgb(ramp)) },
        },
      });
      mat.name = ramp;
      this.cache.set(ramp, mat);
    }
    return mat;
  }

  /** Recolours a ramp in the preview (e.g. the team ramp); sprite ids are unaffected. */
  setRampColors(ramp: RampName, colors: RGB[]): void {
    this.overrides.set(ramp, colors);
    const mat = this.cache.get(ramp);
    if (mat) mat.uniforms.uRamp.value = toVectors(colors);
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
