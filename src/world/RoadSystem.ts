import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createNoise2D } from 'simplex-noise';

export interface RoadChunk {
  chunkIndex: number;
  zStart: number;
  zEnd: number;
  roadMesh: THREE.Mesh;
  terrainMesh: THREE.Mesh;
  propsGroup: THREE.Group;
  physicsBody: CANNON.Body;
  lights: THREE.PointLight[];
}

export class RoadSystem {
  public static readonly ROAD_WIDTH = 13.0; // Two 4.5m lanes + 2m shoulders
  public static readonly CHUNK_LENGTH = 100.0;
  public static readonly SEGMENTS_PER_CHUNK = 25; // 4m per slice for smooth curves
  public static readonly TERRAIN_WIDTH = 100.0; // Terrain width to each side
  public static readonly TERRAIN_SEGMENTS = 16;

  private scene: THREE.Scene;
  private physicsWorld: CANNON.World;
  private groundMaterial: CANNON.Material;

  private roadMaterial: THREE.MeshStandardMaterial;
  private terrainMaterial: THREE.MeshStandardMaterial;
  private guardrailMaterial: THREE.MeshStandardMaterial;
  private poleMaterial: THREE.MeshStandardMaterial;
  private signMaterial: THREE.MeshStandardMaterial;
  private treeBarkMaterial: THREE.MeshStandardMaterial;
  private treeFoliageMaterial: THREE.MeshStandardMaterial;
  private reflectorMaterial: THREE.MeshStandardMaterial;

  private noise2D = createNoise2D();

  // Active chunks keyed by chunkIndex
  private chunks = new Map<number, RoadChunk>();
  private activeLights: THREE.PointLight[] = [];

  constructor(scene: THREE.Scene, physicsWorld: CANNON.World, groundMaterial: CANNON.Material) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.groundMaterial = groundMaterial;

    const textureLoader = new THREE.TextureLoader();

    // Road texture
    const roadTex = textureLoader.load('/road_surface.png');
    roadTex.wrapS = THREE.ClampToEdgeWrapping;
    roadTex.wrapT = THREE.RepeatWrapping;
    roadTex.repeat.set(1, RoadSystem.CHUNK_LENGTH / 12.8); // 12.8m per texture cycle

    this.roadMaterial = new THREE.MeshStandardMaterial({
      map: roadTex,
      roughness: 0.7,
      metalness: 0.1,
      color: 0x999999,
    });

    // Terrain texture
    const terrainTex = textureLoader.load('/terrain.png');
    terrainTex.wrapS = THREE.RepeatWrapping;
    terrainTex.wrapT = THREE.RepeatWrapping;
    terrainTex.repeat.set(12, 12);

    this.terrainMaterial = new THREE.MeshStandardMaterial({
      map: terrainTex,
      roughness: 0.9,
      metalness: 0.05,
      color: 0x667766,
    });

    // Guardrails
    this.guardrailMaterial = new THREE.MeshStandardMaterial({
      color: 0x999999,
      metalness: 0.8,
      roughness: 0.3,
    });

    // Wooden utility poles
    const barkTex = textureLoader.load('/pine_bark.png');
    this.poleMaterial = new THREE.MeshStandardMaterial({
      map: barkTex,
      roughness: 0.9,
      metalness: 0.1,
    });

    // Road sign
    const signTex = textureLoader.load('/sign_warning.png');
    this.signMaterial = new THREE.MeshStandardMaterial({
      map: signTex,
      transparent: true,
      roughness: 0.5,
      metalness: 0.2,
    });

    // Pine trees
    this.treeBarkMaterial = new THREE.MeshStandardMaterial({
      map: barkTex,
      roughness: 0.9,
      color: 0x3d2817,
    });

    const foliageTex = textureLoader.load('/pine_foliage.png');
    this.treeFoliageMaterial = new THREE.MeshStandardMaterial({
      map: foliageTex,
      transparent: true,
      roughness: 0.9,
      color: 0x182c16,
      side: THREE.DoubleSide,
    });

