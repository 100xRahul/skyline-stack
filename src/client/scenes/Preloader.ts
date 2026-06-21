import { Scene } from 'phaser';

// Preloader runs once at boot. Skyline has zero external assets, so we use
// the preloader to bake a few generated canvas textures: a "lit window"
// sprite, a "star" sprite, and a "confetti" sprite. Drawing them once
// here keeps the in-game scene work out of the per-frame hot path and
// lets the parallax city / star field / celebration burst use `add.image()`
// against shared GL textures instead of `add.rectangle()` for every dot.
export class Preloader extends Scene {
  static readonly TEX_WINDOW = 'skyline-window';
  static readonly TEX_STAR = 'skyline-star';
  static readonly TEX_CONFETTI = 'skyline-confetti';

  constructor() {
    super('Preloader');
  }

  create() {
    this.bakeWindowTexture();
    this.bakeStarTexture();
    this.bakeConfettiTexture();
    this.scene.start('MainMenu');
  }

  private bakeWindowTexture() {
    if (this.textures.exists(Preloader.TEX_WINDOW)) return;
    const cv = this.makeCanvas(16, 16, (ctx) => {
      const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 12);
      grad.addColorStop(0, 'rgba(255, 220, 140, 0.9)');
      grad.addColorStop(1, 'rgba(255, 180, 60, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = '#ffd66b';
      ctx.fillRect(3, 3, 10, 10);
      ctx.fillStyle = 'rgba(20, 14, 30, 0.6)';
      ctx.fillRect(7.5, 3, 1, 10);
      ctx.fillRect(3, 7.5, 10, 1);
    });
    this.textures.addCanvas(Preloader.TEX_WINDOW, cv);
  }

  private bakeStarTexture() {
    if (this.textures.exists(Preloader.TEX_STAR)) return;
    const cv = this.makeCanvas(8, 8, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(2, 2, 4, 4);
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(8, 4);
      ctx.lineTo(4, 8);
      ctx.lineTo(0, 4);
      ctx.closePath();
      ctx.fill();
    });
    this.textures.addCanvas(Preloader.TEX_STAR, cv);
  }

  private bakeConfettiTexture() {
    if (this.textures.exists(Preloader.TEX_CONFETTI)) return;
    const cv = this.makeCanvas(24, 16, (ctx) => {
      const cols = ['#ef476f', '#ffd166', '#06d6a0'];
      cols.forEach((c, i) => {
        ctx.fillStyle = c;
        const cx = 4 + i * 8;
        const cy = 8;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(((i - 1) * Math.PI) / 6);
        ctx.fillRect(-2, -4, 4, 8);
        ctx.restore();
      });
    });
    this.textures.addCanvas(Preloader.TEX_CONFETTI, cv);
  }

  private makeCanvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    draw(ctx);
    return cv;
  }
}
