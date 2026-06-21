import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type {
  DailySeed,
  InitResponse,
  LeaderboardEntry,
  SubmitResponse,
} from '../../shared/api';
import { PALETTES } from '../../shared/seed';
import { audio } from '../audio';

// Width of the play column relative to the game world. The camera stays focused
// on the stack and pans up as it grows.
const PLAY_WIDTH = 360;
const PLATFORM_HEIGHT = 28;
const FIRST_PLATFORM_Y_RATIO = 0.62;
const GHOST_FLOOR_RATIO = 0.85;

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

  private daily!: DailySeed;
  private communityFloors = 0;
  private personalBest = 0;
  private streak = 0;
  private builders = 0;
  private leaderboard: LeaderboardEntry[] = [];
  private username = 'guest';

  private stacks: Stack[] = [];
  private currentBlock!: Phaser.GameObjects.Rectangle;
  private currentShadow!: Phaser.GameObjects.Rectangle;
  private currentWidth = 0;
  private currentDepth = 0;
  private currentDirection = 1;
  private currentSpeedDeg = 0;
  private currentTween: Phaser.Tweens.Tween | null = null;

  private isRunning = false;
  private isStarted = false;
  private perfectRun = true;
  private perfectCount = 0;
  // Consecutive perfect drops within the current run, for escalating feedback.
  private perfectCombo = 0;

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

    this.scale.on('resize', this.handleResize, this);
    this.handleResize(this.scale.width, this.scale.height);

    this.setupMuteButton();

    // Wait for /api/init before showing the start overlay so HUD reflects real state.
    void this.bootstrap();
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

    this.paintBackground();
    this.seedGhostFloors();
    this.updateHud();
    const remaining = Math.max(0, this.daily.communityGoal - this.communityFloors);
    const base =
      remaining > 0
        ? `${remaining} floors left to reach today's goal. Stack as high as you can.`
        : "Today's goal is reached — keep stacking to push it higher.";
    this.showOverlay({
      title: this.daily.goalUnlocked ? 'Aurora unlocked ✨' : "Today's Skyline",
      sub: this.daily.goalUnlocked
        ? `The sub hit yesterday's goal, so today's skyline glows. ${base}`
        : base,
      button: 'START',
      leaderboardHtml: this.leaderboardHtml(),
    });
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

  private drawWindows(
    g: Phaser.GameObjects.Graphics,
    left: number,
    topY: number,
    width: number,
    isGhost: boolean,
    windowCol: number
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
      // Deterministic-ish "lit" pattern so it shimmers without re-randomising
      // every redraw: every third window is dark.
      const lit = i % 3 !== 1;
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
    audio.resume();
    this.hideOverlay();
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
    this.stacks = [];
    this.particleLayer.clear();
    if (this.currentTween) {
      this.currentTween.stop();
      this.currentTween = null;
    }
    if (this.currentBlock) this.currentBlock.destroy();
    if (this.currentShadow) this.currentShadow.destroy();
    this.camera.scrollY = 0;
    this.seedGhostFloors();
    this.showOverlay({
      title: 'Ready again?',
      sub: 'Stack blocks to add to today’s sub skyline.',
      button: 'STACK',
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
      // Feedback escalates with the combo so a hot streak feels louder.
      const intensity = Math.min(this.perfectCombo, 6);
      this.burstParticles(newX, newY, '#ffd166', 14 + intensity * 3);
      this.flashScreen('#ffd166', 0.1 + intensity * 0.015);
      // Grow the next block slightly to make perfect stacks feel rewarding.
      this.currentWidth = Math.min(this.currentWidth + 6, PLAY_WIDTH);
    } else {
      this.perfectRun = false;
      this.perfectCombo = 0;
      audio.drop();
      this.burstParticles(blockX, blockY, '#ef476f', 6);
    }

    this.stacks.push({
      x: newX,
      y: newY,
      width: newWidth,
      depth: this.currentDepth + 1,
      color: blockColor,
      isGhost: false,
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
    const palette = PALETTES[this.daily.paletteId];
    const blockColor = Phaser.Display.Color.HexStringToColor(palette.block).color;
    // Save the dropped block, color it red, and animate it falling.
    if (this.currentBlock) {
      this.currentBlock.setFillStyle(0xef476f, 1);
      this.currentBlock.setStrokeStyle(2, 0x000000, 0.5);
    }
    if (this.currentShadow) this.currentShadow.destroy();
    audio.miss();
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
    if (data.goalReached) audio.goal();
    this.endRun(data);
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
      summaryHtml: summaryLines.join(''),
      leaderboardHtml: this.leaderboardHtml(),
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
