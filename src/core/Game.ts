import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { World } from '../world/World';
import { Car } from '../entities/Car';
import { EnemyManager } from '../entities/EnemyManager';
import { AudioManager } from '../audio/AudioManager';
import { HUD, TelemetryData } from '../ui/HUD';

export class Game {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public composer: EffectComposer | null = null;
  public bloomPass: UnrealBloomPass | null = null;
  public physicsWorld: CANNON.World;

  public worldManager: World;
  public car: Car;
  public enemyManager: EnemyManager;
  public audioManager: AudioManager;
  public hud: HUD;

  public isRunning: boolean = false;
  public isPaused: boolean = false;
  private lastTime: number = 0;

  // Camera settings
  public cameraMode: 'chase' | 'cockpit' = 'chase';
  private targetCamPos = new THREE.Vector3();
  private camLookTarget = new THREE.Vector3();
  private cameraShake = 0;

  // Run Telemetry stats
  public runDistance = 0;
  public topSpeed = 0;
  public threatsAvoided = 0;
  public threatsHit = 0;
  public runStartTime = 0;

  // Graphics settings
  public bloomEnabled = true;

  constructor() {
    // 1. Scene
    this.scene = new THREE.Scene();

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 800);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    document.body.appendChild(this.renderer.domElement);

