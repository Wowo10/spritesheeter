import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { vehicleAnimations, WALK_WHEEL_TURN } from '../src/anim/vehicle-anims';
import { MaterialLibrary } from '../src/render/materials';
import { applyVehiclePose, buildVehicle, disposeVehicle, type Vehicle } from '../src/unit/vehicle';
import { randomVehicle, VEHICLE_PRESETS, WEAPONS, type VehicleParams } from '../src/unit/vehicle-params';

const mats = new MaterialLibrary();
const anims = vehicleAnimations();
const anim = (name: string) => anims.find((a) => a.name === name)!;
const TIMES = [0, 0.25, 0.5, 0.75, 1];

function posed<T>(p: VehicleParams, name: string, t: number, check: (v: Vehicle) => T): T {
  const v = buildVehicle(p, mats);
  applyVehiclePose(v, anim(name).pose(t, p, 0));
  v.root.updateMatrixWorld(true);
  try {
    return check(v);
  } finally {
    disposeVehicle(v);
  }
}

/** World-space bounds of what's drawn under `root`. */
function bounds(root: Object3D): Box3 {
  const box = new Box3();
  const visit = (o: Object3D) => {
    if (!o.visible) return;
    if (o instanceof Mesh) box.expandByObject(o, true);
    o.children.forEach(visit);
  };
  visit(root);
  return box;
}

const named = (v: Vehicle, name: string) => v.root.getObjectByName(name)!;
const worldPos = (o: Object3D) => o.getWorldPosition(new Vector3());

describe('vehicle presets', () => {
  for (const [name, p] of Object.entries(VEHICLE_PRESETS)) {
    it(`${name} stands on its wheels`, () => {
      posed(p, 'idle', 0, (v) => {
        // within a centimetre: the wheels are polygons
        expect(Math.abs(bounds(v.root).min.y)).toBeLessThan(0.01);
        for (const w of v.wheels) expect(Math.abs(bounds(w).min.y)).toBeLessThan(0.01);
      });
    });

    it(`${name} fits a 64 px frame`, () => {
      // at 14 px per unit, with the default ground anchor; diagonal views are the widest
      for (const a of anims) {
        for (const t of TIMES) {
          posed(p, a.name, t, (v) => {
            const box = bounds(v.root);
            expect(box.max.y, `${a.name} at ${t}`).toBeLessThan(Math.round(64 * 0.78) / 14);
            expect(box.min.y, `${a.name} at ${t}`).toBeGreaterThan(-0.05);
            const reach = Math.max(...[box.min.x, box.max.x, box.min.z, box.max.z].map(Math.abs));
            expect(reach, `${a.name} at ${t}`).toBeLessThan(64 / 14 / 2);
          });
        }
      }
    });

    it(`${name} poses are finite`, () => {
      for (const a of anims) {
        for (const t of TIMES) {
          const pose = a.pose(t, p, 0);
          for (const v of [pose.wheels, pose.stroke, ...(pose.rock ?? []), pose.flag ?? 0, pose.winch ?? 0]) expect(Number.isFinite(v)).toBe(true);
        }
      }
    });

    it(`${name} attack starts and ends at rest, loaded`, () => {
      for (const t of [0, 1]) {
        const pose = anim('attack').pose(t, p, 0);
        expect(pose.stroke).toBeCloseTo(0);
        expect(pose.loaded).toBe(true);
      }
    });

    it(`${name} breaks down onto the ground`, () => {
      posed(p, 'death', 1, (v) => {
        // the right-hand wheels lie flat on the ground, the frame's right side down on them
        for (const w of v.wheels.filter((w) => w.userData.side < 0)) expect(bounds(w).max.y).toBeLessThan(0.15);
        expect(bounds(v.frame).min.y).toBeGreaterThan(-0.05);
        expect(bounds(v.frame).min.y).toBeLessThan(0.1);
      });
    });
  }

  it('wheels loop seamlessly: a walk turns them a whole number of spoke spacings', () => {
    const p = VEHICLE_PRESETS.catapult;
    expect(anim('walk').pose(1, p, 0).wheels % WALK_WHEEL_TURN).toBe(0);
    expect(anim('run').pose(1, p, 0).wheels % WALK_WHEEL_TURN).toBe(0);
  });

  it('the catapult throws: the arm swings up to the crossbar and the stone is gone', () => {
    const p = VEHICLE_PRESETS.catapult;
    const tip = (t: number) => posed(p, 'attack', t, (v) => worldPos(named(v, 'load')));
    const [cocked, fired] = [tip(0), tip(0.4)];
    expect(fired.y).toBeGreaterThan(cocked.y + 0.4);
    expect(fired.z).toBeGreaterThan(cocked.z + 0.5);
    expect(anim('attack').pose(0.4, p, 0).loaded).toBe(false);
  });

  it("the ballista's string runs straight across once loosed", () => {
    const p = VEHICLE_PRESETS.ballista;
    posed(p, 'attack', 0.36, (v) => {
      const [l, r] = [named(v, 'stringL'), named(v, 'stringR')].map((s) => s.rotation.y);
      expect(Math.abs(l)).toBeCloseTo(Math.PI / 2, 1);
      expect(Math.abs(r)).toBeCloseTo(Math.PI / 2, 1);
    });
    posed(p, 'idle', 0, (v) => expect(Math.abs(named(v, 'stringL').rotation.y)).toBeLessThan(1.2));
  });

  it('the ram swings forward to strike', () => {
    const p = VEHICLE_PRESETS.ram;
    const head = (t: number) => posed(p, 'attack', t, (v) => bounds(named(v, 'ram')).max.z);
    expect(head(0.6)).toBeGreaterThan(head(0) + 0.1);
    expect(head(0.4)).toBeLessThan(head(0) - 0.1);
  });

  it('the flamethrower breathes fire only when it fires', () => {
    const p = VEHICLE_PRESETS.flamethrower;
    const reach = (name: string, t: number) => posed(p, name, t, (v) => bounds(v.root).max.z);
    expect(reach('attack', 0.5)).toBeGreaterThan(reach('idle', 0) + 0.6);
    expect(reach('channel', 0)).toBeGreaterThan(reach('idle', 0) + 0.6);
  });

  it('random vehicles are repeatable, with every weapon', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      expect(randomVehicle(seed)).toEqual(randomVehicle(seed));
      seen.add(randomVehicle(seed).weapon);
    }
    expect([...seen].sort()).toEqual([...WEAPONS].sort());
  });
});
