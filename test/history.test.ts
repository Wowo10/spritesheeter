import { describe, expect, it } from 'vitest';
import { UndoHistory } from '../src/history';

describe('history', () => {
  it('starts with nothing to undo or redo', () => {
    const h = new UndoHistory('a');
    expect([h.canUndo, h.canRedo]).toEqual([false, false]);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });

  it('ignores a snapshot equal to the current one', () => {
    const h = new UndoHistory('a');
    expect(h.record('a')).toBe(false);
    expect(h.canUndo).toBe(false);
    expect(h.record('b')).toBe(true);
    expect(h.canUndo).toBe(true);
  });

  it('walks back and forth', () => {
    const h = new UndoHistory('a');
    h.record('b');
    h.record('c');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBe('b');
    expect(h.redo()).toBe('c');
    expect(h.redo()).toBeNull();
    expect(h.current).toBe('c');
  });

  it('drops the redo branch when something new is recorded', () => {
    const h = new UndoHistory('a');
    h.record('b');
    h.record('c');
    h.undo();
    // restoring b and recording it again changes nothing
    expect(h.record('b')).toBe(false);
    expect(h.canRedo).toBe(true);
    h.record('d');
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
  });

  it('keeps at most `limit` undo steps', () => {
    const h = new UndoHistory('0', 3);
    for (let i = 1; i <= 5; i++) h.record(String(i));
    expect(h.current).toBe('5');
    expect([h.undo(), h.undo(), h.undo(), h.undo()]).toEqual(['4', '3', '2', null]);
    expect(h.redo()).toBe('3');
  });
});
