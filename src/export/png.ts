import { TEAM_INDICES, type RGB } from '../render/palette';
import type { Sheet } from './packer';

/** PNG colour types written here: 3 = palette indices, 4 = grey + alpha. */
export type PngColorType = 3 | 4;

export interface PngImage {
  width: number;
  height: number;
  colorType: PngColorType;
  /** One byte per pixel for type 3, two (grey, alpha) for type 4; rows top to bottom. */
  data: Uint8Array;
  /** Type 3 only. */
  palette?: RGB[];
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib-wrapped deflate, which is what IDAT holds. */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encodes 8-bit pixels; palette images get index 0 transparent and every other entry opaque. */
export async function encodePng({ width, height, colorType, data, palette }: PngImage): Promise<Uint8Array> {
  const bpp = colorType === 3 ? 1 : 2;
  if (data.length !== width * height * bpp) throw new Error(`encodePng: ${data.length} bytes for ${width}x${height}`);

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, colorType, 0, 0, 0], 8);

  // every row starts with filter type 0 (none)
  const stride = width * bpp;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);

  const chunks = [chunk('IHDR', ihdr)];
  if (colorType === 3) {
    if (!palette || palette.length > 256) throw new Error('encodePng: palette images need 1-256 palette entries');
    chunks.push(chunk('PLTE', Uint8Array.from(palette.flat())), chunk('tRNS', Uint8Array.of(0)));
  }
  chunks.push(chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0)));

  const out = new Uint8Array(SIGNATURE.length + chunks.reduce((n, c) => n + c.length, 0));
  out.set(SIGNATURE);
  let at = SIGNATURE.length;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The sheet as a palette PNG: its own indices, so a team is recoloured by swapping 4 palette entries. */
export function indexedPng(sheet: Pick<Sheet, 'width' | 'height' | 'data'>, palette: RGB[]): Promise<Uint8Array> {
  return encodePng({ width: sheet.width, height: sheet.height, colorType: 3, data: sheet.data, palette });
}

/** Grey per team shade (0-3) in the mask; anything else in the sheet is transparent. */
export const MASK_SHADE_STEP = 85;

/** Grey + alpha: team pixels are opaque, grey s * 85 for team shade s; the rest transparent. */
export function teamMaskPixels(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length * 2);
  for (let i = 0; i < data.length; i++) {
    const s = TEAM_INDICES.indexOf(data[i]);
    if (s < 0) continue;
    out[i * 2] = s * MASK_SHADE_STEP;
    out[i * 2 + 1] = 255;
  }
  return out;
}

export function teamMaskPng(sheet: Pick<Sheet, 'width' | 'height' | 'data'>): Promise<Uint8Array> {
  return encodePng({ width: sheet.width, height: sheet.height, colorType: 4, data: teamMaskPixels(sheet.data) });
}
