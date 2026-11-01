// The few Node APIs the benchmark's TypeScript uses, so it typechecks without @types/node
// (not a dependency of the app). Only what's used, with the signatures used.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): Uint8Array;
  export function writeFileSync(path: string | URL, data: string | Uint8Array): void;
  export function renameSync(from: string, to: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[]): unknown;
  export function spawnSync(file: string, args: string[], options?: { stdio?: 'ignore' }): { status: number | null };
}
declare module 'node:crypto' {
  export function createHash(algorithm: 'sha256'): { update(data: Uint8Array): { digest(encoding: 'hex'): string } };
}
