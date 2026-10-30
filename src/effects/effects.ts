import { Group, IcosahedronGeometry, Mesh, OctahedronGeometry } from 'three';
import { keys } from '../anim/keys';
import type { MaterialLibrary } from '../render/materials';
import type { RampName } from '../render/palette';
import { disposeTree, PartBuilder } from '../unit/parts';

// new effects go last: rows of sheets games already use must not shift
export const EFFECT_NAMES = ['arrow', 'bolt', 'fireball', 'impact', 'puff', 'stone', 'javelin', 'bomb', 'throwingAxe', 'blast', 'bullet'] as const;
export type EffectName = (typeof EFFECT_NAMES)[number];

/** One row of the effects sheet. */
export interface EffectDef {
  name: EffectName;
  frames: number;
  fps: number;
  loop: boolean;
  /** Shows just this effect, posed at t in [0, 1]; returns its opacity. */
  apply: (t: number) => number;
}

export interface Effects {
  /** Every effect, centred on the origin and flying toward +Z; rotate around Y to aim it. */
  root: Group;
  defs: EffectDef[];
}

const DEG = Math.PI / 180;

/** Opacity one-shots fade to by their last frame; the game removes them after it. */
export const FADED = 0.25;

/**
 * Projectiles and hit effects drawn with the palette materials, so they render like units.
 * Spells (bolt, fireball, impact) are in `magic`; the arrow's and javelin's fletching is
 * team-coloured. Stones and javelins are what catapults and ballistas shoot; javelins, bombs
 * and throwing axes are also thrown by hand, and bombs go off in a fiery blast. Muskets and
 * pistols fire bullets.
 */
export function buildEffects(mats: MaterialLibrary, magic: RampName): Effects {
  const b = new PartBuilder(mats);
  const root = new Group();
  root.name = 'effects';
  const groups = Object.fromEntries(
    EFFECT_NAMES.map((name) => {
      const g = new Group();
      g.name = name;
      g.visible = false;
      root.add(g);
      return [name, g];
    }),
  ) as Record<EffectName, Group>;
  const show = (name: EffectName) => EFFECT_NAMES.forEach((n) => (groups[n].visible = n === name));

  const arrow = buildArrow(b, groups.arrow);
  const bolt = buildBolt(b, groups.bolt, magic);
  const fireball = buildFireball(b, groups.fireball, magic);
  const impact = buildImpact(b, groups.impact, magic);
  const puff = buildPuff(b, groups.puff);
  const stone = buildStone(b, groups.stone);
  const javelin = buildJavelin(b, groups.javelin);
  const bomb = buildBomb(b, groups.bomb);
  const throwingAxe = buildThrowingAxe(b, groups.throwingAxe);
  const blast = buildBlast(b, groups.blast);
  const bullet = buildBullet(b, groups.bullet);

  const def = (name: EffectName, frames: number, fps: number, loop: boolean, pose: (t: number) => number): EffectDef => ({
    name,
    frames,
    fps,
    loop,
    apply: (t) => {
      show(name);
      return pose(t);
    },
  });
  return {
    root,
    defs: [
      def('arrow', 1, 1, true, arrow),
      def('bolt', 4, 12, true, bolt),
      def('fireball', 4, 10, true, fireball),
      def('impact', 5, 12, false, impact),
      def('puff', 5, 10, false, puff),
      def('stone', 4, 10, true, stone),
      def('javelin', 1, 1, true, javelin),
      def('bomb', 4, 10, true, bomb),
      def('throwingAxe', 4, 14, true, throwingAxe),
      def('blast', 5, 12, false, blast),
      def('bullet', 1, 1, true, bullet),
    ],
  };
}

export function disposeEffects(fx: Effects): void {
  disposeTree(fx.root);
}

/**
 * Parts run along Z (cylinders and cones are turned from Y). The inner outline darkens every
 * edge pixel, so the shaft may be a thin dark line but the head and fletching, which carry
 * the colour, are made at least 3 px across at 32 px frames.
 */
function buildArrow(b: PartBuilder, g: Group): (t: number) => number {
  b.cylinder(g, 'wood', 0.035, 0.72, [0, 0, -0.02], [90, 0, 0], 6);
  b.cone(g, 'steel', 0.12, 0.26, [0, 0, 0.47], [90, 0, 0]);
  // two crossed vanes, so the fletching shows whichever way the arrow flies
  b.box(g, 'team', [0.26, 0.04, 0.24], [0, 0, -0.3]);
  b.box(g, 'team', [0.04, 0.26, 0.24], [0, 0, -0.3]);
  return () => 1;
}

