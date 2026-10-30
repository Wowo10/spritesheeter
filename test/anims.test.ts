import { describe, expect, it } from 'vitest';
import { humanoidAnimations } from '../src/anim/humanoid-anims';
import { frameTime, type JointName } from '../src/anim/types';
import { MaterialLibrary } from '../src/render/materials';
import { applyPose, buildHumanoid, disposeHumanoid } from '../src/unit/humanoid';
import { Quaternion, Vector3 } from 'three';
import { GAITS, handItems, itemKind, PRESETS, SECOND_GRIP, type HandItem, type HeavyItem, type UnitParams } from '../src/unit/params';

const attack = humanoidAnimations().find((a) => a.name === 'attack')!;
const unit = (rightHand: HandItem, leftHand: HandItem): UnitParams => ({ ...PRESETS.swordsman, rightHand, leftHand });
const pitch = (u: UnitParams, t: number, joint: JointName) => attack.pose(t, u, 0.8).joints[joint]?.[0] ?? 0;

describe('per-hand items', () => {
  it('a bow empties the other hand', () => {
    expect(handItems(unit('sword', 'bow'))).toEqual({ L: 'bow', R: 'none' });
    expect(handItems(unit('bow', 'kiteShield'))).toEqual({ L: 'none', R: 'bow' });
    expect(handItems(unit('axe', 'axe'))).toEqual({ L: 'axe', R: 'axe' });
  });

  it('two weapons both strike, the left a beat behind', () => {
    const u = unit('axe', 'axe');
    expect(pitch(u, 0.5, 'shoulderR')).toBeGreaterThan(150);
    expect(pitch(u, 0.5, 'shoulderL')).toBeGreaterThan(100);
    expect(pitch(u, 0.5, 'shoulderL')).toBeLessThan(pitch(u, 0.5, 'shoulderR'));
  });

  it('weapon + shield: only the weapon arm attacks', () => {
    const u = unit('sword', 'kiteShield');
    expect(pitch(u, 0.5, 'shoulderR')).toBeGreaterThan(150);
    expect(pitch(u, 0.5, 'shoulderL')).toBe(pitch(u, 0, 'shoulderL'));
  });

  it('a lone shield bashes, the empty hand stays put', () => {
    const u = unit('none', 'kiteShield');
    expect(pitch(u, 0.75, 'shoulderL')).toBeGreaterThan(80);
    expect(pitch(u, 0.75, 'shoulderR')).toBe(pitch(u, 0, 'shoulderR'));
  });

  it('empty hands punch with the right', () => {
    expect(pitch(unit('none', 'none'), 0.75, 'shoulderR')).toBeGreaterThan(80);
  });

  it('a right-hand bow is drawn with the left', () => {
    expect(pitch(unit('bow', 'none'), 0.5, 'elbowL')).toBeGreaterThan(120);
    expect(pitch(unit('none', 'bow'), 0.5, 'elbowR')).toBeGreaterThan(120);
  });

  it('a crossbow leaves the other hand alone', () => {
    expect(handItems(unit('crossbow', 'kiteShield'))).toEqual({ L: 'kiteShield', R: 'crossbow' });
    expect(handItems(unit('sword', 'crossbow'))).toEqual({ L: 'crossbow', R: 'sword' });
  });

  it('a crossbow is aimed level, an empty other hand steadying it', () => {
    const j = attack.pose(0.5, unit('crossbow', 'none'), 0.8).joints;
    // shoulder + elbow + wrist = 180 (plus a little for the aim's yaw and roll): the stock is level
    expect(j.shoulderR![0] + j.elbowR![0] + j.handR![0]).toBeCloseTo(184);
    expect(j.shoulderL![0]).toBeGreaterThan(50);
  });

  it('a shield stays put while the crossbow shoots', () => {
    const u = unit('crossbow', 'kiteShield');
    expect(pitch(u, 0.5, 'shoulderL')).toBe(pitch(u, 0, 'shoulderL'));
    expect(pitch(u, 0.5, 'shoulderR')).toBeGreaterThan(60);
  });

  it('a left-hand crossbow mirrors the turn', () => {
    const yaw = (u: UnitParams) => attack.pose(0.5, u, 0.8).joints.spine![1];
    expect(yaw(unit('crossbow', 'none'))).not.toBe(0);
    expect(yaw(unit('none', 'crossbow'))).toBeCloseTo(-yaw(unit('crossbow', 'none')));
  });

  it('a left-led attack mirrors the body twist', () => {
    const yaw = (u: UnitParams) => attack.pose(0.5, u, 0.8).joints.spine![1];
    expect(yaw(unit('none', 'sword'))).toBeCloseTo(-yaw(unit('sword', 'none')));
  });
});

