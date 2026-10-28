import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import type { BeastPose, Pose } from '../anim/types';
import type { MaterialLibrary } from '../render/materials';
import { mulberry32, pick } from '../rng';
import { applyBeastPose, buildBeast, disposeBeast, type Beast } from './beast';
import { BEAST_PRESETS, beastDims, randomBeast, type Barding, type BeastParams } from './beast-params';
import { applyPose, buildHumanoid, disposeHumanoid, type Humanoid } from './humanoid';
import { PRESETS, randomUnit, type UnitParams } from './params';
import { PartBuilder } from './parts';

/** A humanoid rider on a beast. */
export interface MountedParams {
  seed: number;
  rider: UnitParams;
  mount: BeastParams;
}

/** Barding a mount may wear: anything else becomes a saddle, since the rider needs a seat. */
export const MOUNT_BARDINGS: readonly Barding[] = ['saddle', 'armor'];

/** How far the rider's hips joint sits above the saddle point; the pelvis sinks into the seat a little. */
const SEAT = 0.06;

export const MOUNTED_PRESETS: Record<string, MountedParams> = {
  knight: {
    seed: 1,
    rider: PRESETS.knight,
    mount: { ...BEAST_PRESETS.horse, barding: 'armor', hide: 'bone', belly: 'bone', metal: 'gold' },
  },
  wolfRider: {
    seed: 1,
    rider: PRESETS.axeman,
    mount: { ...BEAST_PRESETS.wolf, size: 1.35, bulk: 1.15, barding: 'saddle', hide: 'hair' },
  },
  griffinRider: {
    seed: 1,
    rider: PRESETS.spearman,
    mount: { ...BEAST_PRESETS.griffin, size: 1.35 },
  },
};

/** A copy that shares nothing with `p`, so presets stay untouched when the copy is edited. */
export function copyMounted(p: MountedParams): MountedParams {
  return { seed: p.seed, rider: { ...p.rider }, mount: { ...p.mount } };
}

/** Beasts big and steady enough to ride, for random mounts. */
const MOUNTS = ['horse', 'wolf', 'bear', 'boar', 'lion'];

export function randomMounted(seed: number): MountedParams {
  const mount = randomBeast(seed, MOUNTS);
  // a separate stream for the mount's riding gear, so randomBeast's own draws stay as they are
  const rng = mulberry32(seed + 1);
  return {
    seed,
    rider: randomUnit(seed),
    mount: {
      ...mount,
      // big enough to carry a rider
      size: Math.max(mount.size, 1.3),
      barding: pick(rng, MOUNT_BARDINGS),
      // spines would run up into the rider
      back: mount.back === 'spikes' || mount.back === 'ridge' ? 'none' : mount.back,
    },
  };
}

/** The beast as it's built when ridden: always wearing a seat. */
export function mountParams(p: MountedParams): BeastParams {
  return { ...p.mount, barding: MOUNT_BARDINGS.includes(p.mount.barding) ? p.mount.barding : 'saddle' };
}

/**
 * The rider as it's built: sitting, so it walks (floating or shambling has no meaning in the
 * saddle), has legs, and leaves the shadow to the mount. Opacity is the mount's.
 */
export function riderParams(p: MountedParams): UnitParams {
  return { ...p.rider, gait: 'walk', body: 'normal', shadow: false, opacity: 1 };
}

export interface Mounted {
  /** Unit origin: on the ground under the mount, facing +Z. */
  root: Group;
  beast: Beast;
  /** Placed on the saddle every frame (see applyMountedPose); not a child of the beast. */
  rider: Humanoid;
}

export interface MountedPose {
  mount: BeastPose;
  rider: Pose;
  /**
   * Rider thrown out of the saddle: k = 0 is seated, 1 lies at `pos` (in the unit's space, on
   * the ground) the right way up.
   */
  thrown?: { k: number; pos: [number, number, number] };
  opacity?: number;
}

export function buildMounted(p: MountedParams, mats: MaterialLibrary): Mounted {
  const mount = mountParams(p);
  const beast = buildBeast(mount, mats);
  if (mount.barding === 'armor') {
    // a leather seat on the plates
    const { length: L, depth: D, width: W } = beastDims(mount);
    new PartBuilder(mats).box(beast.saddle, 'leather', [W * 0.6, D * 0.12, L * 0.3], [0, -D * 0.06, 0]);
  }
  const rider = buildHumanoid(riderParams(p), mats);
  const root = new Group();
  root.name = 'mounted';
  root.add(beast.root, rider.root);
  return { root, beast, rider };
}

const _saddle = new Matrix4();
const _pos = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();
const _drop = new Vector3();
const _ground = new Vector3();
const _level = new Quaternion();

export function applyMountedPose(m: Mounted, pose: MountedPose): void {
  applyBeastPose(m.beast, pose.mount);
  // the saddle relative to the beast's root, which sits on the unit's origin; that keeps it
  // independent of the direction the renderer turns the whole unit to
  m.beast.root.updateMatrixWorld(true);
  _saddle.copy(m.beast.root.matrixWorld).invert().multiply(m.beast.saddle.matrixWorld);
  _saddle.decompose(_pos, _quat, _scale);
  // the rider's hips joint on the seat
  _pos.add(_drop.set(0, SEAT - m.rider.hipHeight, 0).applyQuaternion(_quat));
  const k = pose.thrown?.k ?? 0;
  if (pose.thrown && k > 0) {
    _pos.lerp(_ground.set(...pose.thrown.pos), k);
    _quat.slerp(_level, k);
  }
  m.rider.root.position.copy(_pos);
  m.rider.root.quaternion.copy(_quat);
  applyPose(m.rider, pose.rider);
}

export function disposeMounted(m: Mounted): void {
  disposeBeast(m.beast);
  disposeHumanoid(m.rider);
  m.root.removeFromParent();
}
