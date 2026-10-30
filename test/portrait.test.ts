import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MaterialLibrary } from '../src/render/materials';
import { BEAST_PORTRAIT_TURN, DEFAULT_PORTRAIT, portraitFocus, visibleBounds, type PortraitHead } from '../src/render/portrait';
import { BEAST_PRESETS } from '../src/unit/beast-params';
import { buildBeast, disposeBeast, type Beast } from '../src/unit/beast';
import { buildHumanoid, disposeHumanoid, type Humanoid } from '../src/unit/humanoid';
import { buildMounted, disposeMounted, MOUNTED_PRESETS } from '../src/unit/mounted';
import { PRESETS, type UnitParams } from '../src/unit/params';
import { buildVehicle, disposeVehicle } from '../src/unit/vehicle';
import { VEHICLE_PRESETS } from '../src/unit/vehicle-params';

const mats = new MaterialLibrary();

const headOf = (rig: Humanoid | Beast): PortraitHead => ({ joint: rig.joints.head, ...rig.skull });

/** Builds a humanoid and hands it to `check` before disposing of it. */
function withHumanoid<T>(p: UnitParams, check: (h: Humanoid) => T): T {
  const h = buildHumanoid(p, mats);
  try {
    return check(h);
  } finally {
    disposeHumanoid(h);
  }
}

describe('portraitFocus', () => {
  it('frames a humanoid head and shoulders: the whole head, above the middle, but not the feet', () =>
    withHumanoid(PRESETS.swordsman, (h) => {
      const { center, span } = portraitFocus(h.root, headOf(h), 1);
      const head = visibleBounds(h.joints.head);
      expect(head.min.y).toBeGreaterThan(center.y - span / 2);
      expect(head.max.y).toBeLessThan(center.y + span / 2);
      expect((head.min.y + head.max.y) / 2).toBeGreaterThan(center.y);
      expect(center.y - span / 2).toBeGreaterThan(0);
    }));

  it('closes in with zoom', () =>
    withHumanoid(PRESETS.swordsman, (h) => {
      expect(portraitFocus(h.root, headOf(h), 2).span).toBeCloseTo(portraitFocus(h.root, headOf(h), 1).span / 2);
    }));

  it('keeps the face the same size whatever the unit wears or however it is turned', () => {
    const plain = withHumanoid({ ...PRESETS.swordsman, helmet: 'none' }, (h) => portraitFocus(h.root, headOf(h), 1).span);
    const wizard = withHumanoid({ ...PRESETS.swordsman, helmet: 'wizard' }, (h) => portraitFocus(h.root, headOf(h), 1).span);
    const turned = withHumanoid(PRESETS.swordsman, (h) => {
      h.root.rotation.y = 1;
      return portraitFocus(h.root, headOf(h), 1).span;
    });
    expect(wizard).toBeCloseTo(plain);
    expect(turned).toBeCloseTo(plain);
  });

  it('rises to take in a tall hat, keeping the face in the upper half', () =>
    withHumanoid({ ...PRESETS.swordsman, helmet: 'wizard' }, (h) => {
      const { center, span } = portraitFocus(h.root, headOf(h), 1);
      const plainY = withHumanoid({ ...PRESETS.swordsman, helmet: 'none' }, (p) => portraitFocus(p.root, headOf(p), 1).center.y);
      expect(center.y).toBeGreaterThan(plainY);
      const skull = h.joints.head.localToWorld(new Vector3(...h.skull.center));
      expect(skull.y).toBeGreaterThanOrEqual(center.y);
      expect(skull.y).toBeLessThan(center.y + span / 2);
    }));

  it("takes in a beast's snout, which grows the frame", () => {
    const short = buildBeast({ ...BEAST_PRESETS.wolf, snoutLength: 0.5 }, mats);
    const long = buildBeast({ ...BEAST_PRESETS.wolf, snoutLength: 2 }, mats);
    expect(portraitFocus(long.root, headOf(long), 1).span).toBeGreaterThan(portraitFocus(short.root, headOf(short), 1).span);
    // the snout points along +Z, so the frame moves forward with it
    expect(portraitFocus(long.root, headOf(long), 1).center.z).toBeGreaterThan(portraitFocus(short.root, headOf(short), 1).center.z);
    disposeBeast(short);
    disposeBeast(long);
  });

  it("shows a beast's face lengthwise at its portrait angle, still inside the frame", () => {
    const b = buildBeast({ ...BEAST_PRESETS.wolf, snoutLength: 2 }, mats);
    // the camera looks along -Z, so a face's width on screen is its spread in X
    const faceAt = (turn: number) => {
      b.root.rotation.y = (turn * Math.PI) / 180;
      const focus = portraitFocus(b.root, headOf(b), 1);
      return { focus, face: visibleBounds(b.joints.head) };
    };
    const nose = faceAt(DEFAULT_PORTRAIT.turn);
    const { focus, face } = faceAt(DEFAULT_PORTRAIT.turn + BEAST_PORTRAIT_TURN);
    expect(face.max.x - face.min.x).toBeGreaterThan(nose.face.max.x - nose.face.min.x);
    expect(face.min.x).toBeGreaterThan(focus.center.x - focus.span / 2);
    expect(face.max.x).toBeLessThan(focus.center.x + focus.span / 2);
    disposeBeast(b);
  });

  it("follows a mounted rider's head, up on the saddle", () => {
    const m = buildMounted(MOUNTED_PRESETS.knight, mats);
    const { center, span } = portraitFocus(m.root, headOf(m.rider), 1);
    const head = visibleBounds(m.rider.joints.head);
    expect(head.max.y).toBeLessThan(center.y + span / 2);
    expect(head.min.y).toBeGreaterThan(center.y - span / 2);
    expect(head.min.y).toBeGreaterThan(m.beast.hipHeight);
    disposeMounted(m);
  });

  it('frames a subject without a head whole', () => {
    const v = buildVehicle(VEHICLE_PRESETS.catapult, mats);
    const { center, span } = portraitFocus(v.root, null, 1);
    const box = visibleBounds(v.root);
    for (const axis of ['x', 'y'] as const) {
      expect(box.min[axis]).toBeGreaterThanOrEqual(center[axis] - span / 2);
      expect(box.max[axis]).toBeLessThanOrEqual(center[axis] + span / 2);
    }
    disposeVehicle(v);
  });
});
