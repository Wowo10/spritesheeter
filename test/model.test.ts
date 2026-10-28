import { Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { beastAnimations } from '../src/anim/beast-anims';
import { humanoidAnimations } from '../src/anim/humanoid-anims';
import { bakeModel, exportGlb, rowDuration, type ModelAnimation } from '../src/export/model';
import { MaterialLibrary } from '../src/render/materials';
import { teamRgb } from '../src/render/palette';
import { applyBeastPose, buildBeast } from '../src/unit/beast';
import { BEAST_PRESETS } from '../src/unit/beast-params';
import { applyPose, buildHumanoid } from '../src/unit/humanoid';
import { PRESETS } from '../src/unit/params';

// GLTFExporter reads its binary output through a FileReader, which Node lacks
class NodeFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
}
(globalThis as { FileReader?: unknown }).FileReader ??= NodeFileReader;

const mats = new MaterialLibrary();
const worker = { ...PRESETS.worker, shadow: true };

function humanoid() {
  const u = buildHumanoid(worker, mats);
  const anims: ModelAnimation[] = humanoidAnimations().map((a) => ({
    name: a.name,
    duration: rowDuration(a.frames, a.fps, a.loop),
    apply: (t) => applyPose(u, a.pose(t, worker, u.hipHeight)),
  }));
  return { root: u.root, anims };
}

const byName = (root: Object3D, name: string) => root.getObjectByName(name)!;

describe('model export', () => {
  it('times rows like the sheet', () => {
    expect(rowDuration(5, 8, true)).toBeCloseTo(5 / 8);
    expect(rowDuration(5, 8, false)).toBeCloseTo(4 / 8);
    expect(rowDuration(1, 8, false)).toBeCloseTo(1 / 8);
  });

  it('bakes one clip per animation, each as long as its row', () => {
    const { root, anims } = humanoid();
    const { clips } = bakeModel(root, anims, { team: 'blue', opacity: 1 });
    expect(clips.map((c) => c.name)).toEqual(humanoidAnimations().map((a) => a.name));
    clips.forEach((c, i) => expect(c.duration).toBeCloseTo(anims[i].duration));
    const walk = clips.find((c) => c.name === 'walk')!;
    expect(walk.tracks.some((t) => t.name === 'hipL.quaternion')).toBe(true);
  });

  it('closes loops: the last key repeats the first', () => {
    const { root, anims } = humanoid();
    const walk = bakeModel(root, anims, { team: 'red', opacity: 1 }).clips.find((c) => c.name === 'walk')!;
    const track = walk.tracks.find((t) => t.name === 'hipL.quaternion')!;
    const n = track.values.length;
    for (let i = 0; i < 4; i++) expect(track.values[n - 4 + i]).toBeCloseTo(track.values[i]);
  });

  it('keeps hidden parts at zero scale, showing the sack only while carrying', () => {
    const { root, anims } = humanoid();
    const { model, clips } = bakeModel(root, anims, { team: 'red', opacity: 1 });
    expect(byName(model, 'load').scale.x).toBe(0);
    const scale = (clip: string) => clips.find((c) => c.name === clip)!.tracks.find((t) => t.name === 'load.scale')!.values[0];
    expect(scale('carry')).toBeGreaterThan(0);
    expect(scale('walk')).toBe(0);
  });

  it('drops the shadow and colours materials from the palette, team ramp in the team colour', () => {
    const { root, anims } = humanoid();
    const { model } = bakeModel(root, anims, { team: 'blue', opacity: 1 });
    const meshes: Mesh[] = [];
    model.traverse((o) => o instanceof Mesh && meshes.push(o));
    expect(meshes.some((m) => m.name === 'shadow')).toBe(false);
    expect(meshes.every((m) => m.material instanceof MeshStandardMaterial)).toBe(true);
    const team = meshes.map((m) => m.material as MeshStandardMaterial).find((m) => m.name === 'team')!;
    const [r, g, b] = teamRgb('blue')[2];
    expect(team.color.getHexString()).toBe(((r << 16) | (g << 8) | b).toString(16).padStart(6, '0'));
    // the live unit keeps its palette shader
    root.traverse((o) => o instanceof Mesh && expect(o.material).not.toBeInstanceOf(MeshStandardMaterial));
  });

  it('makes see-through units transparent', () => {
    const { root, anims } = humanoid();
    const { model } = bakeModel(root, anims, { team: 'red', opacity: 0.5 });
    model.traverse((o) => {
      if (o instanceof Mesh) expect((o.material as MeshStandardMaterial).opacity).toBe(0.5);
    });
  });

  it('bakes beasts too, with unique node names', () => {
    const p = BEAST_PRESETS.dragon;
    const b = buildBeast(p, mats);
    const anims = beastAnimations().map((a) => ({ name: a.name, duration: rowDuration(a.frames, a.fps, a.loop), apply: (t: number) => applyBeastPose(b, a.pose(t, p, b.hipHeight)) }));
    const { model, clips } = bakeModel(b.root, anims, { team: 'red', opacity: 1 });
    const names: string[] = [];
    model.traverse((o) => !(o instanceof Mesh) && o !== model && names.push(o.name));
    expect(new Set(names).size).toBe(names.length);
    expect(clips.find((c) => c.name === 'taunt')!.tracks.some((t) => t.name === 'wingL.quaternion')).toBe(true);
  });

  it('writes a GLB that loads back with its clips', async () => {
    const { root, anims } = humanoid();
    const glb = await exportGlb(root, anims, { team: 'red', opacity: 1 });
    const gltf = await new GLTFLoader().parseAsync(glb, '');
    expect(gltf.animations.map((a) => a.name)).toEqual(anims.map((a) => a.name));
    expect(gltf.scene.getObjectByName('hipL')).toBeTruthy();
  });
});
