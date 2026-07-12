import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { World } from '../world/World';
import { Car } from '../entities/Car';
import { EnemyManager } from '../entities/EnemyManager';

export class Game {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public physicsWorld: CANNON.World;
  
  public worldManager: World;
  public car: Car;
  public enemyManager: EnemyManager;
  
  public isRunning: boolean = false;
  private lastTime: number = 0;

  constructor() {
    // 1. Initialize Three.js Scene
    this.scene = new THREE.Scene();
    
    // Day/Night and Fog will be managed by World, but set defaults here
    this.scene.background = new THREE.Color(0x050505);
    this.scene.fog = new THREE.FogExp2(0x050505, 0.05); // Thick fog

    // 2. Initialize Camera (FPS View)
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    // 3. Initialize Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);

    // 4. Initialize Physics (Cannon-es)
    this.physicsWorld = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.81, 0)
    });
    // Use Sweep and Prune for better performance
    this.physicsWorld.broadphase = new CANNON.SAPBroadphase(this.physicsWorld);
    
    // Default material interactions
    const groundMaterial = new CANNON.Material('ground');
    const wheelMaterial = new CANNON.Material('wheel');
    const wheelGroundContact = new CANNON.ContactMaterial(groundMaterial, wheelMaterial, {
      friction: 0.3,
      restitution: 0,
      contactEquationStiffness: 1000,
    });
    this.physicsWorld.addContactMaterial(wheelGroundContact);

    // 5. Initialize Game Systems
    this.worldManager = new World(this.scene, this.physicsWorld, groundMaterial);
    this.car = new Car(this.scene, this.physicsWorld, wheelMaterial);
    this.enemyManager = new EnemyManager(this.scene, this.physicsWorld, this.car);

    // Handle Resize
    window.addEventListener('resize', this.onWindowResize.bind(this));
    
    // Run an initial render frame so the screen isn't black before start
    this.renderer.render(this.scene, this.camera);
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.car.reset();
    this.worldManager.reset();
    this.enemyManager.reset();
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  public gameOver() {
    this.isRunning = false;
    document.getElementById('game-over-screen')?.classList.remove('hidden');
    
    // Clean up inputs so car stops
    this.car.brake();
  }

  private loop(time: number) {
    if (!this.isRunning) return;
    requestAnimationFrame(this.loop.bind(this));

    const dt = (time - this.lastTime) / 1000;
    this.lastTime = time;
    
    // Limit dt to avoid huge jumps on lag
    const safeDt = Math.min(dt, 0.1);

    // Step physics
    this.physicsWorld.step(1 / 60, safeDt, 3);

    // Update Entities
    this.car.update(safeDt);
    this.worldManager.update(this.car.getPosition());
    this.enemyManager.update(safeDt);

    // Check game over condition
    if (this.enemyManager.checkCollisions(this.car.getPosition())) {
        this.gameOver();
        return;
    }

    // FPS Camera logic: Position camera inside the car
    const carPos = this.car.getPosition();
    const carQuat = this.car.getQuaternion();
    
    // Offset camera to simulate sitting in the driver's seat (windshield level)
    const cameraOffset = new THREE.Vector3(0, 0.8, 0.5); 
    cameraOffset.applyQuaternion(carQuat);
    
    this.camera.position.copy(carPos).add(cameraOffset);
    
    // Camera looks forward along car's local Z axis
    const lookAtPoint = new THREE.Vector3(0, 0, 1);
    lookAtPoint.applyQuaternion(carQuat);
    lookAtPoint.add(this.camera.position);
    this.camera.lookAt(lookAtPoint);

    // Render
    this.renderer.render(this.scene, this.camera);
    
    // Update UI
    document.getElementById('speed')!.innerText = `${Math.floor(this.car.getSpeed())} km/h`;
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
