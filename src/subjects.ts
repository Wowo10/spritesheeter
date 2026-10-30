import type { Object3D } from 'three';
import { beastAnimations } from './anim/beast-anims';
import { buildingAnimations } from './anim/building-anims';
import { humanoidAnimations, type AnimationName, type FrameCounts } from './anim/humanoid-anims';
import { mountedAnimations } from './anim/mounted-anims';
import { vehicleAnimations } from './anim/vehicle-anims';
import { customDecay, type CustomModel } from './custom/model';
import type { PlaygroundOptions, Projectile } from './playground/playground';
import { applyDecay } from './render/decay';
import type { MaterialLibrary } from './render/materials';
import type { RampName } from './render/palette';
import { BEAST_PORTRAIT_TURN, type PortraitHead } from './render/portrait';
import { applyBeastPose, beastDecay, buildBeast, disposeBeast } from './unit/beast';
import { BEAST_PRESETS, randomBeast, type BeastParams } from './unit/beast-params';
import { applyBuildingPose, buildBuilding, buildingDecay, disposeBuilding } from './unit/building';
import { randomBuilding, type BuildingParams } from './unit/building-params';
import { applyPose, buildHumanoid, disposeHumanoid, humanoidDecay } from './unit/humanoid';
import { applyMountedPose, buildMounted, copyMounted, disposeMounted, MOUNTED_PRESETS, randomMounted, type MountedParams } from './unit/mounted';
import { handItems, itemKind, PRESETS, randomUnit, type HandItem, type ThrowItem, type UnitParams } from './unit/params';
import { applyVehiclePose, buildVehicle, disposeVehicle, vehicleDecay } from './unit/vehicle';
import { randomVehicle, VEHICLE_PRESETS, type VehicleParams } from './unit/vehicle-params';

/** A sheet row: how many frames, and how to put the subject at normalised time t. */
export interface Playable {
  name: string;
  frames: number;
  fps: number;
  loop: boolean;
  /** Seconds each frame is shown for, on rows played that slowly (decay); fps is 1 / hold. */
  hold?: number;
  /** Returns the frame's opacity, if not 1. */
  apply: (t: number) => number | void;
}

/** How a unit moves and fights in the playground. */
export type PlaygroundUnit = Pick<PlaygroundOptions, 'stride' | 'attack' | 'cast' | 'channel'>;

/** What the sheet is rendered from: a built procedural unit, or the loaded model. */
export interface Subject {
  readonly root: Object3D;
  /** The posed rows, and how the corpse rots (null if it leaves none: ghosts and see-through units fade away). */
  rows(frames: FrameCounts): { rows: Playable[]; rot: ((t: number) => void) | null };
  /** The head the portrait closes in on; null frames the whole subject. */
  readonly portraitHead: PortraitHead | null;
  /** Kept out of the portrait: a rider's mount, whose neck would cover the face. */
  readonly portraitHide: Object3D[];
  /** Degrees added to the portrait's turn: a beast's long face shows best near profile, not nose-on. */
  readonly portraitTurn: number;
  /** How it moves and fights in the playground; null if it doesn't (buildings). */
  playground(): PlaygroundUnit | null;
  /** Takes it out of the scene, and frees what it alone uses. */
  dispose(): void;
}

export const KINDS = ['humanoid', 'beast', 'mounted', 'vehicle', 'building'] as const;
export type Kind = (typeof KINDS)[number];

export interface ParamsOf {
  humanoid: UnitParams;
  beast: BeastParams;
  mounted: MountedParams;
  vehicle: VehicleParams;
  building: BuildingParams;
}
export type AnyParams = ParamsOf[Kind];

/** One procedural generator: its settings, and the unit it builds from them. */
export interface KindDef<P> {
  /** Named starting points; buildings have none, their seed lays them out. */
  presets: Record<string, P>;
  /** A copy of the named preset with the given seed. */
  preset(name: string, seed: number): P;
  random(seed: number): P;
  /** The spell colour: a mounted unit's rider casts, a vehicle's is its fire, a building's its lights. */
  magic(p: P): RampName;
  /** Its opacity: a mounted unit's is its mount's, and vehicles and buildings are solid. */
  opacity(p: P): number;
  /** Smallest frame it fits in: a rider on its mount is well over twice as tall as a unit on foot. */
  minFrameSize: number;
  build(p: P, mats: MaterialLibrary): Subject;
}

