import { Scene } from 'phaser';

export class Preloader extends Scene {
  constructor() {
    super('Preloader');
  }

  preload() {
    // Reserved for future sprites / sfx. Procedural art keeps the bundle
    // small and avoids any third-party asset licensing questions.
  }

  create() {
    this.scene.start('MainMenu');
  }
}