describe('poles', () => {
  // the pole's pitch: 180 is upright, 90 level in front
  const pole = (u: UnitParams, t: number) => pitch(u, t, 'shoulderR') + pitch(u, t, 'elbowR') + pitch(u, t, 'handR');

  it('blunt poles are swung like a staff, pointed ones thrust', () => {
    for (const i of ['banner', 'broom', 'rake', 'crook', 'fishingRod', 'staff'] as const) expect(itemKind(i)).toBe('staff');
    for (const i of ['spear', 'pitchfork', 'halberd'] as const) expect(itemKind(i)).toBe('thrust');
  });

  it('a staff is cocked back over the shoulder, then strikes level in front', () => {
    const u = unit('crook', 'none');
    expect(pole(u, 0)).toBeCloseTo(180);
    expect(pole(u, 0.3)).toBeGreaterThan(200);
    expect(pole(u, 0.75)).toBeGreaterThan(70);
    expect(pole(u, 0.75)).toBeLessThan(120);
  });

  it('a spear still thrusts, levelled', () => {
    expect(pitch(unit('spear', 'none'), 0.5, 'handR')).toBe(0);
  });
});

describe('two-handed weapons', () => {
  const mats = new MaterialLibrary();

  it('empty the other hand; with two, the left wins', () => {
    expect(handItems(unit('greatsword', 'kiteShield'))).toEqual({ L: 'none', R: 'greatsword' });
    expect(handItems(unit('sword', 'maul'))).toEqual({ L: 'maul', R: 'none' });
    expect(handItems(unit('greataxe', 'bow'))).toEqual({ L: 'bow', R: 'none' });
    expect(handItems(unit('scythe', 'kiteShield'))).toEqual({ L: 'none', R: 'scythe' });
    expect(itemKind('sickle')).toBe('chop');
  });

  // the other fist closes on the grip in every frame it should, whatever the lead arm does
  const bodies: [string, UnitParams][] = [
    ['champion', PRESETS.champion],
    ['crusher', PRESETS.crusher],
  ];
  for (const [name, body] of bodies) {
    for (const item of ['greatsword', 'maul', 'greataxe', 'scythe'] as HeavyItem[]) {
      for (const lead of ['R', 'L'] as const) {
        it(`${name}: both hands on the ${item}, ${lead} leading`, () => {
          const u: UnitParams = { ...body, rightHand: lead === 'R' ? item : 'none', leftHand: lead === 'L' ? item : 'none' };
          const other = lead === 'R' ? 'L' : 'R';
          const h = buildHumanoid(u, mats);
          for (const anim of humanoidAnimations()) {
            if (anim.name === 'death' || anim.name === 'carry') continue;
            for (let i = 0; i < anim.frames; i++) {
              applyPose(h, anim.pose(frameTime(anim, i), u, h.hipHeight));
              h.root.updateMatrixWorld(true);
              const grip = h.joints[`hand${lead}`].localToWorld(new Vector3(0, SECOND_GRIP[item], 0));
              const fist = h.joints[`hand${other}`].localToWorld(new Vector3());
              expect(fist.distanceTo(grip), `${anim.name} frame ${i}`).toBeLessThan(0.01);
              const turn = h.joints[`hand${lead}`].getWorldQuaternion(new Quaternion()).angleTo(h.joints[`hand${other}`].getWorldQuaternion(new Quaternion()));
              expect(turn, `${anim.name} frame ${i}`).toBeLessThan(0.01);
            }
          }
          disposeHumanoid(h);
        });
      }
    }
  }

  it('a maul is heaved up overhead', () => {
    // the grip may move the lead arm too, so look at where the fist ends up, not its angles
    const u = unit('maul', 'none');
    const h = buildHumanoid(u, mats);
    applyPose(h, attack.pose(0.5, u, h.hipHeight));
    h.root.updateMatrixWorld(true);
    const fist = h.joints.handR.localToWorld(new Vector3());
    expect(fist.y).toBeGreaterThan(h.joints.head.localToWorld(new Vector3()).y);
    disposeHumanoid(h);
  });

  it('a greatsword sweeps across, the torso turning through it, mirrored for the left hand', () => {
    const yaw = (u: UnitParams, t: number) => attack.pose(t, u, 0.8).joints.spine![1];
    const right = unit('greatsword', 'none');
    expect(Math.sign(yaw(right, 0.3))).toBe(-Math.sign(yaw(right, 0.75)));
    expect(Math.abs(yaw(right, 0.75))).toBeGreaterThan(30);
    expect(yaw(unit('none', 'greatsword'), 0.75)).toBeCloseTo(-yaw(right, 0.75));
  });
});

