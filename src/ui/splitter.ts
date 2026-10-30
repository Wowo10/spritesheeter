const STORAGE_KEY = 'ssheet.sideWidth';
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 260;
/** The 3D view keeps at least this much of the window. */
const MIN_VIEW = 320;

function readStored(): number | null {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function store(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // private mode etc.: the width just won't be remembered
  }
}

/**
 * Lets the user drag the boundary between the 3D view and the side panel.
 * The width lives in the --side-width CSS variable (the grid and the GUI position read it)
 * and is remembered across reloads. Double-click resets it.
 */
export function initSplitter(splitter: HTMLElement, onResize: (width: number) => void): void {
  const root = document.documentElement;
  const clamp = (w: number) => Math.round(Math.min(Math.max(w, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth - MIN_VIEW)));
  /** The width the user asked for; the window may be too narrow to show all of it. */
  let wanted = readStored() ?? DEFAULT_WIDTH;
  let width = clamp(wanted);

  const apply = (w: number) => {
    width = clamp(w);
    root.style.setProperty('--side-width', `${width}px`);
    onResize(width);
  };
  /** The user picked a width: remember what they actually got. */
  const choose = (w: number) => {
    apply(w);
    wanted = width;
  };

  splitter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('dragging');
    document.body.classList.add('resizing');
  });
  splitter.addEventListener('pointermove', (e) => {
    if (splitter.hasPointerCapture(e.pointerId)) choose(window.innerWidth - e.clientX);
  });
  const end = (e: PointerEvent) => {
    if (!splitter.hasPointerCapture(e.pointerId)) return;
    splitter.releasePointerCapture(e.pointerId);
    splitter.classList.remove('dragging');
    document.body.classList.remove('resizing');
    store(width);
  };
  splitter.addEventListener('pointerup', end);
  splitter.addEventListener('pointercancel', end);
  splitter.addEventListener('dblclick', () => {
    choose(DEFAULT_WIDTH);
    store(width);
  });
  // a narrower window may not fit the wanted width; a wider one gets it back
  window.addEventListener('resize', () => apply(wanted));

  apply(width);
}
