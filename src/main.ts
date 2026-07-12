import './style.css';
import { Game } from './core/Game';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="ui">
    <canvas id="radar" width="150" height="150" style="position: absolute; top: 20px; right: 20px; background: rgba(0,0,0,0.5); border: 2px solid #555; border-radius: 50%; pointer-events: none;"></canvas>
    <div style="display: flex; justify-content: space-between; width: 100%;">
      <div id="speed" style="font-size: 1.5rem; font-weight: bold;">0 km/h</div>
      <div id="status">Survive.</div>
    </div>
    <div id="controls-hint" style="color: rgba(255,255,255,0.7); text-align: left;">
      Controls: W/A/S/D or Arrows to Drive | SPACE to Brake
    </div>
    <div id="start-screen" class="center-text">
      <h1>HORROR DRIVE</h1>
      <p>Click to Start</p>
      <p style="font-size: 1rem">WASD or Arrows to Drive</p>
    </div>
    <div id="game-over-screen" class="center-text hidden">
      <h1 style="color: red">YOU DIED</h1>
      <p>Click to Restart</p>
    </div>
  </div>
`;

const game = new Game();

// Start game on click
document.addEventListener('click', () => {
  if (!game.isRunning) {
    document.getElementById('start-screen')?.classList.add('hidden');
    document.getElementById('game-over-screen')?.classList.add('hidden');
    game.start();
  }
});
