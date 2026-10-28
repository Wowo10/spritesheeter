import { Box3, Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { MaterialLibrary } from '../src/render/materials';
import { buildHumanoid, disposeHumanoid } from '../src/unit/humanoid';
import { HAIR_STYLES, HAND_ITEMS, handItems, HELMETS, PRESETS, type Hand, type HandItem, type UnitParams } from '../src/unit/params';

const mats = new MaterialLibrary();

function meshesIn(o: Object3D): number {
  let n = 0;
  o.traverse((c) => {
    if (c instanceof Mesh) n++;
  });
  return n;
}

describe('every hand item', () => {
  const emptyHand = (() => {
    const u = buildHumanoid({ ...PRESETS.worker, rightHand: 'none', leftHand: 'none' }, mats);
    const n = meshesIn(u.joints.handR);
    disposeHumanoid(u);
    return n;
  })();

  for (const hand of ['R', 'L'] as Hand[]) {
    for (const item of HAND_ITEMS.filter((i) => i !== 'none')) {
      it(`${item} builds in the ${hand} hand`, () => {
        const p = {
          ...PRESETS.worker,
          rightHand: (hand === 'R' ? item : 'none') as HandItem,
          leftHand: (hand === 'L' ? item : 'none') as HandItem,
        };
        expect(handItems(p)[hand]).toBe(item);
        const u = buildHumanoid(p, mats);
        expect(meshesIn(u.joints[`hand${hand}`])).toBeGreaterThan(emptyHand);
        disposeHumanoid(u);
      });
    }
  }
});

describe('cape', () => {
  it('adds cloth to the cape joints only when worn', () => {
    const without = buildHumanoid({ ...PRESETS.knight, cape: 'none' }, mats);
    expect(meshesIn(without.joints.cape)).toBe(0);
    disposeHumanoid(without);
    for (const cape of ['long', 'broad'] as const) {
      const u = buildHumanoid({ ...PRESETS.knight, cape }, mats);
      expect(meshesIn(u.joints.capeTip)).toBeGreaterThan(0);
      expect(meshesIn(u.joints.cape)).toBeGreaterThan(meshesIn(u.joints.capeTip));
      disposeHumanoid(u);
    }
  });

  it('broad is wider than long', () => {
    const width = (cape: 'long' | 'broad') => {
      const u = buildHumanoid({ ...PRESETS.knight, cape }, mats);
      u.root.updateMatrixWorld(true);
      const box = new Box3().setFromObject(u.joints.capeTip);
      disposeHumanoid(u);
      return box.max.x - box.min.x;
    };
    expect(width('broad')).toBeGreaterThan(width('long') * 1.3);
  });
});

describe('hair styles', () => {
  const headMeshes = (p: UnitParams) => {
    const u = buildHumanoid(p, mats);
    const n = meshesIn(u.joints.head);
    disposeHumanoid(u);
    return n;
  };

  for (const hairStyle of HAIR_STYLES) {
    it(`${hairStyle} builds bare-headed and under every helmet`, () => {
      for (const helmet of HELMETS) expect(() => headMeshes({ ...PRESETS.worker, helmet, hairStyle })).not.toThrow();
    });
  }

  it('bald adds nothing; full helms and hoods hide every style', () => {
    const bald = headMeshes({ ...PRESETS.worker, helmet: 'none', hairStyle: 'bald' });
    for (const hairStyle of HAIR_STYLES.filter((h) => h !== 'bald')) {
      expect(headMeshes({ ...PRESETS.worker, helmet: 'none', hairStyle })).toBeGreaterThan(bald);
      for (const helmet of ['full', 'hood'] as const) {
        expect(headMeshes({ ...PRESETS.worker, helmet, hairStyle })).toBe(headMeshes({ ...PRESETS.worker, helmet, hairStyle: 'bald' }));
      }
    }
  });
});
