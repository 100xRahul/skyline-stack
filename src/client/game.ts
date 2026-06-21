import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { Boot } from './scenes/Boot';
import { GameScene } from './scenes/Game';
import { GameOver } from './scenes/GameOver';
import { MainMenu } from './scenes/MainMenu';
import { Preloader } from './scenes/Preloader';

// Vertical-stack game — fixed portrait-style resolution.
// We let Phaser SCALE.FIT the canvas to whatever the Devvit webview gives us.
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: '#0a0a1a',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 540,
    height: 960,
  },
  fps: { target: 60, forceSetTimeOut: false },
  scene: [Boot, Preloader, MainMenu, GameScene, GameOver],
};

const StartGame = (parent: string) =>
  new Game({ ...config, parent });

document.addEventListener('DOMContentLoaded', () => {
  StartGame('game-container');
});
