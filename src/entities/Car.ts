import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class Car {
  private scene: THREE.Scene;
  private physicsWorld: CANNON.World;
  
  public vehicle: CANNON.RaycastVehicle;
  public chassisBody: CANNON.Body;
  private wheelBodies: CANNON.Body[] = [];
  
  public chassisMesh: THREE.Group;
  private wheelMeshes: THREE.Group[] = [];
  private steeringWheel: THREE.Group | null = null;
  private exhaustParticles: THREE.Points | null = null;
  private exhaustPositions: Float32Array | null = null;

  // Lights
  private leftHeadlight: THREE.SpotLight;
  private rightHeadlight: THREE.SpotLight;
  private leftLightCone: THREE.Mesh;
  private rightLightCone: THREE.Mesh;
  private tailLightsMat: THREE.MeshStandardMaterial;
  private reverseLightsMat: THREE.MeshStandardMaterial;
  private hazardLightsMat: THREE.MeshStandardMaterial;

  // Headlight modes: 0 = Off, 1 = Low Beam, 2 = High Beam
  public headlightMode = 2; // Default High Beam for horror visibility
  public hazardsActive = false;
  private hazardTimer = 0;

  // Vehicle Stats & State
  public health = 100;
  public fuel = 100;
  public gear: 'P' | 'R' | 'N' | 'D' = 'D';
  public isReversing = false;
  public isBraking = false;
  public currentSteerAngle = 0;

  // Input state
  public keys: { [key: string]: boolean } = {};

  // Tuning constants
  private baseMaxForce = 6200;
  private brakeForce = 90;
  private handbrakeForce = 150;

  constructor(scene: THREE.Scene, physicsWorld: CANNON.World, wheelMaterial: CANNON.Material) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;

    // 1. Create Physics Chassis (Mass = 1400kg, Low Center of Mass)
    const chassisShape = new CANNON.Box(new CANNON.Vec3(1.0, 0.45, 2.2));
    this.chassisBody = new CANNON.Body({ mass: 1400 });
    // Offset center of mass downwards by 0.25m for roll stability
    this.chassisBody.addShape(chassisShape, new CANNON.Vec3(0, -0.15, 0));
    this.chassisBody.position.set(0, 0.85, 5); // Start safely on road facing +Z
    this.chassisBody.angularDamping = 0.6;
    this.chassisBody.linearDamping = 0.05;

    // 2. Create Raycast Vehicle
    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    const wheelRadius = 0.38;
    const wheelOptions = {
      radius: wheelRadius,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: 45,
      suspensionRestLength: 0.38,
      frictionSlip: 4.2,
      dampingRelaxation: 2.8,
      dampingCompression: 4.2,
      maxSuspensionForce: 100000,
      rollInfluence: 0.02,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(0.95, -0.1, 1.45),
      maxSuspensionTravel: 0.25,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    };

    // Wheel 0: Front Left
    wheelOptions.chassisConnectionPointLocal.set(0.95, -0.1, 1.45);
    this.vehicle.addWheel(wheelOptions);
    // Wheel 1: Front Right
    wheelOptions.chassisConnectionPointLocal.set(-0.95, -0.1, 1.45);
    this.vehicle.addWheel(wheelOptions);
    // Wheel 2: Back Left
    wheelOptions.chassisConnectionPointLocal.set(0.95, -0.1, -1.45);
    this.vehicle.addWheel(wheelOptions);
    // Wheel 3: Back Right
    wheelOptions.chassisConnectionPointLocal.set(-0.95, -0.1, -1.45);
    this.vehicle.addWheel(wheelOptions);

    this.vehicle.addToWorld(this.physicsWorld);

    // Dummy wheel bodies for transform syncing
    const wheelShape = new CANNON.Cylinder(wheelRadius, wheelRadius, 0.28, 16);
    this.vehicle.wheelInfos.forEach(() => {
      const cylinderBody = new CANNON.Body({ mass: 0, material: wheelMaterial });
      const q = new CANNON.Quaternion();
      q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
      cylinderBody.addShape(wheelShape, new CANNON.Vec3(), q);
      this.wheelBodies.push(cylinderBody);
    });

    // 3. Build Detailed Survivor Vehicle 3D Model
    this.chassisMesh = new THREE.Group();
    this.buildCarVisuals();
    this.scene.add(this.chassisMesh);

    // 4. Setup Headlights & Volumetric Cones
    const { leftLight, rightLight, leftCone, rightCone, tailMat, revMat, hazMat } = this.setupCarLighting();
    this.leftHeadlight = leftLight;
    this.rightHeadlight = rightLight;
    this.leftLightCone = leftCone;
    this.rightLightCone = rightCone;
    this.tailLightsMat = tailMat;
    this.reverseLightsMat = revMat;
    this.hazardLightsMat = hazMat;

    // 5. Setup Exhaust Smoke
    this.setupExhaustSmoke();

    // 6. Input Event Handlers
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === 'f') this.cycleHeadlights();
      if (k === 'h') this.hazardsActive = !this.hazardsActive;
    });

    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys[k] = false;
    });

    // Physics World postStep to sync wheel matrices
    this.physicsWorld.addEventListener('postStep', () => {
      for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
        this.vehicle.updateWheelTransform(i);
        const t = this.vehicle.wheelInfos[i].worldTransform;
        this.wheelBodies[i].position.copy(t.position);
        this.wheelBodies[i].quaternion.copy(t.quaternion);
      }
    });
  }

  private buildCarVisuals() {
    const textureLoader = new THREE.TextureLoader();
    const rustTex = textureLoader.load('/car.png');
    rustTex.wrapS = THREE.RepeatWrapping;
    rustTex.wrapT = THREE.RepeatWrapping;
    rustTex.repeat.set(2, 2);

    // Dark distressed paint material
    const bodyMat = new THREE.MeshStandardMaterial({
      map: rustTex,
      color: 0x24282c,
      roughness: 0.5,
      metalness: 0.6,
    });

    // Dark trim / bumper material
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x111315,
      roughness: 0.8,
      metalness: 0.3,
    });

    // Tinted glass
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x15222e,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.65,
    });

    // Interior vinyl material
    const interiorMat = new THREE.MeshStandardMaterial({
      color: 0x1c1e22,
      roughness: 0.85,
    });

    // A. Lower Chassis Body
    const lowerGeo = new THREE.BoxGeometry(2.0, 0.55, 4.4);
    const lowerBody = new THREE.Mesh(lowerGeo, bodyMat);
    lowerBody.position.y = 0.15;
    lowerBody.castShadow = true;
    lowerBody.receiveShadow = true;
    this.chassisMesh.add(lowerBody);

    // B. Hood with air intake scoop
    const hoodGeo = new THREE.BoxGeometry(1.85, 0.18, 1.5);
    const hood = new THREE.Mesh(hoodGeo, bodyMat);
    hood.position.set(0, 0.45, 1.25);
    hood.castShadow = true;
    this.chassisMesh.add(hood);

    const scoopGeo = new THREE.BoxGeometry(0.6, 0.12, 0.8);
    const scoop = new THREE.Mesh(scoopGeo, trimMat);
    scoop.position.set(0, 0.58, 1.15);
    this.chassisMesh.add(scoop);

    // C. Cabin / Greenhouse
    const cabinGeo = new THREE.BoxGeometry(1.7, 0.65, 2.1);
    const cabin = new THREE.Mesh(cabinGeo, bodyMat);
    cabin.position.set(0, 0.72, -0.3);
    cabin.castShadow = true;
    this.chassisMesh.add(cabin);

    // Windshield (sloped glass)
    const windshieldGeo = new THREE.PlaneGeometry(1.6, 0.75);
    const windshield = new THREE.Mesh(windshieldGeo, glassMat);
    windshield.position.set(0, 0.74, 0.82);
    windshield.rotation.x = -0.55;
    this.chassisMesh.add(windshield);

    // Side Windows (Left & Right)
    const sideWindowGeo = new THREE.PlaneGeometry(1.8, 0.45);
    const leftWindow = new THREE.Mesh(sideWindowGeo, glassMat);
    leftWindow.position.set(0.86, 0.75, -0.3);
    leftWindow.rotation.y = Math.PI / 2;
    this.chassisMesh.add(leftWindow);

    const rightWindow = new THREE.Mesh(sideWindowGeo, glassMat);
    rightWindow.position.set(-0.86, 0.75, -0.3);
    rightWindow.rotation.y = -Math.PI / 2;
    this.chassisMesh.add(rightWindow);

    // Rear Window
    const rearWindowGeo = new THREE.PlaneGeometry(1.5, 0.55);
    const rearWindow = new THREE.Mesh(rearWindowGeo, glassMat);
    rearWindow.position.set(0, 0.75, -1.36);
    rearWindow.rotation.y = Math.PI;
    this.chassisMesh.add(rearWindow);

    // D. Front Grill & Heavy Bullbar
    const grillGeo = new THREE.BoxGeometry(1.6, 0.35, 0.1);
    const grill = new THREE.Mesh(grillGeo, trimMat);
    grill.position.set(0, 0.18, 2.22);
    this.chassisMesh.add(grill);

    const bullbarMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.9, roughness: 0.3 });
    const bullbarBar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 8), bullbarMat);
    bullbarBar.rotation.z = Math.PI / 2;
    bullbarBar.position.set(0, 0.25, 2.35);
    this.chassisMesh.add(bullbarBar);

    // E. Side Mirrors
    const mirrorGeo = new THREE.BoxGeometry(0.2, 0.12, 0.1);
    const leftMirror = new THREE.Mesh(mirrorGeo, trimMat);
    leftMirror.position.set(0.98, 0.7, 0.65);
    this.chassisMesh.add(leftMirror);

    const rightMirror = new THREE.Mesh(mirrorGeo, trimMat);
    rightMirror.position.set(-0.98, 0.7, 0.65);
    this.chassisMesh.add(rightMirror);

    // F. Exhaust Pipes
    const exhaustGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8);
    const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.9, roughness: 0.2 });
    const leftExhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
    leftExhaust.rotation.x = Math.PI / 2;
    leftExhaust.position.set(0.65, -0.05, -2.25);
    this.chassisMesh.add(leftExhaust);

    const rightExhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
    rightExhaust.rotation.x = Math.PI / 2;
    rightExhaust.position.set(-0.65, -0.05, -2.25);
    this.chassisMesh.add(rightExhaust);

    // G. Cockpit Interior (Dashboard, Steering Wheel, Rearview Mirror)
    const dashGeo = new THREE.BoxGeometry(1.5, 0.3, 0.4);
    const dashboard = new THREE.Mesh(dashGeo, interiorMat);
    dashboard.position.set(0, 0.62, 0.65);
    this.chassisMesh.add(dashboard);

    // Glowing Speedometer/Tachometer dial face
    const dialFace = new THREE.Mesh(
      new THREE.PlaneGeometry(0.25, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x00ff88 })
    );
    dialFace.position.set(-0.35, 0.68, 0.52);
    dialFace.rotation.x = -0.3;
    this.chassisMesh.add(dialFace);

    // Steering Wheel
    this.steeringWheel = new THREE.Group();
    const rimGeo = new THREE.TorusGeometry(0.18, 0.025, 8, 20);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
    const rimMesh = new THREE.Mesh(rimGeo, wheelMat);
    this.steeringWheel.add(rimMesh);

    const spokeGeo = new THREE.BoxGeometry(0.32, 0.02, 0.02);
    const spoke = new THREE.Mesh(spokeGeo, wheelMat);
    this.steeringWheel.add(spoke);

    this.steeringWheel.position.set(-0.38, 0.72, 0.38);
    this.steeringWheel.rotation.x = -0.35;
    this.chassisMesh.add(this.steeringWheel);

    // Rearview Mirror
    const rearMirror = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.08, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.1, metalness: 0.9 })
    );
    rearMirror.position.set(0, 0.95, 0.7);
    rearMirror.rotation.x = 0.1;
    this.chassisMesh.add(rearMirror);

    // 4 Wheels
    for (let i = 0; i < 4; i++) {
      const wGroup = new THREE.Group();
      // Rubber tire
      const tireGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 20);
      tireGeo.rotateZ(Math.PI / 2);
      const tireMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.9 });
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      wGroup.add(tire);

      // Metallic Rim
      const rimObj = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 0.29, 10),
        new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.3 })
      );
      rimObj.rotation.z = Math.PI / 2;
      wGroup.add(rimObj);

      // Brake Caliper
      const caliper = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 0.08),
        new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.4 })
      );
      caliper.position.set(0, 0.18, 0);
      wGroup.add(caliper);

      this.wheelMeshes.push(wGroup);
      this.scene.add(wGroup);
    }
  }

  private setupCarLighting() {
    // Projector Headlights
    const leftLight = new THREE.SpotLight(0xfffaed, 8000, 220, Math.PI / 4.2, 0.45, 1.2);
    leftLight.position.set(0.75, 0.35, 2.2);
    leftLight.castShadow = true;
    leftLight.shadow.mapSize.width = 512;
    leftLight.shadow.mapSize.height = 512;

    const rightLight = new THREE.SpotLight(0xfffaed, 8000, 220, Math.PI / 4.2, 0.45, 1.2);
    rightLight.position.set(-0.75, 0.35, 2.2);
    rightLight.castShadow = true;
    rightLight.shadow.mapSize.width = 512;
    rightLight.shadow.mapSize.height = 512;

    const leftTarget = new THREE.Object3D();
    leftTarget.position.set(0.75, 0.2, 20);
    const rightTarget = new THREE.Object3D();
    rightTarget.position.set(-0.75, 0.2, 20);

    this.chassisMesh.add(leftLight);
    this.chassisMesh.add(rightLight);
    this.chassisMesh.add(leftTarget);
    this.chassisMesh.add(rightTarget);

    leftLight.target = leftTarget;
    rightLight.target = rightTarget;

    // Volumetric Headlight Cones (gives that thick foggy night beam!)
    const coneGeo = new THREE.ConeGeometry(3.5, 30, 12, 1, true);
    coneGeo.rotateX(Math.PI / 2);
    coneGeo.translate(0, 0, 15);

    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xfffae8,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const leftCone = new THREE.Mesh(coneGeo, coneMat);
    leftCone.position.set(0.75, 0.35, 2.2);
    this.chassisMesh.add(leftCone);

    const rightCone = new THREE.Mesh(coneGeo, coneMat);
    rightCone.position.set(-0.75, 0.35, 2.2);
    this.chassisMesh.add(rightCone);

    // Headlight Glass Lenses
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lensGeo = new THREE.CircleGeometry(0.12, 12);
    const leftLens = new THREE.Mesh(lensGeo, lensMat);
    leftLens.position.set(0.75, 0.35, 2.22);
    this.chassisMesh.add(leftLens);

    const rightLens = new THREE.Mesh(lensGeo, lensMat);
    rightLens.position.set(-0.75, 0.35, 2.22);
    this.chassisMesh.add(rightLens);

    // Tail Lights (Red emissive)
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0x330000,
      emissive: 0x990000,
      emissiveIntensity: 0.8,
      roughness: 0.2,
    });
    const tailGeo = new THREE.BoxGeometry(0.35, 0.12, 0.05);

    const leftTail = new THREE.Mesh(tailGeo, tailMat);
    leftTail.position.set(0.75, 0.35, -2.22);
    this.chassisMesh.add(leftTail);

    const rightTail = new THREE.Mesh(tailGeo, tailMat);
    rightTail.position.set(-0.75, 0.35, -2.22);
    this.chassisMesh.add(rightTail);

    // Reverse Lights
    const revMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      emissive: 0x000000,
      roughness: 0.2,
    });
    const leftRev = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.05), revMat);
    leftRev.position.set(0.5, 0.35, -2.22);
    this.chassisMesh.add(leftRev);

    const rightRev = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.05), revMat);
    rightRev.position.set(-0.5, 0.35, -2.22);
    this.chassisMesh.add(rightRev);

    // Hazard Blinkers (Amber)
    const hazMat = new THREE.MeshStandardMaterial({
      color: 0x332200,
      emissive: 0x000000,
    });
    const hazGeo = new THREE.BoxGeometry(0.1, 0.08, 0.05);
    const hFL = new THREE.Mesh(hazGeo, hazMat);
    hFL.position.set(0.92, 0.35, 2.2);
    this.chassisMesh.add(hFL);
    const hFR = new THREE.Mesh(hazGeo, hazMat);
    hFR.position.set(-0.92, 0.35, 2.2);
    this.chassisMesh.add(hFR);
    const hBL = new THREE.Mesh(hazGeo, hazMat);
    hBL.position.set(0.92, 0.35, -2.2);
    this.chassisMesh.add(hBL);
    const hBR = new THREE.Mesh(hazGeo, hazMat);
    hBR.position.set(-0.92, 0.35, -2.2);
    this.chassisMesh.add(hBR);

    return {
      leftLight,
      rightLight,
      leftCone,
      rightCone,
      tailMat,
      revMat,
      hazMat,
    };
  }

  private setupExhaustSmoke() {
    const count = 30;
    const geo = new THREE.BufferGeometry();
    this.exhaustPositions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.exhaustPositions[i * 3 + 0] = 0;
      this.exhaustPositions[i * 3 + 1] = -100; // start hidden
      this.exhaustPositions[i * 3 + 2] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.exhaustPositions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x555566,
      size: 0.4,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });

    this.exhaustParticles = new THREE.Points(geo, mat);
    this.scene.add(this.exhaustParticles);
  }

  public cycleHeadlights() {
    this.headlightMode = (this.headlightMode + 1) % 3;
    if (this.headlightMode === 0) {
      // Off
      this.leftHeadlight.intensity = 0;
      this.rightHeadlight.intensity = 0;
      this.leftLightCone.visible = false;
      this.rightLightCone.visible = false;
    } else if (this.headlightMode === 1) {
      // Low Beam
      this.leftHeadlight.intensity = 3500;
      this.rightHeadlight.intensity = 3500;
      this.leftHeadlight.distance = 90;
      this.rightHeadlight.distance = 90;
      this.leftLightCone.visible = true;
      this.rightLightCone.visible = true;
      this.leftLightCone.scale.set(0.7, 0.7, 0.6);
      this.rightLightCone.scale.set(0.7, 0.7, 0.6);
    } else {
      // High Beam
      this.leftHeadlight.intensity = 9500;
      this.rightHeadlight.intensity = 9500;
      this.leftHeadlight.distance = 240;
      this.rightHeadlight.distance = 240;
      this.leftLightCone.visible = true;
      this.rightLightCone.visible = true;
      this.leftLightCone.scale.set(1.0, 1.0, 1.0);
      this.rightLightCone.scale.set(1.0, 1.0, 1.0);
    }
  }

  public getPosition(): THREE.Vector3 {
    return new THREE.Vector3(this.chassisBody.position.x, this.chassisBody.position.y, this.chassisBody.position.z);
  }

  public getQuaternion(): THREE.Quaternion {
    return new THREE.Quaternion(
      this.chassisBody.quaternion.x,
      this.chassisBody.quaternion.y,
      this.chassisBody.quaternion.z,
      this.chassisBody.quaternion.w
    );
  }

  public getVelocity(): THREE.Vector3 {
    return new THREE.Vector3(this.chassisBody.velocity.x, this.chassisBody.velocity.y, this.chassisBody.velocity.z);
  }

  public getSpeed(): number {
    return this.chassisBody.velocity.length() * 3.6; // km/h
  }

  public reset(startZ: number = 5) {
    this.chassisBody.position.set(0, 0.85, startZ);
    this.chassisBody.velocity.set(0, 0, 0);
    this.chassisBody.angularVelocity.set(0, 0, 0);
    this.chassisBody.quaternion.set(0, 0, 0, 1);
    this.health = 100;
    this.fuel = 100;
    this.headlightMode = 2;
    this.cycleHeadlights(); // refresh intensities
  }

  public brake() {
    this.vehicle.setBrake(this.brakeForce, 0);
    this.vehicle.setBrake(this.brakeForce, 1);
    this.vehicle.setBrake(this.handbrakeForce, 2);
    this.vehicle.setBrake(this.handbrakeForce, 3);
    this.isBraking = true;
  }

  public applyDamage(amount: number) {
    this.health = Math.max(0, this.health - amount);
  }

  public update(dt: number) {
    const speed = this.getSpeed();

    // Controls
    const up = this.keys['w'] || this.keys['arrowup'];
    const down = this.keys['s'] || this.keys['arrowdown'];
    const left = this.keys['a'] || this.keys['arrowleft'];
    const right = this.keys['d'] || this.keys['arrowright'];
    const brake = this.keys[' '];

    // Throttle & Reverse Logic
    // In Cannon RaycastVehicle with indexForwardAxis: 2, positive force pushes along +Z (Forward!)
    let engineForce = 0;
    if (up) {
      this.gear = 'D';
      this.isReversing = false;
      this.isBraking = false;
      // Progressive acceleration curve
      engineForce = this.baseMaxForce;
    } else if (down) {
      if (speed < 5) {
        // Reverse
        this.gear = 'R';
        this.isReversing = true;
        this.isBraking = false;
        engineForce = -this.baseMaxForce * 0.55;
      } else {
        // Foot brake
        this.gear = 'D';
        this.isReversing = false;
        this.isBraking = true;
      }
    } else {
      this.gear = speed < 2 ? 'N' : 'D';
      this.isReversing = false;
      this.isBraking = false;
    }

    // Apply engine force (AWD: 60% rear, 40% front)
    if (this.health > 0) {
      this.vehicle.applyEngineForce(engineForce * 0.4, 0);
      this.vehicle.applyEngineForce(engineForce * 0.4, 1);
      this.vehicle.applyEngineForce(engineForce * 0.6, 2);
      this.vehicle.applyEngineForce(engineForce * 0.6, 3);
    } else {
      this.vehicle.applyEngineForce(0, 0);
      this.vehicle.applyEngineForce(0, 1);
      this.vehicle.applyEngineForce(0, 2);
      this.vehicle.applyEngineForce(0, 3);
    }

    // Dynamic steering: tighter at low speeds, stable at high speeds
    const targetMaxSteer = THREE.MathUtils.lerp(0.42, 0.22, Math.min(speed / 100, 1));
    let targetSteer = 0;
    if (left) targetSteer += targetMaxSteer;
    if (right) targetSteer -= targetMaxSteer;

    // Smooth steering input
    this.currentSteerAngle = THREE.MathUtils.lerp(this.currentSteerAngle, targetSteer, dt * 14);
    this.vehicle.setSteeringValue(this.currentSteerAngle, 0);
    this.vehicle.setSteeringValue(this.currentSteerAngle, 1);

    // Rotate steering wheel mesh to match
    if (this.steeringWheel) {
      this.steeringWheel.rotation.z = -this.currentSteerAngle * 3.5;
    }

    // Braking & Handbrake
    if (brake) {
      this.vehicle.setBrake(this.brakeForce, 0);
      this.vehicle.setBrake(this.brakeForce, 1);
      this.vehicle.setBrake(this.handbrakeForce, 2);
      this.vehicle.setBrake(this.handbrakeForce, 3);
      this.isBraking = true;
    } else if (this.isBraking) {
      this.vehicle.setBrake(this.brakeForce, 0);
      this.vehicle.setBrake(this.brakeForce, 1);
      this.vehicle.setBrake(this.brakeForce, 2);
      this.vehicle.setBrake(this.brakeForce, 3);
    } else {
      this.vehicle.setBrake(0, 0);
      this.vehicle.setBrake(0, 1);
      this.vehicle.setBrake(0, 2);
      this.vehicle.setBrake(0, 3);
    }

    // Aerodynamic Downforce: keeps vehicle planted over crests
    const downforce = Math.min(speed * speed * 0.08, 3000);
    this.chassisBody.applyForce(new CANNON.Vec3(0, -downforce, 0), new CANNON.Vec3(0, 0, 0));

    // Tail / Brake / Reverse lights visual update
    if (this.isBraking) {
      this.tailLightsMat.emissiveIntensity = 3.5;
      this.tailLightsMat.emissive.setHex(0xff0000);
    } else {
      this.tailLightsMat.emissiveIntensity = 0.7;
      this.tailLightsMat.emissive.setHex(0x880000);
    }

    if (this.isReversing) {
      this.reverseLightsMat.emissive.setHex(0xffffff);
      this.reverseLightsMat.emissiveIntensity = 1.5;
    } else {
      this.reverseLightsMat.emissive.setHex(0x000000);
      this.reverseLightsMat.emissiveIntensity = 0;
    }

    // Hazard flashers update
    this.hazardTimer += dt;
    if (this.hazardsActive) {
      const isOn = Math.floor(this.hazardTimer * 2.5) % 2 === 0;
      this.hazardLightsMat.emissive.setHex(isOn ? 0xffaa00 : 0x000000);
      this.hazardLightsMat.emissiveIntensity = isOn ? 2.5 : 0;
    } else {
      this.hazardLightsMat.emissive.setHex(0x000000);
      this.hazardLightsMat.emissiveIntensity = 0;
    }

    // Sync chassis visual mesh with physics body
    this.chassisMesh.position.copy(this.chassisBody.position as any);
    this.chassisMesh.quaternion.copy(this.chassisBody.quaternion as any);

    // Sync wheels
    for (let i = 0; i < 4; i++) {
      this.wheelMeshes[i].position.copy(this.wheelBodies[i].position as any);
      this.wheelMeshes[i].quaternion.copy(this.wheelBodies[i].quaternion as any);
    }

    // Exhaust smoke update
    if (this.exhaustParticles && this.exhaustPositions) {
      const posAttr = this.exhaustParticles.geometry.attributes.position as THREE.BufferAttribute;
      const arr = this.exhaustPositions;
      const count = arr.length / 3;

      // Spawn puff from exhaust if accelerating
      if (up && Math.random() < 0.35) {
        const p = this.getPosition();
        const q = this.getQuaternion();
        const offset = new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.1, -2.3).applyQuaternion(q);
        const spawnPos = p.clone().add(offset);

        // Put in first available or shift
        for (let i = count - 1; i > 0; i--) {
          arr[i * 3] = arr[(i - 1) * 3];
          arr[i * 3 + 1] = arr[(i - 1) * 3 + 1];
          arr[i * 3 + 2] = arr[(i - 1) * 3 + 2];
        }
        arr[0] = spawnPos.x;
        arr[1] = spawnPos.y;
        arr[2] = spawnPos.z;
      }

      // Drift and fade smoke
      for (let i = 0; i < count; i++) {
        if (arr[i * 3 + 1] > -50) {
          arr[i * 3 + 1] += dt * 0.8;
          arr[i * 3] += (Math.random() - 0.5) * dt * 0.5;
        }
      }
      posAttr.needsUpdate = true;
    }
  }
}
