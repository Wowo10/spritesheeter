import { describe, expect, it } from 'vitest';
import { crc32, encodePng, indexedPng, teamMaskPixels, teamMaskPng } from '../src/export/png';
import { PALETTE, paletteIndex, rampIndex, TEAM_INDICES } from '../src/render/palette';

interface Decoded {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  chunks: Map<string, Uint8Array>;
  pixels: Uint8Array;
}

/** Just enough of a PNG reader for what encodePng writes: one IDAT, filter type 0 on every row. */
async function decode(png: Uint8Array): Promise<Decoded> {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks = new Map<string, Uint8Array>();
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    expect(view.getUint32(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
    chunks.set(type, data);
    at += 12 + length;
  }
  const ihdr = new DataView(chunks.get('IHDR')!.buffer, chunks.get('IHDR')!.byteOffset, 13);
  const width = ihdr.getUint32(0);
  const height = ihdr.getUint32(4);
  const colorType = ihdr.getUint8(9);
  const stream = new Blob([chunks.get('IDAT')!]).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  const stride = width * (colorType === 3 ? 1 : 2);
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)]).toBe(0);
    pixels.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, bitDepth: ihdr.getUint8(8), colorType, chunks, pixels };
}

const team = (s: number) => TEAM_INDICES[s];
const steel = paletteIndex(rampIndex('steel'), 2);
// 3x2: transparent, every team shade, and a non-team colour
const sheet = { width: 3, height: 2, data: Uint8Array.of(0, team(0), team(1), team(2), team(3), steel) };

describe('png', () => {
  it('checksums chunks with CRC-32', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });

  it('writes the sheet as an 8-bit palette PNG, index 0 transparent', async () => {
    const png = await decode(await indexedPng(sheet, PALETTE));
    expect([png.width, png.height, png.bitDepth, png.colorType]).toEqual([3, 2, 8, 3]);
    expect(png.chunks.get('PLTE')!.length).toBe(PALETTE.length * 3);
    expect([...png.chunks.get('PLTE')!.subarray(steel * 3, steel * 3 + 3)]).toEqual(PALETTE[steel]);
    expect([...png.chunks.get('tRNS')!]).toEqual([0]);
    expect(png.pixels).toEqual(sheet.data);
  });

  it('round-trips a sheet big enough to compress', async () => {
    const data = Uint8Array.from({ length: 160 * 96 }, (_, i) => (i * 7) % PALETTE.length);
    const png = await indexedPng({ width: 160, height: 96, data }, PALETTE);
    expect((await decode(png)).pixels).toEqual(data);
  });

  it('masks team pixels as grey per shade, everything else transparent', () => {
    expect([...teamMaskPixels(sheet.data)]).toEqual([0, 0, 0, 255, 85, 255, 170, 255, 255, 255, 0, 0]);
  });

  it('writes the mask as grey + alpha', async () => {
    const png = await decode(await teamMaskPng(sheet));
    expect([png.width, png.height, png.bitDepth, png.colorType]).toEqual([3, 2, 8, 4]);
    expect(png.chunks.has('PLTE')).toBe(false);
    expect(png.pixels).toEqual(teamMaskPixels(sheet.data));
  });

  it('refuses data of the wrong size', async () => {
    await expect(encodePng({ width: 2, height: 2, colorType: 3, data: new Uint8Array(3), palette: PALETTE })).rejects.toThrow();
  });
});
