import './style.css';
import { Game } from './core/Game';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="ui">
    <div id="speed" style="font-size: 1.5rem; font-weight: bold;">0 km/h</div>
    <div id="status">Survive.</div>
    <div id="controls-hint" style="position: absolute; bottom: 20px; left: 20px; color: rgba(255,255,255,0.7);">
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
