import { Box3, Mesh, Vector3, type Object3D } from 'three';

export const PORTRAIT_SIZES = [32, 48, 64, 96];
export const PORTRAIT_BACKGROUNDS = ['none', 'dark', 'team'] as const;
export type PortraitBackground = (typeof PORTRAIT_BACKGROUNDS)[number];

export interface PortraitSettings {
  /** Square frame size, in pixels. */
  size: number;
  /** Above 1 crops in closer, below 1 shows more of the body. */
  zoom: number;
  /** Unit yaw in degrees; 0 faces the camera, negative turns it to the viewer's left, its weapon hand away. */
  turn: number;
  /** Camera angle above the ground, in degrees; kept low so the face shows. */
  elevation: number;
  /** 1 is a still; more samples the idle row as a looping strip. */
  frames: number;
  background: PortraitBackground;
  /** A 1 px bevelled edge around the frame. */
  border: boolean;
}

export const DEFAULT_PORTRAIT: PortraitSettings = {
  size: 64,
  zoom: 1,
  turn: -30,
  elevation: 10,
  frames: 1,
  background: 'dark',
  border: true,
};

/** A head to close in on: its joint, and where and how big the skull is in the joint's space. */
export interface PortraitHead {
  joint: Object3D;
  center: [number, number, number];
  size: number;
}

/** The frame spans this many skull sizes, so the shoulders fit below the head. */
const HEAD_SPANS = 3;
/** How far below the skull's middle the frame is centred, as a fraction of its span. */
const SHOULDER_DROP = 0.2;
/** Room left above a tall hat, as a fraction of the span. */
const HAT_MARGIN = 0.04;
/** Room around a subject without a head, which is framed whole. */
const WHOLE_MARGIN = 1.1;

/** World-space bounds of what's drawn under `root`: hidden parts and the ground shadow aside. */
export function visibleBounds(root: Object3D): Box3 {
  const box = new Box3();
  const visit = (o: Object3D) => {
    if (!o.visible || o.name === 'shadow') return;
    if (o instanceof Mesh) box.expandByObject(o);
    o.children.forEach(visit);
  };
  visit(root);
  return box;
}

/**
 * Where the portrait camera looks and how much it shows (world units, square), from the
 * subject's current pose. With a head it's a head-and-shoulders crop sized by the skull, so
 * every unit's face comes out the same size whatever it wears and however it's turned; the
 * frame rises to take in a tall hat, but never so far that the face drops below the middle.
 * Without a head (vehicles, buildings, custom models) the whole subject is framed.
 */
export function portraitFocus(root: Object3D, head: PortraitHead | null, zoom: number): { center: Vector3; span: number } {
  root.updateMatrixWorld(true);
  if (!head) {
    const box = visibleBounds(root);
    if (box.isEmpty()) return { center: new Vector3(), span: 1 };
    const size = box.getSize(new Vector3());
    return { center: box.getCenter(new Vector3()), span: (WHOLE_MARGIN * Math.max(size.x, size.y, size.z)) / zoom };
  }
  const span = (HEAD_SPANS * head.size) / zoom;
  const skull = head.joint.localToWorld(new Vector3(...head.center));
  const center = skull.clone();
  center.y -= SHOULDER_DROP * span;
  const worn = visibleBounds(head.joint);
  if (!worn.isEmpty()) center.y = Math.min(Math.max(center.y, worn.max.y + HAT_MARGIN * span - span / 2), skull.y);
  return { center, span };
}
