import { Box3, Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { buildEffects, EFFECT_NAMES, FADED } from '../src/effects/effects';
import { MaterialLibrary } from '../src/render/materials';

const mats = new MaterialLibrary();
const fx = buildEffects(mats, 'venom');
const def = (name: string) => fx.defs.find((d) => d.name === name)!;
const group = (name: string) => fx.root.getObjectByName(name)!;

function ramps(o: Object3D): Set<string> {
  const out = new Set<string>();
  o.traverse((m) => m instanceof Mesh && out.add(m.material.name));
  return out;
}

/** Where an effect's pieces are, as a sorted set: what the frame looks like, whichever mesh is where. */
function pieces(o: Object3D): string[] {
  const out: string[] = [];
  o.updateMatrixWorld(true);
  o.traverse((m) => {
    if (!(m instanceof Mesh)) return;
    const box = new Box3().setFromObject(m);
    out.push([...box.min.toArray(), ...box.max.toArray()].map((v) => v.toFixed(3)).join(','));
  });
  return out.sort();
}

describe('effects', () => {
  it('has the five effects in a fixed order, timed for play', () => {
    expect(fx.defs.map((d) => d.name)).toEqual([...EFFECT_NAMES]);
    expect(fx.defs.map((d) => [d.frames, d.loop])).toEqual([
      [1, true],
      [4, true],
      [4, true],
      [5, false],
      [5, false],
    ]);
  });

  it('shows only the effect being posed', () => {
    for (const d of fx.defs) {
      d.apply(0.5);
      expect(fx.root.children.filter((c) => c.visible).map((c) => c.name)).toEqual([d.name]);
    }
  });

  it('colours spells in the magic ramp, the fletching in the team ramp, dust grey', () => {
    expect(ramps(group('arrow'))).toEqual(new Set(['wood', 'steel', 'team']));
    for (const name of ['bolt', 'fireball', 'impact']) expect(ramps(group(name))).toEqual(new Set(['venom']));
    expect(ramps(group('puff'))).toEqual(new Set(['fur']));
  });

  it('points the arrow along +Z, head first', () => {
    def('arrow').apply(0);
    group('arrow').updateMatrixWorld(true);
    const box = new Box3().setFromObject(group('arrow'));
    const size = box.getSize(box.min.clone());
    expect(size.z).toBeGreaterThan(3 * Math.max(size.x, size.y));
    const head = group('arrow').children.find((c) => c instanceof Mesh && c.material.name === 'steel')!;
    expect(head.position.z).toBeGreaterThan(0.3);
  });

  it('closes its loops', () => {
    for (const name of ['bolt', 'fireball']) {
      def(name).apply(0);
      const a = pieces(group(name));
      def(name).apply(1);
      expect(pieces(group(name))).toEqual(a);
    }
  });

  it('fades one-shots out without ending on an empty frame', () => {
    for (const name of ['impact', 'puff']) {
      expect(def(name).apply(0)).toBe(1);
      expect(def(name).apply(1)).toBeCloseTo(FADED);
      expect(FADED).toBeGreaterThan(0);
    }
    for (const name of ['arrow', 'bolt', 'fireball']) expect(def(name).apply(0.5)).toBe(1);
  });

  it('flings impact sparks outward', () => {
    const spread = (t: number) => {
      def('impact').apply(t);
      const box = new Box3().setFromObject(group('impact'));
      return box.getSize(box.min.clone()).x;
    };
    expect(spread(0.6)).toBeGreaterThan(spread(0) * 2);
  });
});
