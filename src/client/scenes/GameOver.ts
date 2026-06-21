import { Scene } from 'phaser';
import * as Phaser from 'phaser';

export class GameOver extends Scene {
  constructor() {
    super('GameOver');
  }

  create() {
    // Skyline's end-of-run summary is handled by the DOM overlay inside the
    // GameScene so we keep all game state in one place. This scene exists so
    // the scene chain (Boot -> Preloader -> MainMenu -> Game -> GameOver)
    // is preserved, and so a tap anywhere here routes the player back to a
    // fresh run.
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, 'Tap anywhere to stack again', {
        fontFamily: 'Arial Black',
        fontSize: '20px',
        color: '#fdfdfd',
        stroke: '#000000',
        strokeThickness: 4,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(50);

    this.cameras.main.setBackgroundColor(0x0a0a1a);
    this.input.once('pointerdown', () => this.scene.start('Game'));
  }
}
