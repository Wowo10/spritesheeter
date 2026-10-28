import {
  AnimationClip,
  Bone,
  Box3,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';
import { CustomModel, guessRamp, guessRows, nearestRamp, withoutDrift } from '../src/custom/model';
import { MaterialLibrary } from '../src/render/materials';

const mats = new MaterialLibrary();

/** A 1×2×1 box floating off-centre, with a node that a clip slides forward by 2 over 1 s. */
function scene() {
  const root = new Group();
  const body = new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial({ color: 0xb82424, name: 'Cloth' }));
  body.name = 'body';
  body.position.set(3, 5, -1);
  root.add(body);
  const walk = new AnimationClip('Walking', 1, [
    new VectorKeyframeTrack('body.position', [0, 0.5, 1], [3, 5, -1, 3, 5.5, 0, 3, 5, 1]),
  ]);
  const wave = new AnimationClip('Wave', 1, [new NumberKeyframeTrack('body.scale[x]', [0, 1], [1, 3])]);
  return { root, body, clips: [walk, wave] };
}

const heightOf = (o: Group) => {
  o.updateMatrixWorld(true);
  return new Box3().setFromObject(o);
};

describe('custom model', () => {
  it('stands on the origin, centred, at the requested height', () => {
    const { root, clips } = scene();
    const m = new CustomModel('box', root, clips, mats);
    m.setHeight(1.8);
    const box = heightOf(m.root);
    expect(box.max.y - box.min.y).toBeCloseTo(1.8);
    expect(box.min.y).toBeCloseTo(0);
    const c = box.getCenter(new Vector3());
    expect(c.x).toBeCloseTo(0);
    expect(c.z).toBeCloseTo(0);
  });

  it('draws each source material with its nearest palette ramp', () => {
    const { root, body, clips } = scene();
    const m = new CustomModel('box', root, clips, mats);
    expect(m.materials.map((x) => [x.name, x.ramp])).toEqual([['Cloth', 'red']]);
    expect(body.material).toBe(mats.get('red'));
    m.setRamp(m.materials[0], 'team');
    expect(body.material).toBe(mats.get('team'));
  });

  it('samples clips and returns to the bind pose without one', () => {
    const { root, body, clips } = scene();
    const m = new CustomModel('box', root, clips, mats);
    m.sample(m.clip('Wave')!, 0.5, false);
    expect(body.scale.x).toBeCloseTo(2);
    m.sample(m.clip('Wave')!, 1, false);
    expect(body.scale.x).toBeCloseTo(3);
    m.sample(null, 0, true);
    expect(body.scale.x).toBe(1);
    expect(body.position.z).toBe(-1);
  });

  it('plays looping clips in place, keeping the motion within the loop', () => {
    const { root, body, clips } = scene();
    const m = new CustomModel('box', root, clips, mats);
    m.sample(m.clip('Walking')!, 0.5, true);
    expect(body.position.z).toBeCloseTo(-1);
    expect(body.position.y).toBeCloseTo(5.5);
    // one-shots keep their travel
    m.sample(m.clip('Walking')!, 0.5, false);
    expect(body.position.z).toBeCloseTo(0);
  });

  it('measures skinned meshes in their bind pose', () => {
    const geo = new BoxGeometry(1, 4, 1);
    const n = geo.getAttribute('position').count;
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const mesh = new SkinnedMesh(geo, new MeshStandardMaterial());
    const bone = new Bone();
    mesh.add(bone);
    mesh.bind(new Skeleton([bone]));
    const root = new Group();
    root.add(mesh);
    const m = new CustomModel('rig', root, [], mats);
    m.setHeight(2);
    const box = heightOf(m.root);
    expect(box.min.y).toBeCloseTo(0);
  });

  it('renames clashing clip names', () => {
    const { root, clips } = scene();
    const m = new CustomModel('box', root, clips, mats);
    const [added] = m.addClips([new AnimationClip('Walking', 1, [])]);
    expect(added.name).toBe('Walking 2');
    expect(m.clips.map((c) => c.name)).toEqual(['Walking', 'Wave', 'Walking 2']);
  });
});

describe('withoutDrift', () => {
  it('leaves a loop that already closes alone', () => {
    const clip = new AnimationClip('c', 1, [new VectorKeyframeTrack('a.position', [0, 0.5, 1], [0, 0, 0, 1, 2, 3, 0, 0, 0])]);
    expect([...withoutDrift(clip).tracks[0].values]).toEqual([0, 0, 0, 1, 2, 3, 0, 0, 0]);
  });

  it('does not touch the original clip', () => {
    const clip = new AnimationClip('c', 1, [new VectorKeyframeTrack('a.position', [0, 1], [0, 0, 0, 0, 0, 4])]);
    withoutDrift(clip);
    expect([...clip.tracks[0].values]).toEqual([0, 0, 0, 0, 0, 4]);
  });
});

describe('guessing', () => {
  it('maps clip names to sheet rows', () => {
    expect(guessRows(['Running', 'Idle', 'Walking', 'Sword Slash', 'Hit Reaction', 'Dying'])).toEqual({
      idle: 'Idle',
      walk: 'Walking',
      attack: 'Sword Slash',
      cast: null,
      death: 'Dying',
      channel: null,
    });
  });

  it('keeps channelled spells off the cast row', () => {
    const rows = guessRows(['Spell Cast', 'Channel Spell']);
    expect(rows.cast).toBe('Spell Cast');
    expect(rows.channel).toBe('Channel Spell');
  });

  it('puts an unrecognised clip on the idle row rather than none', () => {
    expect(guessRows(['Foo', 'Bar']).idle).toBe('Foo');
    expect(guessRows([]).idle).toBeNull();
  });

  it('picks ramps by colour, and the team ramp only by name', () => {
    expect(nearestRamp([150, 160, 175])).toBe('steel');
    expect(nearestRamp([190, 40, 40])).toBe('red');
    expect(guessRamp('TeamColor', [10, 200, 10])).toBe('team');
    expect(guessRamp('Glow', [255, 120, 20], true)).toBe('fire');
  });
});