/** A crystal shard with four sparks trailing behind in a spiral; spins a full turn per loop. */
function buildBolt(b: PartBuilder, g: Group, magic: RampName): (t: number) => number {
  const spin = new Group();
  g.add(spin);
  const shard = b.mesh(spin, new OctahedronGeometry(0.2, 0), magic, [0, 0, 0.08]);
  shard.scale.set(1, 1, 2);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const size = 0.11 - i * 0.015;
    b.box(spin, magic, [size, size, size], [Math.cos(a) * 0.14, Math.sin(a) * 0.14, -0.3 - i * 0.16], [45, 45, 0]);
  }
  // the sparks shrink down the spiral, so only a full turn brings it back to the start
  return (t) => {
    spin.rotation.z = 360 * t * DEG;
    return 1;
  };
}

/** A glowing core with five flame tongues streaming back, each flickering on its own beat. */
function buildFireball(b: PartBuilder, g: Group, magic: RampName): (t: number) => number {
  b.mesh(g, new IcosahedronGeometry(0.24, 0), magic);
  const flames: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    // pointing back (-Z); positioned by the pose, since the length changes
    const f = b.cone(g, magic, 0.14, 1, [Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0], [-90, 0, 0]);
    flames.push(f);
  }
  return (t) => {
    flames.forEach((f, i) => {
      const length = 0.4 + 0.14 * Math.sin((t + i / 5) * Math.PI * 2);
      f.scale.y = length;
      f.position.z = -0.12 - length / 2;
    });
    return 1;
  };
}

/** Directions sparks fly in: around the horizon, alternately tipped up and down. */
const BURST = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  const up = i % 2 === 0 ? 0.5 : -0.3;
  const len = Math.hypot(1, up);
  return [Math.cos(a) / len, up / len, Math.sin(a) / len] as const;
});

/** The core flares and shrinks while sparks fly outward, fading out. */
function buildImpact(b: PartBuilder, g: Group, magic: RampName): (t: number) => number {
  const core = b.mesh(g, new IcosahedronGeometry(0.22, 0), magic);
  const sparks = BURST.map(() => b.box(g, magic, [0.11, 0.11, 0.11], [0, 0, 0], [45, 45, 0]));
  return (t) => {
    core.scale.setScalar(keys(t, [[0, 0.6], [0.3, 1.4], [1, 0.2]]));
    const reach = keys(t, [[0, 0.1], [0.6, 0.6], [1, 0.75]]);
    sparks.forEach((s, i) => {
      const [x, y, z] = BURST[i];
      s.position.set(x * reach, y * reach, z * reach);
      s.scale.setScalar(keys(t, [[0, 1], [1, 0.5]]));
    });
    // the last frame is faint rather than empty: a blank frame would be wasted
    return keys(t, [[0, 1], [0.4, 1], [1, FADED]]);
  };
}

/** Clouds of dust swelling and drifting up from where the unit fell, fading out. */
function buildPuff(b: PartBuilder, g: Group): (t: number) => number {
  const offsets: [number, number, number][] = [
    [0, 0, 0],
    [0.16, -0.04, 0.06],
    [-0.14, -0.02, -0.08],
    [0.02, 0.1, -0.12],
  ];
  const clouds = offsets.map((p) => b.mesh(g, new IcosahedronGeometry(1, 0), 'fur', p));
  return (t) => {
    const r = keys(t, [[0, 0.14], [0.5, 0.3], [1, 0.38]]);
    const rise = 0.3 * t;
    clouds.forEach((c, i) => {
      const [x, y, z] = offsets[i];
      const spread = 1 + 0.8 * t;
      c.position.set(x * spread, y * spread + rise, z * spread);
      c.scale.setScalar(r * (i === 0 ? 1.2 : 1));
    });
    return keys(t, [[0, 1], [0.3, 0.9], [1, FADED]]);
  };
}

/**
 * A lumpy boulder tumbling end over end. Its chips make it look the same only after a whole
 * turn, which the loop takes.
 */
