import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME_COUNTS } from '../src/anim/humanoid-anims';
import { MaterialLibrary } from '../src/render/materials';
import { KIND_DEFS, kindDef, KINDS, projectileOf, type AnyParams, type Kind, type Subject } from '../src/subjects';
import { BEAST_PRESETS } from '../src/unit/beast-params';
import { PRESETS } from '../src/unit/params';

const mats = new MaterialLibrary();

/** Builds a random unit of `kind` in a scene, hands it to `check`, then disposes of it. */
function built<T>(kind: Kind, params: AnyParams | undefined, check: (s: Subject, scene: Scene) => T): T {
  const scene = new Scene();
  const s = kindDef(kind).build(params ?? kindDef(kind).random(7), mats);
  scene.add(s.root);
  try {
    return check(s, scene);
  } finally {
    s.dispose();
  }
}

describe('subjects', () => {
  it.each(KINDS)('%s: builds, poses every row and takes itself out of the scene', (kind) => {
    const scene = built(kind, undefined, (s, scene) => {
      const { rows } = s.rows(DEFAULT_FRAME_COUNTS);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        for (const t of [0, 0.5, 1]) {
          const opacity = r.apply(t) ?? 1;
          expect(opacity).toBeGreaterThanOrEqual(0);
          expect(opacity).toBeLessThanOrEqual(1);
        }
      }
      return scene;
    });
    expect(scene.children).toHaveLength(0);
  });

  it.each(KINDS)('%s: a preset keeps the seed, and a seed makes the same unit again', (kind) => {
    const def = kindDef(kind);
    expect(def.random(42)).toEqual(def.random(42));
    for (const name of Object.keys(def.presets)) expect(def.preset(name, 99).seed).toBe(99);
  });

  it('solid units rot; ghosts and see-through units fade away instead', () => {
    const rots = (kind: Kind, params: AnyParams) =>
      built(kind, params, (s) => s.rows(DEFAULT_FRAME_COUNTS).rot !== null);
    expect(rots('humanoid', { ...PRESETS.swordsman })).toBe(true);
    expect(rots('humanoid', { ...PRESETS.ghost })).toBe(false);
    expect(rots('humanoid', { ...PRESETS.swordsman, opacity: 0.5 })).toBe(false);
    expect(rots('beast', { ...BEAST_PRESETS.wolf })).toBe(true);
    expect(rots('beast', { ...BEAST_PRESETS.ghostWolf })).toBe(false);
    expect(rots('vehicle', KIND_DEFS.vehicle.random(1))).toBe(true);
    expect(rots('building', KIND_DEFS.building.random(1))).toBe(true);
  });

  it("frames a rider's portrait on its head, without the mount; vehicles and buildings whole", () => {
    built('mounted', undefined, (s) => {
      expect(s.portraitHead).not.toBeNull();
      expect(s.portraitHide).toHaveLength(1);
      expect(s.root.getObjectById(s.portraitHide[0].id)).toBeDefined();
    });
    for (const kind of ['vehicle', 'building'] as const) built(kind, undefined, (s) => expect(s.portraitHead).toBeNull());
  });

  it('every kind but buildings goes into the playground', () => {
    for (const kind of KINDS) built(kind, undefined, (s) => expect(s.playground() === null).toBe(kind === 'building'));
  });

  it('big units ask for big frames', () => {
    expect(KIND_DEFS.humanoid.minFrameSize).toBeLessThan(KIND_DEFS.mounted.minFrameSize);
    expect(KIND_DEFS.mounted.minFrameSize).toBeLessThan(KIND_DEFS.building.minFrameSize);
  });

  it('shoots what the hands hold', () => {
    expect(projectileOf({ ...PRESETS.archer })).toBe('arrow');
    expect(projectileOf({ ...PRESETS.musketeer })).toBe('bullet');
    expect(projectileOf({ ...PRESETS.swordsman })).toBeNull();
  });
});
