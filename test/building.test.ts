import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { BUILDING_ROWS, buildingAnimations } from '../src/anim/building-anims';
import { MaterialLibrary } from '../src/render/materials';
import { applyBuildingPose, buildBuilding, disposeBuilding, type Building } from '../src/unit/building';
import { buildingLayout, DEFAULT_BUILDING, randomBuilding, ROOFS, type BuildingParams } from '../src/unit/building-params';

const mats = new MaterialLibrary();
const anims = buildingAnimations();
const anim = (name: string) => anims.find((a) => a.name === name)!;
const TIMES = [0, 0.25, 0.5, 0.75, 1];
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 3);

function posed<T>(p: BuildingParams, name: string, t: number, check: (b: Building) => T): T {
  const b = buildBuilding(p, mats);
  applyBuildingPose(b, anim(name).pose(t, p, 0));
  b.root.updateMatrixWorld(true);
  try {
    return check(b);
  } finally {
    disposeBuilding(b);
  }
}

/** Whether `o` and all its parents are shown. */
function shown(o: Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** World-space corners of what's drawn under `root`. */
function corners(root: Object3D): Vector3[] {
  const out: Vector3[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh) || !shown(o)) return;
    const box = new Box3().expandByObject(o, true);
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new Vector3(x, y, z));
  });
  return out;
}

const visibleNamed = (b: Building, name: string) => {
  const found: Object3D[] = [];
  b.root.traverse((o) => o.name === name && shown(o) && found.push(o));
  return found;
};
const litWindows = (b: Building) => b.lights.filter((l) => shown(l.pane)).length;

/** Every knob at both ends, on a few seeds. */
const EXTREMES: BuildingParams[] = SEEDS.slice(0, 8).flatMap((seed) => [
  { ...DEFAULT_BUILDING, seed, blocks: 5, floors: 4 },
  { ...DEFAULT_BUILDING, seed, blocks: 1, floors: 1, windows: 0 },
  { ...DEFAULT_BUILDING, seed, blocks: 5, floors: 4, windows: 1, roof: 'hip' },
  { ...DEFAULT_BUILDING, seed, blocks: 5, floors: 4, roof: 'gable' },
  { ...DEFAULT_BUILDING, seed, blocks: 5, floors: 4, roof: 'flat' },
]);
const ALL = [...SEEDS.map(randomBuilding), ...EXTREMES];

describe('building layout', () => {
  it('is the same for the same seed', () => {
    for (const p of ALL.slice(0, 10)) expect(buildingLayout({ ...p })).toEqual(buildingLayout(p));
  });

  it('never overlaps its blocks', () => {
    for (const p of ALL) {
      const { blocks } = buildingLayout(p);
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
          const [a, b] = [blocks[i], blocks[j]];
          const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.02 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.02;
          expect(overlap, `seed ${p.seed}, blocks ${i} and ${j}`).toBe(false);
        }
      }
    }
  });

  it('keeps the blocks in place when colours, storeys or roofs change', () => {
    const footprint = (p: BuildingParams) => buildingLayout(p).blocks.map(({ x, z, w, d }) => [x, z, w, d]);
    for (const p of ALL.slice(0, 20)) {
      const same = footprint(p);
      expect(footprint({ ...p, walls: 'wood', roofColor: 'team', light: 'fire', windows: 0.1 })).toEqual(same);
      expect(footprint({ ...p, floors: p.floors === 1 ? 3 : 1 })).toEqual(same);
      for (const roof of ROOFS) expect(footprint({ ...p, roof })).toEqual(same);
    }
  });

  it('adds blocks without moving the ones already there, but for centring', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const few = buildingLayout({ ...DEFAULT_BUILDING, seed, blocks: 2 }).blocks;
      const more = buildingLayout({ ...DEFAULT_BUILDING, seed, blocks: 4 }).blocks;
      const rel = (bs: typeof few) => bs.slice(0, few.length).map((b) => [b.x - bs[0].x, b.z - bs[0].z, b.w, b.d].map((n) => n.toFixed(6)));
      expect(rel(more)).toEqual(rel(few));
    }
  });

  it('varies with the seed', () => {
    const shapes = new Set(SEEDS.map((seed) => JSON.stringify(buildingLayout({ ...DEFAULT_BUILDING, seed }).blocks.map((b) => [b.w.toFixed(2), b.roof]))));
    expect(shapes.size).toBeGreaterThan(SEEDS.length / 2);
  });
});

