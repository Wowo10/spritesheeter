import type { BuildingParams } from '../unit/building-params';
import { DEFAULT_FRAME_COUNTS, type AnimationName, type FrameCounts } from './humanoid-anims';
import { keys } from './keys';
import type { AnimationDef, BuildingPose } from './types';

type BuildingAnimationDef = AnimationDef<BuildingParams, BuildingPose>;
type PoseFn = (t: number) => BuildingPose;

/** The rows a building fills; it doesn't walk, fight or cast. */
export const BUILDING_ROWS: AnimationName[] = ['idle', 'build', 'work', 'hit', 'death'];

/** Lit for the evening, a window or two blinking; smoke curling up, the flag stirring. */
function idle(t: number): BuildingPose {
  return { lights: 0.75, flicker: t, smoke: { phase: t, amount: 1 }, flag: 12 * Math.sin(t * Math.PI * 2) };
}

/**
 * Going up from bare foundations: scaffolding, the walls rising inside it, then the roofs.
 * Plays once; the last frame is finished, the scaffolding gone. A game may also show its
 * frames by how far along the building is.
 */
function build(t: number): BuildingPose {
  return { build: t, lights: 0, flicker: 0, smoke: { phase: 0, amount: 0 } };
}

/** Busy: every light on, smoke billowing out twice as fast, the door open, the flag brisk. */
function work(t: number): BuildingPose {
  return {
    lights: 1,
    flicker: 2 * t,
    smoke: { phase: 2 * t, amount: 1.3 },
    flag: 25 + 12 * Math.sin(t * Math.PI * 4),
    door: 1,
  };
}

/** Struck: a jolt, the lights knocked out for a moment, then back as it was. */
function hit(t: number): BuildingPose {
  const r = keys(t, [[0, 0], [0.2, 1], [1, 0]]);
  return {
    ...idle(0),
    lights: t > 0.1 && t < 0.45 ? 0.3 : 0.75,
    shake: [0.06 * r * Math.cos(t * Math.PI * 5), 0.03 * r * Math.sin(t * Math.PI * 7)],
    flag: -30 * r,
  };
}

/** Falls in: the lights go out, the blocks crumble and lean, one after another, into rubble. */
function death(t: number): BuildingPose {
  return {
    lights: 0.75 * keys(t, [[0, 1], [0.25, 0]]),
    flicker: t,
    smoke: { phase: t, amount: keys(t, [[0, 1], [0.3, 0]]) },
    shake: [0.05 * Math.sin(t * Math.PI * 6) * (1 - t), 0],
    collapse: keys(t, [[0, 0], [0.15, 0], [1, 1]]),
  };
}

/** Timing as for the other unit types, so all sheets line up. */
export function buildingAnimations(counts: FrameCounts = DEFAULT_FRAME_COUNTS): BuildingAnimationDef[] {
  const all: [AnimationName, number, boolean, PoseFn][] = [
    ['idle', 4, true, idle],
    ['build', 6, false, build],
    ['work', 8, true, work],
    ['hit', 10, false, hit],
    ['death', 6, false, death],
  ];
  return all.map(([name, fps, loop, pose]) => ({ name, frames: counts[name], fps, loop, pose: (t: number) => pose(t) }));
}
