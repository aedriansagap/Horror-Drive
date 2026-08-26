export interface TelemetryData {
  speed: number; // km/h
  rpm: number;
  gear: string;
  distance: number; // meters
  health: number; // 0..100
  fuel: number;
  gForce: number;
  headlightMode: number;
  hazardsActive: boolean;
  radioStation: number;
  cameraMode: string;
  radarEntities: { x: number; z: number; type: string }[];
  alertMessage?: string;
}

export class HUD {
  private container: HTMLDivElement;
  private radarCanvas: HTMLCanvasElement;
  private radarCtx: CanvasRenderingContext2D;
  private radarAngle = 0;

  // DOM element caches
  private speedElem!: HTMLElement;
  private speedNeedle!: SVGLineElement;
  private rpmElem!: HTMLElement;
  private rpmNeedle!: SVGLineElement;
  private gearElem!: HTMLElement;
  private odoElem!: HTMLElement;
  private healthBar!: HTMLElement;
  private healthText!: HTMLElement;
  private gForceElem!: HTMLElement;
  private lightBadge!: HTMLElement;
  private hazardBadge!: HTMLElement;
  private radioBadge!: HTMLElement;
  private cameraBadge!: HTMLElement;
  private alertBanner!: HTMLElement;
  private alertTimeout: any = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'hud-container';
    this.container.innerHTML = `
      <!-- TOP STATUS BAR -->
      <header class="hud-top-bar">
        <div class="hud-brand">
          <span class="hud-pulse-dot" id="hud-status-dot"></span>
          <span class="hud-title">VANGUARD FLEET TELEMETRY &bull; UNIT #409</span>
        </div>
        <div class="hud-center-status">
          <span class="hud-sub">ROUTE 99 &bull; SECTOR 7</span>
          <div class="hud-odo-display" id="hud-odo">KM 000.00</div>
        </div>
        <div class="hud-top-actions">
          <button id="btn-pause" class="hud-btn-ghost" title="Settings & Diagnostics (ESC)">[ESC] DIAGNOSTICS</button>
        </div>
      </header>

      <!-- CENTER ALERT BANNER -->
      <div id="hud-alert-banner" class="hud-alert-banner hidden">
        <span class="hud-alert-icon">⚠️</span>
        <span id="hud-alert-text">PROXIMITY WARNING</span>
      </div>

      <!-- BOTTOM TELEMETRY DOCK -->
      <footer class="hud-bottom-dock">
        <!-- GAUGES CLUSTER -->
        <div class="hud-cluster hud-left-cluster">
          <!-- SPEEDOMETER -->
          <div class="hud-gauge-box">
            <svg class="hud-dial-svg" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" class="dial-bg"/>
              <path d="M 25 95 A 50 50 0 1 1 95 95" class="dial-track"/>
              <line id="speed-needle" x1="60" y1="60" x2="60" y2="18" class="dial-needle" transform="rotate(-120 60 60)"/>
              <circle cx="60" cy="60" r="6" class="dial-center"/>
            </svg>
            <div class="hud-gauge-digital">
              <div class="hud-gauge-val" id="hud-speed-val">0</div>
              <div class="hud-gauge-lbl">KM/H</div>
            </div>
          </div>

          <!-- TACHOMETER -->
          <div class="hud-gauge-box">
            <svg class="hud-dial-svg" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" class="dial-bg"/>
              <path d="M 25 95 A 50 50 0 1 1 95 95" class="dial-track tach-track"/>
              <line id="rpm-needle" x1="60" y1="60" x2="60" y2="18" class="dial-needle rpm-needle-color" transform="rotate(-120 60 60)"/>
              <circle cx="60" cy="60" r="6" class="dial-center"/>
            </svg>
            <div class="hud-gauge-digital">
              <div class="hud-gauge-val" id="hud-rpm-val">800</div>
              <div class="hud-gauge-lbl">RPM</div>
            </div>
          </div>

          <!-- GEAR & METRICS -->
          <div class="hud-metrics-column">
            <div class="hud-gear-box">
              <span class="gear-lbl">GEAR</span>
              <span class="gear-val" id="hud-gear-val">D</span>
            </div>
            <div class="hud-stat-line">
              <span class="stat-lbl">LAT G:</span>
              <span class="stat-val" id="hud-gforce-val">0.00 G</span>
            </div>
          </div>
        </div>

        <!-- CONTROLS & SYSTEM BADGES -->
        <div class="hud-center-cluster">
          <div class="hud-badge-strip">
            <div class="hud-badge active" id="badge-lights" title="Toggle Headlights [F]">
              <span class="badge-icon">💡</span>
              <span class="badge-text" id="badge-lights-text">HIGH BEAM</span>
              <span class="badge-key">F</span>
            </div>
            <div class="hud-badge" id="badge-hazards" title="Hazard Flashers [H]">
              <span class="badge-icon">⚠️</span>
              <span class="badge-text" id="badge-hazards-text">HAZARDS</span>
              <span class="badge-key">H</span>
            </div>
            <div class="hud-badge" id="badge-camera" title="Switch View [C]">
              <span class="badge-icon">🎥</span>
              <span class="badge-text" id="badge-camera-text">CHASE CAM</span>
              <span class="badge-key">C</span>
            </div>
            <div class="hud-badge" id="badge-radio" title="In-Car Radio [R]">
              <span class="badge-icon">📻</span>
              <span class="badge-text" id="badge-radio-text">RADIO: OFF</span>
              <span class="badge-key">R</span>
            </div>
          </div>
          <div class="hud-integrity-box">
            <div class="hud-bar-header">
              <span>VEHICLE INTEGRITY</span>
              <span id="hud-health-num">100%</span>
            </div>
            <div class="hud-progress-bg">
              <div id="hud-health-fill" class="hud-progress-fill" style="width: 100%;"></div>
            </div>
          </div>
        </div>

        <!-- TACTICAL SCANNER RADAR -->
        <div class="hud-cluster hud-right-cluster">
          <div class="radar-wrapper">
            <canvas id="hud-radar-canvas" width="130" height="130"></canvas>
            <div class="radar-crosshair"></div>
            <div class="radar-label">TACTICAL SCANNER</div>
          </div>
        </div>
      </footer>
    `;

