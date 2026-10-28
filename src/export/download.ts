import { PALETTE, type RGB } from '../render/palette';
import type { Sheet } from './packer';
import { indexedToRgba } from './packer';
import { indexedPng, teamMaskPng } from './png';

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

/** The sheet as an indexed (palette) PNG, drawn in the given palette. */
export async function downloadPng(sheet: Sheet, filename: string, palette: RGB[] = PALETTE): Promise<void> {
  downloadBinary(await indexedPng(sheet, palette), filename, 'image/png');
}

/** The team-coloured pixels of the sheet, grey per shade; see teamMaskPixels. */
export async function downloadTeamMask(sheet: Sheet, filename: string): Promise<void> {
  downloadBinary(await teamMaskPng(sheet), filename, 'image/png');
}

export function downloadBinary(data: BlobPart, filename: string, type = 'application/octet-stream'): void {
  saveBlob(new Blob([data], { type }), filename);
}

export function downloadJson(data: unknown, filename: string): void {
  saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
}
