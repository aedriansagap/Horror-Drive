import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoadSystem } from './RoadSystem';

export class World {
  private scene: THREE.Scene;
  private physicsWorld: CANNON.World;
  private groundMaterial: CANNON.Material;

  public roadSystem: RoadSystem;

  // Environment Lighting
  private ambientLight: THREE.AmbientLight;
  private hemiLight: THREE.HemisphereLight;
  private moonLight: THREE.DirectionalLight;

  // Weather & Atmosphere
  private rainParticles: THREE.Points | null = null;
  private rainCount = 1800;
  private rainGeo: THREE.BufferGeometry | null = null;
  private lightningLight: THREE.DirectionalLight;
  private lightningFlashTimer = 0;
  private isFlashing = false;

  // Callback for thunder sound trigger
  public onThunder: (() => void) | null = null;

  constructor(scene: THREE.Scene, physicsWorld: CANNON.World, groundMaterial: CANNON.Material) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.groundMaterial = groundMaterial;

    // Atmospheric deep night fog
    this.scene.background = new THREE.Color(0x060b14);
    this.scene.fog = new THREE.FogExp2(0x060b14, 0.0075);

    // Environment Lighting: eerie moonlight
    this.ambientLight = new THREE.AmbientLight(0x445877, 1.4);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0x667799, 0x1a2233, 1.1);
    this.scene.add(this.hemiLight);

    this.moonLight = new THREE.DirectionalLight(0x88aaff, 1.8);
    this.moonLight.position.set(80, 100, 40);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.width = 1024;
    this.moonLight.shadow.mapSize.height = 1024;
    this.moonLight.shadow.camera.near = 10;
    this.moonLight.shadow.camera.far = 300;
    this.moonLight.shadow.camera.left = -60;
    this.moonLight.shadow.camera.right = 60;
    this.moonLight.shadow.camera.top = 60;
    this.moonLight.shadow.camera.bottom = -60;
    this.scene.add(this.moonLight);

    // Lightning Flash Light
    this.lightningLight = new THREE.DirectionalLight(0xddeeff, 0);
    this.lightningLight.position.set(0, 150, 0);
    this.scene.add(this.lightningLight);

    // Road & Environment System
    this.roadSystem = new RoadSystem(this.scene, this.physicsWorld, this.groundMaterial);

    // Setup Rain Particles
    this.setupRain();
  }

  private setupRain() {
    this.rainGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(this.rainCount * 3);
    for (let i = 0; i < this.rainCount; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = Math.random() * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const rainMat = new THREE.PointsMaterial({
      color: 0x88aacc,
      size: 0.18,
      transparent: true,
      opacity: 0.6,
    });

    this.rainParticles = new THREE.Points(this.rainGeo, rainMat);
    this.scene.add(this.rainParticles);
  }

  public update(playerPos: THREE.Vector3, dt: number = 0.016) {
    // 1. Update procedural road chunks based on player Z
    this.roadSystem.update(playerPos.z);

    // 2. Keep moonlight tracking near player
    this.moonLight.position.set(playerPos.x + 60, playerPos.y + 100, playerPos.z + 40);
    this.moonLight.target.position.set(playerPos.x, playerPos.y, playerPos.z);
    this.moonLight.target.updateMatrixWorld();

    // 3. Update rain particle volume following the player
    if (this.rainParticles && this.rainGeo) {
      this.rainParticles.position.set(playerPos.x, 0, playerPos.z);
      const posAttr = this.rainGeo.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < this.rainCount; i++) {
        // Fall down fast
        arr[i * 3 + 1] -= dt * 42.0;
        if (arr[i * 3 + 1] < 0) {
          arr[i * 3 + 1] = 25.0 + Math.random() * 5.0;
          arr[i * 3 + 0] = (Math.random() - 0.5) * 60;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 60;
        }
      }
      posAttr.needsUpdate = true;
    }

    // 4. Random Lightning Flashes (every 18 - 35 seconds)
    this.lightningFlashTimer += dt;
    if (!this.isFlashing && this.lightningFlashTimer > 20 && Math.random() < 0.003) {
      this.triggerLightning();
    }
  }

  private triggerLightning() {
    this.isFlashing = true;
    this.lightningFlashTimer = 0;
    this.lightningLight.intensity = 4.0;
    this.scene.fog!.color.set(0x334466);

    // Double flash flicker
    setTimeout(() => {
      this.lightningLight.intensity = 0.5;
      setTimeout(() => {
        this.lightningLight.intensity = 5.5;
        setTimeout(() => {
          this.lightningLight.intensity = 0;
          this.scene.fog!.color.set(0x04050a);
          this.isFlashing = false;

          // Sound delay for realistic distance
          if (this.onThunder) {
            setTimeout(() => {
              if (this.onThunder) this.onThunder();
            }, 800 + Math.random() * 800);
          }
        }, 90);
      }, 50);
    }, 70);
  }

  public reset() {
    this.roadSystem.reset();
    this.lightningFlashTimer = 0;
    this.isFlashing = false;
    this.lightningLight.intensity = 0;
  }
}
