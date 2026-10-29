import type { Sheet } from '../export/packer';
import { teamPalette, teamRgb, type TeamColor } from '../render/palette';
import type { AnyDirection } from '../render/spriteRenderer';
import { drawDepot, drawMine } from './props';
import { directionOf, durationOf, frameAt, SpriteSet, yawOf, type Strip } from './sprites';

/** Effects-sheet rows a unit can shoot. */
export type Projectile = 'arrow' | 'bolt' | 'fireball' | 'stone' | 'javelin';

export interface PlaygroundOptions {
  /** Shown in the status bar. */
  name: string;
  /** Every row of the unit's sheet. */
  sheet: Sheet;
  /** Projectiles and hit effects; without it shots fly unseen. */
  effects: Sheet | null;
  /** The two units' team colours. */
  teams: [TeamColor, TeamColor];
  pixelsPerUnit: number;
  /** Sprite camera angle (degrees); the grid is foreshortened to match. */
  elevation: number;
  /** Ground covered per loop of walk and of run, in world units, so the feet don't slide. */
  stride: { walk: number; run: number };
  /** What attack shoots; null strikes in melee. */
  attack: Projectile | null;
  /** What cast throws; null is a spell with nothing to throw (a roar), which does no harm. */
  cast: Projectile | null;
  /** Whether channelling hurts what it's aimed at (a spell or a breath stream). */
  channel: boolean;
}

interface Vec {
  x: number;
  z: number;
}

type Order =
  | { kind: 'idle' }
  | { kind: 'move'; to: Vec }
  | { kind: 'attack'; target: Unit }
  | { kind: 'cast'; target: Unit | Vec; fired: boolean }
  | { kind: 'channel'; target: Unit | Vec; nextTick: number }
  | { kind: 'taunt' }
  | { kind: 'gather'; phase: 'toMine' | 'mining' | 'toDepot'; until: number };

/** An attack or cast under way: it lands (or lets fly) at `release` and is over at `end`. */
interface Swing {
  kind: 'attack' | 'cast';
  target: Unit | Vec;
  release: number;
  end: number;
  released: boolean;
}

interface Unit extends Vec {
  /** Index of its team colour, and of its palette. */
  team: number;
  home: Vec;
  homeYaw: number;
  yaw: number;
  hp: number;
  order: Order;
  anim: Strip;
  animStart: number;
  swing: Swing | null;
  /** When it may strike again. */
  ready: number;
  flinchUntil: number;
  carrying: boolean;
  deadSince: number | null;
  puffed: boolean;
}

interface Shot {
  kind: Projectile;
  team: number;
  source: Unit;
  target: Unit | Vec;
  from: Vec & { h: number };
  /** Where it was last headed, kept if the target dies. */
  to: Vec & { h: number };
  start: number;
  flight: number;
  arc: number;
  damage: number;
  /** Shown where it lands. */
  burst: 'impact' | 'puff' | null;
}

/** A one-shot effect playing at a spot. */
interface Burst extends Vec {
  strip: Strip;
  h: number;
  start: number;
  team: number;
  yaw: number;
}

interface Popup extends Vec {
  text: string;
  color: string;
  h: number;
  start: number;
}

interface Marker extends Vec {
  color: string;
  start: number;
}

interface Prop extends Vec {
  image: HTMLCanvasElement;
  /** Footprint, world units. */
  radius: number;
}

const MAX_HP = 100;
const ATTACK_DAMAGE = 12;
const SPELL_DAMAGE = 22;
/** Per channel tick. */
const CHANNEL_DAMAGE = 5;
const CHANNEL_TICK = 0.5;
/** Pause between attacks, seconds. */
const ATTACK_PAUSE = 0.35;
/** How far into its animation an attack or cast lands or lets fly. */
const RELEASE = { attack: 0.55, cast: 0.65 };
const WORK_TIME = 3;
const GOLD_PER_TRIP = 10;
/** How long a dead unit lies there before it's back. */
const RESPAWN = 3;

// ranges and speeds are in frame widths (a frame's size in world units), so they suit any scale
const RANGE: Record<Projectile, number> = { arrow: 3.2, javelin: 3.6, stone: 4.2, bolt: 3, fireball: 2.4 };
const SPEED: Record<Projectile, number> = { arrow: 6, javelin: 6, stone: 2.6, bolt: 3.5, fireball: 3 };
/** Peak height of the flight, per unit of distance. */
const ARC: Record<Projectile, number> = { arrow: 0.15, javelin: 0.08, stone: 0.4, bolt: 0, fireball: 0 };
const BURST: Record<Projectile, Shot['burst']> = { arrow: null, javelin: null, stone: 'puff', bolt: 'impact', fireball: 'impact' };
const CHANNEL_RANGE = 2;

