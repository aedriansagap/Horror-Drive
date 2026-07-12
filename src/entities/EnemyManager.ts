import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Car } from './Car';

interface Enemy {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  type: 'zombie' | 'vampire';
  speed: number;
}

export class EnemyManager {
  private scene: THREE.Scene;
  private physicsWorld: CANNON.World;
  private target: Car;

  private enemies: Enemy[] = [];
  
  // Materials
  private zombieMaterial: THREE.MeshStandardMaterial;
  private vampireMaterial: THREE.MeshStandardMaterial;
  private enemyShape: CANNON.Sphere;
  private enemyGeo: THREE.SphereGeometry;

  // Spawning logic
  private spawnTimer = 0;
  private spawnInterval = 3; // Spawn every 3 seconds initially
  private maxEnemies = 20;
  private spawnDistance = 60; // Just inside fog range

  constructor(scene: THREE.Scene, physicsWorld: CANNON.World, target: Car) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.target = target;

    this.zombieMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x00ff00, 
      emissive: 0x00ff00,
      emissiveIntensity: 0.5,
      roughness: 0.8 
    }); 
    this.vampireMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xff0000, 
      emissive: 0xff0000,
      emissiveIntensity: 0.8,
      roughness: 0.5 
    }); 
    
    this.enemyShape = new CANNON.Sphere(1);
    this.enemyGeo = new THREE.SphereGeometry(1, 16, 16);
  }

  public reset() {
    for (const enemy of this.enemies) {
      this.scene.remove(enemy.mesh);
      this.physicsWorld.removeBody(enemy.body);
    }
    this.enemies = [];
    this.spawnTimer = 0;
  }

  public update(dt: number) {
    const targetPos = this.target.getPosition();

    // Spawn logic
    this.spawnTimer += dt;
    if (this.spawnTimer >= this.spawnInterval && this.enemies.length < this.maxEnemies) {
      this.spawnTimer = 0;
      this.spawnEnemy(targetPos);
      
      // Decrease spawn interval slightly over time (increase difficulty)
      this.spawnInterval = Math.max(0.5, this.spawnInterval - 0.05);
    }

    // AI Logic (Chase player)
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      
      const ePos = new THREE.Vector3(enemy.body.position.x, enemy.body.position.y, enemy.body.position.z);
      
      // Direction to player
      const dir = new THREE.Vector3().subVectors(targetPos, ePos);
      
      // Distance check
      if (dir.length() > this.spawnDistance * 1.5) {
        // Too far, despawn
        this.scene.remove(enemy.mesh);
        this.physicsWorld.removeBody(enemy.body);
        this.enemies.splice(i, 1);
        continue;
      }
      
      // Move towards player
      dir.normalize();
      
      // Apply velocity (ignore Y to stick to ground mostly, though gravity handles Y)
      enemy.body.velocity.x = dir.x * enemy.speed;
      enemy.body.velocity.z = dir.z * enemy.speed;
      
      // Sync visual
      enemy.mesh.position.copy(enemy.body.position as any);
      enemy.mesh.quaternion.copy(enemy.body.quaternion as any);
    }
  }

  private spawnEnemy(playerPos: THREE.Vector3) {
    // Random angle
    const angle = Math.random() * Math.PI * 2;
    const x = playerPos.x + Math.cos(angle) * this.spawnDistance;
    const z = playerPos.z + Math.sin(angle) * this.spawnDistance;
    
    // Drop them from slightly above so they hit the ground
    const y = playerPos.y + 10; 

    const isVampire = Math.random() > 0.7; // 30% vampires
    const type = isVampire ? 'vampire' : 'zombie';
    const speed = isVampire ? 15 : 6; // Vampires are faster
    const material = isVampire ? this.vampireMaterial : this.zombieMaterial;

    const mesh = new THREE.Mesh(this.enemyGeo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const body = new CANNON.Body({
      mass: 50,
      material: new CANNON.Material('enemy')
    });
    body.addShape(this.enemyShape);
    body.position.set(x, y, z);
    // Linear damping to prevent them from sliding forever
    body.linearDamping = 0.5;
    this.physicsWorld.addBody(body);

    this.enemies.push({ mesh, body, type, speed });
  }

  public checkCollisions(playerPos: THREE.Vector3): boolean {
    for (const enemy of this.enemies) {
      const ePos = new THREE.Vector3(enemy.body.position.x, enemy.body.position.y, enemy.body.position.z);
      const distance = ePos.distanceTo(playerPos);
      if (distance < 2.5) { // Rough collision radius with car
        return true; // Game Over
      }
    }
    return false;
  }
}
