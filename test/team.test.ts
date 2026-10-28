import { describe, expect, it } from 'vitest';
import { PALETTE, rampIndex, TEAM_COLOR_NAMES, TEAM_INDICES, teamPalette, teamRgb } from '../src/render/palette';

describe('team colours', () => {
  it('target the reserved team ramp', () => {
    const base = 1 + rampIndex('team') * 4;
    expect(TEAM_INDICES).toEqual([base, base + 1, base + 2, base + 3]);
  });

  it('red is the palette as rendered', () => {
    expect(teamPalette('red')).toEqual(PALETTE);
  });

  it('swap only the four team entries', () => {
    for (const team of TEAM_COLOR_NAMES) {
      const pal = teamPalette(team);
      pal.forEach((rgb, i) => {
        if (TEAM_INDICES.includes(i)) expect(rgb).toEqual(teamRgb(team)[TEAM_INDICES.indexOf(i)]);
        else expect(rgb).toEqual(PALETTE[i]);
      });
    }
  });

  it('keep every team distinct', () => {
    const keys = TEAM_COLOR_NAMES.map((t) => JSON.stringify(teamRgb(t)));
    expect(new Set(keys).size).toBe(TEAM_COLOR_NAMES.length);
  });
});