describe('thrown weapons', () => {
  it('leave the other hand alone', () => {
    expect(handItems(unit('javelin', 'roundShield'))).toEqual({ L: 'roundShield', R: 'javelin' });
  });

  it('leave the hand after the release, and another is drawn by the end', () => {
    for (const [r, l, hand] of [['javelin', 'none', 'R'], ['none', 'bomb', 'L'], ['throwingAxe', 'kiteShield', 'R']] as const) {
      const thrown = (t: number) => attack.pose(t, unit(r, l), 0.8).thrown;
      expect(thrown(0.75)).toBe(hand);
      for (const t of [0, 0.25, 0.5, 1]) expect(thrown(t)).toBeUndefined();
    }
  });

  it('hide the thrown item, and only that one', () => {
    const u = buildHumanoid(unit('javelin', 'roundShield'), new MaterialLibrary());
    applyPose(u, attack.pose(0.75, unit('javelin', 'roundShield'), u.hipHeight));
    expect(u.grips.R.visible).toBe(false);
    expect(u.grips.L.visible).toBe(true);
    applyPose(u, attack.pose(1, unit('javelin', 'roundShield'), u.hipHeight));
    expect(u.grips.R.visible).toBe(true);
    disposeHumanoid(u);
  });

  it('cock a javelin back overhead, held level and point-first', () => {
    const j = attack.pose(0.25, unit('javelin', 'none'), 0.8).joints;
    expect(j.shoulderR![0]).toBeGreaterThan(140);
    // 90 is level: the point tips up a little for distance
    expect(j.shoulderR![0] + j.elbowR![0] + j.handR![0]).toBeCloseTo(100);
  });

  it('lob a bomb underarm, the empty hand pointing at the target', () => {
    const u = unit('bomb', 'none');
    expect(pitch(u, 0.3, 'shoulderR')).toBeLessThan(0);
    expect(pitch(u, 0.6, 'shoulderR')).toBeGreaterThan(90);
    expect(pitch(u, 0.25, 'shoulderL')).toBeGreaterThan(50);
  });
});

