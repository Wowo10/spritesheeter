import { Mesh, type Material, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { buildingAnimations } from '../src/anim/building-anims';
import { humanoidAnimations } from '../src/anim/humanoid-anims';
import { applyDecay, clearDecay } from '../src/render/decay';
import { MaterialLibrary } from '../src/render/materials';
import { applyBeastPose, beastDecay, buildBeast } from '../src/unit/beast';
import { BEAST_PRESETS } from '../src/unit/beast-params';
import { applyBuildingPose, buildBuilding, buildingDecay } from '../src/unit/building';
import { DEFAULT_BUILDING } from '../src/unit/building-params';
import { applyPose, buildHumanoid, humanoidDecay } from '../src/unit/humanoid';
import { PRESETS, type UnitParams } from '../src/unit/params';
import { buildVehicle, vehicleDecay } from '../src/unit/vehicle';
import { VEHICLE_PRESETS } from '../src/unit/vehicle-params';

const mats = new MaterialLibrary();

const meshes = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
};
const rampOf = (m: Mesh) => (m.material as Material).name;
const snapshot = (root: Object3D) => meshes(root).map((m) => ({ material: m.material, scale: m.scale.toArray(), visible: m.visible }));
const body = (root: Object3D) => meshes(root).filter((m) => m.userData.body);

/** A humanoid lying as its death row ends. */
function corpse(p: UnitParams) {
  const u = buildHumanoid(p, mats);
  applyPose(u, humanoidAnimations().find((a) => a.name === 'death')!.pose(1, p, u.hipHeight));
  return u;
}

describe('decay', () => {
  it('leaves the corpse as it fell at 0, and clearDecay puts back everything it rotted', () => {
    const u = corpse(PRESETS.knight);
    const before = snapshot(u.root);
    applyDecay(u.root, 0, mats, humanoidDecay(PRESETS.knight));
    expect(snapshot(u.root)).toEqual(before);
    applyDecay(u.root, 1, mats, humanoidDecay(PRESETS.knight));
    expect(snapshot(u.root)).not.toEqual(before);
    clearDecay(u.root);
    expect(snapshot(u.root)).toEqual(before);
  });

  it('rots a humanoid to thinned bones, its clothes gone', () => {
    const p: UnitParams = { ...PRESETS.swordsman, armor: 'none', cape: 'long' };
    const u = corpse(p);
    const upperArm = body(u.root).find((m) => m.parent === u.joints.shoulderL)!;
    const width = upperArm.scale.x;
    applyDecay(u.root, 1, mats, humanoidDecay(p));
    expect(body(u.root).every((m) => rampOf(m) === 'bone')).toBe(true);
    expect(upperArm.scale.x).toBeCloseTo(width * 0.5);
    expect(upperArm.scale.y).toBe(1);
    const cape = meshes(u.joints.cape).filter((m) => rampOf(m) !== 'bone');
    expect(cape.length).toBeGreaterThan(0);
    expect(cape.every((m) => !m.visible)).toBe(true);
  });

  it('rots part by part: halfway, some of the body is bone and some still flesh', () => {
    const u = corpse(PRESETS.swordsman);
    applyDecay(u.root, 0.6, mats, humanoidDecay(PRESETS.swordsman));
    const ramps = new Set(body(u.root).map(rampOf));
    expect(ramps.has('bone')).toBe(true);
    expect(ramps.size).toBeGreaterThan(1);
  });

  it('leaves plate armour on the bones', () => {
    const p: UnitParams = { ...PRESETS.knight, armor: 'plate' };
    const u = corpse(p);
    applyDecay(u.root, 1, mats, humanoidDecay(p));
    const armour = body(u.root).filter((m) => rampOf(m) === p.metal);
    expect(armour.length).toBeGreaterThan(0);
    expect(armour.every((m) => m.visible && m.scale.x === 1)).toBe(true);
  });

  it('rots away beards, hair and ears whatever their colour, and leaves tusks on the skull', () => {
    const p: UnitParams = { ...PRESETS.brute, hair: 'dark', beard: 'full', teeth: 'tusks', ears: 'long' };
    const u = corpse(p);
    const soft = meshes(u.joints.head).filter((m) => m.userData.soft);
    const tusks = meshes(u.joints.head).filter((m) => rampOf(m) === 'bone');
    expect(soft.length).toBeGreaterThan(0);
    expect(tusks).toHaveLength(2);
    applyDecay(u.root, 1, mats, humanoidDecay(p));
    expect(soft.every((m) => !m.visible)).toBe(true);
    expect(tusks.every((m) => m.visible && rampOf(m) === 'bone')).toBe(true);
  });

  it('a zombie rots to bone too', () => {
    const u = corpse(PRESETS.zombie);
    applyDecay(u.root, 1, mats, humanoidDecay(PRESETS.zombie));
    expect(body(u.root).filter((m) => rampOf(m) === PRESETS.zombie.skin)).toHaveLength(0);
  });

  it("a red-hide beast's body is bone, not rotted away as red cloth", () => {
    const p = { ...BEAST_PRESETS.wolf, hide: 'red' as const };
    const b = buildBeast(p, mats);
    applyBeastPose(b, { joints: {} });
    applyDecay(b.root, 1, mats, beastDecay(p));
    const torso = meshes(b.joints.chest)[0];
    expect(torso.visible).toBe(true);
    expect(rampOf(torso)).toBe('bone');
  });

  it("chars a vehicle's timbers and keeps its metal", () => {
    const p = VEHICLE_PRESETS.catapult;
    const v = buildVehicle(p, mats);
    const wood = meshes(v.root).filter((m) => rampOf(m) === p.wood);
    const metal = meshes(v.root).filter((m) => rampOf(m) === p.metal);
    applyDecay(v.root, 1, mats, vehicleDecay(p));
    expect(wood.every((m) => rampOf(m) === 'dark')).toBe(true);
    expect(metal.every((m) => rampOf(m) === p.metal && m.visible)).toBe(true);
  });

  it('settles a building’s rubble lower as it ruins', () => {
    const p = DEFAULT_BUILDING;
    const bld = buildBuilding(p, mats);
    const death = buildingAnimations().find((a) => a.name === 'death')!;
    applyBuildingPose(bld, death.pose(1, p, 0));
    const fallen = bld.blocks.map((r) => r.walls.scale.y);
    applyBuildingPose(bld, { ...death.pose(1, p, 0), ruin: 1 });
    bld.blocks.forEach((r, i) => expect(r.walls.scale.y).toBeLessThan(fallen[i]));
    applyDecay(bld.root, 1, mats, buildingDecay(p));
    expect(meshes(bld.root).some((m) => m.visible && rampOf(m) === p.walls)).toBe(false);
  });
});
