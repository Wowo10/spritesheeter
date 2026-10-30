import { Color, type Object3D, OrthographicCamera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { DEFAULT_LIGHTING, ID_STEP, ShadeMode, type MaterialLibrary } from './materials';
import { MAGIC_RAMPS, rampIndex } from './palette';
import { portraitFocus, type PortraitHead, type PortraitSettings } from './portrait';
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
    this.configureCamera(this.camera, s);
    const result = new Map<Direction, IndexedFrame[]>();
    this.isolate(root, [], s.frameSize * ss, () => {
      for (const dir of DIRECTIONS) {
        root.rotation.y = (DIRECTION_YAW[dir] * Math.PI) / 180;
        result.set(dir, Array.from({ length: count }, (_, i) => this.frame(setFrame(i) ?? 1, i, ss, s)));
      }
    });
    return result;
  }

  /**
   * Renders a close-up of `head` (or all of `root` without one): the portrait's square frame,
   * turned and seen from its own camera, `count` frames as `setFrame` poses them. The camera is
   * placed from the first frame and stays put, so a looping portrait doesn't jitter. `hide` is
   * kept out of the picture (a rider's mount, whose neck would cover the face).
   */
  renderPortrait(
    root: Object3D,
    opts: { count: number; setFrame: (i: number) => number | void; head: PortraitHead | null; hide?: Object3D[]; portrait: PortraitSettings; sprite: SpriteSettings },
  ): IndexedFrame[] {
    const { portrait: p, sprite } = opts;
    const s = { ...sprite, frameSize: p.size };
    const ss = this.supersampleFor(s);
    const frames: IndexedFrame[] = [];
    this.isolate(root, opts.hide ?? [], p.size * ss, () => {
      root.rotation.y = (p.turn * Math.PI) / 180;
      const firstOpacity = opts.setFrame(0) ?? 1;
      const { center, span } = portraitFocus(root, opts.head, p.zoom);
      const cam = this.camera;
      cam.left = cam.bottom = -span / 2;
      cam.right = cam.top = span / 2;
      cam.near = 0.1;
      cam.far = 100;
      const e = (p.elevation * Math.PI) / 180;
      cam.position.set(center.x, center.y + Math.sin(e) * 20, center.z + Math.cos(e) * 20);
      cam.lookAt(center);
      cam.updateProjectionMatrix();
      for (let i = 0; i < opts.count; i++) {
        const opacity = i === 0 ? firstOpacity : (opts.setFrame(i) ?? 1);
        frames.push(this.frame(opacity, i, ss, s));
      }
    });
    return frames;
  }

  /** One frame of the subject as it's posed now: both passes, downscaled, dithered see-through. */
  private frame(opacity: number, i: number, ss: number, s: SpriteSettings): IndexedFrame {
    const size = s.frameSize * ss;
    this.pass(ShadeMode.Id, this.idBuf, size);
    this.pass(ShadeMode.Light, this.lightBuf, size);
    const frame = downscaleFrame(this.idBuf, this.lightBuf, s.frameSize, s.frameSize, ss, ID_STEP, s);
    // dithered after the outline, so the edge isn't drawn around every hole
    return dither(frame, opacity, i, GLOW_RAMPS);
  }

  /**
   * Runs `render` with the target set up at `size`, only `root` visible (minus `hide`) on a
   * transparent background, then puts the renderer, scene and root's facing back.
   */
  private isolate(root: Object3D, hide: Object3D[], size: number, render: () => void): void {
    this.prepare(size);
    const prevTarget = this.renderer.getRenderTarget();
    const prevClear = this.renderer.getClearColor(new Color());
    const prevAlpha = this.renderer.getClearAlpha();
    const prevYaw = root.rotation.y;
    const prevBackground = this.scene.background;
    // a scene background would fill the target opaquely and destroy the transparency
    this.scene.background = null;
    const hidden = [...this.scene.children.filter((c) => c !== root), ...hide].filter((c) => c.visible);
    hidden.forEach((c) => (c.visible = false));
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 0);
    try {
      render();
    } finally {
      this.mats.setMode(ShadeMode.Preview);
      this.renderer.setRenderTarget(prevTarget);
      this.renderer.setClearColor(prevClear, prevAlpha);
      root.rotation.y = prevYaw;
      this.scene.background = prevBackground;
      hidden.forEach((c) => (c.visible = true));
    }
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
