/**
 * Undo stack of settings snapshots, compared as strings, so recording a snapshot that equals
 * the current one is a no-op and any GUI event may safely record.
 */
export class UndoHistory {
  private entries: string[];
  private index = 0;

  constructor(
    initial: string,
    private readonly limit = 100,
  ) {
    this.entries = [initial];
  }

  get current(): string {
    return this.entries[this.index];
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  /** Adds a snapshot after the current one, dropping anything that could be redone. */
  record(snapshot: string): boolean {
    if (snapshot === this.current) return false;
    this.entries.splice(this.index + 1, Infinity, snapshot);
    // the limit counts undo steps, so keep one more entry than that
    if (this.entries.length > this.limit + 1) this.entries.splice(0, this.entries.length - this.limit - 1);
    this.index = this.entries.length - 1;
    return true;
  }

  /** The snapshot to go back to, or null at the oldest. */
  undo(): string | null {
    if (!this.canUndo) return null;
    return this.entries[--this.index];
  }

  /** The snapshot to go forward to, or null at the newest. */
  redo(): string | null {
    if (!this.canRedo) return null;
    return this.entries[++this.index];
  }
}
