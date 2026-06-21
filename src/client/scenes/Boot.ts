import { Scene } from 'phaser';

export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // No external assets — Skyline draws everything procedurally.
    // Boot is intentionally minimal so the Preloader can take over immediately.
  }

  create() {
    this.scene.start('Preloader');
  }
}
