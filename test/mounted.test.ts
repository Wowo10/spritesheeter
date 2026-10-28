import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { humanoidAnimations } from '../src/anim/humanoid-anims';
import { mountedAnimations } from '../src/anim/mounted-anims';
import { BEAST_JOINTS, JOINTS } from '../src/anim/types';
import { MaterialLibrary } from '../src/render/materials';
import { BEAST_PRESETS, beastDims } from '../src/unit/beast-params';
import { applyPose, buildHumanoid, disposeHumanoid } from '../src/unit/humanoid';
import { applyMountedPose, buildMounted, copyMounted, disposeMounted, MOUNTED_PRESETS, randomMounted, riderParams, type Mounted, type MountedParams } from '../src/unit/mounted';
import { PRESETS } from '../src/unit/params';

const mats = new MaterialLibrary();
const anims = mountedAnimations();
const anim = (name: string) => anims.find((a) => a.name === name)!;
const TIMES = [0, 0.25, 0.5, 0.75, 1];

/** Builds the unit, poses it, and hands it to `check` before disposing of it. */
function posed<T>(p: MountedParams, name: string, t: number, check: (m: Mounted) => T): T {
  const m = buildMounted(p, mats);
  applyMountedPose(m, anim(name).pose(t, p, 0));
  m.root.updateMatrixWorld(true);
  try {
    return check(m);
  } finally {
    disposeMounted(m);
  }
}

/** World-space bounds of what's drawn under `root`, shadow aside. */
function bounds(root: Object3D): Box3 {
  const box = new Box3();
  const visit = (o: Object3D) => {
    if (!o.visible || o.name === 'shadow') return;
    if (o instanceof Mesh) box.expandByObject(o);
    o.children.forEach(visit);
  };
  visit(root);
  return box;
}

const worldPos = (o: Object3D) => o.getWorldPosition(new Vector3());

const humanoidDeath = humanoidAnimations().find((a) => a.name === 'death')!;

/** Lowest point of the rider dying on foot at t. */
function standingDeathFloor(p: MountedParams, t: number): number {
  const rider = riderParams(p);
  const h = buildHumanoid(rider, mats);
  applyPose(h, humanoidDeath.pose(t, rider, h.hipHeight));
  h.root.updateMatrixWorld(true);
  const y = bounds(h.root).min.y;
  disposeHumanoid(h);
  return Math.min(0, y);
}

const CASES: [string, MountedParams][] = [
  ...Object.entries(MOUNTED_PRESETS),
  ...['wolf', 'bear', 'horse', 'lizard', 'crocodile', 'griffin'].map(
    (mount): [string, MountedParams] => [`knight on ${mount}`, { seed: 1, rider: PRESETS.knight, mount: BEAST_PRESETS[mount] }],
  ),
];

describe('mounted units', () => {
  for (const [name, p] of CASES) {
    it(`${name}: the rider sits on the saddle`, () => {
      posed(p, 'idle', 0, (m) => {
        const hips = worldPos(m.rider.joints.hips);
        const seat = worldPos(m.beast.saddle);
        expect(Math.hypot(hips.x - seat.x, hips.z - seat.z)).toBeLessThan(0.03);
        expect(hips.y - seat.y).toBeGreaterThan(0);
        expect(hips.y - seat.y).toBeLessThan(0.1);
      });
    });

    it(`${name}: the rider's knees and feet clear the mount's flank`, () => {
      posed(p, 'idle', 0, (m) => {
        const flank = beastDims(p.mount).width * 0.5;
        for (const j of ['kneeL', 'kneeR'] as const) {
          expect(Math.abs(worldPos(m.rider.joints[j]).x)).toBeGreaterThan(flank);
        }
        // the shins hang down the side rather than sticking out
        const knee = worldPos(m.rider.joints.kneeL);
        const foot = bounds(m.rider.joints.kneeL);
        expect(foot.min.y).toBeLessThan(knee.y - 0.2);
      });
    });

    it(`${name}: poses are finite and nothing sinks into the ground`, () => {
      for (const a of anims) {
        for (const t of TIMES) {
          const pose = a.pose(t, p, 0);
          for (const j of BEAST_JOINTS) for (const v of pose.mount.joints[j] ?? []) expect(Number.isFinite(v)).toBe(true);
          for (const j of JOINTS) for (const v of pose.rider.joints[j] ?? []) expect(Number.isFinite(v)).toBe(true);
          // a thrown rider falls the way a humanoid on foot does, cape and all, but from a low
          // mount it starts the fall nearer the ground
          const floor = a.name === 'death' ? standingDeathFloor(p, t) - 0.15 : -0.05;
          posed(p, a.name, t, (m) => expect(bounds(m.rider.root).min.y, `${a.name} at ${t}`).toBeGreaterThan(floor));
        }
      }
    });

    it(`${name}: a dead rider lies on the ground beside the mount`, () => {
      posed(p, 'death', 1, (m) => {
        const mount = bounds(m.beast.root);
        const hips = worldPos(m.rider.joints.hips);
        expect(hips.y).toBeLessThan(0.3);
        // clear of the body, if not of a sprawled leg or the tail
        expect(hips.x < mount.min.x + 0.2 || hips.x > mount.max.x - 0.2).toBe(true);
      });
    });
  }

  for (const [name, p] of Object.entries(MOUNTED_PRESETS)) {
    it(`${name}: the rider's head stays inside a 64 px frame`, () => {
      // the frame's top at the default 14 px per unit and ground anchor
      const top = Math.round(64 * 0.78) / 14;
      for (const a of anims) {
        for (const t of TIMES) {
          posed(p, a.name, t, (m) => expect(bounds(m.rider.joints.head).max.y, `${a.name} at ${t}`).toBeLessThan(top));
        }
      }
    });
  }

  it('the rider follows a rearing mount, leaning into it', () => {
    const p = MOUNTED_PRESETS.knight;
    const [restHead, rearHead] = [0, 0.5].map((t) => posed(p, 'taunt', t, (m) => worldPos(m.rider.joints.head)));
    const rearSeat = posed(p, 'taunt', 0.5, (m) => worldPos(m.beast.saddle));
    expect(rearHead.y).toBeGreaterThan(restHead.y);
    // still above the seat, not tipped over backward
    expect(rearHead.z).toBeGreaterThan(rearSeat.z - 0.3);
  });

  it('presets are copied, not shared', () => {
    const p = copyMounted(MOUNTED_PRESETS.knight);
    p.rider.height = 2;
    p.mount.size = 2;
    expect(MOUNTED_PRESETS.knight.rider.height).not.toBe(2);
    expect(MOUNTED_PRESETS.knight.mount.size).not.toBe(2);
  });

  it('random mounted units are repeatable and ridable', () => {
    for (let seed = 1; seed < 40; seed++) {
      const p = randomMounted(seed);
      expect(randomMounted(seed)).toEqual(p);
      expect(p.mount.sprawl).toBe(0);
      expect(p.mount.size).toBeGreaterThanOrEqual(1.3);
      expect(['saddle', 'armor']).toContain(p.mount.barding);
      expect(['spikes', 'ridge']).not.toContain(p.mount.back);
    }
  });
});
