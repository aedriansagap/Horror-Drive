import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createNoise2D } from 'simplex-noise';

export class World {
  private scene: THREE.Scene;
  private physicsWorld: CANNON.World;
  private groundMaterial: CANNON.Material;

  private noise2D = createNoise2D();
  
  // Lighting and Environment
  private ambientLight: THREE.AmbientLight;
  private moonLight: THREE.DirectionalLight;
  private timeOfDay = 0;

  // Terrain chunks
  private chunkSize = 100;
  private chunkResolution = 20; // 20x20 segments
  private maxViewDistanceChunks = 2; // Create 5x5 chunks around player
  
  private chunks = new Map<string, { mesh: THREE.Mesh, body: CANNON.Body }>();
  private terrainMaterial: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, physicsWorld: CANNON.World, groundMaterial: CANNON.Material) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.groundMaterial = groundMaterial;

    // Materials
    this.terrainMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x1a3300, // Dark dirty green
      roughness: 0.9,
      metalness: 0.1,
      flatShading: true,
    });

    // Environment Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.05); // Very dark
    this.scene.add(this.ambientLight);

    this.moonLight = new THREE.DirectionalLight(0x4466ff, 0.2); // Blueish moon
    this.moonLight.position.set(100, 100, 50);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.camera.left = -100;
    this.moonLight.shadow.camera.right = 100;
    this.moonLight.shadow.camera.top = 100;
    this.moonLight.shadow.camera.bottom = -100;
    this.scene.add(this.moonLight);

    this.scene.fog = new THREE.FogExp2(0x020205, 0.04);
    this.scene.background = new THREE.Color(0x020205);
  }

  public reset() {
    this.timeOfDay = 0;
    // Clear chunks
    this.chunks.forEach(chunk => {
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      this.physicsWorld.removeBody(chunk.body);
    });
    this.chunks.clear();
  }

  public update(playerPos: THREE.Vector3) {
    // 1. Day Night Cycle (Optional subtle changes)
    this.timeOfDay += 0.001;
    // Let's keep it mostly night/spooky, so limit light changes
    
    // 2. Procedural Terrain Generation
    const currentChunkX = Math.floor(playerPos.x / this.chunkSize);
    const currentChunkZ = Math.floor(playerPos.z / this.chunkSize);

    const neededChunks = new Set<string>();

    for (let x = -this.maxViewDistanceChunks; x <= this.maxViewDistanceChunks; x++) {
      for (let z = -this.maxViewDistanceChunks; z <= this.maxViewDistanceChunks; z++) {
        const cx = currentChunkX + x;
        const cz = currentChunkZ + z;
        const key = `${cx},${cz}`;
        neededChunks.add(key);

        if (!this.chunks.has(key)) {
          this.generateChunk(cx, cz);
        }
      }
    }

    // Cleanup old chunks
    for (const [key, chunk] of this.chunks.entries()) {
      if (!neededChunks.has(key)) {
        this.scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        this.physicsWorld.removeBody(chunk.body);
        this.chunks.delete(key);
      }
    }
  }

  private generateChunk(cx: number, cz: number) {
    const geo = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, this.chunkResolution, this.chunkResolution);
    geo.rotateX(-Math.PI / 2); // Lay flat
    
    const vertices = geo.attributes.position.array;
    const heightData: number[][] = [];
    
    // Generate heights
    for (let i = 0; i <= this.chunkResolution; i++) {
        heightData.push([]);
    }

    let vertexIdx = 0;
    for (let i = 0; i <= this.chunkResolution; i++) {
      for (let j = 0; j <= this.chunkResolution; j++) {
        const x = (cx * this.chunkSize) + (j * (this.chunkSize / this.chunkResolution)) - (this.chunkSize / 2);
        const z = (cz * this.chunkSize) + (i * (this.chunkSize / this.chunkResolution)) - (this.chunkSize / 2);
        
        // Simplex noise for rolling hills
        const scale1 = 0.02;
        const scale2 = 0.05;
        let y = this.noise2D(x * scale1, z * scale1) * 10;
        y += this.noise2D(x * scale2, z * scale2) * 2;
        
        // Flatten the center slightly for a starting road area
        const distFromCenter = Math.sqrt(x*x + z*z);
        if (distFromCenter < 20) {
            y *= (distFromCenter / 20); // Smooth transition
        }

        vertices[vertexIdx + 1] = y;
        heightData[i][j] = y;
        
        vertexIdx += 3;
      }
    }

    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.terrainMaterial);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Physics Heightfield
    // Cannon-es Heightfield expects data in [x][y] format (or [x][z] in our terms)
    // Note: Heightfield in cannon is generated differently, we need to transpose
    const physicsHeightData: number[][] = [];
    for (let i = 0; i < this.chunkResolution + 1; i++) {
      physicsHeightData.push([]);
      for (let j = 0; j < this.chunkResolution + 1; j++) {
        physicsHeightData[i].push(heightData[this.chunkResolution - j][i]);
      }
    }

    const hfShape = new CANNON.Heightfield(physicsHeightData, {
      elementSize: this.chunkSize / this.chunkResolution
    });

    const body = new CANNON.Body({ mass: 0, material: this.groundMaterial });
    body.addShape(hfShape);
    
    // Position the heightfield correctly
    body.position.set(
      cx * this.chunkSize - (this.chunkSize / 2),
      0,
      cz * this.chunkSize + (this.chunkSize / 2)
    );
    // Heightfield needs to be rotated to match our plane
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);

    this.physicsWorld.addBody(body);
    
    this.chunks.set(`${cx},${cz}`, { mesh, body });
  }
}
