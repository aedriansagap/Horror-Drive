import './style.css';
import { Game } from './core/Game';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <!-- START SCREEN -->
  <div id="start-screen" class="modal-backdrop">
    <div class="modal-card">
      <h1 class="modal-title">HORROR DRIVE</h1>
      <div class="modal-sub">HIGHWAY SURVIVAL PROTOCOL &bull; FLEET UNIT #409</div>

      <div class="controls-grid">
        <div class="ctrl-item">
          <span class="kbd-badge">W / ↑</span>
          <span>Throttle (Drive)</span>
        </div>
        <div class="ctrl-item">
          <span class="kbd-badge">S / ↓</span>
          <span>Brake / Reverse</span>
        </div>
        <div class="ctrl-item">
          <span class="kbd-badge">A / D</span>
          <span>Steer Left / Right</span>
        </div>
        <div class="ctrl-item">
          <span class="kbd-badge">SPACE</span>
          <span>Handbrake / Drift</span>
        </div>
        <div class="ctrl-item">
          <span class="kbd-badge">C</span>
          <span>Toggle Chase / Cockpit</span>
        </div>
        <div class="ctrl-item">
          <span class="kbd-badge">F</span>
          <span>Headlights (Low/High/Off)</span>
        </div>
        <div class="ctrl-item">
          <span class="kbd-badge">R</span>
          <span>In-Car Horror Radio</span>
        </div>
        <div class="ctrl-item">
          <span class="kbd-badge">H / E</span>
          <span>Hazards / Horn</span>
        </div>
      </div>

      <button id="btn-start-game" class="btn-primary">INITIALIZE DEPLOYMENT</button>
    </div>
  </div>

  <!-- GAME OVER SCREEN -->
  <div id="game-over-screen" class="modal-backdrop hidden">
    <div class="modal-card">
      <h1 class="modal-title game-over-title">MISSION CASUALTY</h1>
      <div class="modal-sub">VEHICLE COMPROMISED &bull; TELEMETRY ARCHIVED</div>

      <div class="debrief-stats">
        <div class="debrief-item">
          <span class="debrief-lbl">DISTANCE SURVIVED</span>
          <span class="debrief-val" id="debrief-dist">0.00 km</span>
        </div>
        <div class="debrief-item">
          <span class="debrief-lbl">PEAK VELOCITY</span>
          <span class="debrief-val" id="debrief-speed">0 km/h</span>
        </div>
        <div class="debrief-item">
          <span class="debrief-lbl">ENCOUNTERS</span>
          <span class="debrief-val" id="debrief-threats">0</span>
        </div>
      </div>

      <div class="debrief-rank" id="debrief-rating">EVALUATION: CASUALTY</div>

      <button id="btn-restart-game" class="btn-primary">RE-DEPLOY ASSET</button>
    </div>
  </div>

  <!-- DIAGNOSTICS & SETTINGS MODAL (ESC) -->
  <div id="diagnostics-modal" class="modal-backdrop hidden">
    <div class="modal-card">
      <h2 class="modal-title" style="font-size: 1.6rem;">FLEET DIAGNOSTICS</h2>
      <div class="modal-sub">UNIT #409 TELEMETRY & SYSTEM CONFIGURATION</div>

      <div class="settings-row">
        <span>Post-Processing Bloom:</span>
        <button id="btn-toggle-bloom" class="hud-btn-ghost">ENABLED</button>
      </div>
      <div class="settings-row">
        <span>Camera Perspective:</span>
        <button id="btn-toggle-cam" class="hud-btn-ghost">CHASE CAM</button>
      </div>
      <div class="settings-row">
        <span>Export Flight Telemetry:</span>
        <button id="btn-export-log" class="hud-btn-ghost">DOWNLOAD JSON</button>
      </div>

      <div style="display: flex; justify-content: center; gap: 14px; margin-top: 24px;">
        <button id="btn-resume-game" class="btn-primary" style="padding: 10px 28px; font-size: 0.95rem;">RESUME</button>
      </div>
    </div>
  </div>
`;

const game = new Game();

// Start button
const startBtn = document.getElementById('btn-start-game');
startBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('start-screen')?.classList.add('hidden');
  game.start();
});

// Restart button
const restartBtn = document.getElementById('btn-restart-game');
restartBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('game-over-screen')?.classList.add('hidden');
  game.start();
});

// Resume button
const resumeBtn = document.getElementById('btn-resume-game');
resumeBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  game.togglePause();
});

// Bloom toggle button
const bloomBtn = document.getElementById('btn-toggle-bloom');
bloomBtn?.addEventListener('click', () => {
  game.bloomEnabled = !game.bloomEnabled;
  bloomBtn.innerText = game.bloomEnabled ? 'ENABLED' : 'DISABLED';
});

// Camera mode toggle in modal
const camBtn = document.getElementById('btn-toggle-cam');
camBtn?.addEventListener('click', () => {
  game.cameraMode = game.cameraMode === 'chase' ? 'cockpit' : 'chase';
  camBtn.innerText = game.cameraMode.toUpperCase();
});

// Telemetry Export Log
const exportBtn = document.getElementById('btn-export-log');
exportBtn?.addEventListener('click', () => {
  const telemetryLog = {
    fleetId: 'VANGUARD-UNIT-409',
    timestamp: new Date().toISOString(),
    distanceTraveledMeters: game.runDistance,
    peakSpeedKmh: game.topSpeed,
    threatsHit: game.threatsHit,
    threatsAvoided: game.threatsAvoided,
    finalVehicleHealth: game.car.health,
    fuelRemaining: game.car.fuel,
    telemetryStatus: 'VALIDATED_ENTERPRISE_RUN',
  };

  const blob = new Blob([JSON.stringify(telemetryLog, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `telemetry-unit409-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
