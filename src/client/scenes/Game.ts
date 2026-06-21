import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type {
  DailySeed,
  InitResponse,
  LeaderboardEntry,
  SubmitResponse,
} from '../../shared/api';
import { PALETTES, dailyChallengeName } from '../../shared/seed';
import { audio } from '../audio';

// Width of the play column relative to the game world. The camera stays focused
// on the stack and pans up as it grows.
const PLAY_WIDTH = 360;
const PLATFORM_HEIGHT = 28;
const FIRST_PLATFORM_Y_RATIO = 0.62;
const GHOST_FLOOR_RATIO = 0.85;
// Minimum combo before the HUD pill appears. 2 keeps the surface calm.
const COMBO_HUD_THRESHOLD = 2;
// Floor count above which the goal-banner deserves a full-screen celebration.
const GOAL_BANNER_FLOORS_THRESHOLD = 1;

// Best-effort haptic tap. Silently no-op on devices without vibration support.
function vibrate(ms: number) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch {
    // ignore
  }
}

function shadowColorForPalette(daily: DailySeed): number {
  return Phaser.Display.Color.HexStringToColor(PALETTES[daily.paletteId].shadow).color;
}

// Per-floor color jitter so the stack reads as a varied city skyline rather
// than a single color bar. The tint is deterministic from the floor index so
// it stays stable across re-renders, and the magnitude is small enough that
// it never breaks the palette identity.
function tintedBlockColor(baseColor: number, depth: number): number {
  // 6% max HSL lightness shift, oscillating with the floor number.
  const tint = (Math.sin(depth * 0.55) + Math.cos(depth * 0.31)) * 0.03;
  const base = Phaser.Display.Color.IntegerToColor(baseColor) as unknown as {
    h: number;
    s: number;
    l: number;
  };
  const h = base.h;
  const s = Phaser.Math.Clamp(base.s, 0, 1);
  const l = Phaser.Math.Clamp(base.l + tint, 0.2, 0.95);
  const c = Phaser.Display.Color.HSLToColor(h, s, l) as unknown as {
    r: number;
    g: number;
    b: number;
  };
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
}

type Stack = {
  x: number;
  y: number;
  width: number;
  depth: number;
  color: number;
  isGhost: boolean;
};

type Particle = Phaser.GameObjects.Rectangle;

export class GameScene extends Scene {
  private camera!: Phaser.Cameras.Scene2D.Camera;
  private background!: Phaser.GameObjects.Graphics;
  private platformGraphics!: Phaser.GameObjects.Graphics;
  private particleLayer!: Phaser.GameObjects.Graphics;
  private windowLayer!: Phaser.GameObjects.Graphics;
  private pbGhostGraphics: Phaser.GameObjects.Graphics | null = null;
  private pbGhostLabel: Phaser.GameObjects.Text | null = null;
  private pbGhost: number | null = null;

  private daily!: DailySeed;
  private communityFloors = 0;
  private personalBest = 0;
  private streak = 0;
  private builders = 0;
  private leaderboard: LeaderboardEntry[] = [];
  private username = 'guest';
  private subredditName = '';
  private streakAtRisk = false;
  private goalCelebrated = false;

  private stacks: Stack[] = [];
  private currentBlock!: Phaser.GameObjects.Rectangle;
  private currentShadow!: Phaser.GameObjects.Rectangle;
  private currentWidth = 0;
  private currentDepth = 0;
  private currentDirection = 1;
  private currentSpeedDeg = 0;
  private currentTween: Phaser.Tweens.Tween | null = null;
  // Window flicker timer — re-randomises a fraction of lit windows every tick.
  private windowFlickerEvent: Phaser.Time.TimerEvent | null = null;

  private isRunning = false;
  private isStarted = false;
  private perfectRun = true;
  private perfectCount = 0;
  // Consecutive perfect drops within the current run, for escalating feedback.
  private perfectCombo = 0;
  // Combo HUD timeout — hides the pill after the player misses or idles.
  private comboHideTimer: number | null = null;

  constructor() {
    super('Game');
  }

  create() {
    this.camera = this.cameras.main;
    this.camera.setBackgroundColor('#0a0a1a');

    this.background = this.add.graphics();
    this.background.setScrollFactor(0);
    this.background.setDepth(-10);

    this.platformGraphics = this.add.graphics();
    this.platformGraphics.setDepth(0);

    this.particleLayer = this.add.graphics();
    this.particleLayer.setDepth(20);

    this.windowLayer = this.add.graphics();
    this.windowLayer.setDepth(2);

    this.scale.on('resize', this.handleResize, this);
    this.handleResize(this.scale.width, this.scale.height);

    this.setupMuteButton();
    this.setupSubredditPill();
    this.setupComboBanner();
    this.setupVisibilityPause();

    // Wait for /api/init before showing the start overlay so HUD reflects real state.
    void this.bootstrap();
  }

