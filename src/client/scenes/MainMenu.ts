import { Scene } from 'phaser';

export class MainMenu extends Scene {
  constructor() {
    super('MainMenu');
  }

  create() {
    // The overlay is the actual UI for menu state; we just route here so the
    // Boot -> Preloader -> MainMenu -> Game chain is preserved and the overlay
    // can show its CTA.
    this.scene.start('Game');
  }
}
