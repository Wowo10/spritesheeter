import { ShaderMaterial, Vector3 } from 'three';
import { rampIndex, rampRgb, type RampName } from './palette';

/**
 * One shader serves three passes, switched globally through a shared uniform:
 * - PREVIEW: lit and posterised straight to the ramp colours (what the 3D view shows);
 * - LIGHT:   light intensity in the red channel, used to pick the shade per sprite pixel;
 * - ID:      ramp id in the red channel, used to pick the ramp per sprite pixel.
 * Lighting is in view space, so every sprite direction is lit the same way.
 */
export const ShadeMode = { Preview: 0, Light: 1, Id: 2 } as const;
export type ShadeMode = (typeof ShadeMode)[keyof typeof ShadeMode];

/** Ramp ids are written as (index + 1) * ID_STEP so 8-bit rounding can't confuse neighbours. */
export const ID_STEP = 8;

export interface Lighting {
  ambient: number;
  diffuse: number;
  /** Intensity thresholds between shades 0|1, 1|2 and 2|3. */
  thresholds: [number, number, number];
}

export const DEFAULT_LIGHTING: Lighting = {
  ambient: 0.32,
  diffuse: 0.85,
  thresholds: [0.4, 0.62, 0.86],
};

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uMode;
  uniform float uId;
  uniform vec3 uRamp[4];
  uniform vec3 uLightDir;
  uniform float uAmbient;
  uniform float uDiffuse;
  uniform vec3 uThresholds;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    float light = clamp(uAmbient + uDiffuse * max(dot(n, uLightDir), 0.0), 0.0, 1.0);
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
    uLightDir: { value: new Vector3(-0.55, 0.65, 0.52).normalize() },
    uAmbient: { value: DEFAULT_LIGHTING.ambient },
    uDiffuse: { value: DEFAULT_LIGHTING.diffuse },
    uThresholds: { value: new Vector3(...DEFAULT_LIGHTING.thresholds) },
  };
  private readonly cache = new Map<RampName, ShaderMaterial>();

  get(ramp: RampName): ShaderMaterial {
    let mat = this.cache.get(ramp);
    if (!mat) {
      mat = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          ...this.shared,
          uId: { value: (rampIndex(ramp) + 1) * ID_STEP },
          uRamp: { value: rampRgb(ramp).map(([r, g, b]) => new Vector3(r / 255, g / 255, b / 255)) },
        },
      });
      mat.name = ramp;
      this.cache.set(ramp, mat);
    }
    return mat;
  }

  setMode(mode: ShadeMode): void {
    this.shared.uMode.value = mode;
  }

  setLighting(l: Lighting): void {
    this.shared.uAmbient.value = l.ambient;
    this.shared.uDiffuse.value = l.diffuse;
    this.shared.uThresholds.value.set(...l.thresholds);
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}
