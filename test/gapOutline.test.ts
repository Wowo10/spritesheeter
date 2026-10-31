import { describe, expect, it } from 'vitest';
import { coloredOutline } from '../src/render/coloredOutline';
import { gapBlackOutline, holes, MATERIAL_OUTLINE, MATERIAL_RANK, SMALL_HOLE, stableColoredOutline } from '../src/render/gapOutline';
import { OUTLINE_INDEX, paletteIndex, RAMP_NAMES, rampIndex, SHADES, TEAM_INDICES } from '../src/render/palette';
import { outline, sampleFrame, shadeFrame, shadePixels, shadeStages, type IndexedFrame, type PostprocessSettings } from '../src/render/postprocess';
import { randomPass, STEP } from './passes';

const steel = rampIndex('steel');
const lit = paletteIndex(steel, 3);

/** A frame from text: '.' transparent, any other character a pixel from the legend (X: lit steel). */
function frame(lines: string[], legend: Record<string, number> = { X: lit }): IndexedFrame {
  const width = lines[0].length;
  return { width, height: lines.length, data: Uint8Array.from(lines.join(''), (c) => (c === '.' ? 0 : legend[c])) };
}

/** An outlined frame as text: 'X' drawn before, 'o' black outline, 'c' coloured outline, '.' empty. */
function marks(before: IndexedFrame, after: IndexedFrame): string[] {
  const w = before.width;
  return Array.from({ length: before.height }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      const i = y * w + x;
      return before.data[i] ? 'X' : after.data[i] === OUTLINE_INDEX ? 'o' : after.data[i] ? 'c' : '.';
    }).join(''),
  );
}

const s: PostprocessSettings = { coverage: 0.3, thresholds: [0.4, 0.62, 0.86], outline: 'none' };
/** Random frames, shaded twice: under two sets of thresholds, so the same parts in other shades. */
const relit = [1, 2, 3, 4, 5].map((seed) => {
  const f = sampleFrame(randomPass(24, 4, seed), 24, 24, 4, STEP);
  return [shadePixels(f, s), shadePixels(f, { ...s, thresholds: [0.1, 0.3, 0.5] })];
});
/** The outline pixels alone: what an outline added. */
const added = (before: IndexedFrame, after: IndexedFrame) => Array.from(after.data, (v, i) => (before.data[i] ? 0 : v));

describe('material outline colours', () => {
  it('are one per material, the same for all its shades: computed once, not per lit pixel', () => {
    RAMP_NAMES.forEach((_, r) => {
      for (let sh = 1; sh < SHADES; sh++) expect(MATERIAL_OUTLINE[paletteIndex(r, sh)]).toBe(MATERIAL_OUTLINE[paletteIndex(r, 0)]);
      for (let sh = 1; sh < SHADES; sh++) expect(MATERIAL_RANK[paletteIndex(r, sh)]).toBe(MATERIAL_RANK[paletteIndex(r, 0)]);
    });
  });

  it("are the material's darkest shade, or black for materials too pale for that", () => {
    expect(MATERIAL_OUTLINE[lit]).toBe(paletteIndex(steel, 0));
    expect(MATERIAL_OUTLINE[paletteIndex(rampIndex('team'), 2)]).toBe(TEAM_INDICES[0]);
    expect(MATERIAL_OUTLINE[paletteIndex(rampIndex('paleSkin'), 3)]).toBe(OUTLINE_INDEX);
    expect(MATERIAL_OUTLINE[0]).toBe(0);
  });

  it('rank the materials by how dark they are, black first', () => {
    expect(MATERIAL_RANK[OUTLINE_INDEX]).toBe(0);
    expect(MATERIAL_RANK[paletteIndex(rampIndex('team'), 3)]).toBeLessThan(MATERIAL_RANK[lit]);
    expect(new Set(RAMP_NAMES.map((_, r) => MATERIAL_RANK[paletteIndex(r, 0)])).size).toBe(RAMP_NAMES.length);
  });
});