describe('firearms', () => {
  const total = (j: Record<string, number[] | undefined>, h: 'L' | 'R') => j[`shoulder${h}`]![0] + j[`elbow${h}`]![0] + j[`hand${h}`]![0];

  it('a musket takes both hands, aimed level from the shoulder, the other hand steadying it', () => {
    expect(handItems(unit('musket', 'kiteShield'))).toEqual({ L: 'none', R: 'musket' });
    const j = attack.pose(0.5, unit('musket', 'kiteShield'), 0.8).joints;
    expect(total(j, 'R')).toBeCloseTo(184);
    expect(j.shoulderL![0]).toBeGreaterThan(50);
  });

  it('a pistol is held out level at arm\'s length, the empty hand behind the back', () => {
    expect(handItems(unit('pistol', 'sabre'))).toEqual({ L: 'sabre', R: 'pistol' });
    const j = attack.pose(0.5, unit('pistol', 'none'), 0.8).joints;
    expect(j.shoulderR![0]).toBeGreaterThan(70);
    expect(total(j, 'R')).toBeCloseTo(93);
    expect(j.shoulderL![0]).toBeLessThan(0);
    // a sabre stays put
    const u = unit('pistol', 'sabre');
    expect(pitch(u, 0.5, 'shoulderL')).toBe(pitch(u, 0, 'shoulderL'));
  });

  it('a left-hand pistol mirrors the turn', () => {
    const yaw = (u: UnitParams) => attack.pose(0.5, u, 0.8).joints.spine![1];
    expect(yaw(unit('pistol', 'none'))).not.toBe(0);
    expect(yaw(unit('none', 'pistol'))).toBeCloseTo(-yaw(unit('pistol', 'none')));
  });

  it('flash on the shot, smoke after; a crossbow neither', () => {
    for (const [r, l, hand] of [['pistol', 'none', 'R'], ['none', 'musket', 'L']] as const) {
      const muzzle = (t: number) => attack.pose(t, unit(r, l), 0.8).muzzle?.[hand];
      expect(muzzle(0.75)).toBe('flash');
      expect(muzzle(1)).toBe('smoke');
      expect(muzzle(0)).toBeUndefined();
      expect(muzzle(0.5)).toBeUndefined();
    }
    expect(attack.pose(0.75, unit('crossbow', 'none'), 0.8).muzzle?.R).toBeUndefined();
  });

  it('a second pistol fires a beat later', () => {
    const muzzle = attack.pose(0.57, unit('pistol', 'pistol'), 0.8).muzzle!;
    expect(muzzle.R).toBe('flash');
    expect(muzzle.L).toBeUndefined();
  });

  it('shows the flash and smoke on the model only when fired', () => {
    const u = unit('pistol', 'none');
    const h = buildHumanoid(u, new MaterialLibrary());
    expect(h.muzzles.R).toBeDefined();
    expect(h.muzzles.L).toBeUndefined();
    applyPose(h, attack.pose(0, u, h.hipHeight));
    expect(h.muzzles.R!.flash.visible).toBe(false);
    applyPose(h, attack.pose(0.75, u, h.hipHeight));
    expect(h.muzzles.R!.flash.visible).toBe(true);
    expect(h.muzzles.R!.smoke.visible).toBe(false);
    applyPose(h, attack.pose(1, u, h.hipHeight));
    expect(h.muzzles.R!.smoke.visible).toBe(true);
    disposeHumanoid(h);
  });
});

describe('cast', () => {
  const caster = { ...PRESETS.mage };
  const castAnim = () => humanoidAnimations().find((a) => a.name === 'cast')!;

  it('is in every sheet', () => {
    expect(humanoidAnimations().map((a) => a.name)).toContain('cast');
  });

  it('raises both hands with the spell overhead, then flings it forward', () => {
    const top = castAnim().pose(0.45, caster, 0.8);
    expect(top.joints.shoulderL![0]).toBeGreaterThan(150);
    expect(top.joints.shoulderR![0]).toBeGreaterThan(150);
    const release = castAnim().pose(0.7, caster, 0.8);
    expect(release.fx!.pos[2]).toBeGreaterThan(top.fx!.pos[2]);
    expect(release.fx!.scale).toBeGreaterThan(top.fx!.scale);
  });

  it('raises the spell higher with longer arms', () => {
    const overhead = (armLength: number) => castAnim().pose(0.45, { ...caster, armLength }, 0.8).fx!.pos[1];
    expect(overhead(1.3)).toBeGreaterThan(overhead(1));
  });

  it('shows no effect before and after', () => {
    expect(castAnim().pose(0, caster, 0.8).fx!.scale).toBe(0);
    expect(castAnim().pose(1, caster, 0.8).fx!.scale).toBe(0);
  });
});

describe('channel', () => {
  const caster = { ...PRESETS.mage };
  const channel = humanoidAnimations().find((a) => a.name === 'channel')!;

  it('loops, and comes after the older rows so their positions in a sheet stay put', () => {
    const names = humanoidAnimations().map((a) => a.name);
    expect(names.slice(0, 6)).toEqual(['idle', 'walk', 'attack', 'cast', 'death', 'channel']);
    expect(channel.loop).toBe(true);
  });

  it('holds both hands out in front with the spell always lit', () => {
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const p = channel.pose(t, caster, 0.8);
      expect(p.joints.shoulderL![0]).toBeGreaterThan(60);
      expect(p.joints.shoulderR![0]).toBeGreaterThan(60);
      expect(p.fx!.scale).toBeGreaterThan(0.5);
      expect(p.fx!.pos[2]).toBeGreaterThan(0.4);
    }
  });

  it('closes the loop: t = 1 matches t = 0, sparks a quarter turn on', () => {
    const a = channel.pose(0, caster, 0.8);
    const b = channel.pose(1, caster, 0.8);
    for (const [name, rot] of Object.entries(a.joints)) {
      rot.forEach((v, i) => expect(b.joints[name as JointName]![i]).toBeCloseTo(v));
    }
    expect(b.fx!.scale).toBeCloseTo(a.fx!.scale);
    expect(b.fx!.spin! - a.fx!.spin!).toBe(90);
  });

  it('keeps a staff upright', () => {
    const u = unit('staff', 'none');
    for (const t of [0, 0.25, 0.5]) {
      const j = channel.pose(t, u, 0.8).joints;
      expect(j.shoulderR![0] + j.elbowR![0] + j.handR![0]).toBeCloseTo(180);
    }
  });
});

