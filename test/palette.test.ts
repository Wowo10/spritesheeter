import { describe, expect, it } from 'vitest';
import { ID_STEP } from '../src/render/materials';
import { sampleFrame } from '../src/render/postprocess';
import { HIDE_RAMPS, METAL_RAMPS, PALETTE, RAMP_CHOICES, RAMP_LABELS, RAMP_NAMES, RANDOM_METAL_RAMPS, SKIN_CHOICES, SKIN_RAMPS, UNDEAD_SKIN_RAMPS } from '../src/render/palette';

describe('palette', () => {
  it('fits an 8-bit indexed image and the 8-bit ramp ids', () => {
    expect(PALETTE.length).toBeLessThanOrEqual(256);
    expect(RAMP_NAMES.length * ID_STEP).toBeLessThanOrEqual(255 - ID_STEP / 2);
  });

  it('reads every ramp back from its id, the last ones too', () => {
    for (const r of [0, RAMP_NAMES.indexOf('rust'), RAMP_NAMES.length - 1]) {
      const buf = new Uint8Array([(r + 1) * ID_STEP, 200, 0, 255]);
      expect(sampleFrame(buf, 1, 1, 1, ID_STEP).ramp[0]).toBe(r);
    }
  });

  it('keeps the old ramps at their palette indices', () => {
    // exported sheets index the palette: new ramps only ever go last
    expect(RAMP_NAMES.slice(0, 5)).toEqual(['team', 'skin', 'greenSkin', 'paleSkin', 'steel']);
    expect(RAMP_NAMES.indexOf('nightSkin')).toBe(27);
  });

  it('labels every ramp, each with its own name', () => {
    const labels = RAMP_NAMES.map((r) => RAMP_LABELS[r]);
    expect(labels.every((l) => typeof l === 'string' && l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(RAMP_NAMES.length);
    // a skin tone isn't just "skin"
    expect(RAMP_LABELS.skin).not.toBe('skin');
  });

  it('lists every ramp exactly once where any ramp can be picked', () => {
    expect([...RAMP_CHOICES].sort()).toEqual([...RAMP_NAMES].sort());
  });

  it('offers every skin, living and undead', () => {
    expect([...SKIN_CHOICES].sort()).toEqual([...SKIN_RAMPS, ...UNDEAD_SKIN_RAMPS].sort());
  });

  it('offers more metals, rust among them, but draws random units from the first ones', () => {
    expect(METAL_RAMPS).toContain('rust');
    expect(RANDOM_METAL_RAMPS).toEqual(['steel', 'gold', 'bronze']);
    expect(RANDOM_METAL_RAMPS.every((r) => METAL_RAMPS.includes(r))).toBe(true);
    expect(HIDE_RAMPS.every((r) => RAMP_NAMES.includes(r))).toBe(true);
  });
});
