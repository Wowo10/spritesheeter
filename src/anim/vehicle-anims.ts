import type { VehicleParams, Weapon } from '../unit/vehicle-params';
import { DEFAULT_FRAME_COUNTS, type FrameCounts } from './humanoid-anims';
import { keys, type Key } from './keys';
import type { AnimationDef, VehiclePose } from './types';

type VehicleAnimationDef = AnimationDef<VehicleParams, VehiclePose>;
type PoseFn = (t: number, p: VehicleParams) => VehiclePose;

/**
 * Wheel turn per walk loop: a quarter turn, which the wheels' four spokes repeat, so the loop
 * is seamless. A game moving the unit about 0.4 of a wheel's diameter per loop keeps them
 * from skidding.
 */
export const WALK_WHEEL_TURN = 90;

/** The pilot light a flamethrower keeps burning between bursts. */
function pilot(p: VehicleParams, t: number): VehiclePose['flame'] {
  return p.weapon === 'flamethrower' ? { scale: 0.15, flicker: t } : undefined;
}

/** Standing still, the flag stirring in the wind. */
function rest(t: number, p: VehicleParams): VehiclePose {
  const phase = t * Math.PI * 2;
  return {
    wheels: 0,
    // a ram's log sways a little on its ropes
    stroke: p.weapon === 'ram' ? 0.04 * Math.sin(phase) : 0,
    loaded: true,
    flag: 12 * Math.sin(phase),
    flame: pilot(p, t),
  };
}

/** Rolling along: wheels turning `turn` degrees per loop, the frame jolting over the ground. */
function roll(turn: number, bump: number) {
  return (t: number, p: VehicleParams): VehiclePose => {
    const phase = t * Math.PI * 2;
    return {
      ...rest(t, p),
      wheels: turn * t,
      // a jolt per spoke, and a slow sway from side to side
      rock: [bump * Math.sin(2 * phase), 0.6 * bump * Math.sin(phase), 0.01 * bump * Math.abs(Math.sin(2 * phase))],
      stroke: p.weapon === 'ram' ? 0.12 * bump * Math.sin(phase) : 0,
      flag: 25 + 10 * Math.sin(2 * phase),
    };
  };
}

/** One shot of a weapon: the stroke over time, when the shot is in place, the winch and fire. */
interface Shot {
  stroke: Key<number>[];
  /** Times between which the shot is gone: fired, and not yet reloaded. */
  gone?: [number, number];
  winch?: Key<number>[];
  flame?: Key<number>[];
  /** Nose-up kick of the frame. */
  kick: Key<number>[];
}

/** Each ends as it started, so it blends with idle. */
const SHOTS: Record<Weapon, Shot> = {
  // pulled back, swung hard into the gate, rebounding a little, then settling
  ram: {
    stroke: [[0, 0], [0.4, -1], [0.6, 1], [0.7, 0.75], [0.85, 0.2], [1, 0]],
    kick: [[0, 0], [0.6, 0], [0.66, -2], [0.8, 0.5], [1, 0]],
  },
  // a brief strain, the arm whips up against the crossbar, then is winched back down
  catapult: {
    stroke: [[0, 0], [0.12, -0.05], [0.28, 1], [0.34, 0.9], [0.4, 1], [1, 0]],
    gone: [0.22, 0.92],
    winch: [[0, 0], [0.4, 0], [1, -720]],
    kick: [[0, 0], [0.22, 0], [0.3, 4], [0.42, -1.5], [0.55, 0], [1, 0]],
  },
  // a moment's aim, the string snaps forward, the arms overshoot, then it's wound back
  ballista: {
    stroke: [[0, 0], [0.12, 0], [0.22, 1.15], [0.3, 0.95], [0.36, 1], [1, 0]],
    gone: [0.18, 0.88],
    winch: [[0, 0], [0.36, 0], [1, -540]],
    kick: [[0, 0], [0.18, 0], [0.24, -1.5], [0.36, 0.5], [0.5, 0], [1, 0]],
  },
  // two pumps of the lever, and the fire roars out between them
  flamethrower: {
    stroke: [[0, 0], [0.12, -1], [0.27, 1], [0.42, -1], [0.57, 1], [0.75, 0], [1, 0]],
    flame: [[0, 0.15], [0.2, 0.5], [0.32, 1], [0.65, 1], [0.85, 0.35], [1, 0.15]],
    kick: [[0, 0], [0.3, -1], [0.7, -1], [1, 0]],
  },
};