const COMMANDS = [
  { key: 'a', label: 'attack', title: 'Attack: then click a unit' },
  { key: 'c', label: 'cast', title: 'Cast a spell: then click a unit or the ground' },
  { key: 'h', label: 'channel', title: 'Channel: then click a unit or the ground' },
  { key: 't', label: 'taunt', title: 'Taunt' },
  { key: 'g', label: 'gather', title: 'Mine gold and carry it to the depot' },
  { key: 's', label: 'stop', title: 'Stop' },
  { key: 'r', label: 'run', title: 'Toggle running for moves' },
] as const;
type Command = (typeof COMMANDS)[number]['label'];
/** Commands that wait for a click on their target. */
type Targeted = 'attack' | 'cast' | 'channel';

const isUnit = (t: Unit | Vec): t is Unit => 'team' in t;
const dist = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.z - a.z);

/** Opens the playground over the page; it closes itself with its button or Esc. */
export function openPlayground(opts: PlaygroundOptions): void {
  new Playground(opts);
}

class Playground {
  private readonly root = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly status = document.createElement('span');
  private readonly gold = document.createElement('span');
  private readonly hint = document.createElement('div');
  private readonly buttons = new Map<Command, HTMLButtonElement>();

  private readonly sprites: SpriteSet;
  private readonly fx: SpriteSet | null;
  private readonly units: Unit[];
  private readonly mine: Prop;
  private readonly depot: Prop;
  /** A frame's width in world units: ranges and the layout are measured in it. */
  private readonly frameWorld: number;
  /** Footprint radius of a unit, world units. */
  private readonly radius: number;
  /** Height of a unit's middle above the ground, world units: where shots leave and land. */
  private readonly chest: number;
  /** How many screen pixels tall a unit's health bar sits above its feet, at zoom 1. */
  private readonly barHeight: number;
  /** Where clicks pick a unit: frame pixels from the anchor across, and from the top down. */
  private readonly hitBox: { half: number; top: number; bottom: number };
  private readonly sinE: number;
  private readonly cosE: number;

  private now = 0;
  private last = performance.now();
  private raf = 0;
  private zoom: number;
  private pan = { x: 0, y: 0 };
  private running = false;
  private selected = new Set<Unit>();
  private pending: Targeted | null = null;
  private shots: Shot[] = [];
  private bursts: Burst[] = [];
  private popups: Popup[] = [];
  private markers: Marker[] = [];
  private goldOf = [0, 0];
  private mouse = { x: 0, y: 0 };
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private panning: { x: number; y: number } | null = null;

  constructor(private readonly opts: PlaygroundOptions) {
    const palettes = opts.teams.map(teamPalette);
    this.sprites = new SpriteSet(opts.sheet, palettes);
    this.fx = opts.effects ? new SpriteSet(opts.effects, palettes) : null;
    const fs = this.sprites.frameWidth;
    const ppu = opts.pixelsPerUnit;
    this.frameWorld = fs / ppu;
    this.sinE = Math.sin((opts.elevation * Math.PI) / 180);
    this.cosE = Math.cos((opts.elevation * Math.PI) / 180);
    this.zoom = Math.max(1, Math.round(110 / fs));

    // the unit's size, from its idle pose seen side on (its length) and from the front
    const first = this.sprites.resolve('idle').name;
    const side = this.sprites.bounds(first, 'E');
    const front = this.sprites.bounds(first, 'S');
    const length = side ? side.right - side.left : fs / 3;
    this.radius = Math.max(0.2, (length / ppu) * 0.35);
    const { anchor } = this.sprites;
    const tall = front ? anchor.y - front.top : fs / 2;
    this.chest = (0.55 * tall) / ppu / this.cosE;
    this.barHeight = tall + 4;
    const seen = [side, front].filter((b) => b !== null);
    this.hitBox = seen.length
      ? {
          half: Math.max(3, ...seen.map((b) => Math.max(anchor.x - b.left, b.right - anchor.x))),
          top: Math.min(...seen.map((b) => b.top)),
          bottom: Math.max(...seen.map((b) => b.bottom)),
        }
      : { half: fs / 4, top: 0, bottom: anchor.y };

    const L = this.frameWorld;
    const art = fs / 32;
    const prop = (image: HTMLCanvasElement, x: number, z: number): Prop => ({ image, x, z, radius: (0.38 * image.width * art) / ppu });
    this.mine = prop(drawMine(), -2.6 * L, -1.4 * L);
    this.depot = prop(drawDepot(), -2.6 * L, 1.4 * L);
    this.units = [this.spawn(0, { x: -0.9 * L, z: 0 }, 90), this.spawn(1, { x: 0.9 * L, z: 0 }, -90)];
    this.selected.add(this.units[0]);

    this.ctx = this.build();
    this.resize();
    this.raf = requestAnimationFrame(this.tick);
  }

  // --- DOM ------------------------------------------------------------------