    // Retroreflective road studs
    this.reflectorMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xddddaa,
      emissiveIntensity: 0.4,
      roughness: 0.2,
      metalness: 0.9,
    });
  }

  // --- Road Curvature Math ---

  public static getRoadCenter(z: number): THREE.Vector3 {
    // Start straight for first 60m so player can get rolling smoothly
    const blend = Math.min(1, Math.max(0, (z - 40) / 80));
    
    // Multi-frequency curve
    const x = blend * (
      Math.sin(z * 0.0035) * 45 +
      Math.sin(z * 0.009 + 0.8) * 22 +
      Math.sin(z * 0.02 + 2.1) * 7
    );

    // Subtle undulating hills and dips
    const y = blend * (
      Math.sin(z * 0.004) * 3.5 +
      Math.cos(z * 0.011) * 1.5
    );

    return new THREE.Vector3(x, y, z);
  }

  public static getRoadTangent(z: number): THREE.Vector3 {
    const dz = 0.5;
    const p1 = RoadSystem.getRoadCenter(z - dz);
    const p2 = RoadSystem.getRoadCenter(z + dz);
    return new THREE.Vector3().subVectors(p2, p1).normalize();
  }

  public static getRoadFrame(z: number) {
    const center = RoadSystem.getRoadCenter(z);
    const tangent = RoadSystem.getRoadTangent(z);
    const worldUp = new THREE.Vector3(0, 1, 0);

    // Curvature banking
    const dz = 1.0;
    const t1 = RoadSystem.getRoadTangent(z - dz);
    const t2 = RoadSystem.getRoadTangent(z + dz);
    const curvature = (t2.x - t1.x) / (2 * dz); // approximate dTx/dz
    const bankAngle = THREE.MathUtils.clamp(-curvature * 12.0, -0.15, 0.15); // gentle banking

    // Right vector
    const right = new THREE.Vector3().crossVectors(tangent, worldUp).normalize();
    // Apply banking roll around tangent
    right.applyAxisAngle(tangent, bankAngle);
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();

    return { center, tangent, right, up, bankAngle, curvature };
  }

  // Terrain height away from road
  public getTerrainElevation(x: number, z: number): number {
    const roadPoint = RoadSystem.getRoadCenter(z);
    const distToRoad = Math.hypot(x - roadPoint.x, 0);
    const roadWidthHalf = RoadSystem.ROAD_WIDTH / 2;

    // Smooth transition from road edge to natural hills
    const shoulderEnd = roadWidthHalf + 4.0;
    if (distToRoad <= roadWidthHalf) {
      return roadPoint.y;
    }

    // Natural rolling terrain
    let hillHeight = this.noise2D(x * 0.015, z * 0.015) * 12.0;
    hillHeight += this.noise2D(x * 0.04, z * 0.04) * 3.5;

    if (distToRoad < shoulderEnd) {
      const t = (distToRoad - roadWidthHalf) / (shoulderEnd - roadWidthHalf);
      // Ease out blend
      const smoothT = t * t * (3 - 2 * t);
      return THREE.MathUtils.lerp(roadPoint.y, roadPoint.y + hillHeight, smoothT);
    }

    return roadPoint.y + hillHeight;
  }

  // --- Chunk Management ---

  public update(playerZ: number) {
    const currentChunkIdx = Math.floor(playerZ / RoadSystem.CHUNK_LENGTH);

    // Keep chunks loaded: 1 chunk behind, 4 chunks ahead (500 meters total)
    const neededChunks = new Set<number>();
    for (let offset = -1; offset <= 4; offset++) {
      neededChunks.add(currentChunkIdx + offset);
    }

    // Generate new chunks
    for (const chunkIdx of neededChunks) {
      if (!this.chunks.has(chunkIdx)) {
        this.generateChunk(chunkIdx);
      }
    }

    // Unload distant chunks
    for (const [chunkIdx, chunk] of this.chunks.entries()) {
      if (!neededChunks.has(chunkIdx)) {
        this.destroyChunk(chunk);
        this.chunks.delete(chunkIdx);
      }
    }

    // Flicker streetlights
    const time = performance.now() * 0.001;
    for (const light of this.activeLights) {
      // Occasional spooky flicker
      if (Math.random() < 0.04) {
        light.intensity = 15 + Math.sin(time * 30) * 12;
      } else {
        light.intensity = 25;
      }
    }
  }

  private generateChunk(chunkIdx: number) {
    const zStart = chunkIdx * RoadSystem.CHUNK_LENGTH;
    const zEnd = (chunkIdx + 1) * RoadSystem.CHUNK_LENGTH;
    const segs = RoadSystem.SEGMENTS_PER_CHUNK;
    const dz = RoadSystem.CHUNK_LENGTH / segs;

    const propsGroup = new THREE.Group();
    const chunkLights: THREE.PointLight[] = [];

    // 1. Generate Road Ribbon Geometry
    const roadGeo = new THREE.BufferGeometry();
    const roadPositions: number[] = [];
    const roadNormals: number[] = [];
    const roadUvs: number[] = [];
    const roadIndices: number[] = [];

    // Also collect vertices & indices for Cannon-es physics Trimesh
    const physicsVertices: number[] = [];
    const physicsIndices: number[] = [];

    // Across the road: left shoulder, road, right shoulder
    const halfW = RoadSystem.ROAD_WIDTH / 2;
    const widthSlices = 4; // 5 vertices across: -W/2, -W/4, 0, +W/4, +W/2

    for (let i = 0; i <= segs; i++) {
      const z = zStart + i * dz;
      const frame = RoadSystem.getRoadFrame(z);
      const v = (i / segs) * (RoadSystem.CHUNK_LENGTH / 12.8);

      for (let j = 0; j <= widthSlices; j++) {
        const u = j / widthSlices;
        const crossOffset = (u - 0.5) * RoadSystem.ROAD_WIDTH;
        
        // World position of this road vertex
        const vertPos = new THREE.Vector3()
          .copy(frame.center)
          .addScaledVector(frame.right, crossOffset);

        roadPositions.push(vertPos.x, vertPos.y, vertPos.z);
        roadNormals.push(frame.up.x, frame.up.y, frame.up.z);
        roadUvs.push(u, v);

        // Physics vertices match world position
        physicsVertices.push(vertPos.x, vertPos.y, vertPos.z);
      }
    }

    // Triangles
    const vertsPerRow = widthSlices + 1;
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < widthSlices; j++) {
        const a = i * vertsPerRow + j;
        const b = (i + 1) * vertsPerRow + j;
        const c = (i + 1) * vertsPerRow + (j + 1);
        const d = i * vertsPerRow + (j + 1);

        roadIndices.push(a, b, d);
        roadIndices.push(b, c, d);

        physicsIndices.push(a, b, d);
        physicsIndices.push(b, c, d);
      }
    }

    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
    roadGeo.setIndex(roadIndices);

    const roadMesh = new THREE.Mesh(roadGeo, this.roadMaterial);
    roadMesh.receiveShadow = true;
    this.scene.add(roadMesh);

    // 2. Physics Body for Road (Cannon Trimesh)
    const trimeshShape = new CANNON.Trimesh(physicsVertices, physicsIndices);
    const roadBody = new CANNON.Body({ mass: 0, material: this.groundMaterial });
    roadBody.addShape(trimeshShape);
    this.physicsWorld.addBody(roadBody);

    // 3. Flanking Rolling Terrain (Left and Right)
    const terrainGeo = new THREE.BufferGeometry();
    const terrainPositions: number[] = [];
    const terrainNormals: number[] = [];
    const terrainUvs: number[] = [];
    const terrainIndices: number[] = [];

    // We build 2 terrain ribbons: left (-TERRAIN_WIDTH to -halfW) and right (+halfW to +TERRAIN_WIDTH)
    const tWidth = RoadSystem.TERRAIN_WIDTH;
    const tSegsX = RoadSystem.TERRAIN_SEGMENTS;
    let tVertCount = 0;

    // Left Terrain Ribbon
    for (let i = 0; i <= segs; i++) {
      const z = zStart + i * dz;
      const frame = RoadSystem.getRoadFrame(z);
      const roadLeftEdge = new THREE.Vector3().copy(frame.center).addScaledVector(frame.right, -halfW);

      for (let j = 0; j <= tSegsX; j++) {
        const frac = j / tSegsX; // 0 is outer terrain edge, 1 is road left edge
        const distFromRoad = (1 - frac) * tWidth;
        const px = roadLeftEdge.x - frame.right.x * distFromRoad;
        const pz = z;
        const py = this.getTerrainElevation(px, pz);

        terrainPositions.push(px, py, pz);
        terrainNormals.push(0, 1, 0); // Will compute at end
        terrainUvs.push(frac * 4, (i / segs) * 4);
      }
    }

    const tCols = tSegsX + 1;
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < tSegsX; j++) {
        const a = tVertCount + i * tCols + j;
        const b = tVertCount + (i + 1) * tCols + j;
        const c = tVertCount + (i + 1) * tCols + (j + 1);
        const d = tVertCount + i * tCols + (j + 1);
        terrainIndices.push(a, b, d);
        terrainIndices.push(b, c, d);
      }
    }
    tVertCount += (segs + 1) * tCols;

    // Right Terrain Ribbon
    for (let i = 0; i <= segs; i++) {
      const z = zStart + i * dz;
      const frame = RoadSystem.getRoadFrame(z);
      const roadRightEdge = new THREE.Vector3().copy(frame.center).addScaledVector(frame.right, halfW);

      for (let j = 0; j <= tSegsX; j++) {
        const frac = j / tSegsX; // 0 is road right edge, 1 is outer terrain edge
        const distFromRoad = frac * tWidth;
        const px = roadRightEdge.x + frame.right.x * distFromRoad;
        const pz = z;
        const py = this.getTerrainElevation(px, pz);

        terrainPositions.push(px, py, pz);
        terrainNormals.push(0, 1, 0);
        terrainUvs.push(frac * 4, (i / segs) * 4);
      }
    }

    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < tSegsX; j++) {
        const a = tVertCount + i * tCols + j;
        const b = tVertCount + (i + 1) * tCols + j;
        const c = tVertCount + (i + 1) * tCols + (j + 1);
        const d = tVertCount + i * tCols + (j + 1);
        terrainIndices.push(a, b, d);
        terrainIndices.push(b, c, d);
      }
    }

    terrainGeo.setAttribute('position', new THREE.Float32BufferAttribute(terrainPositions, 3));
    terrainGeo.setAttribute('normal', new THREE.Float32BufferAttribute(terrainNormals, 3));
    terrainGeo.setAttribute('uv', new THREE.Float32BufferAttribute(terrainUvs, 2));
    terrainGeo.setIndex(terrainIndices);
    terrainGeo.computeVertexNormals();

    const terrainMesh = new THREE.Mesh(terrainGeo, this.terrainMaterial);
    terrainMesh.receiveShadow = true;
    this.scene.add(terrainMesh);

    // 4. Roadside Props: Guardrails on curves, Utility Poles, Streetlights, Spooky Trees
    this.populateChunkProps(chunkIdx, propsGroup, chunkLights);
    this.scene.add(propsGroup);

    // Track active lights
    this.activeLights.push(...chunkLights);

    this.chunks.set(chunkIdx, {
      chunkIndex: chunkIdx,
      zStart,
      zEnd,
      roadMesh,
      terrainMesh,
      propsGroup,
      physicsBody: roadBody,
      lights: chunkLights,
    });
  }

  private populateChunkProps(chunkIdx: number, group: THREE.Group, chunkLights: THREE.PointLight[]) {
    const zStart = chunkIdx * RoadSystem.CHUNK_LENGTH;
    const halfW = RoadSystem.ROAD_WIDTH / 2;

    // A. Guardrails on sharper curves
    const midZ = zStart + RoadSystem.CHUNK_LENGTH / 2;
    const frameMid = RoadSystem.getRoadFrame(midZ);
    const hasCurve = Math.abs(frameMid.curvature) > 0.004;

    if (hasCurve) {
      // Guardrail along outer curve side
      const side = frameMid.curvature > 0 ? 1 : -1;
      const railOffset = (halfW - 0.3) * side;

      const railGeo = new THREE.BoxGeometry(0.12, 0.4, 8);
      const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 8);

      for (let z = zStart + 4; z < zStart + RoadSystem.CHUNK_LENGTH; z += 8) {
        const frame = RoadSystem.getRoadFrame(z);
        const railPos = new THREE.Vector3().copy(frame.center).addScaledVector(frame.right, railOffset);
        railPos.y += 0.6;

        const rail = new THREE.Mesh(railGeo, this.guardrailMaterial);
        rail.position.copy(railPos);
        rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
        rail.castShadow = true;
        group.add(rail);

        // Support post
        const post = new THREE.Mesh(postGeo, this.guardrailMaterial);
        post.position.set(railPos.x, railPos.y - 0.4, railPos.z);
        post.castShadow = true;
        group.add(post);
      }
    }

    // B. Wooden Utility Poles & Catenary Wires (every 40m along right shoulder)
    for (let step = 0; step < 2; step++) {
      const zPole = zStart + 20 + step * 50;
      const frame = RoadSystem.getRoadFrame(zPole);
      const polePos = new THREE.Vector3().copy(frame.center).addScaledVector(frame.right, halfW + 3.2);
      polePos.y = this.getTerrainElevation(polePos.x, polePos.z);

      // Pole geometry
      const pole = this.createUtilityPole();
      pole.position.copy(polePos);
      group.add(pole);

      // Add a warning sign on the first pole of odd chunks
      if (chunkIdx % 2 === 1 && step === 0) {
        const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), this.signMaterial);
        signMesh.position.set(polePos.x - 0.8, polePos.y + 2.5, polePos.z);
        signMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
        group.add(signMesh);
      }
    }

    // C. Flickering Sodium-Vapor Streetlight (every chunk)
    const zLight = zStart + 50;
    const frameLight = RoadSystem.getRoadFrame(zLight);
    const lightPolePos = new THREE.Vector3().copy(frameLight.center).addScaledVector(frameLight.right, -halfW - 2.5);
    lightPolePos.y = this.getTerrainElevation(lightPolePos.x, lightPolePos.z);

    const streetLightMesh = this.createStreetLight();
    streetLightMesh.position.copy(lightPolePos);
    group.add(streetLightMesh);

    // Warm eerie amber point light
    const pointLight = new THREE.PointLight(0xffa834, 25, 45, 1.5);
    pointLight.position.set(lightPolePos.x + 2.2, lightPolePos.y + 7.5, lightPolePos.z);
    pointLight.castShadow = false; // Keep performance 60fps
    group.add(pointLight);
    chunkLights.push(pointLight);

    // D. Retroreflective Cat's Eyes (studs) along road edges and center line
    const studGeo = new THREE.BoxGeometry(0.12, 0.05, 0.2);
    for (let z = zStart; z < zStart + RoadSystem.CHUNK_LENGTH; z += 10) {
      const frame = RoadSystem.getRoadFrame(z);
      // Center yellow stud
      const centerStud = new THREE.Mesh(studGeo, this.reflectorMaterial);
      centerStud.position.copy(frame.center).addScaledVector(frame.up, 0.04);
      centerStud.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      group.add(centerStud);

      // White edge studs
      const leftStud = new THREE.Mesh(studGeo, this.reflectorMaterial);
      leftStud.position.copy(frame.center).addScaledVector(frame.right, -halfW + 0.8).addScaledVector(frame.up, 0.04);
      leftStud.quaternion.copy(centerStud.quaternion);
      group.add(leftStud);

      const rightStud = new THREE.Mesh(studGeo, this.reflectorMaterial);
      rightStud.position.copy(frame.center).addScaledVector(frame.right, halfW - 0.8).addScaledVector(frame.up, 0.04);
      rightStud.quaternion.copy(centerStud.quaternion);
      group.add(rightStud);
    }

    // E. Dense Spooky Pine Trees & Dead Trees along forest line
    const treeCount = 28;
    for (let i = 0; i < treeCount; i++) {
      const zTree = zStart + (i / treeCount) * RoadSystem.CHUNK_LENGTH + (Math.random() * 4 - 2);
      const side = (i % 2 === 0 ? 1 : -1);
      const dist = halfW + 6.0 + Math.random() * 40.0; // In the woods
      
      const frame = RoadSystem.getRoadFrame(zTree);
      const treePos = new THREE.Vector3().copy(frame.center).addScaledVector(frame.right, side * dist);
      treePos.y = this.getTerrainElevation(treePos.x, treePos.z);

      const isDead = Math.random() < 0.35;
      const treeMesh = isDead ? this.createDeadTree() : this.createPineTree();
      treeMesh.position.copy(treePos);
      const scale = 0.8 + Math.random() * 0.7;
      treeMesh.scale.set(scale, scale, scale);
      treeMesh.rotation.y = Math.random() * Math.PI * 2;
      group.add(treeMesh);
    }
  }

  private createUtilityPole(): THREE.Group {
    const poleGroup = new THREE.Group();
    // Main vertical pole (height 9m)
    const poleGeo = new THREE.CylinderGeometry(0.18, 0.24, 9, 8);
    const poleMesh = new THREE.Mesh(poleGeo, this.poleMaterial);
    poleMesh.position.y = 4.5;
    poleMesh.castShadow = true;
    poleGroup.add(poleMesh);

    // Crossbar
    const barGeo = new THREE.BoxGeometry(2.4, 0.15, 0.15);
    const barMesh = new THREE.Mesh(barGeo, this.poleMaterial);
    barMesh.position.y = 8.2;
    barMesh.castShadow = true;
    poleGroup.add(barMesh);

    // Insulators
    const insGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 6);
    const insMat = new THREE.MeshStandardMaterial({ color: 0x224455, roughness: 0.3 });
    for (const offset of [-1.0, 0, 1.0]) {
      const ins = new THREE.Mesh(insGeo, insMat);
      ins.position.set(offset, 8.35, 0);
      poleGroup.add(ins);
    }

    return poleGroup;
  }

  private createStreetLight(): THREE.Group {
    const lightGroup = new THREE.Group();
    // Metal pole
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 8, 8);
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8, roughness: 0.4 });
    const pole = new THREE.Mesh(poleGeo, metalMat);
    pole.position.y = 4;
    lightGroup.add(pole);

    // Curved arm extending over road
    const armGeo = new THREE.BoxGeometry(2.6, 0.1, 0.1);
    const arm = new THREE.Mesh(armGeo, metalMat);
    arm.position.set(1.2, 7.8, 0);
    lightGroup.add(arm);

    // Lamp fixture head
    const headGeo = new THREE.ConeGeometry(0.35, 0.4, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(2.4, 7.6, 0);
    head.rotation.x = Math.PI;
    lightGroup.add(head);

    // Glowing bulb surface
    const bulbGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffcc66 });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(2.4, 7.4, 0);
    lightGroup.add(bulb);

    return lightGroup;
  }

  private createPineTree(): THREE.Group {
    const tree = new THREE.Group();
    // Trunk
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.45, 8, 7);
    const trunk = new THREE.Mesh(trunkGeo, this.treeBarkMaterial);
    trunk.position.y = 4;
    trunk.castShadow = true;
    tree.add(trunk);

    // 3 tiered pine foliage cones
    const foliageTiers = [
      { y: 5.5, radius: 2.8, height: 4.5 },
      { y: 7.5, radius: 2.2, height: 4.0 },
      { y: 9.5, radius: 1.4, height: 3.2 },
    ];

    for (const tier of foliageTiers) {
      const coneGeo = new THREE.ConeGeometry(tier.radius, tier.height, 7);
      const cone = new THREE.Mesh(coneGeo, this.treeFoliageMaterial);
      cone.position.y = tier.y;
      cone.castShadow = true;
      tree.add(cone);
    }

    return tree;
  }

  private createDeadTree(): THREE.Group {
    const tree = new THREE.Group();
    // Twisted trunk
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.5, 7.5, 6);
    const trunk = new THREE.Mesh(trunkGeo, this.treeBarkMaterial);
    trunk.position.y = 3.75;
    trunk.rotation.z = (Math.random() - 0.5) * 0.25;
    trunk.castShadow = true;
    tree.add(trunk);

    // 2-3 bare branches
    const branchGeo = new THREE.CylinderGeometry(0.08, 0.15, 3.5, 5);
    for (let b = 0; b < 3; b++) {
      const branch = new THREE.Mesh(branchGeo, this.treeBarkMaterial);
      branch.position.set(0, 4.5 + b * 1.0, 0);
      branch.rotation.z = (b % 2 === 0 ? 1 : -1) * (0.8 + Math.random() * 0.4);
      branch.rotation.y = Math.random() * Math.PI * 2;
      tree.add(branch);
    }

    return tree;
  }

  private destroyChunk(chunk: RoadChunk) {
    this.scene.remove(chunk.roadMesh);
    chunk.roadMesh.geometry.dispose();

    this.scene.remove(chunk.terrainMesh);
    chunk.terrainMesh.geometry.dispose();

    this.scene.remove(chunk.propsGroup);
    // Remove lights from active list
    for (const light of chunk.lights) {
      const idx = this.activeLights.indexOf(light);
      if (idx !== -1) this.activeLights.splice(idx, 1);
    }

    this.physicsWorld.removeBody(chunk.physicsBody);
  }

  public reset() {
    for (const chunk of this.chunks.values()) {
      this.destroyChunk(chunk);
    }
    this.chunks.clear();
    this.activeLights = [];
  }
}
