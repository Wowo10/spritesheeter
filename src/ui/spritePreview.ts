import { indexedToRgba } from '../export/packer';
import { mirrorFrame, type IndexedFrame } from '../render/postprocess';
import { MIRRORED, type AnyDirection, type Direction } from '../render/spriteRenderer';

const LAYOUT: (AnyDirection | null)[][] = [
  ['NW', 'N', 'NE'],
  ['W', null, 'E'],
  ['SW', 'S', 'SE'],
];

function frameToCanvas(f: IndexedFrame): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = f.width;
  c.height = f.height;
  c.getContext('2d')!.putImageData(new ImageData(indexedToRgba(f.data), f.width, f.height), 0, 0);
  return c;
}

/** All eight directions of one animation, played in a 3x3 compass grid. */
export class CompassPreview {
  private frames = new Map<AnyDirection, HTMLCanvasElement[]>();
  private frameSize = 32;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly scale = 3,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  setFrames(byDir: Map<Direction, IndexedFrame[]>): void {
    this.frames.clear();
    for (const [dir, frames] of byDir) {
      this.frames.set(dir, frames.map(frameToCanvas));
      this.frameSize = frames[0]?.width ?? this.frameSize;
    }
    for (const [mirror, source] of Object.entries(MIRRORED) as [AnyDirection, Direction][]) {
      this.frames.set(mirror, (byDir.get(source) ?? []).map((f) => frameToCanvas(mirrorFrame(f))));
    }
    const px = this.frameSize * this.scale * 3;
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
  }

  draw(frameIndex: number): void {
    const cell = this.frameSize * this.scale;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    LAYOUT.forEach((row, r) =>
      row.forEach((dir, c) => {
        const frames = dir && this.frames.get(dir);
        if (!frames?.length) return;
        this.ctx.drawImage(frames[Math.min(frameIndex, frames.length - 1)], c * cell, r * cell, cell, cell);
      }),
    );
  }
}