  private build(): CanvasRenderingContext2D {
    this.root.className = 'playground';
    this.root.tabIndex = -1;

    const top = document.createElement('div');
    top.className = 'pgTop';
    const title = document.createElement('b');
    title.textContent = '🎮 Playground';
    const help = document.createElement('span');
    help.className = 'pgHelp';
    help.textContent = 'click / drag: select · right-click: move, attack, gather · 1 2: pick a unit · wheel: zoom · middle-drag: pan';
    const close = document.createElement('button');
    close.textContent = '✕ close';
    close.title = 'Back to the editor (Esc)';
    close.onclick = this.close;
    top.append(title, this.gold, help, close);

    const bar = document.createElement('div');
    bar.className = 'pgBar';
    this.status.className = 'pgStatus';
    bar.append(this.status);
    for (const c of COMMANDS) {
      const b = document.createElement('button');
      b.innerHTML = `<u>${c.key.toUpperCase()}</u> ${c.label}`;
      b.title = c.title;
      b.onclick = () => this.command(c.label);
      this.buttons.set(c.label, b);
      bar.append(b);
    }

    this.hint.className = 'pgHint';
    this.hint.hidden = true;
    this.root.append(this.canvas, top, bar, this.hint);
    document.body.append(this.root);
    this.root.focus();

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.resize);
    this.updateBar();
    return this.canvas.getContext('2d')!;
  }

  private readonly close = (): void => {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.resize);
    this.root.remove();
  };

  private readonly resize = (): void => {
    this.canvas.width = this.root.clientWidth;
    this.canvas.height = this.root.clientHeight;
  };

  private updateBar(): void {
    const any = this.selected.size > 0;
    for (const [label, b] of this.buttons) {
      b.disabled = label !== 'run' && !any;
      b.classList.toggle('active', label === 'run' ? this.running : label === this.pending);
    }
    this.hint.hidden = !this.pending;
    if (this.pending) this.hint.textContent = `${this.pending}: click a ${this.pending === 'attack' ? 'unit' : 'unit or the ground'} · right-click or Esc to cancel`;
  }

  private updateStatus(): void {
    const parts = [...this.selected].map((u) => {
      const doing = u.deadSince !== null ? 'dead' : u.swing ? `${u.swing.kind}ing` : this.describe(u.order);
      const load = u.carrying && u.order.kind !== 'gather' ? ' (carrying gold)' : '';
      return `${this.opts.teams[u.team]} ${this.opts.name} · ${Math.ceil(u.hp)}/${MAX_HP} · ${doing}${load}`;
    });
    const text = parts.join('  |  ') || 'nothing selected';
    if (this.status.textContent !== text) this.status.textContent = text;
    const gold = this.opts.teams.map((t, i) => `${t} ${this.goldOf[i]}`).join(' · ');
    if (this.gold.textContent !== `gold: ${gold}`) this.gold.textContent = `gold: ${gold}`;
  }

  private describe(o: Order): string {
    if (o.kind === 'gather') return { toMine: 'going to the mine', mining: 'mining', toDepot: 'carrying gold' }[o.phase];
    return { idle: 'idle', move: 'moving', attack: 'attacking', cast: 'casting', channel: 'channelling', taunt: 'taunting' }[o.kind];
  }

  // --- input ----------------------------------------------------------------

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
    // the editor underneath doesn't hear keys (its undo) while the playground is open
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      if (this.pending) {
        this.pending = null;
        this.updateBar();
      } else this.close();
    } else if (key === '1' || key === '2') {
      const u = this.units[Number(key) - 1];
      if (!e.shiftKey) this.selected.clear();
      if (u.deadSince === null) this.selected.add(u);
      this.updateBar();
    } else {
      const c = COMMANDS.find((c) => c.key === key);
      if (!c) return;
      this.command(c.label);
    }
    e.preventDefault();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.mouse = this.pointer(e);
    const { x, y } = this.mouse;
    if (e.button === 1) {
      this.panning = { x, y };
      e.preventDefault();
    } else if (e.button === 2) {
      if (this.pending) this.pending = null;
      else this.smartCommand(x, y);
      this.updateBar();
    } else if (e.button === 0) {
      if (this.pending) {
        this.targetCommand(this.pending, x, y);
        if (!e.shiftKey) this.pending = null;
        this.updateBar();
      } else this.box = { x0: x, y0: y, x1: x, y1: y };
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.mouse = this.pointer(e);
    if (this.panning) {
      this.pan.x += this.mouse.x - this.panning.x;
      this.pan.y += this.mouse.y - this.panning.y;
      this.panning = { ...this.mouse };
    }
    if (this.box) {
      this.box.x1 = this.mouse.x;
      this.box.y1 = this.mouse.y;
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button === 1) this.panning = null;
    if (e.button !== 0 || !this.box) return;
    const { x0, y0, x1, y1 } = this.box;
    this.box = null;
    if (!e.shiftKey) this.selected.clear();
    if (Math.abs(x1 - x0) < 4 && Math.abs(y1 - y0) < 4) {
      const u = this.unitAt(x0, y0);
      if (u) this.selected.add(u);
    } else {
      const [l, r, t, b] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
      for (const u of this.alive()) {
        const feet = this.toScreen(u.x, u.z);
        const mid = this.toScreen(u.x, u.z, this.chest);
        if ([feet, mid].some((p) => p.x >= l && p.x <= r && p.y >= t && p.y <= b)) this.selected.add(u);
      }
    }
    this.updateBar();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const zoom = Math.max(1, Math.min(8, this.zoom + (e.deltaY < 0 ? 1 : -1)));
    if (zoom === this.zoom) return;
    // keep the ground under the cursor where it is
    const { x, y } = this.pointer(e);
    const g = this.toGround(x, y);
    this.zoom = zoom;
    const s = this.toScreen(g.x, g.z);
    this.pan.x += x - s.x;
    this.pan.y += y - s.y;
  };

  private pointer(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Right-click: attack a unit, gather at the mine, unload at the depot, or move. */
  private smartCommand(x: number, y: number): void {
    const target = this.unitAt(x, y);
    const prop = target ? null : this.propAt(x, y);
    const ground = this.toGround(x, y);
    let color = '#6ac46a';
    for (const u of this.selected) {
      if (target && target !== u) {
        this.order(u, { kind: 'attack', target });
        color = '#e85a4a';
      } else if (prop === this.mine || (prop === this.depot && u.carrying)) {
        this.order(u, { kind: 'gather', phase: u.carrying ? 'toDepot' : 'toMine', until: 0 });
        color = '#f8e080';
      } else if (!target) this.order(u, { kind: 'move', to: ground });
    }
    const at = target ?? prop ?? ground;
    if (this.selected.size) this.markers.push({ x: at.x, z: at.z, color, start: this.now });
  }

  private targetCommand(kind: Targeted, x: number, y: number): void {
    const unit = this.unitAt(x, y);
    const target: Unit | Vec = unit ?? this.toGround(x, y);
    for (const u of this.selected) {
      if (unit === u) continue;
      if (kind === 'attack') {
        if (unit) this.order(u, { kind: 'attack', target: unit });
        else this.order(u, { kind: 'move', to: target });
      } else if (kind === 'cast') this.order(u, { kind: 'cast', target, fired: false });
      else this.order(u, { kind: 'channel', target, nextTick: Infinity });
    }
    this.markers.push({ x: target.x, z: target.z, color: unit ? '#e85a4a' : '#6ac8ff', start: this.now });
  }

  private command(c: Command): void {
    if (c === 'run') this.running = !this.running;
    else if (c === 'attack' || c === 'cast' || c === 'channel') this.pending = this.selected.size ? c : null;
    else {
      this.pending = null;
      for (const u of this.selected) {
        if (c === 'stop') this.order(u, { kind: 'idle' });
        else if (c === 'taunt') {
          this.order(u, { kind: 'taunt' });
          this.play(u, 'taunt', true);
        } else this.order(u, { kind: 'gather', phase: u.carrying ? 'toDepot' : 'toMine', until: 0 });
      }
    }
    this.updateBar();
  }

  /** Gives a unit a new order, breaking off whatever it was doing. */
  private order(u: Unit, o: Order): void {
    if (u.deadSince !== null) return;
    u.order = o;
    u.swing = null;
  }

  // --- the world -------------------------------------------------------------

  private spawn(team: number, at: Vec, yaw: number): Unit {
    return {
      ...at,
      team,
      home: { ...at },
      homeYaw: yaw,
      yaw,
      hp: MAX_HP,
      order: { kind: 'idle' },
      anim: this.sprites.resolve('idle'),
      animStart: 0,
      swing: null,
      ready: 0,
      flinchUntil: 0,
      carrying: false,
      deadSince: null,
      puffed: false,
    };
  }

  private alive(): Unit[] {
    return this.units.filter((u) => u.deadSince === null);
  }

  private play(u: Unit, name: string, restart = false): void {
    const s = this.sprites.resolve(name);
    if (restart || u.anim !== s) {
      u.anim = s;
      u.animStart = this.now;
    }
  }

  private face(u: Unit, t: Vec): void {
    if (dist(u, t) > 1e-3) u.yaw = yawOf(t.x - u.x, t.z - u.z);
  }

  /** World units per second for a gait, matched to how far its row's loop strides. */
  private speedOf(gait: string): number {
    const s = this.sprites.resolve(gait);
    return (s.name === 'run' ? this.opts.stride.run : this.opts.stride.walk) / durationOf(s);
  }

  /** Steps toward `to` until within `stop` of it; true once there. */
  private walk(u: Unit, to: Vec, stop: number, dt: number): boolean {
    const d = dist(u, to);
    if (d <= stop) return true;
    const gait = u.carrying ? 'carry' : this.running ? 'run' : 'walk';
    const step = Math.min(this.speedOf(gait) * dt, d - stop);
    u.x += ((to.x - u.x) / d) * step;
    u.z += ((to.z - u.z) / d) * step;
    this.face(u, to);
    this.play(u, gait);
    return d - step <= stop + 1e-6;
  }

  private attackRange(target: Unit | Vec): number {
    if (this.opts.attack) return RANGE[this.opts.attack] * this.frameWorld;
    return this.radius * (isUnit(target) ? 2 : 1) + 0.35;
  }

  private castRange(target: Unit | Vec): number {
    return this.opts.cast ? RANGE[this.opts.cast] * this.frameWorld : this.attackRange(target);
  }

  private update(dt: number): void {
    for (const u of this.units) this.updateUnit(u, dt);
    this.separate();
    this.updateShots();
    this.bursts = this.bursts.filter((b) => this.now - b.start < durationOf(b.strip));
    this.popups = this.popups.filter((p) => this.now - p.start < 1.2);
    this.markers = this.markers.filter((m) => this.now - m.start < 0.6);
  }

  private updateUnit(u: Unit, dt: number): void {
    if (u.deadSince !== null) return this.updateDead(u);
    if (this.now < u.flinchUntil) return;
    if (u.swing) return this.updateSwing(u);
    const o = u.order;
    switch (o.kind) {
      case 'idle':
        this.play(u, 'idle');
        break;
      case 'move':
        if (this.walk(u, o.to, 0.05, dt)) u.order = { kind: 'idle' };
        break;
      case 'taunt':
        this.play(u, 'taunt');
        if (this.now - u.animStart >= durationOf(u.anim)) u.order = { kind: 'idle' };
        break;
      case 'attack': {
        if (o.target.deadSince !== null) {
          u.order = { kind: 'idle' };
          break;
        }
        const range = this.attackRange(o.target);
        // chase to a little inside the range, so a step back doesn't break it off at once
        if (dist(u, o.target) > range && !this.walk(u, o.target, range * 0.9, dt)) break;
        this.face(u, o.target);
        if (this.now >= u.ready) this.startSwing(u, 'attack', o.target);
        else this.play(u, 'idle');
        break;
      }
      case 'cast': {
        if (o.fired || (isUnit(o.target) && o.target.deadSince !== null)) {
          u.order = { kind: 'idle' };
          break;
        }
        const range = this.castRange(o.target);
        if (dist(u, o.target) > range && !this.walk(u, o.target, range * 0.9, dt)) break;
        this.face(u, o.target);
        o.fired = true;
        this.startSwing(u, 'cast', o.target);
        break;
      }
      case 'channel': {
        if (isUnit(o.target) && o.target.deadSince !== null) {
          u.order = { kind: 'idle' };
          break;
        }
        const range = CHANNEL_RANGE * this.frameWorld;
        if (isUnit(o.target) && dist(u, o.target) > range && !this.walk(u, o.target, range * 0.9, dt)) break;
        this.face(u, o.target);
        this.play(u, 'channel');
        if (o.nextTick === Infinity) o.nextTick = this.now + CHANNEL_TICK;
        if (this.now >= o.nextTick) {
          o.nextTick += CHANNEL_TICK;
          if (this.opts.channel && isUnit(o.target)) {
            this.burst('impact', o.target, this.chest, u.team, u.yaw);
            this.damage(o.target, CHANNEL_DAMAGE, u);
          }
        }
        break;
      }
      case 'gather':
        this.updateGather(u, o, dt);
        break;
    }
  }

  private updateGather(u: Unit, o: Extract<Order, { kind: 'gather' }>, dt: number): void {
    if (o.phase === 'toMine') {
      if (this.walk(u, this.mine, this.mine.radius + this.radius, dt)) {
        o.phase = 'mining';
        o.until = this.now + WORK_TIME;
      }
    } else if (o.phase === 'mining') {
      this.face(u, this.mine);
      this.play(u, 'work');
      if (this.now >= o.until) {
        u.carrying = true;
        o.phase = 'toDepot';
      }
    } else if (this.walk(u, this.depot, this.depot.radius + this.radius, dt)) {
      u.carrying = false;
      this.goldOf[u.team] += GOLD_PER_TRIP;
      this.popups.push({ x: this.depot.x, z: this.depot.z, h: this.chest * 2, text: `+${GOLD_PER_TRIP}`, color: '#f8e080', start: this.now });
      o.phase = 'toMine';
    }
  }

  private startSwing(u: Unit, kind: Swing['kind'], target: Unit | Vec): void {
    this.play(u, kind, true);
    const d = durationOf(u.anim);
    u.swing = { kind, target, release: this.now + d * RELEASE[kind], end: this.now + d, released: false };
  }

  private updateSwing(u: Unit): void {
    const s = u.swing!;
    this.face(u, s.target);
    if (!s.released && this.now >= s.release) {
      s.released = true;
      const shot = s.kind === 'attack' ? this.opts.attack : this.opts.cast;
      if (shot) this.shoot(u, shot, s.target, s.kind === 'attack' ? ATTACK_DAMAGE : SPELL_DAMAGE);
      else if (s.kind === 'attack' && isUnit(s.target) && dist(u, s.target) <= this.attackRange(s.target) * 1.3) {
        this.damage(s.target, ATTACK_DAMAGE, u);
      }
    }
    if (this.now >= s.end) {
      u.swing = null;
      u.ready = this.now + ATTACK_PAUSE;
    }
  }

  private updateDead(u: Unit): void {
    const lies = u.anim.name === 'death' ? durationOf(u.anim) : 0;
    if (!u.puffed && this.now - u.deadSince! >= lies) {
      u.puffed = true;
      this.burst('puff', u, this.chest * 0.4, u.team, u.yaw);
    }
    if (this.now - u.deadSince! < lies + RESPAWN) return;
    Object.assign(u, { x: u.home.x, z: u.home.z, yaw: u.homeYaw, hp: MAX_HP, deadSince: null, puffed: false, order: { kind: 'idle' } });
    this.play(u, 'idle', true);
  }

  private damage(u: Unit, amount: number, from: Unit): void {
    if (u.deadSince !== null) return;
    u.hp -= amount;
    this.popups.push({ x: u.x, z: u.z, h: this.chest * 1.8, text: `-${amount}`, color: '#ff8a7a', start: this.now });
    if (u.hp <= 0) return this.die(u);
    // a unit in the middle of a swing carries on; otherwise it flinches
    if (!u.swing) {
      this.play(u, 'hit', true);
      u.flinchUntil = this.sprites.has('hit') ? this.now + durationOf(u.anim) : 0;
    }
    // and an idle one hits back
    if (u.order.kind === 'idle' && from !== u && from.deadSince === null) u.order = { kind: 'attack', target: from };
  }

  private die(u: Unit): void {
    u.hp = 0;
    u.deadSince = this.now;
    u.swing = null;
    u.carrying = false;
    u.order = { kind: 'idle' };
    u.flinchUntil = 0;
    this.play(u, 'death', true);
    this.selected.delete(u);
    this.updateBar();
  }

  private shoot(u: Unit, kind: Projectile, target: Unit | Vec, damage: number): void {
    const ahead = this.radius * 0.8;
    const yaw = (u.yaw * Math.PI) / 180;
    const from = { x: u.x + Math.sin(yaw) * ahead, z: u.z + Math.cos(yaw) * ahead, h: this.chest };
    const to = { x: target.x, z: target.z, h: isUnit(target) ? this.chest : 0.05 };
    const d = dist(from, to);
    this.shots.push({
      kind,
      team: u.team,
      source: u,
      target,
      from,
      to,
      start: this.now,
      flight: Math.max(0.15, d / (SPEED[kind] * this.frameWorld)),
      arc: ARC[kind] * d,
      damage,
      burst: BURST[kind],
    });
  }

  private shotPos(s: Shot): Vec & { h: number; yaw: number } {
    const p = Math.min(1, (this.now - s.start) / s.flight);
    const x = s.from.x + (s.to.x - s.from.x) * p;
    const z = s.from.z + (s.to.z - s.from.z) * p;
    const h = s.from.h + (s.to.h - s.from.h) * p + s.arc * 4 * p * (1 - p);
    return { x, z, h, yaw: yawOf(s.to.x - s.from.x, s.to.z - s.from.z) };
  }

  private updateShots(): void {
    this.shots = this.shots.filter((s) => {
      // follows a living target
      if (isUnit(s.target) && s.target.deadSince === null) {
        s.to.x = s.target.x;
        s.to.z = s.target.z;
      }
      if (this.now - s.start < s.flight) return true;
      const pos = this.shotPos(s);
      if (s.burst) this.burst(s.burst, s.to, s.burst === 'puff' ? this.chest * 0.4 : s.to.h, s.team, pos.yaw);
      if (isUnit(s.target)) this.damage(s.target, s.damage, s.source);
      else {
        // a shot at the ground hurts whoever it lands near
        for (const u of this.alive()) if (u !== s.source && dist(u, s.to) < this.radius + 0.3 * this.frameWorld) this.damage(u, s.damage, s.source);
      }
      return false;
    });
  }

  private burst(name: 'impact' | 'puff', at: Vec, h: number, team: number, yaw: number): void {
    const strip = this.fx?.strips.get(name);
    if (strip) this.bursts.push({ x: at.x, z: at.z, h, strip, start: this.now, team, yaw });
  }

  /** Pushes overlapping units apart, and out of the props. */
  private separate(): void {
    const live = this.alive();
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const [a, b] = [live[i], live[j]];
        const d = dist(a, b);
        const overlap = 2 * this.radius - d;
        if (overlap <= 0) continue;
        const [nx, nz] = d > 1e-6 ? [(b.x - a.x) / d, (b.z - a.z) / d] : [1, 0];
        a.x -= (nx * overlap) / 2;
        a.z -= (nz * overlap) / 2;
        b.x += (nx * overlap) / 2;
        b.z += (nz * overlap) / 2;
      }
      for (const p of [this.mine, this.depot]) {
        const u = live[i];
        const d = dist(p, u);
        const min = p.radius + this.radius * 0.9;
        if (d >= min || d < 1e-6) continue;
        u.x = p.x + ((u.x - p.x) / d) * min;
        u.z = p.z + ((u.z - p.z) / d) * min;
      }
    }
  }

  // --- picking ----------------------------------------------------------------

  private toScreen(x: number, z: number, h = 0): { x: number; y: number } {
    const s = this.opts.pixelsPerUnit * this.zoom;
    return { x: this.canvas.width / 2 + this.pan.x + x * s, y: this.canvas.height / 2 + this.pan.y + (z * this.sinE - h * this.cosE) * s };
  }

  private toGround(sx: number, sy: number): Vec {
    const s = this.opts.pixelsPerUnit * this.zoom;
    return { x: (sx - this.canvas.width / 2 - this.pan.x) / s, z: (sy - this.canvas.height / 2 - this.pan.y) / s / this.sinE };
  }

  /** Where a unit's frame is drawn on screen, and which frame. */
  private placement(u: Unit): { x: number; y: number; dir: AnyDirection; frame: number } {
    const feet = this.toScreen(u.x, u.z);
    const a = this.sprites.anchor;
    return {
      x: Math.round(feet.x - a.x * this.zoom),
      y: Math.round(feet.y - a.y * this.zoom),
      dir: directionOf(u.yaw),
      frame: frameAt(u.anim, this.now - u.animStart),
    };
  }

  /**
   * The living unit at a screen point, front-most first: one drawn there (give or take a
   * pixel), or else one whose box around its idle pose is there, as thin units are hard to hit.
   */
  private unitAt(sx: number, sy: number): Unit | null {
    const front = this.alive()
      .sort((a, b) => b.z - a.z)
      .map((u) => ({ u, p: this.placement(u) }))
      .map(({ u, p }) => ({ u, p, fx: (sx - p.x) / this.zoom, fy: (sy - p.y) / this.zoom }));
    for (const { u, p, fx, fy } of front) {
      const { cell, flip } = this.sprites.cell(u.anim, p.dir, p.frame);
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (this.sprites.opaqueAt(cell, flip, fx + dx, fy + dy)) return u;
      }
    }
    const { half, top, bottom } = this.hitBox;
    const ax = this.sprites.anchor.x;
    return front.find(({ fx, fy }) => Math.abs(fx - ax) <= half && fy >= top && fy <= bottom)?.u ?? null;
  }

  private propAt(sx: number, sy: number): Prop | null {
    for (const p of [this.mine, this.depot]) {
      const r = this.propRect(p);
      if (sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h) return p;
    }
    return null;
  }

  private propRect(p: Prop): { x: number; y: number; w: number; h: number } {
    const k = (this.sprites.frameWidth / 32) * this.zoom;
    const at = this.toScreen(p.x, p.z);
    const w = p.image.width * k;
    const h = p.image.height * k;
    // its base sits a little below its footprint's centre
    return { x: Math.round(at.x - w / 2), y: Math.round(at.y - h * 0.8), w, h };
  }

  // --- drawing ----------------------------------------------------------------

  private readonly tick = (t: number): void => {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.now += dt;
    this.update(dt);
    this.draw();
    this.updateStatus();
    this.raf = requestAnimationFrame(this.tick);
  };

  private draw(): void {
    const { ctx, canvas } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1a1d22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.drawGrid();

    for (const m of this.markers) this.drawMarker(m);
    // whose is whose, even for units without team colours (a beast's hide)
    for (const u of this.alive()) if (!this.selected.has(u)) this.drawRing(u, this.teamColor(u, 0.55));
    for (const u of this.selected) this.drawRing(u, '#6ac46a');
    if (this.pending) {
      const u = this.unitAt(this.mouse.x, this.mouse.y);
      if (u && !this.selected.has(u)) this.drawRing(u, '#e85a4a');
    }

    // back to front
    const things: { z: number; draw: () => void }[] = [
      ...[this.mine, this.depot].map((p) => ({ z: p.z, draw: () => this.drawProp(p) })),
      ...this.units.filter((u) => u.deadSince === null || u.anim.name === 'death').map((u) => ({ z: u.z, draw: () => this.drawUnit(u) })),
    ];
    things.sort((a, b) => a.z - b.z).forEach((t) => t.draw());

    for (const s of this.shots) {
      const p = this.shotPos(s);
      const strip = this.fx?.strips.get(s.kind);
      if (strip) this.drawEffect(strip, p, p.h, p.yaw, frameAt(strip, this.now - s.start), s.team);
    }
    for (const b of this.bursts) this.drawEffect(b.strip, b, b.h, b.yaw, frameAt(b.strip, this.now - b.start), b.team);
    for (const u of this.alive()) this.drawHealth(u);
    for (const p of this.popups) this.drawPopup(p);

    if (this.box) {
      const { x0, y0, x1, y1 } = this.box;
      ctx.strokeStyle = '#6ac46a';
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(106, 196, 106, 0.1)';
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    canvas.style.cursor = this.pending ? 'crosshair' : this.panning ? 'grabbing' : 'default';
  }

  /** The ground: a grid of square cells, foreshortened as the sprite camera sees them. */
  private drawGrid(): void {
    const { ctx, canvas } = this;
    // a round cell size near half a frame
    const cell = 2 ** Math.round(Math.log2(this.frameWorld / 2));
    const tl = this.toGround(0, 0);
    const br = this.toGround(canvas.width, canvas.height);
    ctx.lineWidth = 1;
    for (const [from, to, vertical] of [[tl.x, br.x, true], [tl.z, br.z, false]] as const) {
      for (let i = Math.floor(from / cell); i <= Math.ceil(to / cell); i++) {
        const v = i * cell;
        ctx.strokeStyle = i === 0 ? '#3b4250' : i % 4 === 0 ? '#2e333d' : '#252930';
        ctx.beginPath();
        if (vertical) {
          const x = Math.round(this.toScreen(v, 0).x) + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
        } else {
          const y = Math.round(this.toScreen(0, v).y) + 0.5;
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
        }
        ctx.stroke();
      }
    }
  }

  private ellipse(at: Vec, r: number): void {
    const c = this.toScreen(at.x, at.z);
    const s = this.opts.pixelsPerUnit * this.zoom;
    this.ctx.beginPath();
    this.ctx.ellipse(c.x, c.y, Math.max(2, r * s), Math.max(1, r * s * this.sinE), 0, 0, Math.PI * 2);
  }

  private drawRing(u: Unit, color: string): void {
    this.ellipse(u, this.radius * 1.15);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = Math.max(1, this.zoom / 2);
    this.ctx.stroke();
  }

  private drawMarker(m: Marker): void {
    const p = (this.now - m.start) / 0.6;
    this.ctx.globalAlpha = 1 - p;
    this.ellipse(m, this.radius * (1.2 - 0.8 * p));
    this.ctx.strokeStyle = m.color;
    this.ctx.lineWidth = Math.max(1, this.zoom / 2);
    this.ctx.stroke();
    this.ctx.globalAlpha = 1;
  }

  private drawProp(p: Prop): void {
    const r = this.propRect(p);
    this.ctx.drawImage(p.image, r.x, r.y, r.w, r.h);
  }

  private drawUnit(u: Unit): void {
    const p = this.placement(u);
    const { cell, flip } = this.sprites.cell(u.anim, p.dir, p.frame);
    this.blit(this.sprites.image(cell, u.team), p.x, p.y, flip);
  }

  /** An effect frame centred on a point above the ground. */
  private drawEffect(strip: Strip, at: Vec, h: number, yaw: number, frame: number, team: number): void {
    const fx = this.fx!;
    const { cell, flip } = fx.cell(strip, directionOf(yaw), frame);
    const c = this.toScreen(at.x, at.z, h);
    const a = fx.anchor;
    this.blit(fx.image(cell, team), Math.round(c.x - a.x * this.zoom), Math.round(c.y - a.y * this.zoom), flip);
  }

  private blit(img: HTMLCanvasElement, x: number, y: number, flip: boolean): void {
    const w = img.width * this.zoom;
    const h = img.height * this.zoom;
    if (!flip) return this.ctx.drawImage(img, x, y, w, h);
    this.ctx.save();
    this.ctx.translate(x + w, y);
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(img, 0, 0, w, h);
    this.ctx.restore();
  }

  private drawHealth(u: Unit): void {
    const { ctx } = this;
    const feet = this.toScreen(u.x, u.z);
    const w = Math.max(20, Math.min(64, this.radius * 3 * this.opts.pixelsPerUnit * this.zoom));
    const x = Math.round(feet.x - w / 2);
    const y = Math.round(feet.y - this.barHeight * this.zoom - 6);
    const f = Math.max(0, u.hp / MAX_HP);
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.fillStyle = this.teamColor(u);
    ctx.fillRect(x, y, w, 1);
    ctx.fillStyle = f > 0.5 ? '#3cc850' : f > 0.25 ? '#e0c020' : '#e03a2a';
    ctx.fillRect(x, y + 1, Math.round(w * f), 3);
  }

  private teamColor(u: Unit, alpha = 1): string {
    const [r, g, b] = teamRgb(this.opts.teams[u.team])[2];
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private drawPopup(p: Popup): void {
    const t = (this.now - p.start) / 1.2;
    const c = this.toScreen(p.x, p.z, p.h);
    this.ctx.globalAlpha = 1 - t * t;
    this.ctx.font = `bold ${10 + 2 * Math.min(this.zoom, 4)}px monospace`;
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#000';
    const y = Math.round(c.y - 24 * t);
    this.ctx.fillText(p.text, c.x + 1, y + 1);
    this.ctx.fillStyle = p.color;
    this.ctx.fillText(p.text, c.x, y);
    this.ctx.globalAlpha = 1;
  }
}
