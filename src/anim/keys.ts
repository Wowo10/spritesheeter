import type { JointRot } from './types';

export type Key<T> = [time: number, value: T];

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Piecewise smoothstep interpolation between keyframes (times ascending, covering [0, 1]). */
export function keys(t: number, ks: Key<number>[]): number {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    const [t1, v1] = ks[i];
    if (t <= t1) {
      const [t0, v0] = ks[i - 1];
      return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
    }
  }
  return ks[ks.length - 1][1];
}

export function rotKeys(t: number, ks: Key<JointRot>[]): JointRot {
  return [0, 1, 2].map((c) => keys(t, ks.map(([kt, v]) => [kt, v[c]]))) as JointRot;
}