describe('stable colored outer outline', () => {
  it("is the material's darkest shade on the lit side and the shadowed side alike", () => {
    const square = ['......', '......', '..XX..', '..XX..', '......', '......'];
    for (const sh of [0, 1, 2, 3]) {
      const d = stableColoredOutline(frame(square, { X: paletteIndex(steel, sh) })).data;
      expect(d[1 * 6 + 2]).toBe(paletteIndex(steel, 0));
    }
    // where the colored outline goes black next to the shadowed side
    expect(coloredOutline(frame(square, { X: paletteIndex(steel, 1) })).data[1 * 6 + 2]).toBe(OUTLINE_INDEX);
  });

  it("doesn't change with the light: the same parts in other shades get the same outline", () => {
    let coloredChanged = 0;
    for (const [a, b] of relit) {
      expect(a.data).not.toEqual(b.data);
      expect(added(a, stableColoredOutline(a))).toEqual(added(b, stableColoredOutline(b)));
      if (added(a, coloredOutline(a)).join() !== added(b, coloredOutline(b)).join()) coloredChanged++;
    }
    // the colored outline does
    expect(coloredChanged).toBeGreaterThan(0);
  });

  it('takes the darkest material it borders, whichever of them is lit', () => {
    const leather = rampIndex('leather');
    expect(MATERIAL_RANK[paletteIndex(leather, 0)]).toBeLessThan(MATERIAL_RANK[lit]);
    // the top left corner borders steel to its right and leather below
    for (const [st, le] of [[3, 0], [0, 3]]) {
      const d = stableColoredOutline(frame(['.S', 'L.'], { S: paletteIndex(steel, st), L: paletteIndex(leather, le) })).data;
      expect(d[0]).toBe(paletteIndex(leather, 0));
    }
  });

  it('leaves a 1 px gap open and outlines a 2 px one on the darker material, not the darker pixel', () => {
    const steel0 = paletteIndex(steel, 0);
    expect(Array.from(stableColoredOutline(frame(['.X.X.'])).data)).toEqual([steel0, lit, 0, lit, steel0]);
    // shadowed steel against lit team colour: the colored outline goes by the pixels, this by the materials
    const team = paletteIndex(rampIndex('team'), 3);
    const shadowed = paletteIndex(steel, 0);
    expect(Array.from(stableColoredOutline(frame(['S..T'], { S: shadowed, T: team })).data)).toEqual([shadowed, 0, TEAM_INDICES[0], team]);
    expect(Array.from(coloredOutline(frame(['S..T'], { S: shadowed, T: team })).data)).toEqual([shadowed, OUTLINE_INDEX, 0, team]);
    // one material lit on one side and shadowed on the other: a tie, the left part
    expect(Array.from(stableColoredOutline(frame(['X..S'], { X: lit, S: shadowed })).data)).toEqual([lit, steel0, 0, shadowed]);
  });

  it("outlines only where the outer outline would, and doesn't touch the sprite", () => {
    for (const [a] of relit) {
      const d = stableColoredOutline(a).data;
      const outer = outline(a, 'outer').data;
      d.forEach((v, i) => {
        if (a.data[i]) expect(v).toBe(a.data[i]);
        else if (v) expect(outer[i]).not.toBe(0);
      });
    }
  });

  it("is shadeFrame's 'stableColored' outline, dithered after", () => {
    const f = sampleFrame(randomPass(16, 4, 9), 16, 16, 4, STEP);
    const st = shadeStages(f, { ...s, outline: 'stableColored' });
    expect(st.outlined.data).toEqual(stableColoredOutline(shadePixels(f, s)).data);
    expect(shadeFrame(f, { ...s, outline: 'stableColored' }).data).toEqual(st.final.data);
  });
});