function attack(t: number, p: VehicleParams): VehiclePose {
  const shot = SHOTS[p.weapon];
  const [from, to] = shot.gone ?? [2, 2];
  return {
    ...rest(0, p),
    stroke: keys(t, shot.stroke),
    loaded: t < from || t >= to,
    winch: shot.winch ? keys(t, shot.winch) : 0,
    flame: shot.flame ? { scale: keys(t, shot.flame), flicker: 2 * t } : pilot(p, t),
    rock: [keys(t, shot.kick), 0, 0],
    flag: keys(t, [[0, 0], [0.3, 18], [0.6, -10], [1, 0]]),
  };
}

/** Looped. A flamethrower pumps steadily and pours out fire; anything else stands ready. */
function channel(t: number, p: VehicleParams): VehiclePose {
  if (p.weapon !== 'flamethrower') return rest(t, p);
  const phase = t * Math.PI * 2;
  return {
    ...rest(t, p),
    stroke: Math.sin(phase),
    flame: { scale: 0.95 + 0.05 * Math.cos(2 * phase), flicker: 2 * t },
    rock: [-1, 0, 0],
  };
}

/** Struck: the frame jolts and shudders, the flag whips. */
function hit(t: number, p: VehicleParams): VehiclePose {
  const r = keys(t, [[0, 0], [0.25, 1], [1, 0]]);
  return {
    ...rest(0, p),
    stroke: p.weapon === 'ram' ? -0.3 * r : 0,
    rock: [-3 * r, 3 * r * Math.cos(t * Math.PI * 4), 0.02 * r],
    flag: -30 * r,
  };
}

/** The banner waves hard; a flamethrower lets out a spurt of fire. */
function taunt(t: number, p: VehicleParams): VehiclePose {
  const wave = keys(t, [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]);
  const spurt = keys(t, [[0, 0], [0.3, 0], [0.45, 1], [0.6, 0], [1, 0]]);
  return {
    ...rest(t, p),
    flag: 40 * wave * Math.sin(t * Math.PI * 6),
    flame: p.weapon === 'flamethrower' ? { scale: 0.15 + 0.6 * spurt, flicker: 2 * t } : undefined,
  };
}

/**
 * Breaks down: a shudder, the wheels on one side give way and the frame tips onto the ground,
 * the weapon going slack; the flag pole falls and the fire goes out.
 */
function death(t: number, p: VehicleParams): VehiclePose {
  const wreck = keys(t, [[0, 0], [0.33, 0.15], [0.67, 0.85], [1, 1]]);
  return {
    ...rest(0, p),
    // as for units: lying straight along the camera axis reads badly
    turn: keys(t, [[0, 0], [1, 22.5]]),
    rock: [keys(t, [[0, 0], [0.2, -3], [0.4, 0]]), 0, 0],
    stroke: 0,
    loaded: t < 0.33,
    wreck,
    flag: keys(t, [[0, 0], [0.5, -20], [1, 0]]),
    flame: p.weapon === 'flamethrower' ? { scale: keys(t, [[0, 0.15], [0.33, 0.6], [0.67, 0]]), flicker: 2 * t } : undefined,
  };
}

/** Same rows, frame counts and timing as the other unit types, so all sheets line up. */
export function vehicleAnimations(counts: FrameCounts = DEFAULT_FRAME_COUNTS): VehicleAnimationDef[] {
  const walk = roll(WALK_WHEEL_TURN, 1);
  const all: [VehicleAnimationDef['name'], number, boolean, PoseFn][] = [
    ['idle', 4, true, rest],
    ['walk', 8, true, walk],
    ['attack', 8, false, attack],
    // a vehicle has no spell: cast fires it as attack does
    ['cast', 8, false, attack],
    ['death', 6, false, death],
    ['channel', 6, true, channel],
    ['hit', 10, false, hit],
    ['run', 12, true, roll(2 * WALK_WHEEL_TURN, 2)],
    ['work', 8, true, rest],
    ['carry', 8, true, walk],
    ['taunt', 8, false, taunt],
  ];
  return all.map(([name, fps, loop, pose]) => ({
    name,
    frames: counts[name as keyof FrameCounts],
    fps,
    loop,
    pose: (t: number, p: VehicleParams) => pose(t, p),
  }));
}