describe('cast blends with idle', () => {
  it('starts and ends in the idle stance', () => {
    const anims = humanoidAnimations();
    const idle = anims.find((a) => a.name === 'attack')!.pose(0, PRESETS.mage, 0.8).joints;
    const cast = anims.find((a) => a.name === 'cast')!;
    for (const t of [0, 1]) {
      const j = cast.pose(t, PRESETS.mage, 0.8).joints;
      for (const name of ['shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR'] as const) {
        expect(j[name]).toEqual(idle[name]);
      }
    }
  });
});

describe('orb', () => {
  it('a lone orb is thrust forward; a weapon takes precedence', () => {
    const orbOnly = unit('none', 'orb');
    expect(pitch(orbOnly, 0.75, 'shoulderL')).toBeGreaterThan(80);
    expect(pitch(orbOnly, 0.75, 'shoulderR')).toBe(pitch(orbOnly, 0, 'shoulderR'));
    const withSword = unit('sword', 'orb');
    expect(pitch(withSword, 0.75, 'shoulderL')).toBe(pitch(withSword, 0, 'shoulderL'));
  });

  it('stays above the palm while casting', () => {
    const u = unit('orb', 'none');
    const cast = humanoidAnimations().find((a) => a.name === 'cast')!;
    for (const t of [0.45, 0.7]) {
      const j = cast.pose(t, u, 0.8).joints;
      // shoulder + elbow + wrist = 90: the hand's up axis points at the sky
      expect(j.shoulderR![0] + j.elbowR![0] + j.handR![0]).toBeCloseTo(90);
    }
  });
});

describe('cape motion', () => {
  const anims = humanoidAnimations();
  const flare = (name: string, t: number) => -anims.find((a) => a.name === name)!.pose(t, PRESETS.mage, 0.8).joints.cape![0];

  it('is set by every animation and always lifts backward', () => {
    for (const a of anims) {
      for (const t of [0, 0.25, 0.5, 0.75]) expect(flare(a.name, t)).toBeGreaterThanOrEqual(0);
    }
  });

  it('streams further back when walking than when standing', () => {
    expect(flare('walk', 0.25)).toBeGreaterThan(flare('idle', 0.25));
  });
});

