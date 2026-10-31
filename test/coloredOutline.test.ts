import { describe, expect, it } from 'vitest';
import { coloredOutline, MAX_OUTLINE_LUMA } from '../src/render/coloredOutline';
import { OUTLINE_INDEX, PALETTE, paletteIndex, rampIndex, TEAM_INDICES } from '../src/render/palette';
import { outline, sampleFrame, shadeFrame, shadePixels, type IndexedFrame, type PostprocessSettings } from '../src/render/postprocess';
import { randomPass, STEP } from './passes';

const steel = rampIndex('steel');
const luma = ([r, g, b]: number[]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/** A frame from text: '.' transparent, any other character a pixel from the legend. */
function frame(lines: string[], legend: Record<string, number>): IndexedFrame {
  const width = lines[0].length;
  return { width, height: lines.length, data: Uint8Array.from(lines.join(''), (c) => (c === '.' ? 0 : legend[c])) };
}

const square = ['......', '......', '..XX..', '..XX..', '......', '......'];

describe('colored outer outline', () => {
  it('rings a lit part in the darkest shade of its material, where the outer outline would go', () => {
    const f = frame(square, { X: paletteIndex(steel, 3) });
    const d = coloredOutline(f).data;
    const outer = outline(f, 'outer').data;
    d.forEach((v, i) => {
      if (f.data[i]) expect(v).toBe(f.data[i]);
      else expect(v === 0, `pixel ${i}`).toBe(outer[i] === 0);
    });
    expect(d[1 * 6 + 2]).toBe(paletteIndex(steel, 0));
  });

  it('is black next to shadowed pixels, so it follows the light', () => {
    const d = coloredOutline(frame(square, { X: paletteIndex(steel, 1) })).data;
    expect(d[1 * 6 + 2]).toBe(OUTLINE_INDEX);
  });

  it('is black next to materials too pale to outline in their own colour', () => {
    const pale = paletteIndex(rampIndex('paleSkin'), 0);
    expect(luma(PALETTE[pale])).toBeGreaterThan(MAX_OUTLINE_LUMA);
    expect(coloredOutline(frame(square, { X: paletteIndex(rampIndex('paleSkin'), 3) })).data[1 * 6 + 2]).toBe(OUTLINE_INDEX);
  });

  it('takes the darkest of the pixels it borders', () => {
    // the corner pixel at the top left borders a lit pixel below and a shadowed one to its right
    const d = coloredOutline(frame(['.S', 'L.'], { S: paletteIndex(steel, 1), L: paletteIndex(steel, 3) })).data;
    expect(d[0]).toBe(OUTLINE_INDEX);
  });

  it('outlines the team colour in its darkest team shade, which recolours per team', () => {
    const d = coloredOutline(frame(square, { X: paletteIndex(rampIndex('team'), 3) })).data;
    expect(d[1 * 6 + 2]).toBe(TEAM_INDICES[0]);
  });

  it('leaves a 1 px gap between parts open', () => {
    const d = coloredOutline(frame(['.X.X.'], { X: paletteIndex(steel, 3) })).data;
    expect(Array.from(d)).toEqual([paletteIndex(steel, 0), paletteIndex(steel, 3), 0, paletteIndex(steel, 3), paletteIndex(steel, 0)]);
    // where the outer outline closes it
    expect(outline(frame(['.X.X.'], { X: paletteIndex(steel, 3) }), 'outer').data[2]).toBe(OUTLINE_INDEX);
  });

  it('outlines a 2 px gap on its darker part only, the left or upper one on a tie', () => {
    const team = paletteIndex(rampIndex('team'), 3);
    const lit = paletteIndex(steel, 3);
    expect(luma(PALETTE[team])).toBeLessThan(luma(PALETTE[lit]));
    expect(Array.from(coloredOutline(frame(['X..T'], { X: lit, T: team })).data)).toEqual([lit, 0, TEAM_INDICES[0], team]);
    expect(Array.from(coloredOutline(frame(['X..X'], { X: lit })).data)).toEqual([lit, paletteIndex(steel, 0), 0, lit]);
    expect(Array.from(coloredOutline(frame(['X', '.', '.', 'X'], { X: lit })).data)).toEqual([lit, paletteIndex(steel, 0), 0, lit]);
  });

  it('only uses palette colours, and leaves the frame it was given alone', () => {
    const f = shadePixels(sampleFrame(randomPass(24, 4, 8), 24, 24, 4, STEP), { coverage: 0.3, thresholds: [0.4, 0.62, 0.86] });
    const before = Array.from(f.data);
    const d = coloredOutline(f).data;
    expect(Array.from(f.data)).toEqual(before);
    d.forEach((v) => expect(v).toBeLessThan(PALETTE.length));
  });

  it("is shadeFrame's 'colored' outline, dithered after", () => {
    const s: PostprocessSettings = { coverage: 0.3, thresholds: [0.4, 0.62, 0.86], outline: 'colored' };
    const f = sampleFrame(randomPass(16, 4, 9), 16, 16, 4, STEP);
    expect(shadeFrame(f, s).data).toEqual(coloredOutline(shadePixels(f, s)).data);
  });
});