  private setupSubredditPill() {
    const el = document.getElementById('subreddit-name');
    if (!el) return;
    try {
      // Devvit webview injects context globally; read lazily so we don't depend
      // on the bundle ordering.
      const ctx = (globalThis as { devvit?: { subredditName?: string } }).devvit;
      const name = ctx?.subredditName;
      if (name) {
        this.subredditName = name;
        el.textContent = name;
        return;
      }
    } catch {
      // ignore
    }
    el.textContent = 'skyline';
  }

  private setupComboBanner() {
    // Nothing to do — the banner element already exists. We just make sure
    // it starts hidden. (It's hidden by default in HTML.)
    const banner = document.getElementById('combo-banner');
    if (banner) banner.classList.remove('is-visible');
  }

  private setupVisibilityPause() {
    // Pause the swinging block when the player switches tabs or backgrounds
    // the app. Resumes on return so the run isn't wasted by an out-of-focus
    // miss. We use the document visibility API which works on desktop and mobile.
    document.addEventListener('visibilitychange', () => {
      if (!this.isRunning) return;
      if (document.hidden) {
        this.currentTween?.pause();
      } else {
        this.currentTween?.resume();
      }
    });
  }

  private showCombo() {
    if (this.perfectCombo < COMBO_HUD_THRESHOLD) {
      // Hide it if it was visible from a previous combo.
      this.hideCombo();
      return;
    }
    const banner = document.getElementById('combo-banner');
    const valEl = document.getElementById('combo-value');
    if (!banner || !valEl) return;
    valEl.textContent = `x${this.perfectCombo}`;
    banner.classList.add('is-visible');
    // Re-trigger the bump animation each time the combo ticks up.
    banner.classList.remove('is-bump');
    void banner.offsetWidth;
    banner.classList.add('is-bump');
    if (this.comboHideTimer !== null) {
      window.clearTimeout(this.comboHideTimer);
    }
    this.comboHideTimer = window.setTimeout(() => this.hideCombo(), 1200);
  }

  private hideCombo() {
    const banner = document.getElementById('combo-banner');
    banner?.classList.remove('is-visible');
    if (this.comboHideTimer !== null) {
      window.clearTimeout(this.comboHideTimer);
      this.comboHideTimer = null;
    }
  }

  private showTapHint() {
    const hint = document.getElementById('tap-hint');
    if (hint) hint.hidden = false;
  }

  private hideTapHint() {
    const hint = document.getElementById('tap-hint');
    if (hint) hint.hidden = true;
  }

  private showGoalBanner() {
    const banner = document.getElementById('goal-banner');
    if (!banner) return;
    banner.hidden = false;
    window.setTimeout(() => {
      banner.hidden = true;
    }, 3200);
  }

  private updateStreakWarning() {
    const warn = document.getElementById('streak-warning');
    if (!warn) return;
    warn.hidden = !this.streakAtRisk;
  }

  private setupMuteButton() {
    const btn = document.getElementById('mute-button');
    if (!btn) return;
    const render = () => {
      const muted = audio.isMuted();
      btn.textContent = muted ? '🔇' : '🔊';
      btn.classList.toggle('is-muted', muted);
    };
    render();
    btn.onclick = () => {
      audio.toggleMute();
      audio.resume();
      render();
    };
  }

  private async bootstrap() {
    this.showLoading();
    let init: InitResponse;
    try {
      const res = await fetch('/api/init');
      if (!res.ok) throw new Error(`init ${res.status}`);
      init = (await res.json()) as InitResponse;
    } catch (err) {
      console.error('init failed', err);
      this.showError('Could not load today’s skyline.', () =>
        void this.bootstrap()
      );
      return;
    }
    this.daily = init.daily;
    this.communityFloors = init.communityFloors;
    this.personalBest = init.personalBest;
    this.streak = init.streak;
    this.builders = init.builders;
    this.leaderboard = init.leaderboard;
    this.username = init.username;
    // Server can hint when a streak is "at risk" — set by /api/init so the
    // overlay and HUD can nudge the player back.
    this.streakAtRisk = init.streakAtRisk ?? false;

    this.paintBackground();
    this.seedGhostFloors();
    this.startWindowFlicker();
    this.updateHud();
    this.updateStreakWarning();
    const remaining = Math.max(0, this.daily.communityGoal - this.communityFloors);
    const base =
      remaining > 0
        ? `${remaining} floors left to reach today's goal. Stack as high as you can.`
        : "Today's goal is reached — keep stacking to push it higher.";
    const dayName = dailyChallengeName(this.daily.date);
    this.showOverlay({
      title: this.daily.goalUnlocked
        ? `Aurora ${dayName} ✨`
        : dayName,
      sub: this.daily.goalUnlocked
        ? `The sub hit yesterday's goal, so today's skyline glows. ${base}`
        : base,
      button: this.isFirstPlay() ? 'SHOW ME' : 'START',
      leaderboardHtml: this.leaderboardHtml(),
      rivalHtml: this.rivalHtml(),
    });
    if (this.isFirstPlay()) {
      // Flag is set when the player actually starts so the tutorial only
      // shows on the first ever interaction, not on every cold load.
      this.showTutorialBanner();
    }
  }

