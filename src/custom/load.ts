import { LoadingManager, Mesh, type AnimationClip, type Object3D } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'fbx', 'obj'];

export interface LoadedFile {
  /** The model file's name without its extension. */
  name: string;
  scene: Object3D;
  clips: AnimationClip[];
  /** False for animation-only files, like Mixamo's "without skin" downloads. */
  hasMeshes: boolean;
}

const ext = (f: { name: string }) => f.name.split('.').pop()!.toLowerCase();
const baseName = (path: string) => decodeURIComponent(path.split(/[\\/]/).pop()!.split('?')[0]);

/**
 * Parses the first model file among `files`. The rest (a .gltf's .bin, textures) are served to
 * the loader by file name, so a model and its side files can be picked or dropped together.
 */
export async function loadModelFiles(files: File[]): Promise<LoadedFile> {
  const main = files.find((f) => MODEL_EXTENSIONS.includes(ext(f)));
  if (!main) throw new Error(`no model file (${MODEL_EXTENSIONS.map((e) => '.' + e).join(', ')})`);

  const urls = new Map(files.filter((f) => f !== main).map((f) => [f.name, URL.createObjectURL(f)]));
  const manager = new LoadingManager();
  manager.setURLModifier((url) => urls.get(baseName(url)) ?? url);
  // FBX and OBJ textures load after parse() returns; wait for them so their colours can be read
  let started = false;
  manager.onStart = () => (started = true);
  const settled = new Promise<void>((resolve) => (manager.onLoad = resolve));

  try {
    const name = main.name.replace(/\.[^.]+$/, '');
    let scene: Object3D;
    let clips: AnimationClip[];
    switch (ext(main)) {
      case 'glb':
      case 'gltf': {
        const gltf = await new GLTFLoader(manager).parseAsync(await main.arrayBuffer(), '');
        scene = gltf.scene;
        clips = gltf.animations;
        break;
      }
      case 'fbx':
        scene = new FBXLoader(manager).parse(await main.arrayBuffer(), '');
        clips = scene.animations;
        break;
      default:
        scene = new OBJLoader(manager).parse(await main.text());
        clips = [];
    }
    if (started) await settled;
    let hasMeshes = false;
    scene.traverse((o) => (hasMeshes ||= o instanceof Mesh));
    return { name, scene, clips: clips.map((c) => renameClip(c, name, clips.length)), hasMeshes };
  } finally {
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
}

/**
 * Gives clips names worth showing: Blender's "Armature|Walk" becomes "Walk", and the lone,
 * generically named clip in a Mixamo or similar download takes the file's name.
 */
function renameClip(clip: AnimationClip, fileName: string, clipsInFile: number): AnimationClip {
  let name = clip.name.split('|').pop()!.trim();
  if (!name || (clipsInFile === 1 && /^(mixamo\.com|take\s*\d*|anim(ation)?|default|scene)$/i.test(name))) name = fileName;
  clip.name = name;
  return clip;
}