describe('gap-preserving black outer outline', () => {
  it('is the outer outline around a shape with no gaps or holes', () => {
    const f = frame(['......', '.XXX..', '.XXXX.', '..XX..', '......']);
    expect(gapBlackOutline(f).data).toEqual(outline(f, 'outer').data);
  });

  it('keeps a slit between two legs open below the row where they join, which it outlines', () => {
    const legs = frame(['.......', '.XXXXX.', '.XX.XX.', '.XX.XX.', '.XX.XX.', '.......']);
    expect(marks(legs, gapBlackOutline(legs))).toEqual(['.ooooo.', 'oXXXXXo', 'oXXoXXo', 'oXX.XXo', 'oXX.XXo', '.oo.oo.']);
    expect(marks(legs, outline(legs, 'outer'))[3]).toBe('oXXoXXo');
    // deeper dents outlined: the whole slit, as the outer outline has it
    expect(gapBlackOutline(legs, { dentDepth: 3 }).data).toEqual(outline(legs, 'outer').data);
  });

  it('outlines a one-pixel notch in an edge, which is background, not a gap', () => {
    const notch = frame(['.....', '.X.X.', '.XXX.', '.....']);
    expect(marks(notch, gapBlackOutline(notch))).toEqual(['.o.o.', 'oXoXo', 'oXXXo', '.ooo.']);
    // the colored outline leaves it open
    expect(marks(notch, coloredOutline(notch))[1]).toBe('cX.Xc');
  });

  it('keeps a gap between separate parts open: 1 px all of it, 2 px on one side', () => {
    expect(marks(frame(['.X.X.']), gapBlackOutline(frame(['.X.X.'])))).toEqual(['oX.Xo']);
    expect(marks(frame(['X', '.', 'X']), gapBlackOutline(frame(['X', '.', 'X'])))).toEqual(['X', '.', 'X']);
    // a tie: the left part's side; otherwise the darker material's
    expect(marks(frame(['X..X']), gapBlackOutline(frame(['X..X'])))).toEqual(['Xo.X']);
    const team = paletteIndex(rampIndex('team'), 3);
    expect(marks(frame(['X..T'], { X: lit, T: team }), gapBlackOutline(frame(['X..T'], { X: lit, T: team })))).toEqual(['X.oX']);
  });

  it("leaves small enclosed holes alone, where the outer outline fills them", () => {
    const ring = frame(['......', '.XXXX.', '.X..X.', '.X..X.', '.XXXX.', '......']);
    expect(marks(ring, gapBlackOutline(ring)).slice(2, 4)).toEqual(['oX..Xo', 'oX..Xo']);
    expect(marks(ring, outline(ring, 'outer')).slice(2, 4)).toEqual(['oXooXo', 'oXooXo']);
    expect(SMALL_HOLE).toBe(4);
  });

  it('outlines a bigger hole inside, except where it is narrow', () => {
    const big = frame(['.......', '.XXXXX.', '.X...X.', '.X...X.', '.X...X.', '.XXXXX.', '.......']);
    expect(gapBlackOutline(big).data).toEqual(outline(big, 'outer').data);
    const narrow = frame(['......', '.XXXX.', '.X..X.', '.X..X.', '.X..X.', '.XXXX.', '......']);
    expect(marks(narrow, gapBlackOutline(narrow)).slice(2, 5)).toEqual(['oXo.Xo', 'oXo.Xo', 'oXo.Xo']);
  });

  it('rings a thin protrusion as the outer outline does', () => {
    const spear = frame(['.......', '.X.....', '..X....', '...XXX.', '...XXX.', '.......']);
    expect(gapBlackOutline(spear).data).toEqual(outline(spear, 'outer').data);
  });

  it("is all black, only where the outer outline would go, doesn't touch the sprite and doesn't change with the light", () => {
    for (const [a, b] of relit) {
      const d = gapBlackOutline(a).data;
      const outer = outline(a, 'outer').data;
      d.forEach((v, i) => {
        if (a.data[i]) expect(v).toBe(a.data[i]);
        else if (v) {
          expect(v).toBe(OUTLINE_INDEX);
          expect(outer[i]).toBe(OUTLINE_INDEX);
        }
      });
      expect(added(a, gapBlackOutline(a))).toEqual(added(b, gapBlackOutline(b)));
    }
  });

  it("is shadeFrame's 'gapBlack' outline, dithered after", () => {
    const f = sampleFrame(randomPass(16, 4, 9), 16, 16, 4, STEP);
    const st = shadeStages(f, { ...s, outline: 'gapBlack' });
    expect(st.outlined.data).toEqual(gapBlackOutline(shadePixels(f, s)).data);
    expect(shadeFrame(f, { ...s, outline: 'gapBlack' }).data).toEqual(st.final.data);
  });
});

describe('holes', () => {
  it('are transparent regions that reach no edge of the frame, joined along rows and columns', () => {
    const f = frame(['.....', '.XX..', '.X.X.', '..XX.', '.....']);
    // the middle pixel is shut in along rows and columns, though open diagonally
    expect(Array.from(holes(f))).toEqual(Array.from(f.data, (_, i) => (i === 2 * 5 + 2 ? 1 : 0)));
    expect(Array.from(holes(frame(['X.X', 'XXX'])))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('are sized by their pixel count', () => {
    const h = holes(frame(['XXXXX', 'X..XX', 'X.XXX', 'XXX.X', 'XXXXX']));
    expect([h[6], h[7], h[11], h[18]]).toEqual([3, 3, 3, 1]);
  });
});
