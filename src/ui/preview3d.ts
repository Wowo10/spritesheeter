import { Color, GridHelper, OrthographicCamera, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 16;

/** Owns the WebGL renderer and scene; the sprite renderer borrows both. */
export class Preview3D {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly perspective = new PerspectiveCamera(35, 1, 0.1, 100);
  readonly ortho = new OrthographicCamera();
  readonly controls: OrbitControls;
  /** When set, the view shows exactly the sprite camera's angle (scaled to fit). */
  spriteView = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x2a2e38);
    const grid = new GridHelper(4, 8, 0x4a5060, 0x3a3f4c);
    this.scene.add(grid);

    this.perspective.position.set(2.6, 2.2, 3.8);
    this.controls = new OrbitControls(this.perspective, this.renderer.domElement);
    this.controls.target.set(0, 0.85, 0);
    this.controls.update();

    // the sprite camera view zooms on its own (orbit controls only move the perspective camera)
    this.renderer.domElement.addEventListener('wheel', (e) => {
      if (!this.spriteView) return;
      e.preventDefault();
      this.setSpriteZoom(this.ortho.zoom * Math.exp(-e.deltaY * 0.002));
    }, { passive: false });
    this.renderer.domElement.addEventListener('dblclick', () => {
      if (this.spriteView) this.setSpriteZoom(1);
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.perspective.aspect = w / h;
    this.perspective.updateProjectionMatrix();
    this.fitOrtho();
  }

  /** Call after configuring `ortho` like a sprite camera: widens it to the viewport aspect and adds margin. */
  fitOrtho(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    const c = this.ortho;
    const margin = 1.3;
    const cy = (c.top + c.bottom) / 2;
    const half = ((c.top - c.bottom) / 2) * margin;
    c.top = cy + half;
    c.bottom = cy - half;
    c.left = -half * (w / h);
    c.right = half * (w / h);
    c.updateProjectionMatrix();
  }

  setSpriteZoom(zoom: number): void {
    this.ortho.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.ortho.updateProjectionMatrix();
  }

  render(): void {
    this.controls.enabled = !this.spriteView;
    this.renderer.render(this.scene, this.spriteView ? this.ortho : this.perspective);
  }
}
