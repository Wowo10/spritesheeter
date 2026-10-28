import { PALETTE, type RGB } from '../render/palette';
import type { Sheet } from './packer';
import { indexedToRgba } from './packer';

export function sheetToCanvas(
  sheet: Pick<Sheet, 'width' | 'height' | 'data'>,
  palette: RGB[] = PALETTE,
  canvas = document.createElement('canvas'),
): HTMLCanvasElement {
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(indexedToRgba(sheet.data, palette), sheet.width, sheet.height), 0, 0);
  return canvas;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadPng(sheet: Sheet, filename: string, palette: RGB[] = PALETTE): void {
  sheetToCanvas(sheet, palette).toBlob((blob) => blob && saveBlob(blob, filename), 'image/png');
}

export function downloadJson(data: unknown, filename: string): void {
  saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
}