    document.body.appendChild(this.container);

    // Cache elements
    this.speedElem = document.getElementById('hud-speed-val')!;
    this.speedNeedle = document.getElementById('speed-needle')! as unknown as SVGLineElement;
    this.rpmElem = document.getElementById('hud-rpm-val')!;
    this.rpmNeedle = document.getElementById('rpm-needle')! as unknown as SVGLineElement;
    this.gearElem = document.getElementById('hud-gear-val')!;
    this.odoElem = document.getElementById('hud-odo')!;
    this.healthBar = document.getElementById('hud-health-fill')!;
    this.healthText = document.getElementById('hud-health-num')!;
    this.gForceElem = document.getElementById('hud-gforce-val')!;
    this.lightBadge = document.getElementById('badge-lights')!;
    this.hazardBadge = document.getElementById('badge-hazards')!;
    this.radioBadge = document.getElementById('badge-radio')!;
    this.cameraBadge = document.getElementById('badge-camera')!;
    this.alertBanner = document.getElementById('hud-alert-banner')!;

    this.radarCanvas = document.getElementById('hud-radar-canvas') as HTMLCanvasElement;
    this.radarCtx = this.radarCanvas.getContext('2d')!;
  }

  public showAlert(message: string, durationMs: number = 3200) {
    const textElem = document.getElementById('hud-alert-text');
    if (textElem) textElem.innerText = message;
    this.alertBanner.classList.remove('hidden');

    if (this.alertTimeout) clearTimeout(this.alertTimeout);
    this.alertTimeout = setTimeout(() => {
      this.alertBanner.classList.add('hidden');
    }, durationMs);
  }

  public update(data: TelemetryData, dt: number) {
    // 1. Digital Speed & Needle
    const clampedSpeed = Math.max(0, Math.min(160, data.speed));
    this.speedElem.innerText = Math.round(clampedSpeed).toString();
    const speedAngle = -120 + (clampedSpeed / 160) * 240;
    this.speedNeedle.setAttribute('transform', `rotate(${speedAngle} 60 60)`);

    // 2. RPM & Needle
    const clampedRpm = Math.max(800, Math.min(7500, data.rpm));
    this.rpmElem.innerText = Math.round(clampedRpm).toString();
    const rpmAngle = -120 + ((clampedRpm - 800) / (7500 - 800)) * 240;
    this.rpmNeedle.setAttribute('transform', `rotate(${rpmAngle} 60 60)`);

    // 3. Gear & Odometer
    this.gearElem.innerText = data.gear;
    const km = (data.distance / 1000).toFixed(2);
    this.odoElem.innerText = `KM ${km.padStart(6, '0')}`;

    // 4. Lateral G
    this.gForceElem.innerText = `${Math.abs(data.gForce).toFixed(2)} G`;

    // 5. Vehicle Integrity
    const healthPercent = Math.max(0, Math.round(data.health));
    this.healthText.innerText = `${healthPercent}%`;
    this.healthBar.style.width = `${healthPercent}%`;
    if (healthPercent > 50) {
      this.healthBar.style.background = 'linear-gradient(90deg, #00ffaa, #00d4ff)';
    } else if (healthPercent > 25) {
      this.healthBar.style.background = 'linear-gradient(90deg, #ffbb00, #ff8800)';
    } else {
      this.healthBar.style.background = 'linear-gradient(90deg, #ff2244, #ff0055)';
    }

    // 6. Badges
    const lightLabels = ['LIGHTS OFF', 'LOW BEAM', 'HIGH BEAM'];
    const lightText = document.getElementById('badge-lights-text');
    if (lightText) lightText.innerText = lightLabels[data.headlightMode] || 'LIGHTS';
    this.lightBadge.classList.toggle('active', data.headlightMode > 0);

    this.hazardBadge.classList.toggle('active', data.hazardsActive);

    const camText = document.getElementById('badge-camera-text');
    if (camText) camText.innerText = data.cameraMode.toUpperCase();
    this.cameraBadge.classList.toggle('active', data.cameraMode.includes('Cockpit'));

    const radioStations = ['RADIO: OFF', 'EAS ALERT', 'DARK SYNTH', 'NUMBERS STN'];
    const radioText = document.getElementById('badge-radio-text');
    if (radioText) radioText.innerText = radioStations[data.radioStation] || 'RADIO';
    this.radioBadge.classList.toggle('active', data.radioStation > 0);

    // 7. Tactical Radar
    this.renderRadar(data.radarEntities, dt);
  }

  private renderRadar(entities: { x: number; z: number; type: string }[], dt: number) {
    const ctx = this.radarCtx;
    const w = this.radarCanvas.width;
    const h = this.radarCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = w / 2 - 4;

    ctx.clearRect(0, 0, w, h);

    // Background circle
    ctx.fillStyle = 'rgba(5, 12, 18, 0.8)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Range rings
    ctx.strokeStyle = 'rgba(0, 255, 170, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.7, 0, Math.PI * 2);
    ctx.stroke();

    // Sweeping radar scan line
    this.radarAngle += dt * 3.5;
    const sweepX = cx + Math.cos(this.radarAngle) * radius;
    const sweepY = cy + Math.sin(this.radarAngle) * radius;

    ctx.strokeStyle = 'rgba(0, 255, 170, 0.6)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sweepX, sweepY);
    ctx.stroke();

    // Center player blip
    ctx.fillStyle = '#00ffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Entity Blips
    const scale = radius / 90.0;
    for (const e of entities) {
      const rx = cx + e.x * scale;
      const ry = cy - e.z * scale;

      const dist = Math.hypot(rx - cx, ry - cy);
      if (dist <= radius) {
        if (e.type === 'stalker') {
          ctx.fillStyle = '#ff2244';
        } else if (e.type === 'phantom_truck') {
          ctx.fillStyle = '#ffaa00';
        } else {
          ctx.fillStyle = '#66ccff';
        }
        ctx.beginPath();
        ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = ctx.fillStyle;
        ctx.beginPath();
        ctx.arc(rx, ry, 6.0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  public setVisible(visible: boolean) {
    this.container.style.display = visible ? 'block' : 'none';
  }
}