// legs swinging ±28° walking cover about 1.9 leg lengths a loop; running, with a moment in the air, about 2.8
const legs = (hip: number) => ({ walk: 1.9 * hip, run: 2.8 * hip });

const THROWN: Record<ThrowItem, Projectile> = { javelin: 'javelin', bomb: 'bomb', throwingAxe: 'throwingAxe' };

/**
 * What the unit's attack lets fly, picked as the attack picks its hand: bows and crossbows
 * shoot arrows, muskets and pistols bullets; failing those, the right hand's throwing item,
 * then the left's. Null is melee.
 */
export function projectileOf(u: UnitParams): Projectile | null {
  const items = handItems(u);
  if ([items.L, items.R].some((i) => i === 'bow' || i === 'crossbow')) return 'arrow';
  if ([items.L, items.R].some((i) => i === 'musket' || i === 'pistol')) return 'bullet';
  const thrown = (i: HandItem) => (itemKind(i) === 'throw' ? THROWN[i as ThrowItem] : null);
  return thrown(items.R) ?? thrown(items.L);
}

/** What a vehicle's weapon shoots, whether it attacks or "casts"; a ram strikes up close. */
const VEHICLE_SHOTS: Record<VehicleParams['weapon'], Projectile | null> = { ram: null, catapult: 'stone', ballista: 'javelin', flamethrower: 'fireball' };

const humanoid: KindDef<UnitParams> = {
  presets: PRESETS,
  preset: (name, seed) => ({ ...PRESETS[name], seed }),
  random: randomUnit,
  magic: (p) => p.magic,
  opacity: (p) => p.opacity,
  minFrameSize: 0,
  build(p, mats) {
    const u = buildHumanoid(p, mats);
    return {
      root: u.root,
      rows(frames) {
        const rows = humanoidAnimations(frames).map((d) => ({
          ...d,
          apply: (t: number) => {
            const pose = d.pose(t, p, u.hipHeight);
            applyPose(u, pose);
            return pose.opacity;
          },
        }));
        const corpse = p.opacity === 1 && p.body !== 'ghost';
        return { rows, rot: corpse ? (t) => applyDecay(u.root, t, mats, humanoidDecay(p)) : null };
      },
      portraitHead: { joint: u.joints.head, ...u.skull },
      portraitHide: [],
      portraitTurn: 0,
      playground: () => ({ stride: legs(u.hipHeight), attack: projectileOf(p), cast: 'bolt', channel: true }),
      dispose: () => disposeHumanoid(u),
    };
  },
};

const beast: KindDef<BeastParams> = {
  presets: BEAST_PRESETS,
  preset: (name, seed) => ({ ...BEAST_PRESETS[name], seed }),
  random: randomBeast,
  magic: (p) => p.magic,
  opacity: (p) => p.opacity,
  minFrameSize: 0,
  build(p, mats) {
    const b = buildBeast(p, mats);
    return {
      root: b.root,
      rows(frames) {
        const rows = beastAnimations(frames).map((d) => ({
          ...d,
          apply: (t: number) => {
            const pose = d.pose(t, p, b.hipHeight);
            applyBeastPose(b, pose);
            return pose.opacity;
          },
        }));
        return { rows, rot: p.opacity === 1 ? (t) => applyDecay(b.root, t, mats, beastDecay(p)) : null };
      },
      portraitHead: { joint: b.joints.head, ...b.skull },
      portraitHide: [],
      portraitTurn: BEAST_PORTRAIT_TURN,
      playground: () => ({ stride: legs(b.hipHeight), attack: null, cast: p.breath ? 'fireball' : null, channel: p.breath }),
      dispose: () => disposeBeast(b),
    };
  },
};

const mounted: KindDef<MountedParams> = {
  presets: MOUNTED_PRESETS,
  preset: (name, seed) => ({ ...copyMounted(MOUNTED_PRESETS[name]), seed }),
  random: randomMounted,
  magic: (p) => p.rider.magic,
  opacity: (p) => p.mount.opacity,
  minFrameSize: 64,
  build(p, mats) {
    const m = buildMounted(p, mats);
    return {
      root: m.root,
      rows(frames) {
        const rows = mountedAnimations(frames).map((d) => ({
          ...d,
          apply: (t: number) => {
            const pose = d.pose(t, p, 0);
            applyMountedPose(m, pose);
            return pose.opacity;
          },
        }));
        const rot = (t: number) => {
          applyDecay(m.rider.root, t, mats, humanoidDecay(p.rider));
          applyDecay(m.beast.root, t, mats, beastDecay(p.mount));
        };
        return { rows, rot: p.mount.opacity === 1 ? rot : null };
      },
      portraitHead: { joint: m.rider.joints.head, ...m.rider.skull },
      portraitHide: [m.beast.root],
      portraitTurn: 0,
      playground: () => ({ stride: legs(m.beast.hipHeight), attack: projectileOf(p.rider), cast: 'bolt', channel: true }),
      dispose: () => disposeMounted(m),
    };
  },
};