function buildStone(b: PartBuilder, g: Group): (t: number) => number {
  const tumble = new Group();
  g.add(tumble);
  b.mesh(tumble, new IcosahedronGeometry(0.24, 0), 'fur');
  b.mesh(tumble, new IcosahedronGeometry(0.13, 0), 'fur', [0.14, 0.1, 0.06]);
  b.mesh(tumble, new IcosahedronGeometry(0.1, 0), 'dark', [-0.1, -0.14, 0.08]);
  return (t) => {
    tumble.rotation.x = 360 * t * DEG;
    return 1;
  };
}

/** A ballista's javelin: an arrow twice as long and thick, with an iron head. */
function buildJavelin(b: PartBuilder, g: Group): (t: number) => number {
  b.cylinder(g, 'wood', 0.05, 1.3, [0, 0, -0.05], [90, 0, 0], 6);
  b.cone(g, 'steel', 0.15, 0.34, [0, 0, 0.77], [90, 0, 0]);
  b.box(g, 'team', [0.32, 0.05, 0.3], [0, 0, -0.55]);
  b.box(g, 'team', [0.05, 0.32, 0.3], [0, 0, -0.55]);
  return () => 1;
}

/** A bomb tumbling through the air, its fuse sparking. */
function buildBomb(b: PartBuilder, g: Group): (t: number) => number {
  const tumble = new Group();
  g.add(tumble);
  b.mesh(tumble, new IcosahedronGeometry(0.26, 1), 'dark');
  b.cylinder(tumble, 'steel', 0.09, 0.07, [0, 0.26, 0]);
  const spark = b.box(tumble, 'fire', [0.14, 0.14, 0.14], [0, 0.36, 0], [45, 45, 0]);
  return (t) => {
    tumble.rotation.x = 360 * t * DEG;
    spark.scale.setScalar(1 + 0.4 * Math.sin(t * Math.PI * 4));
    return 1;
  };
}

/** A hand axe spinning end over end, head first at the start of each turn. */
function buildThrowingAxe(b: PartBuilder, g: Group): (t: number) => number {
  const spin = new Group();
  g.add(spin);
  // the handle along Z, centred on its balance point near the head
  b.box(spin, 'wood', [0.09, 0.09, 0.6], [0, 0, -0.1]);
  b.box(spin, 'steel', [0.08, 0.26, 0.22], [0, 0.12, 0.18]);
  b.box(spin, 'steel', [0.08, 0.08, 0.34], [0, 0.27, 0.18]); // flared edge
  return (t) => {
    spin.rotation.x = 360 * t * DEG;
    return 1;
  };
}

/** A bomb going off: a fireball flaring and shrinking, sparks flying, smoke rising, fading out. */
function buildBlast(b: PartBuilder, g: Group): (t: number) => number {
  const core = b.mesh(g, new IcosahedronGeometry(0.3, 0), 'fire');
  const sparks = BURST.map(() => b.box(g, 'fire', [0.12, 0.12, 0.12], [0, 0, 0], [45, 45, 0]));
  const smoke = [
    [0.18, 0.1, 0.05],
    [-0.16, 0.14, -0.06],
    [0.02, 0.22, 0.14],
  ].map((p) => b.mesh(g, new IcosahedronGeometry(1, 0), 'dark', p as [number, number, number]));
  return (t) => {
    core.scale.setScalar(keys(t, [[0, 0.7], [0.25, 1.5], [0.6, 0.8], [1, 0.1]]));
    const reach = keys(t, [[0, 0.15], [0.5, 0.75], [1, 0.9]]);
    sparks.forEach((s, i) => {
      const [x, y, z] = BURST[i];
      s.position.set(x * reach, y * reach, z * reach);
      s.scale.setScalar(keys(t, [[0, 1], [1, 0.4]]));
    });
    smoke.forEach((c) => c.scale.setScalar(keys(t, [[0, 0.01], [0.3, 0.12], [1, 0.26]])));
    smoke.forEach((c, i) => (c.position.y = [0.1, 0.14, 0.22][i] + 0.35 * t));
    return keys(t, [[0, 1], [0.5, 1], [1, FADED]]);
  };
}

/** A lead ball, far too small to see, so drawn as a ball with a pale streak of its flight behind it. */
function buildBullet(b: PartBuilder, g: Group): (t: number) => number {
  b.mesh(g, new IcosahedronGeometry(0.08, 0), 'dark', [0, 0, 0.2]);
  b.box(g, 'bone', [0.05, 0.05, 0.4], [0, 0, -0.06]);
  return () => 1;
}
