import { Scene } from 'phaser';

// GameOver is the Phaser scene that plays the "money shot" camera beat
// after a successful run. The DOM overlay inside GameScene handles the
// summary card and share buttons, but this scene owns the celebratory
// camera pan + zoom that frames the tower against the daily sky. A
// tap anywhere skips to the next run.
export class GameOver extends Scene {
  constructor() {
    super('GameOver');
  }

  create() {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(0x0a0a1a);

    this.add
      .text(width / 2, height * 0.92, 'Tap anywhere to stack again', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: 'rgba(255, 255, 255, 0.7)',
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(50);

    // Subtle parallax: pull the camera back a touch so the in-game tower
    // (if it persists across the scene transition) frames against the sky.
    this.cameras.main.zoomTo(0.85, 600, 'Cubic.easeInOut');

    this.input.once('pointerdown', () => this.scene.start('Game'));
  }
}
