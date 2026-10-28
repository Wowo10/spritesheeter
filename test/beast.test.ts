import { Box3, Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { beastAnimations } from '../src/anim/beast-anims';
import { BEAST_JOINTS } from '../src/anim/types';
import { MaterialLibrary } from '../src/render/materials';
import { applyBeastPose, buildBeast, disposeBeast } from '../src/unit/beast';
import { BEAST_PRESETS, beastDims, randomBeast, type BeastParams } from '../src/unit/beast-params';

const mats = new MaterialLibrary();
const anims = beastAnimations();
const anim = (name: string) => anims.find((a) => a.name === name)!;

/** World-space bounds of what's drawn of a beast in the given pose (the spell may be hidden), shadow aside. */
function bounds(p: BeastParams, name: string, t: number): Box3 {
  const b = buildBeast(p, mats);
  applyBeastPose(b, anim(name).pose(t, p, b.hipHeight));
  b.root.updateMatrixWorld(true);
  const box = new Box3();
  const visit = (o: Object3D) => {
    if (!o.visible || o.name === 'shadow') return;
    if (o instanceof Mesh) box.expandByObject(o);
    o.children.forEach(visit);
  };
  visit(b.root);
  disposeBeast(b);
  return box;
}

describe('beast presets', () => {
  for (const [name, p] of Object.entries(BEAST_PRESETS)) {
    it(`${name} ${p.flying ? 'hovers off' : 'stands on'} the ground`, () => {
      // within a couple of centimetres: the paws, not the belly or tail, touch down
      if (p.flying) expect(bounds(p, 'idle', 0).min.y).toBeGreaterThan(0.15);
      else expect(bounds(p, 'idle', 0).min.y).toBeCloseTo(0, 1);
    });

    it(`${name} fits a 32 px frame side-on`, () => {
      // 32 px at 14 px per unit
      const box = bounds(p, 'idle', 0);
      expect(box.max.z - box.min.z).toBeLessThan(32 / 14);
    });

    it(`${name} poses are finite in every animation`, () => {
      for (const a of anims) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const pose = a.pose(t, p, beastDims(p).hipHeight);
          for (const j of BEAST_JOINTS) for (const v of pose.joints[j] ?? []) expect(Number.isFinite(v)).toBe(true);
          for (const v of pose.offset ?? []) expect(Number.isFinite(v)).toBe(true);
        }
      }
    });
  }
});

describe('beast animations', () => {
  it('lie on the ground at the end of death, reptiles on their backs', () => {
    for (const p of Object.values(BEAST_PRESETS)) {
      const box = bounds(p, 'death', 1);
      expect(box.min.y).toBeGreaterThan(-0.03);
      expect(box.min.y).toBeLessThan(0.03);
    }
    expect(anim('death').pose(1, BEAST_PRESETS.wolf, 0.5).joints.pelvis![2]).toBeCloseTo(88);
    expect(anim('death').pose(1, BEAST_PRESETS.crocodile, 0.2).joints.pelvis![2]).toBeGreaterThan(170);
  });

  it('only beasts with a breath attack show the spell', () => {
    for (const name of ['cast', 'channel']) {
      expect(anim(name).pose(0.6, BEAST_PRESETS.hellhound, 0.5).fx!.scale).toBeGreaterThan(0.5);
      expect(anim(name).pose(0.6, BEAST_PRESETS.wolf, 0.5).fx).toBeUndefined();
    }
  });

  it('opens the jaws to bite', () => {
    const jaw = (t: number) => anim('attack').pose(t, BEAST_PRESETS.wolf, 0.5).joints.jaw![0];
    expect(jaw(0.55)).toBeLessThan(-30);
    expect(jaw(0.7)).toBeGreaterThan(-5);
  });

  it('see-through beasts fade away as they die', () => {
    const ghost = BEAST_PRESETS.ghostWolf;
    expect(anim('death').pose(0, ghost, 0.5).opacity).toBe(ghost.opacity);
    expect(anim('death').pose(1, ghost, 0.5).opacity).toBe(0);
    expect(anim('death').pose(1, BEAST_PRESETS.wolf, 0.5).opacity).toBe(1);
  });

  it('keeps sprawled lower legs upright', () => {
    const croc = BEAST_PRESETS.crocodile;
    const j = anim('idle').pose(0, croc, 0.2).joints;
    expect(j.legFL![2]).toBeCloseTo(beastDims(croc).splay);
    expect(j.kneeFL![2]).toBeCloseTo(-j.legFL![2]);
  });
});

describe('wings', () => {
  const griffin = BEAST_PRESETS.griffin;
  const grounded = { ...griffin, flying: false };

  it('fold on the ground and spread in flight', () => {
    const idle = anim('idle');
    expect(idle.pose(0, grounded, 0.5).joints.wingL![0]).toBeGreaterThan(60);
    for (const t of [0, 0.25, 0.5, 0.75]) expect(idle.pose(t, griffin, 0.5).joints.wingL![0]).toBe(0);
  });

  it('flap through every loop of a flyer', () => {
    const rolls = [0, 0.25, 0.5, 0.75].map((t) => anim('walk').pose(t, griffin, 0.5).joints.wingL![2]);
    expect(Math.max(...rolls) - Math.min(...rolls)).toBeGreaterThan(40);
  });

  it('a flyer falls out of the sky when it dies', () => {
    const death = anim('death');
    expect(death.pose(0, griffin, 0.5).offset![1]).toBeGreaterThan(death.pose(0, grounded, 0.5).offset![1] + 0.3);
    expect(death.pose(1, griffin, 0.5).offset).toEqual(death.pose(1, grounded, 0.5).offset);
  });

  it('build only when asked for', () => {
    const count = (p: BeastParams) => {
      const b = buildBeast(p, mats);
      let n = 0;
      b.joints.wingL.traverse((o) => o instanceof Mesh && n++);
      disposeBeast(b);
      return n;
    };
    expect(count(BEAST_PRESETS.wolf)).toBe(0);
    for (const wings of ['bat', 'feathered'] as const) expect(count({ ...BEAST_PRESETS.wolf, wings })).toBeGreaterThan(2);
  });

  it('flying needs wings', () => {
    const wolf = { ...BEAST_PRESETS.wolf, flying: true };
    expect(anim('idle').pose(0, wolf, 0.5)).toEqual(anim('idle').pose(0, BEAST_PRESETS.wolf, 0.5));
  });
});

describe('randomBeast', () => {
  it('is repeatable per seed and builds', () => {
    expect(randomBeast(42)).toEqual(randomBeast(42));
    for (let seed = 0; seed < 20; seed++) {
      const b = buildBeast(randomBeast(seed), mats);
      expect(b.root.children.length).toBeGreaterThan(0);
      disposeBeast(b);
    }
  });
});
