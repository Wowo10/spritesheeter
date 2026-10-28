import { Color, type Object3D, OrthographicCamera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { DEFAULT_LIGHTING, ID_STEP, ShadeMode, type MaterialLibrary } from './materials';
import { MAGIC_RAMPS, rampIndex } from './palette';
import { dither, downscaleFrame, type IndexedFrame, type PostprocessSettings } from './postprocess';

/** Rendered directions; the west-facing ones are mirrored from their east twins. */
export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const MIRRORED = { NW: 'NE', W: 'E', SW: 'SE' } as const;
export type AnyDirection = Direction | keyof typeof MIRRORED;

/** Unit yaw (degrees) that makes it face the given direction; S faces the camera. */
export const DIRECTION_YAW: Record<Direction, number> = { S: 0, SE: 45, E: 90, NE: 135, N: 180 };

export interface SpriteSettings extends PostprocessSettings {
  frameSize: number;
  pixelsPerUnit: number;
  /** Camera angle above the ground, in degrees. */
  elevation: number;
  /** Vertical position of the ground anchor as a fraction of the frame, from the top. */
  anchorY: number;
  supersample: number;
}

export const DEFAULT_SPRITE_SETTINGS: SpriteSettings = {
  frameSize: 32,
  pixelsPerUnit: 14,
  elevation: 35,
  anchorY: 0.78,
  supersample: 8,
  coverage: 0.3,
  thresholds: DEFAULT_LIGHTING.thresholds,
  outline: 'inner',
};

export function anchorOf(s: Pick<SpriteSettings, 'frameSize' | 'anchorY'>): { x: number; y: number } {
  return { x: s.frameSize / 2, y: Math.round(s.frameSize * s.anchorY) };
}

/** Largest supersampled render target, in pixels per side. */
const MAX_TARGET_SIZE = 2048;

/** Glowing ramps stay more solid when a sprite is dithered see-through. */
const GLOW_RAMPS = MAGIC_RAMPS.map(rampIndex);

export class SpriteRenderer {
  private readonly camera = new OrthographicCamera();
  private target: WebGLRenderTarget | null = null;
  private idBuf = new Uint8Array(0);
  private lightBuf = new Uint8Array(0);

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly mats: MaterialLibrary,
  ) {}

  /** Points the camera exactly as the sprites see the unit; also used by the 3D view. */
  configureCamera(cam: OrthographicCamera, s: SpriteSettings): void {
    const view = s.frameSize / s.pixelsPerUnit;
    // the ground anchor (world origin) lands anchorY of the way down the frame
    const top = Math.round(s.frameSize * s.anchorY) / s.pixelsPerUnit;
    cam.left = -view / 2;
    cam.right = view / 2;
    cam.top = top;
    cam.bottom = top - view;
    cam.near = 0.1;
    cam.far = 100;
    const e = (s.elevation * Math.PI) / 180;
    cam.position.set(0, Math.sin(e) * 20, Math.cos(e) * 20);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }

  /**
   * Supersampling actually used: big frames get less, so the render target stays within what
   * the GPU can render and re-rendering stays quick. 256 px frames still get 8x.
   */
  supersampleFor(s: Pick<SpriteSettings, 'frameSize' | 'supersample'>): number {
    const gl = this.renderer.getContext();
    const max = Math.min(MAX_TARGET_SIZE, this.renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
    return Math.max(1, Math.min(s.supersample, Math.floor(max / s.frameSize)));
  }

  /**
   * Renders `count` frames in every direction, so the render target is set up once per batch.
   * `setFrame(i)` puts the subject in its i-th frame and may return its opacity (default 1);
   * `root` is turned to face each direction.
   */
  renderFrames(root: Object3D, count: number, setFrame: (i: number) => number | void, s: SpriteSettings): Map<Direction, IndexedFrame[]> {
    const ss = this.supersampleFor(s);
    const size = s.frameSize * ss;
    this.prepare(size);
    this.configureCamera(this.camera, s);

    const prevTarget = this.renderer.getRenderTarget();
    const prevClear = this.renderer.getClearColor(new Color());
    const prevAlpha = this.renderer.getClearAlpha();
    const prevYaw = root.rotation.y;
    const prevBackground = this.scene.background;
    // a scene background would fill the target opaquely and destroy the transparency
    this.scene.background = null;
    const hidden = this.scene.children.filter((c) => c !== root && c.visible);
    hidden.forEach((c) => (c.visible = false));
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 0);

    const result = new Map<Direction, IndexedFrame[]>();
    try {
      for (const dir of DIRECTIONS) {
        root.rotation.y = (DIRECTION_YAW[dir] * Math.PI) / 180;
        const frames: IndexedFrame[] = [];
        for (let i = 0; i < count; i++) {
          const opacity = setFrame(i) ?? 1;
          this.pass(ShadeMode.Id, this.idBuf, size);
          this.pass(ShadeMode.Light, this.lightBuf, size);
          const frame = downscaleFrame(this.idBuf, this.lightBuf, s.frameSize, s.frameSize, ss, ID_STEP, s);
          // dithered after the outline, so the edge isn't drawn around every hole
          frames.push(dither(frame, opacity, i, GLOW_RAMPS));
        }
        result.set(dir, frames);
      }
    } finally {
      this.mats.setMode(ShadeMode.Preview);
      this.renderer.setRenderTarget(prevTarget);
      this.renderer.setClearColor(prevClear, prevAlpha);
      root.rotation.y = prevYaw;
      this.scene.background = prevBackground;
      hidden.forEach((c) => (c.visible = true));
    }
    return result;
  }

  private pass(mode: ShadeMode, buf: Uint8Array, size: number): void {
    this.mats.setMode(mode);
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(this.target!, 0, 0, size, size, buf);
  }

  private prepare(size: number): void {
    if (this.target?.width === size) return;
    this.target?.dispose();
    // no MSAA: ids must never be blended between neighbouring materials
    this.target = new WebGLRenderTarget(size, size, { samples: 0, depthBuffer: true });
    this.idBuf = new Uint8Array(size * size * 4);
    this.lightBuf = new Uint8Array(size * size * 4);
  }

  dispose(): void {
    this.target?.dispose();
  }
}
