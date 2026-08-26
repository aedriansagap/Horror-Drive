import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoadSystem } from '../world/RoadSystem';

export interface HorrorEntity {
  mesh: THREE.Group;
  body: CANNON.Body | null;
  type: 'stalker' | 'specter' | 'phantom_truck' | 'road_obstacle';
  zPos: number;
  isDead?: boolean;
  update: (dt: number, playerPos: THREE.Vector3, playerSpeed: number) => { collided: boolean; damage: number; soundEvent?: string };
  dispose: (scene: THREE.Scene, world: CANNON.World) => void;
}

// 1. The Stalker (Wendigo / Crawler)
export class StalkerEntity implements HorrorEntity {
  public mesh: THREE.Group;
  public body: CANNON.Body;
  public type: 'stalker' = 'stalker';
  public zPos: number;
  public isDead = false;

  private state: 'stalking' | 'charging' | 'fleeing' = 'stalking';
  private eyeMat: THREE.MeshBasicMaterial;
  private headMesh: THREE.Mesh;
  private leftArm: THREE.Mesh;
  private rightArm: THREE.Mesh;
  private animTimer = 0;
  private speed = 22.0;

  constructor(scene: THREE.Scene, world: CANNON.World, spawnZ: number, side: number = 1) {
    this.zPos = spawnZ;
    this.mesh = new THREE.Group();

    const roadFrame = RoadSystem.getRoadFrame(spawnZ);
    // Spawn just outside the road shoulder
    const spawnPos = new THREE.Vector3()
      .copy(roadFrame.center)
      .addScaledVector(roadFrame.right, side * (RoadSystem.ROAD_WIDTH / 2 + 3.5));
    spawnPos.y += 0.2;

    // Dark shadowy creature material
    const stalkerMat = new THREE.MeshStandardMaterial({
      color: 0x08090a,
      roughness: 0.9,
      metalness: 0.2,
    });

    // Piercing glowing yellow eyes
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xffea44 });

    // Torso: elongated, emaciated
    const torsoGeo = new THREE.BoxGeometry(0.55, 1.3, 0.35);
    const torso = new THREE.Mesh(torsoGeo, stalkerMat);
    torso.position.y = 1.6;
    torso.castShadow = true;
    this.mesh.add(torso);

    // Head
    const headGeo = new THREE.SphereGeometry(0.24, 8, 8);
    this.headMesh = new THREE.Mesh(headGeo, stalkerMat);
    this.headMesh.position.set(0, 2.4, 0.1);
    this.mesh.add(this.headMesh);

    // Glowing eyes
    const eyeGeo = new THREE.SphereGeometry(0.045, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeo, this.eyeMat);
    leftEye.position.set(0.08, 2.45, 0.3);
    const rightEye = new THREE.Mesh(eyeGeo, this.eyeMat);
    rightEye.position.set(-0.08, 2.45, 0.3);
    this.mesh.add(leftEye);
    this.mesh.add(rightEye);

    // Long spindly arms
    const armGeo = new THREE.BoxGeometry(0.12, 1.4, 0.12);
    this.leftArm = new THREE.Mesh(armGeo, stalkerMat);
    this.leftArm.position.set(0.38, 1.4, 0);
    this.leftArm.castShadow = true;
    this.mesh.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, stalkerMat);
    this.rightArm.position.set(-0.38, 1.4, 0);
    this.rightArm.castShadow = true;
    this.mesh.add(this.rightArm);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.16, 1.5, 0.16);
    const leftLeg = new THREE.Mesh(legGeo, stalkerMat);
    leftLeg.position.set(0.18, 0.75, 0);
    leftLeg.castShadow = true;
    this.mesh.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, stalkerMat);
    rightLeg.position.set(-0.18, 0.75, 0);
    rightLeg.castShadow = true;
    this.mesh.add(rightLeg);

    this.mesh.position.copy(spawnPos);
    scene.add(this.mesh);

    // Cannon Body
    this.body = new CANNON.Body({
      mass: 80,
      material: new CANNON.Material('monster'),
    });
    this.body.addShape(new CANNON.Cylinder(0.4, 0.4, 2.2, 8));
    this.body.position.set(spawnPos.x, spawnPos.y + 1.1, spawnPos.z);
    this.body.linearDamping = 0.4;
    world.addBody(this.body);
  }

  public update(dt: number, playerPos: THREE.Vector3, playerSpeed: number) {
    if (this.isDead) return { collided: false, damage: 0 };

    this.animTimer += dt * 8.0;
    const mPos = new THREE.Vector3(this.body.position.x, this.body.position.y, this.body.position.z);
    const distToPlayer = mPos.distanceTo(playerPos);

    let soundEvent: string | undefined = undefined;

    // State transition: charge when player is close (< 50m)
    if (this.state === 'stalking' && distToPlayer < 55.0) {
      this.state = 'charging';
      soundEvent = 'screech';
    }

    if (this.state === 'charging') {
      // Run toward player
      const dir = new THREE.Vector3().subVectors(playerPos, mPos);
      dir.y = 0;
      dir.normalize();

      this.body.velocity.x = dir.x * this.speed;
      this.body.velocity.z = dir.z * this.speed;

      // Look at player
      this.mesh.lookAt(playerPos.x, this.mesh.position.y, playerPos.z);

      // Arm flailing animation
      this.leftArm.rotation.x = Math.sin(this.animTimer) * 0.8;
      this.rightArm.rotation.x = -Math.sin(this.animTimer) * 0.8;
    } else {
      // Idle twitching
      this.headMesh.rotation.y = Math.sin(this.animTimer * 0.3) * 0.4;
    }

    // Sync visuals with physics body
    this.mesh.position.copy(this.body.position as any);
    this.mesh.position.y -= 1.1; // adjust cylinder center

    // Collision check with player
    if (distToPlayer < 2.6) {
      this.isDead = true;
      if (playerSpeed > 35) {
        // Player rammed monster!
        this.body.velocity.set(0, 12, (playerPos.z - mPos.z > 0 ? -15 : 15));
        return { collided: true, damage: 10, soundEvent: 'thump' };
      } else {
        // Monster ambushed player!
        return { collided: true, damage: 25, soundEvent: 'attack' };
      }
    }

    return { collided: false, damage: 0, soundEvent };
  }

  public dispose(scene: THREE.Scene, world: CANNON.World) {
    scene.remove(this.mesh);
    world.removeBody(this.body);
  }
}

