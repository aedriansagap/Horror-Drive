import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class Car {
  private scene: THREE.Scene;
  private physicsWorld: CANNON.World;
  
  public vehicle: CANNON.RaycastVehicle;
  private chassisBody: CANNON.Body;
  private wheelBodies: CANNON.Body[] = [];
  
  private chassisMesh: THREE.Mesh;
  private wheelMeshes: THREE.Mesh[] = [];

  // Headlights for horror vibe
  private leftHeadlight: THREE.SpotLight;
  private rightHeadlight: THREE.SpotLight;

  // Input state
  private keys: { [key: string]: boolean } = {};

  // Engine configuration
  private maxSteerVal = 0.4;
  private maxForce = 2000;
  private brakeForce = 50;

  constructor(scene: THREE.Scene, physicsWorld: CANNON.World, wheelMaterial: CANNON.Material) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;

    // 1. Create Physics Chassis
    const chassisShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
    this.chassisBody = new CANNON.Body({ mass: 1500 });
    this.chassisBody.addShape(chassisShape);
    this.chassisBody.position.set(0, 2, 0);
    this.chassisBody.angularVelocity.set(0, 0, 0);

    // 2. Create Raycast Vehicle
    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    const wheelOptions = {
      radius: 0.4,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: 30,
      suspensionRestLength: 0.3,
      frictionSlip: 5,
      dampingRelaxation: 2.3,
      dampingCompression: 4.4,
      maxSuspensionForce: 100000,
      rollInfluence: 0.01,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(1, 1, 0),
      maxSuspensionTravel: 0.3,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    };

    // Add wheels
    // Front Left
    wheelOptions.chassisConnectionPointLocal.set(1, 0, 1.5);
    this.vehicle.addWheel(wheelOptions);
    // Front Right
    wheelOptions.chassisConnectionPointLocal.set(-1, 0, 1.5);
    this.vehicle.addWheel(wheelOptions);
    // Back Left
    wheelOptions.chassisConnectionPointLocal.set(1, 0, -1.5);
    this.vehicle.addWheel(wheelOptions);
    // Back Right
    wheelOptions.chassisConnectionPointLocal.set(-1, 0, -1.5);
    this.vehicle.addWheel(wheelOptions);

    this.vehicle.addToWorld(this.physicsWorld);

    // Wheel bodies for visualization
    const wheelShape = new CANNON.Cylinder(wheelOptions.radius, wheelOptions.radius, wheelOptions.radius / 2, 20);
    this.vehicle.wheelInfos.forEach(() => {
      const cylinderBody = new CANNON.Body({ mass: 0, material: wheelMaterial });
      const q = new CANNON.Quaternion();
      q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
      cylinderBody.addShape(wheelShape, new CANNON.Vec3(), q);
      this.wheelBodies.push(cylinderBody);
      // NOTE: We don't add wheel bodies to physics world, we just use them to sync meshes
    });

    // 3. Create Visuals (Three.js)
    const chassisGeo = new THREE.BoxGeometry(2, 1, 4);
    const chassisMat = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      metalness: 0.8, 
      roughness: 0.2,
      transparent: true,
      opacity: 0.5 // Semi-transparent so it doesn't blind the camera if clipped
    });
    this.chassisMesh = new THREE.Mesh(chassisGeo, chassisMat);
    this.chassisMesh.castShadow = true;
    this.chassisMesh.receiveShadow = true;
    this.scene.add(this.chassisMesh);

    const wheelGeo = new THREE.CylinderGeometry(wheelOptions.radius, wheelOptions.radius, wheelOptions.radius / 2, 20);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

    for (let i = 0; i < 4; i++) {
      const wheelMesh = new THREE.Mesh(wheelGeo, wheelMat);
      wheelMesh.castShadow = true;
      this.wheelMeshes.push(wheelMesh);
      this.scene.add(wheelMesh);
    }

    // 4. Headlights (Horror vibe)
    this.leftHeadlight = new THREE.SpotLight(0xffffee, 2000, 150, Math.PI / 4, 0.5, 1);
    this.leftHeadlight.castShadow = true;
    this.leftHeadlight.position.set(0.8, 0.5, 2);
    
    this.rightHeadlight = new THREE.SpotLight(0xffffee, 2000, 150, Math.PI / 4, 0.5, 1);
    this.rightHeadlight.castShadow = true;
    this.rightHeadlight.position.set(-0.8, 0.5, 2);

    const leftTarget = new THREE.Object3D();
    const rightTarget = new THREE.Object3D();
    leftTarget.position.set(0.8, 0.5, 5);
    rightTarget.position.set(-0.8, 0.5, 5);
    
    this.chassisMesh.add(this.leftHeadlight);
    this.chassisMesh.add(this.rightHeadlight);
    this.chassisMesh.add(leftTarget);
    this.chassisMesh.add(rightTarget);
    
    this.leftHeadlight.target = leftTarget;
    this.rightHeadlight.target = rightTarget;

    // 5. Input Listeners
    window.addEventListener('keydown', (e) => (this.keys[e.key.toLowerCase()] = true));
    window.addEventListener('keyup', (e) => (this.keys[e.key.toLowerCase()] = false));

    // Update vehicle sync with wheels
    this.physicsWorld.addEventListener('postStep', () => {
      for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
        this.vehicle.updateWheelTransform(i);
        const t = this.vehicle.wheelInfos[i].worldTransform;
        this.wheelBodies[i].position.copy(t.position);
        this.wheelBodies[i].quaternion.copy(t.quaternion);
      }
    });
  }

  public getPosition(): THREE.Vector3 {
    return new THREE.Vector3(this.chassisBody.position.x, this.chassisBody.position.y, this.chassisBody.position.z);
  }

  public getQuaternion(): THREE.Quaternion {
    return new THREE.Quaternion(this.chassisBody.quaternion.x, this.chassisBody.quaternion.y, this.chassisBody.quaternion.z, this.chassisBody.quaternion.w);
  }

  public getSpeed(): number {
    return this.chassisBody.velocity.length() * 3.6; // m/s to km/h
  }

  public reset() {
    this.chassisBody.position.set(0, 2, 0);
    this.chassisBody.velocity.set(0, 0, 0);
    this.chassisBody.angularVelocity.set(0, 0, 0);
    this.chassisBody.quaternion.set(0, 0, 0, 1);
  }

  public brake() {
    this.vehicle.setBrake(this.brakeForce, 0);
    this.vehicle.setBrake(this.brakeForce, 1);
    this.vehicle.setBrake(this.brakeForce, 2);
    this.vehicle.setBrake(this.brakeForce, 3);
  }

  public update(_dt: number) {
    // Controls
    const up = this.keys['w'] || this.keys['arrowup'];
    const down = this.keys['s'] || this.keys['arrowdown'];
    const left = this.keys['a'] || this.keys['arrowleft'];
    const right = this.keys['d'] || this.keys['arrowright'];
    const brake = this.keys[' '];

    if (up) {
      this.vehicle.applyEngineForce(-this.maxForce, 2);
      this.vehicle.applyEngineForce(-this.maxForce, 3);
    } else if (down) {
      this.vehicle.applyEngineForce(this.maxForce / 2, 2);
      this.vehicle.applyEngineForce(this.maxForce / 2, 3);
    } else {
      this.vehicle.applyEngineForce(0, 2);
      this.vehicle.applyEngineForce(0, 3);
    }

    if (left) {
      this.vehicle.setSteeringValue(this.maxSteerVal, 0);
      this.vehicle.setSteeringValue(this.maxSteerVal, 1);
    } else if (right) {
      this.vehicle.setSteeringValue(-this.maxSteerVal, 0);
      this.vehicle.setSteeringValue(-this.maxSteerVal, 1);
    } else {
      this.vehicle.setSteeringValue(0, 0);
      this.vehicle.setSteeringValue(0, 1);
    }

    if (brake) {
      this.brake();
    } else {
      this.vehicle.setBrake(0, 0);
      this.vehicle.setBrake(0, 1);
      this.vehicle.setBrake(0, 2);
      this.vehicle.setBrake(0, 3);
    }

    // Sync visuals
    this.chassisMesh.position.copy(this.chassisBody.position as any);
    this.chassisMesh.quaternion.copy(this.chassisBody.quaternion as any);

    for (let i = 0; i < 4; i++) {
      this.wheelMeshes[i].position.copy(this.wheelBodies[i].position as any);
      this.wheelMeshes[i].quaternion.copy(this.wheelBodies[i].quaternion as any);
    }
  }
}
