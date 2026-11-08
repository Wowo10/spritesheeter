import { Mesh, ShaderMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { applyDecay, clearDecay } from '../src/render/decay';
import { MaterialLibrary } from '../src/render/materials';
import { METAL_RAMPS, type RampName } from '../src/render/palette';
import { buildBeast } from '../src/unit/beast';
import { BEAST_PRESETS } from '../src/unit/beast-params';
import { buildHumanoid, humanoidDecay } from '../src/unit/humanoid';
import { PRESETS, randomUnit } from '../src/unit/params';
import { buildVehicle } from '../src/unit/vehicle';
import { VEHICLE_PRESETS } from '../src/unit/vehicle-params';

const mats = new MaterialLibrary();

const materials = (root: Object3D): ShaderMaterial[] => {
  const out: ShaderMaterial[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o.material as ShaderMaterial);
  });
  return out;
};
const isMetal = (m: ShaderMaterial) => METAL_RAMPS.includes(m.name as RampName);
const rusty = (m: ShaderMaterial) => m.uniforms.uRust.value === 1;

describe('rusty metal', () => {
  it('is off unless asked for', () => {
    expect(PRESETS.knight.rusty).toBe(false);
    expect(randomUnit(7).rusty).toBe(false);
    expect(materials(buildHumanoid(PRESETS.knight, mats).root).some(rusty)).toBe(false);
  });

  it('patches every metal part, and only those, keeping each part on its own metal', () => {
    for (const p of [PRESETS.knight, PRESETS.champion, { ...PRESETS.swordsman, metal: 'copper' as RampName }]) {
      const plain = materials(buildHumanoid(p, mats).root);
      const rusted = materials(buildHumanoid({ ...p, rusty: true }, mats).root);
      expect(rusted.map((m) => m.name)).toEqual(plain.map((m) => m.name));
      expect(rusted.some(rusty)).toBe(true);
      rusted.forEach((m) => expect(rusty(m)).toBe(isMetal(m)));
    }
  });

  it('works for beasts and vehicles too', () => {
    const beast = materials(buildBeast({ ...BEAST_PRESETS.horse, barding: 'armor', rusty: true }, mats).root);
    expect(beast.filter(isMetal).length).toBeGreaterThan(0);
    beast.forEach((m) => expect(rusty(m)).toBe(isMetal(m)));
    const ram = materials(buildVehicle({ ...VEHICLE_PRESETS.ram, rusty: true }, mats).root);
    ram.forEach((m) => expect(rusty(m)).toBe(isMetal(m)));
  });

  it('shares one material per metal, apart from the clean one', () => {
    expect(mats.get('steel', true)).toBe(mats.get('steel', true));
    expect(mats.get('steel', true)).not.toBe(mats.get('steel'));
    expect(mats.get('steel', true).name).toBe('steel');
  });

  it('stays on a corpse, and comes back with it', () => {
    const p = { ...PRESETS.knight, rusty: true };
    const u = buildHumanoid(p, mats);
    const before = materials(u.root);
    applyDecay(u.root, 1, mats, humanoidDecay(p));
    const metal = materials(u.root).filter(isMetal);
    expect(metal.length).toBeGreaterThan(0);
    metal.forEach((m) => expect(rusty(m)).toBe(true));
    clearDecay(u.root);
    expect(materials(u.root)).toEqual(before);
  });
});