// 2. The Roadside Specter (Phantom Hitchhiker)
export class SpecterEntity implements HorrorEntity {
  public mesh: THREE.Group;
  public body: CANNON.Body | null = null;
  public type: 'specter' = 'specter';
  public zPos: number;
  public isDead = false;

  private floatTimer = 0;
  private glowMesh: THREE.Mesh;

  constructor(scene: THREE.Scene, _world: CANNON.World, spawnZ: number, onRoad: boolean = false) {
    this.zPos = spawnZ;
    this.mesh = new THREE.Group();

    const roadFrame = RoadSystem.getRoadFrame(spawnZ);
    const offset = onRoad ? (Math.random() - 0.5) * 4.0 : (RoadSystem.ROAD_WIDTH / 2 - 1.0);
    const spawnPos = new THREE.Vector3()
      .copy(roadFrame.center)
      .addScaledVector(roadFrame.right, offset);
    spawnPos.y += 1.2;

    // Translucent ghostly veil
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0xaaccff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });

    // Flowing gown / shroud
    const bodyGeo = new THREE.CylinderGeometry(0.2, 0.6, 1.8, 12, 1, true);
    const body = new THREE.Mesh(bodyGeo, ghostMat);
    this.mesh.add(body);

    // Head
    const headGeo = new THREE.SphereGeometry(0.22, 12, 12);
    const head = new THREE.Mesh(headGeo, ghostMat);
    head.position.y = 1.05;
    this.mesh.add(head);

    // Eerie inner aura light
    const auraGeo = new THREE.SphereGeometry(0.8, 8, 8);
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
    });
    this.glowMesh = new THREE.Mesh(auraGeo, auraMat);
    this.glowMesh.position.y = 0.5;
    this.mesh.add(this.glowMesh);

    this.mesh.position.copy(spawnPos);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), roadFrame.tangent.clone().negate());
    scene.add(this.mesh);
  }

  public update(dt: number, playerPos: THREE.Vector3, _playerSpeed: number) {
    if (this.isDead) return { collided: false, damage: 0 };

    this.floatTimer += dt;
    this.mesh.position.y += Math.sin(this.floatTimer * 2.5) * 0.005;

    const dist = this.mesh.position.distanceTo(playerPos);
    let soundEvent: string | undefined = undefined;

    if (dist < 18.0 && !this.isDead) {
      soundEvent = 'static_glitch';
    }

    if (dist < 2.8) {
      this.isDead = true;
      // Fade out
      return { collided: true, damage: 5, soundEvent: 'specter_wail' };
    }

    return { collided: false, damage: 0, soundEvent };
  }

  public dispose(scene: THREE.Scene, _world: CANNON.World) {
    scene.remove(this.mesh);
  }
}