  // localStorage flag — silent on failures (private mode, quota, etc.).
  private isFirstPlay(): boolean {
    try {
      return localStorage.getItem('skyline:tutorial-done') !== '1';
    } catch {
      return false;
    }
  }

  private markTutorialDone() {
    try {
      localStorage.setItem('skyline:tutorial-done', '1');
    } catch {
      // ignore
    }
  }

  private showTutorialBanner() {
    const banner = document.getElementById('tutorial-banner');
    if (!banner) return;
    banner.hidden = false;
  }

  private hideTutorialBanner() {
    const banner = document.getElementById('tutorial-banner');
    if (banner) banner.hidden = true;
  }

  private paintBackground() {
    const palette = PALETTES[this.daily.paletteId];
    const { width, height } = this.scale;
    const g = this.background;
    g.clear();
    // Vertical gradient — sky color at top, mid color near horizon, shadow at base.
    const steps = 24;
    const top = Phaser.Display.Color.HexStringToColor(palette.sky);
    const mid = Phaser.Display.Color.HexStringToColor(palette.mid);
    const bot = Phaser.Display.Color.HexStringToColor(palette.shadow);
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        t < 0.5 ? top : mid,
        t < 0.5 ? mid : bot,
        1,
        t < 0.5 ? t * 2 : (t - 0.5) * 2
      );
      const color = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
      g.fillStyle(color, 1);
      g.fillRect(0, (height * i) / steps, width, height / steps + 1);
    }
    // Soft sun/moon disk — gives each palette a distinct horizon accent.
    const horizonY = height * 0.35;
    const diskR = Math.min(width, height) * 0.18;
    const diskColor = Phaser.Display.Color.HexStringToColor(palette.block);
    g.fillStyle(diskColor.color, 0.55);
    g.fillCircle(width * 0.5, horizonY, diskR);
  }

  private seedGhostFloors() {
    // The community floors below the player's stack render as a soft
    // repeating "ghost" so today's contribution has a visible starting line.
    this.platformGraphics.clear();
    this.windowLayer.clear();
    this.pbGhostGraphics?.clear();
    this.pbGhost = null;
    const ghostCount = Math.min(
      this.daily.communityFloors,
      Math.floor(this.scale.height * GHOST_FLOOR_RATIO / PLATFORM_HEIGHT)
    );
    const palette = PALETTES[this.daily.paletteId];
    const ghostColor = Phaser.Display.Color.HexStringToColor(palette.shadow).color;
    const baseY = this.scale.height * FIRST_PLATFORM_Y_RATIO;
    for (let i = 0; i < ghostCount; i++) {
      const y = baseY + i * PLATFORM_HEIGHT;
      const block: Stack = {
        x: this.scale.width / 2,
        y,
        width: PLAY_WIDTH,
        depth: -i,
        color: ghostColor,
        isGhost: true,
      };
      this.stacks.push(block);
    }
    // First real platform is the floor players stack on.
    this.stacks.push({
      x: this.scale.width / 2,
      y: baseY + ghostCount * PLATFORM_HEIGHT,
      width: PLAY_WIDTH,
      depth: 0,
      color: Phaser.Display.Color.HexStringToColor(palette.block).color,
      isGhost: false,
    });
    this.drawStacks();
    // Render the PB ghost line if the player has set a personal best today.
    this.drawPbGhost();
  }

  // Personal-best ghost marker. If the player already has a daily PB, draw
  // a gold horizontal line at that height so they have a visible target
  // to beat during their run. The line extends across the play column.
  private drawPbGhost() {
    if (this.personalBest <= 0) return;
    const g = this.ensurePbGhostLayer();
    g.clear();
    const baseY = this.scale.height * FIRST_PLATFORM_Y_RATIO;
    const ghostCount = Math.min(
      this.daily.communityFloors,
      Math.floor(this.scale.height * GHOST_FLOOR_RATIO / PLATFORM_HEIGHT)
    );
    const stackBaseY = baseY + ghostCount * PLATFORM_HEIGHT;
    // PB sits this many floors above the base.
    const y = stackBaseY - (this.personalBest + 1) * PLATFORM_HEIGHT;
    if (y < 0) return;
    this.pbGhost = y;
    const gold = Phaser.Display.Color.HexStringToColor('#ffd166').color;
    const width = PLAY_WIDTH + 12;
    g.lineStyle(2, gold, 0.9);
    g.strokeRoundedRect(
      this.scale.width / 2 - width / 2,
      y - 1,
      width,
      2,
      1
    );
    // Tiny flag label centered on the line.
    const label = this.add
      .text(this.scale.width / 2, y - 12, `PB ${this.personalBest}`, {
        fontFamily: 'Arial Black',
        fontSize: '11px',
        color: '#ffd166',
        backgroundColor: 'rgba(8, 10, 26, 0.78)',
        padding: { x: 6, y: 2 } as Phaser.Types.GameObjects.Text.TextPadding,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(8);
    this.pbGhostLabel = label;
  }

  private ensurePbGhostLayer(): Phaser.GameObjects.Graphics {
    if (!this.pbGhostGraphics) {
      this.pbGhostGraphics = this.add.graphics();
      this.pbGhostGraphics.setDepth(7);
    }
    return this.pbGhostGraphics;
  }

  private drawStacks() {
    const g = this.platformGraphics;
    g.clear();
    const palette = PALETTES[this.daily.paletteId];
    const shadowCol = Phaser.Display.Color.HexStringToColor(palette.shadow).color;
    const windowCol = Phaser.Display.Color.HexStringToColor(palette.mid).color;
    for (const s of this.stacks) {
      const left = s.x - s.width / 2;
      const topY = s.y - PLATFORM_HEIGHT / 2;
      g.fillStyle(s.color, s.isGhost ? 0.7 : 1);
      g.fillRect(left, topY, s.width, PLATFORM_HEIGHT);
      // Lit windows give the stack a city-skyline read instead of plain bars.
      this.drawWindows(g, left, topY, s.width, s.isGhost, windowCol);
      // Subtle base shadow for solid blocks.
      if (!s.isGhost) {
        g.fillStyle(shadowCol, 0.18);
        g.fillRect(left, s.y + PLATFORM_HEIGHT / 2 - 4, s.width, 4);
      }
    }
  }

  // Periodically redraws a subset of the windows so they flicker on/off.
  // Cheap: only re-randomises the *pattern*, never the geometry.
  private startWindowFlicker() {
    if (this.windowFlickerEvent) {
      this.windowFlickerEvent.remove();
      this.windowFlickerEvent = null;
    }
    // Re-randomise the window flicker pattern ~6 times per second.
    this.windowFlickerEvent = this.time.addEvent({
      delay: 160,
      loop: true,
      callback: () => this.redrawWindows(),
    });
  }

  private redrawWindows() {
    if (!this.daily || this.stacks.length === 0) return;
    const palette = PALETTES[this.daily.paletteId];
    const windowCol = Phaser.Display.Color.HexStringToColor(palette.mid).color;
    const g = this.windowLayer;
    g.clear();
    for (const s of this.stacks) {
      if (s.isGhost) continue;
      const left = s.x - s.width / 2;
      const topY = s.y - PLATFORM_HEIGHT / 2;
      this.drawWindows(g, left, topY, s.width, false, windowCol, true);
    }
  }

  private drawWindows(
    g: Phaser.GameObjects.Graphics,
    left: number,
    topY: number,
    width: number,
    isGhost: boolean,
    windowCol: number,
    flicker = false
  ) {
    const winW = 6;
    const winH = 8;
    const gap = 8;
    const stride = winW + gap;
    const usable = width - gap;
    if (usable < stride) return;
    const count = Math.floor(usable / stride);
    const inset = (width - (count * stride - gap)) / 2;
    const winY = topY + (PLATFORM_HEIGHT - winH) / 2;
    for (let i = 0; i < count; i++) {
      // Deterministic "lit" pattern so the stack looks the same on first draw,
      // and a flicker variant that re-randomises on every window-flicker tick.
      const lit = flicker
        ? Math.random() > 0.42
        : i % 3 !== 1;
      const alpha = isGhost ? 0.18 : lit ? 0.85 : 0.25;
      g.fillStyle(windowCol, alpha);
      g.fillRect(left + inset + i * stride, winY, winW, winH);
    }
  }

  private startRun() {
    if (this.isStarted) return;
    if (!this.daily) return; // Still loading / errored — nothing to start.
    this.isStarted = true;
    this.perfectRun = true;
    this.perfectCount = 0;
    this.perfectCombo = 0;
    this.goalCelebrated = false;
    audio.resume();
    this.hideOverlay();
    this.hideTutorialBanner();
    this.markTutorialDone();
    this.showTapHint();
    // Spawn the very first moving block (its base is the top of the starting stack).
    const top = this.stacks[this.stacks.length - 1]!;
    this.spawnMovingBlock(top.y - PLATFORM_HEIGHT, top.width, 0);
    this.isRunning = true;
  }

  private retry() {
    this.isRunning = false;
    this.isStarted = false;
    this.perfectRun = true;
    this.perfectCount = 0;
    this.perfectCombo = 0;
    this.goalCelebrated = false;
    this.stacks = [];
    this.particleLayer.clear();
    this.windowLayer.clear();
    this.pbGhostGraphics?.clear();
    this.pbGhostLabel?.destroy();
    this.pbGhostLabel = null;
    this.pbGhost = null;
    this.hideTapHint();
    this.hideCombo();
    if (this.currentTween) {
      this.currentTween.stop();
      this.currentTween = null;
    }
    if (this.currentBlock) this.currentBlock.destroy();
    if (this.currentShadow) this.currentShadow.destroy();
    this.camera.scrollY = 0;
    this.seedGhostFloors();
    this.updateHud();
    this.showOverlay({
      title: 'Ready again?',
      sub: 'Stack blocks to add to today’s sub skyline.',
      button: 'STACK',
      leaderboardHtml: this.leaderboardHtml(),
      rivalHtml: this.rivalHtml(),
    });
  }

  private spawnMovingBlock(y: number, width: number, depth: number) {
    const palette = PALETTES[this.daily.paletteId];
    const blockColor = Phaser.Display.Color.HexStringToColor(palette.block).color;
    const shadowColor = Phaser.Display.Color.HexStringToColor(palette.shadow).color;

    // Top of the current stack (guarded: seedGhostFloors guarantees >=1 entry).
    const top = this.stacks[this.stacks.length - 1]!;

    this.currentWidth = width;
    this.currentDepth = depth;
    this.currentDirection = depth % 2 === 0 ? 1 : -1;
    // Swing speed ramps with depth so the challenge escalates as the tower grows.
    this.currentSpeedDeg = this.daily.swingSpeed + depth * 6;

    // Shadow on the next-down platform to show drop position.
    if (this.currentShadow) this.currentShadow.destroy();
    this.currentShadow = this.add.rectangle(
      top.x,
      top.y + PLATFORM_HEIGHT,
      width,
      4,
      shadowColor,
      0.35
    );
    this.currentShadow.setDepth(15);

    if (this.currentBlock) this.currentBlock.destroy();
    this.currentBlock = this.add.rectangle(0, y, width, PLATFORM_HEIGHT, blockColor, 1);
    this.currentBlock.setStrokeStyle(2, shadowColor, 0.6);
    this.currentBlock.setDepth(10);

    // Use a tween for the swing so we get a deterministic, frame-rate independent motion.
    const minX = width / 2 + 8;
    const maxX = this.scale.width - width / 2 - 8;
    const distance = maxX - minX;
    // Convert deg/sec to ms duration for a full sweep. Easier to think in pixels/sec.
    const speedPxPerSec = 220 + this.currentSpeedDeg * 2;
    const durationMs = (distance * 2 * 1000) / speedPxPerSec;

    if (this.currentTween) this.currentTween.stop();
    this.currentTween = this.tweens.add({
      targets: this.currentBlock,
      x: { from: minX, to: maxX },
      duration: durationMs / 2,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
      onRepeat: () => {
        this.currentDirection *= -1;
      },
    });

    // Tap / click / spacebar drops the block.
    this.input.once('pointerdown', this.handleDrop, this);
    this.input.keyboard?.once('keydown-SPACE', this.handleDrop, this);
  }

  private handleDrop() {
    if (!this.isRunning) return;
    const blockX = this.currentBlock.x;
    const blockY = this.currentBlock.y;
    const top = this.stacks[this.stacks.length - 1]!;
    const topX = top.x;
    const topY = top.y;
    const topWidth = top.width;

    const overlapStart = Math.max(blockX - this.currentWidth / 2, topX - topWidth / 2);
    const overlapEnd = Math.min(blockX + this.currentWidth / 2, topX + topWidth / 2);
    const overlap = overlapEnd - overlapStart;

    if (this.currentTween) {
      this.currentTween.stop();
      this.currentTween = null;
    }

    if (overlap <= 0) {
      // Missed entirely. The block falls off the side. End the run.
      this.miss(blockX, blockY);
      return;
    }

    const newWidth = overlap;
    const newX = (overlapStart + overlapEnd) / 2;
    const newY = topY - PLATFORM_HEIGHT;
    const palette = PALETTES[this.daily.paletteId];
    const blockColor = Phaser.Display.Color.HexStringToColor(palette.block).color;

    const perfect = Math.abs(overlap - topWidth) < 1.5;
    if (perfect) {
      this.perfectCount += 1;
      this.perfectCombo += 1;
      audio.perfect(this.perfectCombo);
      vibrate(12);
      // Feedback escalates with the combo so a hot streak feels louder.
      const intensity = Math.min(this.perfectCombo, 6);
      this.burstParticles(newX, newY, '#ffd166', 14 + intensity * 3);
      this.flashScreen('#ffd166', 0.1 + intensity * 0.015);
      // Grow the next block slightly to make perfect stacks feel rewarding.
      this.currentWidth = Math.min(this.currentWidth + 6, PLAY_WIDTH);
      this.showCombo();
    } else {
      this.perfectRun = false;
      this.perfectCombo = 0;
      audio.drop();
      vibrate(8);
      this.burstParticles(blockX, blockY, '#ef476f', 6);
      this.hideCombo();
    }

    this.stacks.push({
      x: newX,
      y: newY,
      width: newWidth,
      depth: this.currentDepth + 1,
      color: tintedBlockColor(blockColor, this.currentDepth + 1),
      isGhost: false,
    });

    // Squash/stretch the dropped block as it lands. The block briefly squashes
    // vertically and bulges horizontally so every stack has a satisfying thump.
    // We also briefly tint it with the accent so the player reads the impact.
    this.currentBlock.setFillStyle(0xffd166, 1);
    this.currentBlock.setStrokeStyle(2, shadowColorForPalette(this.daily), 0.6);
    this.tweens.add({
      targets: this.currentBlock,
      scaleY: { from: 0.55, to: 1 },
      scaleX: { from: 1.18, to: 1 },
      duration: 220,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        // Restore the canonical block color before drawing into the stack.
        this.currentBlock.setFillStyle(
          Phaser.Display.Color.HexStringToColor(PALETTES[this.daily.paletteId].block).color,
          1
        );
      },
    });

    // Trim the dropped moving block to its placed width, then animate it into place.
    this.tweens.add({
      targets: this.currentBlock,
      x: newX,
      width: newWidth,
      duration: 120,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.currentBlock.destroy();
        this.drawStacks();
        // Camera follows the new top — keep gameplay visible.
        const targetY = Math.max(0, newY - this.scale.height * 0.45);
        this.tweens.add({
          targets: this.camera,
          scrollY: targetY,
          duration: 280,
          ease: 'Cubic.easeOut',
        });
        const nextDepth = this.currentDepth + 1;
        const placedFloors = this.stacks.filter((s) => !s.isGhost).length - 1;
        this.updateScore(placedFloors);
        // Reset swing speed for the next block using the new width.
        const nextWidth = perfect
          ? this.currentWidth
          : Math.max(60, newWidth - 4);
        this.spawnMovingBlock(newY - PLATFORM_HEIGHT, nextWidth, nextDepth);
      },
    });
  }

  private miss(blockX: number, blockY: number) {
    this.isRunning = false;
    this.hideTapHint();
    this.hideCombo();
    const palette = PALETTES[this.daily.paletteId];
    const blockColor = Phaser.Display.Color.HexStringToColor(palette.block).color;
    // Save the dropped block, color it red, and animate it falling.
    if (this.currentBlock) {
      this.currentBlock.setFillStyle(0xef476f, 1);
      this.currentBlock.setStrokeStyle(2, 0x000000, 0.5);
    }
    if (this.currentShadow) this.currentShadow.destroy();
    audio.miss();
    vibrate(28);
    this.cameras.main.shake(220, 0.012);
    this.burstParticles(blockX, blockY, '#ef476f', 14);
    this.flashScreen('#ef476f', 0.18);

    const fallDir = blockX < this.scale.width / 2 ? -1 : 1;
    this.tweens.add({
      targets: this.currentBlock,
      x: blockX + fallDir * 220,
      y: blockY + 600,
      angle: fallDir * 35,
      duration: 600,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.currentBlock.destroy();
      },
    });

    // Score = non-ghost floors minus the starting floor.
    const placedFloors = this.stacks.filter((s) => !s.isGhost).length - 1;
    void this.submitRun(placedFloors);
  }

  private async submitRun(floors: number) {
    const body: { floors: number; perfect: boolean } = {
      floors,
      perfect: this.perfectRun && floors > 0,
    };
    let data: SubmitResponse;
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`submit ${res.status}`);
      data = (await res.json()) as SubmitResponse;
    } catch (err) {
      console.error('submit failed', err);
      this.showError('Could not save your run.', () => void this.submitRun(floors));
      return;
    }
    this.communityFloors = data.communityFloors;
    this.personalBest = data.personalBest;
    this.streak = data.streak;
    this.builders = data.builders;
    this.leaderboard = data.leaderboard;
    this.updateHud();
    if (data.goalReached && !this.goalCelebrated) {
      this.goalCelebrated = true;
      audio.goal();
      vibrate(45);
      this.showGoalBanner();
      this.celebrationBurst();
    }
    this.endRun(data);
  }

  // Goal-reached celebration: a confetti burst of golden particles raining
  // across the whole canvas. Cheap to render (12 rectangles via tween).
  private celebrationBurst() {
    const { width, height } = this.scale;
    const palette = PALETTES[this.daily.paletteId];
    const colors = [
      palette.block,
      '#ffd166',
      '#ef476f',
      '#06d6a0',
      palette.mid,
    ];
    for (let i = 0; i < 40; i++) {
      const color = Phaser.Display.Color.HexStringToColor(
        colors[i % colors.length]!
      ).color;
      const r = this.add.rectangle(
        Math.random() * width,
        -20,
        6,
        10,
        color,
        1
      ) as Particle;
      r.setScrollFactor(0);
      r.setDepth(40);
      r.setRotation(Math.random() * Math.PI);
      this.tweens.add({
        targets: r,
        y: height + 40,
        x: r.x + (Math.random() - 0.5) * 80,
        angle: r.angle + (Math.random() - 0.5) * 8,
        duration: 1400 + Math.random() * 800,
        delay: Math.random() * 400,
        ease: 'Cubic.easeIn',
        onComplete: () => r.destroy(),
      });
    }
  }

  private endRun(data: SubmitResponse) {
    const placedFloors = this.stacks.filter((s) => !s.isGhost).length - 1;
    const beat = data.improvedPb && placedFloors > 0;
    const perfect = this.perfectRun && placedFloors > 0;
    const goal = data.goalReached;
    const summaryLines: string[] = [];
    summaryLines.push(
      `<div class="summary-row"><span class="label">Floors stacked</span><span class="value">${placedFloors}</span></div>`
    );
    summaryLines.push(
      `<div class="summary-row"><span class="label">Added to sub</span><span class="value">+${data.floorsAdded}</span></div>`
    );
    summaryLines.push(
      `<div class="summary-row"><span class="label">Sub total</span><span class="value">${data.communityFloors} / ${this.daily.communityGoal}</span></div>`
    );
    summaryLines.push(
      `<div class="summary-row"><span class="label">Builders today</span><span class="value">${data.builders}</span></div>`
    );
    summaryLines.push(
      `<div class="summary-row"><span class="label">Streak</span><span class="value">${data.streak}🔥</span></div>`
    );
    if (perfect) summaryLines.push(`<div class="summary-row" style="color:#ffd166"><span class="label">Perfect run</span><span class="value">all clean</span></div>`);
    if (goal) summaryLines.push(`<div class="summary-row" style="color:#06d6a0"><span class="label">Sub goal</span><span class="value">REACHED 🎉</span></div>`);

    // Share templates — three short, pre-written comments the player can post
    // on the post. The form endpoint is fixed-template (no free text), so
    // moderation/abuse is bounded by the templates themselves.
    const shareHtml = `<div id="overlay-share">
      <div class="share-title">Share to this post</div>
      <div class="share-buttons">
        <button class="share-btn" data-share="1" type="button">Just my score</button>
        <button class="share-btn" data-share="2" type="button">Brag</button>
        <button class="share-btn" data-share="3" type="button">Rally the sub</button>
      </div>
    </div>`;

    const overlayTitle = beat
      ? placedFloors === 0
        ? 'Tough break'
        : 'New personal best!'
      : placedFloors === 0
      ? 'One more try'
      : 'Nice stack';
    this.showOverlay({
      title: overlayTitle,
      sub: goal
        ? 'You helped the sub reach today’s goal. Come back tomorrow.'
        : 'Keep adding to the sub’s skyline.',
      button: 'STACK AGAIN',
      summaryHtml: summaryLines.join('') + shareHtml,
      leaderboardHtml: this.leaderboardHtml(),
      rivalHtml: this.rivalHtml(),
    });
    // Wire the share buttons to a server-side form. The Devvit form handler
    // we registered is fixed-template, so this is a single click → toast.
    document
      .querySelectorAll<HTMLButtonElement>('#overlay-share .share-btn')
      .forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const choice = btn.getAttribute('data-share') ?? '1';
          try {
            await fetch('/internal/form/share-result', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: choice }),
            });
            btn.textContent = '✓ Queued';
            btn.disabled = true;
          } catch {
            btn.textContent = 'Try again';
          }
        };
      });
  }

  // Build the "Today's builders" leaderboard markup from the latest server data.
  private leaderboardHtml(): string {
    if (!this.leaderboard.length) return '';
    const rows = this.leaderboard
      .map((e, i) => {
        const you =
          e.username.toLowerCase() === this.username.toLowerCase()
            ? ' lb-you'
            : '';
        const perfect = e.perfect ? ' <span class="lb-perfect">★</span>' : '';
        const name = this.escapeHtml(e.username);
        return `<div class="lb-row"><span class="lb-rank">${i + 1}</span><span class="lb-name${you}">${name}${perfect}</span><span class="lb-floors">${e.floors}</span></div>`;
      })
      .join('');
    return `<div id="overlay-leaderboard"><div class="lb-title">Today's builders</div>${rows}</div>`;
  }

  // Rival indicator: a single-line callout above the leaderboard that points
  // at whoever is currently topping the day's tower (other than the player).
  // Drives explicit competition and a clear next move for the player.
  private rivalHtml(): string {
    const youLc = this.username.toLowerCase();
    const rival = this.leaderboard.find(
      (e) => e.username.toLowerCase() !== youLc
    );
    if (!rival) return '';
    const name = this.escapeHtml(rival.username);
    return `<div id="overlay-rival"><span class="rival-arrow">▲</span> Beat <span class="rival-name">u/${name}</span> (${rival.floors} floors)</div>`;
  }

  private escapeHtml(s: string): string {
    return s.replace(
      /[&<>"']/g,
      (ch) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[ch] ?? ch
    );
  }

  private updateScore(floors: number) {
    const el = document.getElementById('score-value');
    if (el) el.textContent = String(floors);
  }

  private updateHud() {
    const scoreEl = document.getElementById('score-value');
    const commEl = document.getElementById('community-value');
    const goalEl = document.getElementById('community-goal');
    const streakEl = document.getElementById('streak-value');
    const fillEl = document.getElementById('progress-fill');
    if (scoreEl) scoreEl.textContent = String(this.stacks.filter((s) => !s.isGhost).length - 1);
    if (commEl) commEl.textContent = String(this.communityFloors);
    if (goalEl) goalEl.textContent = String(this.daily.communityGoal);
    if (streakEl) streakEl.textContent = String(this.streak);
    if (fillEl) {
      const pct = Math.min(100, (this.communityFloors / Math.max(1, this.daily.communityGoal)) * 100);
      fillEl.style.width = `${pct}%`;
    }
  }

  private showOverlay(opts: {
    title: string;
    sub: string;
    button: string;
    summaryHtml?: string;
    leaderboardHtml?: string;
    rivalHtml?: string;
    onButton?: () => void;
  }) {
    const overlay = document.getElementById('overlay');
    const titleEl = document.getElementById('overlay-title');
    const subEl = document.getElementById('overlay-sub');
    const btn = document.getElementById('overlay-button') as HTMLButtonElement | null;
    const card = document.getElementById('overlay-card');
    if (!overlay || !titleEl || !subEl || !btn || !card) return;
    titleEl.textContent = opts.title;
    subEl.textContent = opts.sub;
    btn.textContent = opts.button;
    btn.hidden = false;
    btn.onclick =
      opts.onButton ??
      (() => {
        if (this.isStarted && !this.isRunning) {
          // End-of-run overlay: retry
          this.retry();
        } else {
          this.startRun();
        }
      });
    // Make the entire card tappable on touch devices so players don't have
    // to aim for the button. Mouse clicks still go through (the button is
    // the most visible target), but touch is forgiving.
    card.onclick = (e) => {
      if (e.target === btn) return; // button handles its own click
      btn.click();
    };
    // Rival indicator sits between the description and the leaderboard.
    this.setOverlaySection('overlay-rival', opts.rivalHtml, btn, card);
    this.setOverlaySection('overlay-summary', opts.summaryHtml, btn, card);
    this.setOverlaySection('overlay-leaderboard-wrap', opts.leaderboardHtml, btn, card);
    overlay.classList.remove('overlay-hidden');
  }

  // Insert/update/remove an HTML section inside the overlay card, kept ordered
  // before the action button.
  private setOverlaySection(
    id: string,
    html: string | undefined,
    btn: HTMLElement,
    card: HTMLElement
  ) {
    let el = document.getElementById(id);
    if (html) {
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        card.insertBefore(el, btn);
      }
      el.innerHTML = html;
    } else if (el) {
      el.remove();
    }
  }

  private showLoading() {
    this.showOverlay({
      title: 'Loading…',
      sub: "Fetching today's skyline",
      button: '',
      onButton: () => {},
    });
    const btn = document.getElementById('overlay-button') as HTMLButtonElement | null;
    if (btn) btn.hidden = true;
  }

  private showError(message: string, retry: () => void) {
    this.showOverlay({
      title: 'Something went wrong',
      sub: message,
      button: 'RETRY',
      onButton: retry,
    });
  }

  private hideOverlay() {
    const overlay = document.getElementById('overlay');
    overlay?.classList.add('overlay-hidden');
  }

  private burstParticles(x: number, y: number, color: string, count: number) {
    const g = this.particleLayer;
    const col = Phaser.Display.Color.HexStringToColor(color).color;
    const rects: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const r = this.add.rectangle(x, y, 4, 4, col, 1) as Particle;
      r.setDepth(20);
      rects.push(r);
    }
    rects.forEach((r, i) => {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const dist = 30 + Math.random() * 40;
      this.tweens.add({
        targets: r,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.2,
        duration: 380,
        ease: 'Cubic.easeOut',
        onComplete: () => r.destroy(),
      });
    });
    // Touch g so the reference stays meaningful even if particle rects are GC'd.
    void g;
  }

  private flashScreen(color: string, alpha: number) {
    const flash = this.add.rectangle(
      this.scale.width / 2,
      this.scale.height / 2,
      this.scale.width,
      this.scale.height,
      Phaser.Display.Color.HexStringToColor(color).color,
      alpha
    );
    flash.setScrollFactor(0);
    flash.setDepth(30);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 280,
      ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  private handleResize(width: number, height: number) {
    this.cameras.resize(width, height);
    this.background.setPosition(0, 0);
    if (this.daily) {
      this.paintBackground();
      this.drawStacks();
    }
  }
}
