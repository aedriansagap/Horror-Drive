import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Car } from './Car';
import { HorrorEntity, StalkerEntity, SpecterEntity, PhantomTruckEntity } from './HorrorEntities';

export class EnemyManager {
  private scene: THREE.Scene;
  private physicsWorld: CANNON.World;
  private playerCar: Car;

  private entities: HorrorEntity[] = [];

  // Spawning logic
  private nextStalkerZ = 120.0;
  private nextSpecterZ = 220.0;
  private phantomTruckActive = false;
  private nextTruckZ = 450.0;

  // Sound event callback
  public onSoundEvent: ((event: string) => void) | null = null;
  public onHitEvent: ((damage: number) => void) | null = null;

  constructor(scene: THREE.Scene, physicsWorld: CANNON.World, playerCar: Car) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.playerCar = playerCar;
  }

  public reset() {
    for (const e of this.entities) {
      e.dispose(this.scene, this.physicsWorld);
    }
    this.entities = [];
    this.nextStalkerZ = 120.0;
    this.nextSpecterZ = 220.0;
    this.phantomTruckActive = false;
    this.nextTruckZ = 450.0;
  }

  public getEntities(): HorrorEntity[] {
    return this.entities;
  }

  public update(dt: number) {
    const playerPos = this.playerCar.getPosition();
    const playerSpeed = this.playerCar.getSpeed();

    // 1. Procedural Stalker Spawns along road progression
    if (playerPos.z + 140 > this.nextStalkerZ) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const stalker = new StalkerEntity(this.scene, this.physicsWorld, this.nextStalkerZ, side);
      this.entities.push(stalker);
      this.nextStalkerZ += 90.0 + Math.random() * 80.0;
    }

    // 2. Specter Spawns
    if (playerPos.z + 160 > this.nextSpecterZ) {
      const onRoad = Math.random() < 0.3;
      const specter = new SpecterEntity(this.scene, this.physicsWorld, this.nextSpecterZ, onRoad);
      this.entities.push(specter);
      this.nextSpecterZ += 180.0 + Math.random() * 140.0;
    }

    // 3. Phantom Truck Chase Event (after player establishes speed)
    if (!this.phantomTruckActive && playerPos.z > this.nextTruckZ) {
      this.phantomTruckActive = true;
      const truck = new PhantomTruckEntity(this.scene, this.physicsWorld, playerPos.z - 45.0);
      this.entities.push(truck);
      this.nextTruckZ += 900.0; // Rare intense event
    }

    // 4. Update all entities
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      const result = e.update(dt, playerPos, playerSpeed);

      if (result.soundEvent && this.onSoundEvent) {
        this.onSoundEvent(result.soundEvent);
      }

      if (result.collided) {
        this.playerCar.applyDamage(result.damage);
        if (this.onHitEvent) {
          this.onHitEvent(result.damage);
        }
      }

      // Cleanup entities far behind the player (> 100m behind) or dead
      const distZ = playerPos.z - e.mesh.position.z;
      if (distZ > 120.0 || (e.isDead && distZ > 20.0)) {
        if (e.type === 'phantom_truck') {
          this.phantomTruckActive = false;
        }
        e.dispose(this.scene, this.physicsWorld);
        this.entities.splice(i, 1);
      }
    }
  }
}