// 3. The Phantom Chaser (Black Heavy Semi-Truck behind player)
export class PhantomTruckEntity implements HorrorEntity {
  public mesh: THREE.Group;
  public body: CANNON.Body | null = null;
  public type: 'phantom_truck' = 'phantom_truck';
  public zPos: number;
  public isDead = false;

  private truckLights: THREE.SpotLight[] = [];
  private hornTimer = 0;
  private lifeTimer = 0;

  constructor(scene: THREE.Scene, _world: CANNON.World, startZ: number) {
    this.zPos = startZ;
    this.mesh = new THREE.Group();

    // Massive blacked-out semi cab
    const truckMat = new THREE.MeshStandardMaterial({
      color: 0x070709,
      roughness: 0.4,
      metalness: 0.7,
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      metalness: 0.95,
      roughness: 0.1,
    });

    // Cab box
    const cabGeo = new THREE.BoxGeometry(2.6, 3.2, 5.5);
    const cab = new THREE.Mesh(cabGeo, truckMat);
    cab.position.y = 1.8;
    this.mesh.add(cab);

    // Front Grille
    const grilleGeo = new THREE.BoxGeometry(2.2, 1.8, 0.2);
    const grille = new THREE.Mesh(grilleGeo, chromeMat);
    grille.position.set(0, 1.2, 2.8);
    this.mesh.add(grille);

    // Dual vertical exhaust stacks
    const stackGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.8, 8);
    const leftStack = new THREE.Mesh(stackGeo, chromeMat);
    leftStack.position.set(1.4, 2.8, -1.2);
    const rightStack = new THREE.Mesh(stackGeo, chromeMat);
    rightStack.position.set(-1.4, 2.8, -1.2);
    this.mesh.add(leftStack);
    this.mesh.add(rightStack);

    // Blinding high-beam lights
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
    for (const offset of [0.9, -0.9]) {
      const spot = new THREE.SpotLight(0xffffdd, 12000, 180, Math.PI / 4, 0.3, 1.0);
      spot.position.set(offset, 1.2, 3.0);
      const target = new THREE.Object3D();
      target.position.set(offset, 0.5, 40);
      this.mesh.add(spot);
      this.mesh.add(target);
      spot.target = target;
      this.truckLights.push(spot);

      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), lightMat);
      lens.position.set(offset, 1.2, 2.92);
      this.mesh.add(lens);
    }

    const roadFrame = RoadSystem.getRoadFrame(startZ);
    this.mesh.position.copy(roadFrame.center);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), roadFrame.tangent);
    scene.add(this.mesh);
  }

  public update(dt: number, playerPos: THREE.Vector3, _playerSpeed: number) {
    if (this.isDead) return { collided: false, damage: 0 };

    this.lifeTimer += dt;
    this.hornTimer += dt;

    // Follow road behind player
    // Maintain a distance of 18..35 meters behind player
    const targetZ = playerPos.z - 28.0;
    this.zPos = THREE.MathUtils.lerp(this.zPos, targetZ, dt * 1.8);

    const frame = RoadSystem.getRoadFrame(this.zPos);
    this.mesh.position.copy(frame.center);
    this.mesh.position.y += 0.2;
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);

    let soundEvent: string | undefined = undefined;
    if (this.hornTimer > 6.0 && Math.random() < 0.2) {
      soundEvent = 'truck_horn';
      this.hornTimer = 0;
    }

    // Collision if player slows down or reverses into truck
    const dist = this.mesh.position.distanceTo(playerPos);
    if (dist < 4.5) {
      return { collided: true, damage: 40, soundEvent: 'crash' };
    }

    // Despawn after 45 seconds of chase
    if (this.lifeTimer > 45) {
      this.isDead = true;
    }

    return { collided: false, damage: 0, soundEvent };
  }

  public dispose(scene: THREE.Scene, _world: CANNON.World) {
    scene.remove(this.mesh);
  }
}