const vehicle: KindDef<VehicleParams> = {
  presets: VEHICLE_PRESETS,
  preset: (name, seed) => ({ ...VEHICLE_PRESETS[name], seed }),
  random: randomVehicle,
  magic: (p) => p.flame,
  opacity: () => 1,
  // siege engines are about as long as a rider is tall
  minFrameSize: 64,
  build(p, mats) {
    const v = buildVehicle(p, mats);
    return {
      root: v.root,
      rows(frames) {
        const rows = vehicleAnimations(frames).map((d) => ({
          ...d,
          apply: (t: number) => applyVehiclePose(v, d.pose(t, p, 0)),
        }));
        return { rows, rot: (t) => applyDecay(v.root, t, mats, vehicleDecay(p)) };
      },
      portraitHead: null,
      portraitHide: [],
      portraitTurn: 0,
      playground() {
        // the wheels turn a quarter turn a loop walking, half a turn running
        const r = v.dims.wheelR;
        const shot = VEHICLE_SHOTS[p.weapon];
        return { stride: { walk: (Math.PI * r) / 2, run: Math.PI * r }, attack: shot, cast: shot, channel: p.weapon === 'flamethrower' };
      },
      dispose: () => disposeVehicle(v),
    };
  },
};

const building: KindDef<BuildingParams> = {
  presets: {},
  preset: (_, seed) => randomBuilding(seed),
  random: randomBuilding,
  magic: (p) => p.light,
  opacity: () => 1,
  minFrameSize: 128,
  build(p, mats) {
    const bld = buildBuilding(p, mats);
    return {
      root: bld.root,
      rows(frames) {
        const defs = buildingAnimations(frames);
        const rows = defs.map((d) => ({
          ...d,
          apply: (t: number) => applyBuildingPose(bld, d.pose(t, p, 0)),
        }));
        const death = defs.find((d) => d.name === 'death')!;
        const rot = (t: number) => {
          applyBuildingPose(bld, { ...death.pose(1, p, 0), ruin: t });
          applyDecay(bld.root, t, mats, buildingDecay(p));
        };
        return { rows, rot };
      },
      portraitHead: null,
      portraitHide: [],
      portraitTurn: 0,
      playground: () => null,
      dispose: () => disposeBuilding(bld),
    };
  },
};

export const KIND_DEFS: { [K in Kind]: KindDef<ParamsOf[K]> } = { humanoid, beast, mounted, vehicle, building };

/** The generator for `kind`, taking whichever settings it's given; they must be that kind's. */
export function kindDef(kind: Kind): KindDef<AnyParams> {
  return KIND_DEFS[kind] as KindDef<AnyParams>;
}

/**
 * A loaded model, which stays loaded when it's not shown. It gets the rows it has clips for
 * (`clipFor` names the clip picked for each row), with the procedural rows' timing; without
 * any it's a static model, one frame per direction.
 */
export function customSubject(m: CustomModel, mats: MaterialLibrary, clipFor: (row: AnimationName) => string, height: () => number): Subject {
  return {
    root: m.root,
    rows(frames) {
      // a custom model may be a building going up
      const defs = [...humanoidAnimations(frames), ...buildingAnimations(frames).filter((d) => d.name === 'build')];
      const rows = defs.flatMap((d): Playable[] => {
        const clip = m.clip(clipFor(d.name as AnimationName));
        return clip ? [{ name: d.name, frames: d.frames, fps: d.fps, loop: d.loop, apply: (t) => m.sample(clip, t, d.loop) }] : [];
      });
      const rot = (t: number) => applyDecay(m.root, t, mats, customDecay());
      return { rows: rows.length > 0 ? rows : [{ name: 'idle', frames: 1, fps: 1, loop: true, apply: () => m.sample(null, 0, true) }], rot };
    },
    portraitHead: null,
    portraitHide: [],
    portraitTurn: 0,
    playground: () => ({ stride: legs(height() / 2), attack: null, cast: 'bolt', channel: true }),
    dispose: () => m.root.removeFromParent(),
  };
}