describe('hit, run, work and carry', () => {
  const anims = humanoidAnimations();
  const anim = (name: string) => anims.find((a) => a.name === name)!;

  it('come after the older rows, hit as a one-shot and the rest looping', () => {
    expect(anims.map((a) => a.name).slice(6, 10)).toEqual(['hit', 'run', 'work', 'carry']);
    expect(anim('hit').loop).toBe(false);
    for (const name of ['run', 'work', 'carry']) expect(anim(name).loop).toBe(true);
  });

  it('close their loops in every gait, and hit recovers to where it started', () => {
    for (const gait of GAITS) {
      const u = { ...PRESETS.worker, gait };
      for (const name of ['hit', 'run', 'work', 'carry', 'taunt']) {
        const a = anim(name).pose(0, u, 0.8);
        const b = anim(name).pose(1, u, 0.8);
        for (const [joint, rot] of Object.entries(a.joints)) {
          rot.forEach((v, i) => expect(b.joints[joint as JointName]![i]).toBeCloseTo(v));
        }
        a.hips!.forEach((v, i) => expect(b.hips![i]).toBeCloseTo(v));
      }
    }
  });

  it('hit throws the body back', () => {
    const p = anim('hit').pose(0.25, PRESETS.swordsman, 0.8);
    expect(p.joints.spine![0]).toBeGreaterThan(5);
    expect(p.hips![2]).toBeLessThan(0);
  });

  it('runs with longer strides than it walks', () => {
    const stride = (name: string) => anim(name).pose(0.25, PRESETS.swordsman, 0.8).joints.hipL![0] - anim(name).pose(0.75, PRESETS.swordsman, 0.8).joints.hipL![0];
    expect(stride('run')).toBeGreaterThan(stride('walk') * 1.3);
  });

  it('work raises the tool overhead, the empty hand gripping it too', () => {
    const top = anim('work').pose(0.35, PRESETS.worker, 0.8).joints;
    expect(top.shoulderR![0]).toBeGreaterThan(150);
    expect(top.shoulderL![0]).toBeGreaterThan(150);
    // a shield stays where it is
    const u = unit('hammer', 'kiteShield');
    expect(pitch(u, 0, 'shoulderL')).toBe(anim('work').pose(0.35, u, 0.8).joints.shoulderL![0]);
  });

  it('works with a left-hand tool', () => {
    const j = anim('work').pose(0.35, unit('none', 'pickaxe'), 0.8).joints;
    expect(j.shoulderL![0]).toBeGreaterThan(150);
  });

  it('carries the sack on the shoulder of the empty hand', () => {
    const load = (u: UnitParams) => anim('carry').pose(0.5, u, 0.8).load;
    expect(load(PRESETS.worker)).toBe('L');
    expect(load(unit('none', 'kiteShield'))).toBe('R');
    expect(load(unit('none', 'none'))).toBe('L');
    for (const name of ['idle', 'walk', 'run', 'work']) expect(anim(name).pose(0.5, PRESETS.worker, 0.8).load).toBeUndefined();
  });

  it('shows the sack only while carrying, over the shoulder the pose names', () => {
    const u = buildHumanoid(PRESETS.worker, new MaterialLibrary());
    applyPose(u, anim('walk').pose(0, PRESETS.worker, u.hipHeight));
    expect(u.load.visible).toBe(false);
    applyPose(u, { ...anim('carry').pose(0, PRESETS.worker, u.hipHeight), load: 'L' });
    expect(u.load.visible).toBe(true);
    const left = u.load.position.x;
    applyPose(u, { ...anim('carry').pose(0, PRESETS.worker, u.hipHeight), load: 'R' });
    expect(u.load.position.x).toBeCloseTo(-left);
    expect(left).toBeGreaterThan(0);
    disposeHumanoid(u);
  });
});

describe('taunt', () => {
  const taunt = humanoidAnimations().find((a) => a.name === 'taunt')!;

  it('is a one-shot after carry', () => {
    expect(humanoidAnimations().map((a) => a.name).slice(-2)).toEqual(['carry', 'taunt']);
    expect(taunt.loop).toBe(false);
  });

  it('starts and ends in the attack stance', () => {
    const stance = attack.pose(0, PRESETS.swordsman, 0.8).joints;
    for (const t of [0, 1]) {
      const j = taunt.pose(t, PRESETS.swordsman, 0.8).joints;
      for (const name of ['shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR'] as const) {
        j[name]!.forEach((v, i) => expect(v).toBeCloseTo(stance[name]![i]));
      }
    }
  });

  it('raises the weapon overhead and holds it upright', () => {
    const j = taunt.pose(0.25, PRESETS.swordsman, 0.8).joints;
    expect(j.shoulderR![0]).toBeGreaterThan(150);
    expect(j.shoulderR![0] + j.elbowR![0] + j.handR![0]).toBeCloseTo(180);
    // the shield stays where it is
    expect(j.shoulderL).toEqual(attack.pose(0, PRESETS.swordsman, 0.8).joints.shoulderL);
  });

  it('beckons with an empty other hand, and raises a left-hand weapon', () => {
    const elbow = (t: number) => taunt.pose(t, unit('axe', 'none'), 0.8).joints.elbowL![0];
    expect(elbow(0.45)).toBeGreaterThan(elbow(0.3) + 50);
    expect(taunt.pose(0.25, unit('none', 'axe'), 0.8).joints.shoulderL![0]).toBeGreaterThan(150);
  });
});