describe('building model', () => {
  it('stands on the ground when finished', () => {
    for (const p of ALL) {
      posed(p, 'idle', 0, (b) => {
        const ys = corners(b.root).map((c) => c.y);
        expect(Math.min(...ys), `seed ${p.seed}`).toBeCloseTo(0, 2);
      });
    }
  });

  it('fits a 128 px frame at 14 px per unit, from any side', () => {
    // seen from 35° up, a point's height on screen is its height times cos 35°, plus its
    // distance behind the middle times sin 35°; the default anchor leaves 100 px above the
    // ground and 28 below
    const [up, down, side] = [Math.round(128 * 0.78) / 14, (128 - Math.round(128 * 0.78)) / 14, 64 / 14];
    const [c, s] = [Math.cos((35 * Math.PI) / 180), Math.sin((35 * Math.PI) / 180)];
    for (const p of ALL) {
      // built once and posed through every row, as the app does
      const b = buildBuilding(p, mats);
      for (const a of anims) {
        for (const t of TIMES) {
          applyBuildingPose(b, a.pose(t, p, 0));
          b.root.updateMatrixWorld(true);
          // the worst corner of each kind, so a failure names the pose without thousands of expects
          let [hi, lo, far, under] = [-Infinity, -Infinity, 0, Infinity];
          for (const v of corners(b.root)) {
            const r = Math.hypot(v.x, v.z);
            hi = Math.max(hi, v.y * c + r * s);
            lo = Math.max(lo, r * s - v.y * c);
            far = Math.max(far, r);
            under = Math.min(under, v.y);
          }
          const at = `seed ${p.seed} ${a.name} at ${t}`;
          expect(hi, at).toBeLessThan(up);
          expect(lo, at).toBeLessThan(down);
          expect(far, at).toBeLessThan(side);
          expect(under, at).toBeGreaterThan(-0.05);
        }
      }
      disposeBuilding(b);
    }
  });

  it('has a door on the main block, and windows', () => {
    const p = { ...DEFAULT_BUILDING, windows: 1 };
    posed(p, 'idle', 0, (b) => {
      expect(visibleNamed(b, 'door')).toHaveLength(1);
      expect(visibleNamed(b, 'window').length).toBeGreaterThan(3);
    });
  });
});

describe('building animations', () => {
  it('fills only the building rows', () => {
    expect(anims.map((a) => a.name)).toEqual(BUILDING_ROWS);
  });

  it('goes up from bare foundations to finished', () => {
    for (const p of ALL.slice(0, 10)) {
      posed(p, 'build', 0, (b) => {
        expect(visibleNamed(b, 'walls')).toHaveLength(0);
        expect(visibleNamed(b, 'roof')).toHaveLength(0);
        expect(visibleNamed(b, 'foundation').length).toBe(b.blocks.length);
        expect(litWindows(b)).toBe(0);
      });
      posed(p, 'build', 0.5, (b) => {
        expect(visibleNamed(b, 'scaffold').length).toBe(b.blocks.length);
        expect(visibleNamed(b, 'walls').length).toBeGreaterThan(0);
      });
      posed(p, 'build', 1, (b) => {
        expect(visibleNamed(b, 'scaffold')).toHaveLength(0);
        expect(visibleNamed(b, 'foundation')).toHaveLength(0);
        expect(visibleNamed(b, 'roof').length).toBe(b.blocks.length);
      });
    }
  });

  it('blinks a few lights between idle frames, keeping most of them on', () => {
    const p = { ...DEFAULT_BUILDING, blocks: 4, floors: 3, windows: 1 };
    const lit = [0, 0.25, 0.5, 0.75].map((t) => posed(p, 'idle', t, (b) => b.lights.map((l) => shown(l.pane))));
    const total = lit[0].length;
    expect(new Set(lit.map((l) => JSON.stringify(l))).size).toBeGreaterThan(1);
    for (const l of lit) expect(l.filter(Boolean).length).toBeGreaterThan(total / 2);
  });

  it('lights every window and opens the door at work', () => {
    const p = { ...DEFAULT_BUILDING, windows: 1 };
    posed(p, 'work', 0, (b) => {
      expect(litWindows(b)).toBeGreaterThan(b.lights.length * 0.8);
      expect(shown(b.door.inside)).toBe(true);
    });
    posed(p, 'idle', 0, (b) => expect(shown(b.door.inside)).toBe(false));
  });

  it('falls into rubble, dark and without smoke', () => {
    for (const p of ALL.slice(0, 10)) {
      posed(p, 'death', 1, (b) => {
        expect(litWindows(b)).toBe(0);
        expect(b.smoke.flat().some(shown)).toBe(false);
        expect(visibleNamed(b, 'rubble').length).toBe(6 * b.blocks.length);
        const top = Math.max(...corners(b.root).map((c) => c.y));
        const standing = posed(p, 'idle', 0, (s) => Math.max(...corners(s.root).map((c) => c.y)));
        expect(top).toBeLessThan(standing * 0.6);
      });
    }
  });

  it('loops seamlessly', () => {
    const p = { ...DEFAULT_BUILDING, windows: 1 };
    for (const name of ['idle', 'work']) {
      const smoke = (t: number) => posed(p, name, t, (b) => b.smoke.flat().map((m) => [m.position.y, m.scale.x].map((n) => n.toFixed(4))));
      // the frame after the last is the first again
      expect(smoke(1)).toEqual(smoke(0));
    }
  });
});