    // 4. Post-processing Composer
    try {
      this.composer = new EffectComposer(this.renderer);
      const renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(renderPass);

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.65, // strength
        0.35, // radius
        0.82  // threshold
      );
      this.composer.addPass(this.bloomPass);
    } catch (e) {
      console.warn('Postprocessing composer init warning, falling back to direct render:', e);
      this.composer = null;
    }

    // 5. Physics World
    this.physicsWorld = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    });
    this.physicsWorld.broadphase = new CANNON.SAPBroadphase(this.physicsWorld);

    const groundMaterial = new CANNON.Material('ground');
    const wheelMaterial = new CANNON.Material('wheel');
    const wheelContact = new CANNON.ContactMaterial(groundMaterial, wheelMaterial, {
      friction: 0.85,
      restitution: 0.05,
      contactEquationStiffness: 10000,
    });
    this.physicsWorld.addContactMaterial(wheelContact);

    // 6. Subsystems
    this.worldManager = new World(this.scene, this.physicsWorld, groundMaterial);
    this.car = new Car(this.scene, this.physicsWorld, wheelMaterial);
    this.enemyManager = new EnemyManager(this.scene, this.physicsWorld, this.car);
    this.audioManager = new AudioManager();
    this.hud = new HUD();

    // 7. Event bindings
    this.setupEventHandlers();

    // 8. Initial render
    this.renderer.render(this.scene, this.camera);
  }

  private setupEventHandlers() {
    window.addEventListener('resize', this.onWindowResize.bind(this));

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'c') {
        this.cameraMode = this.cameraMode === 'chase' ? 'cockpit' : 'chase';
        this.hud.showAlert(`CAMERA: ${this.cameraMode.toUpperCase()} VIEW`);
        this.audioManager.playClick();
      } else if (k === 'r') {
        const station = this.audioManager.cycleRadio();
        const names = ['RADIO: OFF', 'EAS BROADCAST', 'DARK SYNTH', 'NUMBERS STATION'];
        this.hud.showAlert(names[station]);
      } else if (k === 'e') {
        this.audioManager.playHorn();
      } else if (k === 'escape') {
        this.togglePause();
      }
    });

    // EnemyManager audio callbacks
    this.enemyManager.onSoundEvent = (event: string) => {
      if (event === 'screech') {
        this.audioManager.playScreech();
        this.hud.showAlert('⚠️ PROXIMITY ALERT: HOSTILE BIOLOGICAL NEARBY', 2500);
      } else if (event === 'thump') {
        this.audioManager.playThump();
        this.cameraShake = 0.6;
        this.threatsHit++;
      } else if (event === 'attack') {
        this.audioManager.playScreech();
        this.audioManager.playThump();
        this.cameraShake = 0.9;
        this.hud.showAlert('⚠️ CRITICAL: VEHICLE UNDER ATTACK!', 3000);
      } else if (event === 'static_glitch') {
        this.audioManager.playStaticGlitch();
      } else if (event === 'specter_wail') {
        this.audioManager.playStaticGlitch();
        this.hud.showAlert('👁️ APPARITION DETECTED & PASSED', 2500);
        this.threatsAvoided++;
      } else if (event === 'truck_horn') {
        this.audioManager.playTruckHorn();
        this.hud.showAlert('⚠️ HIGHWAY ALERT: PURSUIT VEHICLE IN REARVIEW!', 4000);
      } else if (event === 'crash') {
        this.audioManager.playThump();
        this.cameraShake = 1.4;
      }
    };

    this.enemyManager.onHitEvent = (_damage: number) => {
      if (this.car.health <= 0) {
        this.gameOver();
      }
    };

    // Weather thunder sound
    this.worldManager.onThunder = () => {
      this.audioManager.playThunder();
    };

    // Pause button in HUD
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => this.togglePause());
    }
  }

  public start() {
    if (this.isRunning) return;

    this.audioManager.init();
    this.isRunning = true;
    this.isPaused = false;
    this.runStartTime = performance.now();
    this.runDistance = 0;
    this.topSpeed = 0;
    this.threatsAvoided = 0;
    this.threatsHit = 0;

    this.car.reset(20);
    this.worldManager.reset(20);
    this.worldManager.update(this.car.getPosition(), 0.016);
    this.enemyManager.reset();
    this.hud.setVisible(true);

    // Immediately snap camera to vehicle
    const carPos = this.car.getPosition();
    const carQuat = this.car.getQuaternion();
    const chaseOffset = new THREE.Vector3(0, 2.3, -6.4).applyQuaternion(carQuat);
    this.camera.position.copy(carPos).add(chaseOffset);
    const lookOffset = new THREE.Vector3(0, 1.2, 14.0).applyQuaternion(carQuat);
    this.camera.lookAt(carPos.clone().add(lookOffset));

    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  public togglePause() {
    if (!this.isRunning) return;
    this.isPaused = !this.isPaused;
    const modal = document.getElementById('diagnostics-modal');
    if (modal) {
      modal.classList.toggle('hidden', !this.isPaused);
    }
  }

  public gameOver() {
    this.isRunning = false;
    this.hud.setVisible(false);
    this.audioManager.stop();
    this.car.brake();

    const gameOverScreen = document.getElementById('game-over-screen');
    if (gameOverScreen) {
      gameOverScreen.classList.remove('hidden');
      // Populate debriefing telemetry
      const distElem = document.getElementById('debrief-dist');
      if (distElem) distElem.innerText = `${(this.runDistance / 1000).toFixed(2)} km`;
      const speedElem = document.getElementById('debrief-speed');
      if (speedElem) speedElem.innerText = `${Math.round(this.topSpeed)} km/h`;
      const threatsElem = document.getElementById('debrief-threats');
      if (threatsElem) threatsElem.innerText = `${this.threatsHit} hits / ${this.threatsAvoided} evaded`;

      const ratingElem = document.getElementById('debrief-rating');
      if (ratingElem) {
        if (this.runDistance > 2500) ratingElem.innerText = 'FLEET SPECIALIST (GRADE A)';
        else if (this.runDistance > 1000) ratingElem.innerText = 'FIELD OPERATOR (GRADE B)';
        else ratingElem.innerText = 'CASUALTY (GRADE C)';
      }
    }
  }

  private loop(time: number) {
    if (!this.isRunning) return;
    requestAnimationFrame(this.loop.bind(this));

    const dt = Math.min((time - this.lastTime) / 1000, 0.08);
    this.lastTime = time;

    if (this.isPaused) return;

    // Fixed-step physics
    this.physicsWorld.step(1 / 60, dt, 4);

    // Update Entities
    this.car.update(dt);
    const carPos = this.car.getPosition();
    const carSpeed = this.car.getSpeed();
    const carQuat = this.car.getQuaternion();

    this.runDistance = Math.max(this.runDistance, carPos.z);
    this.topSpeed = Math.max(this.topSpeed, carSpeed);

    this.worldManager.update(carPos, dt);
    this.enemyManager.update(dt);

    // Sound engine updates
    const isSkidding = Math.abs(this.car.currentSteerAngle) > 0.25;
    this.audioManager.updateEngine(
      carSpeed,
      this.car.isBraking,
      this.car.keys[' '] || false,
      isSkidding
    );

    // Update Camera
    this.updateCamera(dt, carPos, carQuat, carSpeed);

    // Update Telemetry HUD
    const entitiesOnRadar = this.enemyManager.getEntities().map((e) => {
      return {
        x: e.mesh.position.x - carPos.x,
        z: e.mesh.position.z - carPos.z,
        type: e.type,
      };
    });

    const rpm = 800 + Math.abs(carSpeed) * 45;
    const telemetryData: TelemetryData = {
      speed: carSpeed,
      rpm: rpm,
      gear: this.car.gear,
      distance: this.runDistance,
      health: this.car.health,
      fuel: this.car.fuel,
      gForce: Math.abs(this.car.currentSteerAngle) * (carSpeed / 60),
      headlightMode: this.car.headlightMode,
      hazardsActive: this.car.hazardsActive,
      radioStation: this.audioManager.radioStation,
      cameraMode: this.cameraMode === 'chase' ? 'Chase Cam' : 'Cockpit',
      radarEntities: entitiesOnRadar,
    };
    this.hud.update(telemetryData, dt);

    // Check game over if health depleted
    if (this.car.health <= 0) {
      this.gameOver();
      return;
    }

    // Render Scene (Postprocessing or fallback)
    if (this.bloomEnabled && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private updateCamera(dt: number, carPos: THREE.Vector3, carQuat: THREE.Quaternion, speed: number) {
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 2.5);
    }

    if (this.cameraMode === 'chase') {
      // Dynamic Spring-Arm Chase Cam: Positioned behind and slightly above
      const chaseOffset = new THREE.Vector3(0, 2.3, -6.4);
      chaseOffset.applyQuaternion(carQuat);
      this.targetCamPos.copy(carPos).add(chaseOffset);

      // Smooth lag / lerp
      this.camera.position.lerp(this.targetCamPos, dt * 11);

      // Lookahead target down the highway
      const lookOffset = new THREE.Vector3(0, 1.2, 14.0);
      lookOffset.applyQuaternion(carQuat);
      this.camLookTarget.copy(carPos).add(lookOffset);

      // Dynamic FOV with speed
      const targetFOV = THREE.MathUtils.lerp(72, 88, Math.min(speed / 130, 1));
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, dt * 4);
      this.camera.updateProjectionMatrix();

      this.camera.lookAt(this.camLookTarget);
    } else {
      // 1st-Person Cockpit View: Sitting in the driver seat
      const cockpitOffset = new THREE.Vector3(-0.38, 0.95, 0.2);
      cockpitOffset.applyQuaternion(carQuat);
      this.camera.position.copy(carPos).add(cockpitOffset);

      // Forward target along car heading
      const lookOffset = new THREE.Vector3(-0.38, 0.95, 8.0);
      lookOffset.applyQuaternion(carQuat);
      this.camLookTarget.copy(carPos).add(lookOffset);

      this.camera.fov = 76;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.camLookTarget);
    }

    // Apply trauma camera shake
    if (this.cameraShake > 0) {
      const shakeAmt = this.cameraShake * 0.15;
      this.camera.position.x += (Math.random() - 0.5) * shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * shakeAmt;
      this.camera.position.z += (Math.random() - 0.5) * shakeAmt;
    }
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.composer) {
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
  }
}
