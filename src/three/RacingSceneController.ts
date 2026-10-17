import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {
  CameraMode,
  CAR_PAINT_PRESETS,
  CarPaintId,
  ENVIRONMENT_PRESETS,
  EnvironmentId,
  GameState,
  OnlinePlayerState,
  TelemetryData,
} from '../types/game';
import { soundEngine } from '../audio/soundEngine';
import {
  createBoostPadTexture,
  createCarbonFiberTexture,
  createContactShadowTexture,
  createHighwayRoadTexture,
} from './proceduralTextures';
import {
  buildHeroSupercar,
  buildRivalVehicle,
  HeroCarRig,
  RivalArchetype,
  RivalCarRig,
} from './carBuilder';

// Pre-allocated math helpers at module scope (Zero GC in animation loop)
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _color = new THREE.Color();

const LANE_X = [-5.25, -1.75, 1.75, 5.25];
const ROAD_HALF_WIDTH = 7.4;
const LAP_DISTANCE_METERS = 1800;
const TOTAL_LAPS = 3;

interface ActiveRival {
  rig: RivalCarRig;
  x: number;
  z: number;
  speedMps: number;
  baseSpeedMps: number;
  currentLane: number;
  targetLane: number;
  laneChangeWindup: number;
  isChangingLane: boolean;
  laneChangeCooldown: number;
  nearMissAwarded: boolean;
}

interface RemotePeerActor {
  id: string;
  name: string;
  paintId: CarPaintId;
  rig: HeroCarRig;
  labelSprite: THREE.Sprite;
  labelTexture: THREE.CanvasTexture;
  targetX: number;
  currentX: number;
  targetDistanceMeters: number;
  currentRelativeZ: number;
  speedMps: number;
  steerAngle: number;
  driftAngle: number;
  isBoosting: boolean;
  isDrifting: boolean;
  rank: number;
}

interface BoostPadItem {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  activeCooldown: number;
}

interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  colorHex: number;
}

function createDriverLabelSprite(name: string, rank: number, hexColor: string): {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  updateDriverLabelCanvas(canvas, texture, name, rank, hexColor);

  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.4, 0.85, 1);
  sprite.position.set(0, 2.15, 0);
  sprite.renderOrder = 10;
  return { sprite, texture };
}

function updateDriverLabelCanvas(
  canvas: HTMLCanvasElement,
  texture: THREE.CanvasTexture,
  name: string,
  rank: number,
  hexColor: string
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Dark slate tag background
  ctx.fillStyle = 'rgba(9, 13, 22, 0.88)';
  ctx.strokeStyle = hexColor;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(16, 20, 480, 88, 18);
  ctx.fill();
  ctx.stroke();

  // Rank indicator
  ctx.fillStyle = hexColor;
  ctx.font = 'bold 42px "Chakra Petch", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`P${rank}`, 42, 66);

  // Callsign text
  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 38px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(name.slice(0, 13).toUpperCase(), 125, 66);

  texture.needsUpdate = true;
}

export class RacingSceneController {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock: THREE.Clock;
  private rafId: number | null = null;
  private isDisposed = false;

  // Shared Procedural Textures
  private roadTexture!: THREE.CanvasTexture;
  private carbonTexture!: THREE.CanvasTexture;
  private shadowTexture!: THREE.CanvasTexture;
  private roadScrollOffset = 0;

  // Lighting & Environment
  private keyLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private rimLight!: THREE.DirectionalLight;
  private rectLight!: THREE.RectAreaLight;
  private groundMesh!: THREE.Mesh;
  private roadMesh!: THREE.Mesh;

  // Instanced Scenery
  private canyonInstanced!: THREE.InstancedMesh;
  private canyonPositions: { x: number; y: number; z: number; sx: number; sy: number; sz: number; rotY: number }[] = [];
  private treeInstanced!: THREE.InstancedMesh;
  private treePositions: { x: number; y: number; z: number; scale: number }[] = [];
  private poleInstanced!: THREE.InstancedMesh;
  private polePositions: { x: number; y: number; z: number }[] = [];
  private gantryGroup!: THREE.Group;

  // Vehicles & Pickups
  private heroCar!: HeroCarRig;
  private rivals: ActiveRival[] = [];
  private remotePeers = new Map<string, RemotePeerActor>();
  private boostPads: BoostPadItem[] = [];

  // Pooled 3D Particle System
  private particleInstanced!: THREE.InstancedMesh;
  private particles: PooledParticle[] = [];

  // Input State
  private heldKeys = new Set<string>();
  private justPressedKeys = new Set<string>();
  private touchInput = { left: false, right: false, throttle: false, brake: false, nitro: false, drift: false };

  // Simulation State
  private gameState: GameState = GameState.TITLE;
  private cameraMode: CameraMode = CameraMode.CHASE;
  private environmentId: EnvironmentId = EnvironmentId.SUNSET_CANYON;
  private paintId: CarPaintId = CarPaintId.SOLAR_AMBER;

  // Player Physics
  private playerX = 1.75;
  private playerVx = 0;
  private playerSpeedMps = 38;
  private maxBaseSpeedMps = 86;
  private maxBoostSpeedMps = 108;
  private steerAngle = 0;
  private driftAngle = 0;
  private isDrifting = false;
  private isBoosting = false;
  private nitro = 100;
  private shield = 100;
  private score = 0;
  private combo = 1;
  private comboTimer = 0;
  private nearMisses = 0;
  private distanceMeters = 0;
  private lap = 1;
  private lapTimeMs = 0;
  private bestLapTimeMs: number | null = null;
  private totalTimeMs = 0;
  private hitstopTimer = 0;
  private cameraShake = 0;
  private damageFlashTimer = 0;
  private eventBanner: string | null = null;
  private eventBannerTimer = 0;
  private titleOrbitAngle = 0;
  private authoritativeRank: number | null = null;
  private onlinePlayerCount = 1;

  // Callbacks
  private onTelemetryUpdate: (data: TelemetryData) => void;
  private onNetworkTick?: (payload: {
    x: number;
    distanceMeters: number;
    speedMps: number;
    steerAngle: number;
    driftAngle: number;
    isBoosting: boolean;
    isDrifting: boolean;
    lap: number;
    score: number;
    shield: number;
    finished: boolean;
    finishTimeMs: number | null;
  }, force?: boolean) => void;
  private onGameStateChange: (state: GameState) => void;
  private onCameraModeChange: (mode: CameraMode) => void;
  private onHudToggleRequest: () => void;
  private lastUiSyncTime = 0;

  constructor(
    container: HTMLElement,
    callbacks: {
      onTelemetryUpdate: (data: TelemetryData) => void;
      onNetworkTick?: (
        payload: {
          x: number;
          distanceMeters: number;
          speedMps: number;
          steerAngle: number;
          driftAngle: number;
          isBoosting: boolean;
          isDrifting: boolean;
          lap: number;
          score: number;
          shield: number;
          finished: boolean;
          finishTimeMs: number | null;
        },
        force?: boolean
      ) => void;
      onGameStateChange: (state: GameState) => void;
      onCameraModeChange: (mode: CameraMode) => void;
      onHudToggleRequest: () => void;
    }
  ) {
    this.container = container;
    this.onTelemetryUpdate = callbacks.onTelemetryUpdate;
    this.onNetworkTick = callbacks.onNetworkTick;
    this.onGameStateChange = callbacks.onGameStateChange;
    this.onCameraModeChange = callbacks.onCameraModeChange;
    this.onHudToggleRequest = callbacks.onHudToggleRequest;

    const isHeadless = navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !isHeadless,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(isHeadless ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = !isHeadless;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      64,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.2,
      360
    );
    this.clock = new THREE.Clock();

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const roadTex = createHighwayRoadTexture(maxAnisotropy);
    roadTex.repeat.set(1, 24);
    this.roadTexture = roadTex;

    this.carbonTexture = createCarbonFiberTexture(maxAnisotropy);
    this.shadowTexture = createContactShadowTexture();
    const boostPadTex = createBoostPadTexture(maxAnisotropy);

    this.initLighting();
    this.initWorldGeometry(boostPadTex);
    this.initVehicles(this.carbonTexture, this.shadowTexture);
    this.initParticlePool();
    this.applyEnvironmentPreset(this.environmentId);

    this.renderer.compile(this.scene, this.camera);

    this.bindEvents();
    this.animate();
  }

  /**
   * Idempotently synchronizes remote online players in the 3D scene from the authoritative server snapshot.
   */
  public syncRemotePlayers(players: OnlinePlayerState[], localPlayerId: string | null): void {
    this.onlinePlayerCount = Math.max(1, players.length);
    const activeRemoteIds = new Set<string>();

    for (const p of players) {
      if (p.id === localPlayerId) {
        this.authoritativeRank = p.rank;
        continue;
      }

      activeRemoteIds.add(p.id);
      let peer = this.remotePeers.get(p.id);
      const paintPreset =
        CAR_PAINT_PRESETS.find((preset) => preset.id === p.paintId) || CAR_PAINT_PRESETS[0];

      if (!peer) {
        // Idempotent creation of remote player's 10-part Hero GT Supercar + 3D Callsign Sprite
        const rig = buildHeroSupercar(paintPreset, this.carbonTexture, this.shadowTexture);
        const { sprite, texture } = createDriverLabelSprite(p.name, p.rank, paintPreset.hex);
        rig.root.add(sprite);

        const initialRelZ = -(p.distanceMeters - this.distanceMeters);
        rig.root.position.set(p.x, 0, THREE.MathUtils.clamp(initialRelZ, -260, 30));
        this.scene.add(rig.root);

        peer = {
          id: p.id,
          name: p.name,
          paintId: p.paintId,
          rig,
          labelSprite: sprite,
          labelTexture: texture,
          targetX: p.x,
          currentX: p.x,
          targetDistanceMeters: p.distanceMeters,
          currentRelativeZ: initialRelZ,
          speedMps: p.speedMps,
          steerAngle: p.steerAngle,
          driftAngle: p.driftAngle,
          isBoosting: p.isBoosting,
          isDrifting: p.isDrifting,
          rank: p.rank,
        };
        this.remotePeers.set(p.id, peer);
      } else {
        // Update existing remote peer state
        if (peer.paintId !== p.paintId) {
          peer.paintId = p.paintId;
          peer.rig.paintMaterial.color.set(paintPreset.hex);
          peer.rig.accentMaterial.color.set(paintPreset.accentHex);
          peer.rig.accentMaterial.emissive.set(paintPreset.accentHex);
        }
        if (peer.name !== p.name || peer.rank !== p.rank) {
          peer.name = p.name;
          peer.rank = p.rank;
          const canvas = peer.labelTexture.image as HTMLCanvasElement;
          updateDriverLabelCanvas(canvas, peer.labelTexture, p.name, p.rank, paintPreset.hex);
        }

        peer.targetX = p.x;
        peer.targetDistanceMeters = p.distanceMeters;
        peer.speedMps = p.speedMps;
        peer.steerAngle = p.steerAngle;
        peer.driftAngle = p.driftAngle;
        peer.isBoosting = p.isBoosting;
        peer.isDrifting = p.isDrifting;
      }
    }

    // Remove any disconnected remote players cleanly
    for (const [peerId, peer] of this.remotePeers.entries()) {
      if (!activeRemoteIds.has(peerId)) {
        this.scene.remove(peer.rig.root);
        peer.labelTexture.dispose();
        peer.labelSprite.material.dispose();
        this.remotePeers.delete(peerId);
      }
    }
  }

  public showBannerMessage(banner: string, durationSeconds = 2.2): void {
    this.eventBanner = banner;
    this.eventBannerTimer = durationSeconds;
  }

  public prepareCountdownGrid(assignedX?: number): void {
    soundEngine.init();
    if (typeof assignedX === 'number') {
      this.playerX = assignedX;
    }
    this.playerVx = 0;
    this.playerSpeedMps = 0;
    this.steerAngle = 0;
    this.driftAngle = 0;
    this.isDrifting = false;
    this.isBoosting = false;
    this.nitro = 100;
    this.shield = 100;
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.nearMisses = 0;
    this.distanceMeters = 0;
    this.lap = 1;
    this.lapTimeMs = 0;
    this.totalTimeMs = 0;
    this.hitstopTimer = 0;
    this.cameraShake = 0;
    this.heroCar.root.position.set(this.playerX, 0, 0);
    this.heroCar.bodyGroup.rotation.set(0, 0, 0);
    this.gantryGroup.position.z = -12;
    this.setGameState(GameState.COUNTDOWN);
  }

  private initLighting(): void {
    RectAreaLightUniformsLib.init();

    this.keyLight = new THREE.DirectionalLight(0xff9e5e, 2.6);
    this.keyLight.position.set(22, 38, 18);
    this.keyLight.castShadow = this.renderer.shadowMap.enabled;
    const d = 24;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 95;
    this.keyLight.shadow.mapSize.width = 1024;
    this.keyLight.shadow.mapSize.height = 1024;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.hemiLight = new THREE.HemisphereLight(0xff7b54, 0x2b1810, 0.85);
    this.hemiLight.position.set(0, 50, 0);
    this.scene.add(this.hemiLight);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 1.35);
    this.rimLight.position.set(-18, 16, -28);
    this.scene.add(this.rimLight);

    this.rectLight = new THREE.RectAreaLight(0xfff7ed, 4.5, 8, 18);
    this.rectLight.position.set(0, 9.5, -2);
    this.rectLight.lookAt(0, 0, -2);
    this.scene.add(this.rectLight);
  }

  private initWorldGeometry(boostPadTex: THREE.CanvasTexture): void {
    const groundGeo = new THREE.PlaneGeometry(700, 460);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2c1914,
      roughness: 0.92,
      metalness: 0.05,
    });
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.position.set(0, -0.04, -120);
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    const roadGeo = new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2.15, 420);
    roadGeo.rotateX(-Math.PI / 2);
    const roadMat = new THREE.MeshStandardMaterial({
      map: this.roadTexture,
      roughness: 0.62,
      metalness: 0.14,
    });
    this.roadMesh = new THREE.Mesh(roadGeo, roadMat);
    this.roadMesh.position.set(0, 0, -130);
    this.roadMesh.receiveShadow = true;
    this.scene.add(this.roadMesh);

    const railGeo = new THREE.BoxGeometry(0.32, 0.55, 420);
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.78,
      roughness: 0.32,
    });
    const leftRail = new THREE.Mesh(railGeo, railMat);
    leftRail.position.set(-ROAD_HALF_WIDTH - 0.65, 0.35, -130);
    leftRail.receiveShadow = true;
    this.scene.add(leftRail);

    const rightRail = new THREE.Mesh(railGeo, railMat);
    rightRail.position.set(ROAD_HALF_WIDTH + 0.65, 0.35, -130);
    rightRail.receiveShadow = true;
    this.scene.add(rightRail);

    this.gantryGroup = new THREE.Group();
    const pillarGeo = new THREE.BoxGeometry(0.75, 7.5, 0.75);
    const gantryMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.75,
      roughness: 0.3,
    });
    const leftPillar = new THREE.Mesh(pillarGeo, gantryMat);
    leftPillar.position.set(-ROAD_HALF_WIDTH - 1.1, 3.75, 0);
    this.gantryGroup.add(leftPillar);

    const rightPillar = new THREE.Mesh(pillarGeo, gantryMat);
    rightPillar.position.set(ROAD_HALF_WIDTH + 1.1, 3.75, 0);
    this.gantryGroup.add(rightPillar);

    const crossBeamGeo = new THREE.BoxGeometry((ROAD_HALF_WIDTH + 1.4) * 2, 1.05, 0.95);
    const crossBeam = new THREE.Mesh(crossBeamGeo, gantryMat);
    crossBeam.position.set(0, 7.2, 0);
    this.gantryGroup.add(crossBeam);

    const bannerLightGeo = new THREE.BoxGeometry(ROAD_HALF_WIDTH * 1.85, 0.36, 1.04);
    const bannerLightMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 2.5,
    });
    const bannerLight = new THREE.Mesh(bannerLightGeo, bannerLightMat);
    bannerLight.position.set(0, 7.2, 0);
    this.gantryGroup.add(bannerLight);
    this.gantryGroup.position.set(0, 0, -140);
    this.scene.add(this.gantryGroup);

    const padGeo = new THREE.PlaneGeometry(2.3, 6.2);
    padGeo.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshBasicMaterial({
      map: boostPadTex,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(padGeo, padMat);
      const laneIdx = i % 4;
      const z = -65 - i * 95;
      mesh.position.set(LANE_X[laneIdx], 0.03, z);
      this.scene.add(mesh);
      this.boostPads.push({
        mesh,
        x: LANE_X[laneIdx],
        z,
        activeCooldown: 0,
      });
    }

    const canyonCount = 76;
    const canyonGeo = new THREE.ConeGeometry(9.5, 28, 6);
    canyonGeo.translate(0, 14, 0);
    const canyonMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.08,
      flatShading: true,
    });
    this.canyonInstanced = new THREE.InstancedMesh(canyonGeo, canyonMat, canyonCount);
    this.canyonInstanced.frustumCulled = false;

    for (let i = 0; i < canyonCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (24 + Math.random() * 58);
      const z = 40 - (i / canyonCount) * 340;
      const sx = 0.85 + Math.random() * 1.4;
      const sy = 0.75 + Math.random() * 1.65;
      const sz = 0.85 + Math.random() * 1.4;
      const rotY = Math.random() * Math.PI * 2;
      this.canyonPositions.push({ x, y: -0.04, z, sx, sy, sz, rotY });
    }
    this.syncCanyonInstances();
    this.scene.add(this.canyonInstanced);

    const treeCount = 84;
    const treeGeo = new THREE.ConeGeometry(2.1, 7.8, 7);
    treeGeo.translate(0, 3.9, 0);
    const treeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.1,
      flatShading: true,
    });
    this.treeInstanced = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
    this.treeInstanced.frustumCulled = false;

    for (let i = 0; i < treeCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (11.5 + Math.random() * 14);
      const z = 35 - (i / treeCount) * 320;
      const scale = 0.85 + (Math.random() - 0.5) * 0.3;
      this.treePositions.push({ x, y: 0, z, scale });
    }
    this.syncTreeInstances();
    this.scene.add(this.treeInstanced);

    const poleCount = 64;
    const poleGeo = new THREE.BoxGeometry(0.18, 1.35, 0.18);
    poleGeo.translate(0, 0.675, 0);
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.4,
      roughness: 0.3,
    });
    this.poleInstanced = new THREE.InstancedMesh(poleGeo, poleMat, poleCount);
    this.poleInstanced.frustumCulled = false;

    for (let i = 0; i < poleCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (ROAD_HALF_WIDTH + 0.65);
      const z = 30 - Math.floor(i / 2) * 10.5;
      this.polePositions.push({ x, y: 0.3, z });
    }
    this.syncPoleInstances();
    this.scene.add(this.poleInstanced);
  }

  private syncCanyonInstances(): void {
    for (let i = 0; i < this.canyonPositions.length; i++) {
      const p = this.canyonPositions[i];
      _vec3A.set(p.x, p.y, p.z);
      _euler.set(0, p.rotY, 0);
      _quat.setFromEuler(_euler);
      _vec3B.set(p.sx, p.sy, p.sz);
      _mat4.compose(_vec3A, _quat, _vec3B);
      this.canyonInstanced.setMatrixAt(i, _mat4);
    }
    this.canyonInstanced.instanceMatrix.needsUpdate = true;
    this.canyonInstanced.computeBoundingSphere();
  }

  private syncTreeInstances(): void {
    for (let i = 0; i < this.treePositions.length; i++) {
      const p = this.treePositions[i];
      _vec3A.set(p.x, p.y, p.z);
      _quat.identity();
      _vec3B.setScalar(p.scale);
      _mat4.compose(_vec3A, _quat, _vec3B);
      this.treeInstanced.setMatrixAt(i, _mat4);
    }
    this.treeInstanced.instanceMatrix.needsUpdate = true;
    this.treeInstanced.computeBoundingSphere();
  }

  private syncPoleInstances(): void {
    for (let i = 0; i < this.polePositions.length; i++) {
      const p = this.polePositions[i];
      _vec3A.set(p.x, p.y, p.z);
      _quat.identity();
      _vec3B.set(1, 1, 1);
      _mat4.compose(_vec3A, _quat, _vec3B);
      this.poleInstanced.setMatrixAt(i, _mat4);
    }
    this.poleInstanced.instanceMatrix.needsUpdate = true;
    this.poleInstanced.computeBoundingSphere();
  }

  private initVehicles(carbonTex: THREE.CanvasTexture, shadowTex: THREE.CanvasTexture): void {
    const initialPaint = CAR_PAINT_PRESETS[0];
    this.heroCar = buildHeroSupercar(initialPaint, carbonTex, shadowTex);
    this.heroCar.root.position.set(this.playerX, 0, 0);
    this.scene.add(this.heroCar.root);

    const rivalConfigs: { archetype: RivalArchetype; color: number }[] = [
      { archetype: 'RIVAL_GT', color: 0xef4444 },
      { archetype: 'INTERCEPTOR', color: 0x38bdf8 },
      { archetype: 'HAULER', color: 0x64748b },
      { archetype: 'RIVAL_GT', color: 0x10b981 },
      { archetype: 'INTERCEPTOR', color: 0xf97316 },
      { archetype: 'RIVAL_GT', color: 0xa855f7 },
      { archetype: 'HAULER', color: 0x475569 },
    ];

    rivalConfigs.forEach((cfg, idx) => {
      const rig = buildRivalVehicle(cfg.archetype, cfg.color, shadowTex);
      const lane = idx % 4;
      const z = -42 - idx * 38;
      const baseSpeedMps =
        cfg.archetype === 'HAULER'
          ? 34 + (idx % 3) * 3
          : cfg.archetype === 'INTERCEPTOR'
          ? 48 + (idx % 3) * 4
          : 54 + (idx % 3) * 5;

      rig.root.position.set(LANE_X[lane], 0, z);
      this.scene.add(rig.root);

      this.rivals.push({
        rig,
        x: LANE_X[lane],
        z,
        speedMps: baseSpeedMps,
        baseSpeedMps,
        currentLane: lane,
        targetLane: lane,
        laneChangeWindup: 0,
        isChangingLane: false,
        laneChangeCooldown: 2.0 + idx * 0.7,
        nearMissAwarded: false,
      });
    });
  }

  private initParticlePool(): void {
    const count = 90;
    const geo = new THREE.BoxGeometry(0.18, 0.18, 0.45);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.particleInstanced = new THREE.InstancedMesh(geo, mat, count);
    this.particleInstanced.frustumCulled = false;

    for (let i = 0; i < count; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -10,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.4,
        scale: 0,
        colorHex: 0x38bdf8,
      });
      _vec3A.set(0, -10, 0);
      _quat.identity();
      _vec3B.setScalar(0);
      _mat4.compose(_vec3A, _quat, _vec3B);
      this.particleInstanced.setMatrixAt(i, _mat4);
      this.particleInstanced.setColorAt(i, _color.setHex(0x38bdf8));
    }
    this.particleInstanced.instanceMatrix.needsUpdate = true;
    if (this.particleInstanced.instanceColor) {
      this.particleInstanced.instanceColor.needsUpdate = true;
    }
    this.scene.add(this.particleInstanced);
  }

  private spawnParticleBurst(
    x: number,
    y: number,
    z: number,
    count: number,
    colorHex: number,
    spreadSpeed: number,
    baseScale: number
  ): void {
    let spawned = 0;
    for (let i = 0; i < this.particles.length && spawned < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.x = x + (Math.random() - 0.5) * 0.5;
        p.y = y + Math.random() * 0.3;
        p.z = z + (Math.random() - 0.5) * 0.5;
        p.vx = (Math.random() - 0.5) * spreadSpeed;
        p.vy = Math.random() * (spreadSpeed * 0.55) + 0.8;
        p.vz = (Math.random() - 0.5) * spreadSpeed + 6;
        p.maxLife = 0.22 + Math.random() * 0.25;
        p.life = p.maxLife;
        p.scale = baseScale * (0.7 + Math.random() * 0.6);
        p.colorHex = colorHex;
        spawned++;
      }
    }
  }

  private updateParticles(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      dirty = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        _vec3A.set(0, -10, 0);
        _quat.identity();
        _vec3B.setScalar(0);
        _mat4.compose(_vec3A, _quat, _vec3B);
        this.particleInstanced.setMatrixAt(i, _mat4);
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 9.8 * dt;

      const ratio = Math.max(0, p.life / p.maxLife);
      _vec3A.set(p.x, Math.max(0.05, p.y), p.z);
      _quat.identity();
      _vec3B.setScalar(p.scale * ratio);
      _mat4.compose(_vec3A, _quat, _vec3B);
      this.particleInstanced.setMatrixAt(i, _mat4);
      this.particleInstanced.setColorAt(i, _color.setHex(p.colorHex));
    }

    if (dirty) {
      this.particleInstanced.instanceMatrix.needsUpdate = true;
      if (this.particleInstanced.instanceColor) {
        this.particleInstanced.instanceColor.needsUpdate = true;
      }
    }
  }

  public setCarPaint(paintId: CarPaintId): void {
    this.paintId = paintId;
    const preset = CAR_PAINT_PRESETS.find((p) => p.id === paintId) || CAR_PAINT_PRESETS[0];
    this.heroCar.paintMaterial.color.set(preset.hex);
    this.heroCar.paintMaterial.metalness = preset.metalness;
    this.heroCar.paintMaterial.roughness = preset.roughness;
    this.heroCar.accentMaterial.color.set(preset.accentHex);
    this.heroCar.accentMaterial.emissive.set(preset.accentHex);
  }

  public applyEnvironmentPreset(envId: EnvironmentId): void {
    this.environmentId = envId;
    const env = ENVIRONMENT_PRESETS[envId];

    this.scene.background = new THREE.Color(env.skyColor);
    this.scene.fog = new THREE.FogExp2(env.fogColor, env.fogDensity);

    this.keyLight.color.setHex(env.keyLightColor);
    this.keyLight.intensity = env.keyLightIntensity;
    this.hemiLight.color.setHex(env.hemiSkyColor);
    this.hemiLight.groundColor.setHex(env.hemiGroundColor);
    this.hemiLight.intensity = env.hemiIntensity;

    (this.groundMesh.material as THREE.MeshStandardMaterial).color.setHex(env.groundColor);

    const baseCanyon = new THREE.Color(env.sceneryPrimaryColor);
    for (let i = 0; i < this.canyonPositions.length; i++) {
      _color.copy(baseCanyon).offsetHSL(0, 0, (i % 5 - 2) * 0.03);
      this.canyonInstanced.setColorAt(i, _color);
    }
    if (this.canyonInstanced.instanceColor) {
      this.canyonInstanced.instanceColor.needsUpdate = true;
    }

    const baseTree = new THREE.Color(env.scenerySecondaryColor);
    for (let i = 0; i < this.treePositions.length; i++) {
      _color.copy(baseTree).offsetHSL(0, 0, (i % 4 - 1.5) * 0.035);
      this.treeInstanced.setColorAt(i, _color);
    }
    if (this.treeInstanced.instanceColor) {
      this.treeInstanced.instanceColor.needsUpdate = true;
    }

    const poleMat = this.poleInstanced.material as THREE.MeshStandardMaterial;
    poleMat.emissive.setHex(env.accentGlowColor);
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.onCameraModeChange(mode);
  }

  public cycleCameraMode(): void {
    const order = [CameraMode.CHASE, CameraMode.COCKPIT, CameraMode.AERIAL];
    const next = order[(order.indexOf(this.cameraMode) + 1) % order.length];
    this.setCameraMode(next);
  }

  public setTouchInput(partial: Partial<typeof this.touchInput>): void {
    Object.assign(this.touchInput, partial);
  }

  public startNewRace(): void {
    soundEngine.init();
    this.playerVx = 0;
    this.playerSpeedMps = 28;
    this.steerAngle = 0;
    this.driftAngle = 0;
    this.isDrifting = false;
    this.isBoosting = false;
    this.nitro = 100;
    this.shield = 100;
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.nearMisses = 0;
    this.distanceMeters = 0;
    this.lap = 1;
    this.lapTimeMs = 0;
    this.totalTimeMs = 0;
    this.hitstopTimer = 0;
    this.cameraShake = 0;
    this.eventBanner = 'LAP 1/3 · GREEN FLAG';
    this.eventBannerTimer = 2.2;

    this.rivals.forEach((r, idx) => {
      const lane = idx % 4;
      r.currentLane = lane;
      r.targetLane = lane;
      r.x = LANE_X[lane];
      r.z = -50 - idx * 42;
      r.laneChangeWindup = 0;
      r.isChangingLane = false;
      r.nearMissAwarded = false;
      r.rig.root.position.set(r.x, 0, r.z);
      r.rig.root.rotation.set(0, 0, 0);
    });

    this.gantryGroup.position.z = -180;
    this.setGameState(GameState.PLAYING);
  }

  public setGameState(state: GameState): void {
    this.gameState = state;
    if (state !== GameState.PLAYING) {
      soundEngine.silenceContinuous();
    }
    this.onGameStateChange(state);
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  private handleResize = (): void => {
    if (this.isDisposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Do not intercept typing when an input field is focused
    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

    const code = e.code;
    if (!this.heldKeys.has(code)) {
      this.justPressedKeys.add(code);
    }
    this.heldKeys.add(code);

    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code) &&
      (this.gameState === GameState.PLAYING || this.gameState === GameState.TITLE)
    ) {
      e.preventDefault();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.code);
  };

  private handleWindowBlur = (): void => {
    this.heldKeys.clear();
    this.justPressedKeys.clear();
    this.touchInput = { left: false, right: false, throttle: false, brake: false, nitro: false, drift: false };
  };

  private processEdgeInputs(): void {
    if (this.justPressedKeys.has('KeyC')) {
      this.cycleCameraMode();
    }
    if (this.justPressedKeys.has('KeyH')) {
      this.onHudToggleRequest();
    }
    if (this.justPressedKeys.has('Escape') || this.justPressedKeys.has('KeyP')) {
      if (this.gameState === GameState.PLAYING) {
        this.setGameState(GameState.PAUSED);
      } else if (this.gameState === GameState.PAUSED) {
        this.setGameState(GameState.PLAYING);
      }
    }
    if (this.justPressedKeys.has('Enter')) {
      if (
        this.gameState === GameState.TITLE ||
        this.gameState === GameState.VICTORY ||
        this.gameState === GameState.GAME_OVER
      ) {
        this.startNewRace();
      }
    }
    this.justPressedKeys.clear();
  }

  private animate = (): void => {
    if (this.isDisposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);

    this.processEdgeInputs();

    if (this.gameState === GameState.TITLE) {
      this.updateTitleDemo(dt);
    } else if (this.gameState === GameState.COUNTDOWN) {
      this.updateCountdownGrid(dt);
    } else if (this.gameState === GameState.PLAYING) {
      this.updatePlayingSimulation(dt);
    }

    this.updateRemotePeers3D(dt);
    this.updateParticles(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private updateRemotePeers3D(dt: number): void {
    for (const peer of this.remotePeers.values()) {
      peer.currentX = THREE.MathUtils.damp(peer.currentX, peer.targetX, 10, dt);

      // In TITLE or COUNTDOWN mode, place remote cars alongside on the grid
      const targetRelZ =
        this.gameState === GameState.TITLE || this.gameState === GameState.COUNTDOWN
          ? -3.5
          : -(peer.targetDistanceMeters - this.distanceMeters);

      peer.currentRelativeZ = THREE.MathUtils.damp(peer.currentRelativeZ, targetRelZ, 9, dt);

      // Hide only if extremely far outside camera clip range
      peer.rig.root.visible = peer.currentRelativeZ > -310 && peer.currentRelativeZ < 45;
      peer.rig.root.position.set(peer.currentX, 0, peer.currentRelativeZ);

      const targetYaw = -peer.steerAngle * 0.12 + peer.driftAngle;
      const targetRoll = -peer.steerAngle * 0.065 - peer.driftAngle * 0.08;
      peer.rig.bodyGroup.rotation.y = THREE.MathUtils.damp(
        peer.rig.bodyGroup.rotation.y,
        targetYaw,
        10,
        dt
      );
      peer.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(
        peer.rig.bodyGroup.rotation.z,
        targetRoll,
        10,
        dt
      );

      // Spin remote wheels & show remote nitro flames
      const spin = Math.max(20, peer.speedMps) * dt * 2.4;
      for (const w of peer.rig.wheels) {
        w.rotation.x -= spin;
      }

      const flameScale = peer.isBoosting ? 0.95 + Math.random() * 0.3 : 0.001;
      for (const flame of peer.rig.nitroFlames) {
        flame.scale.set(
          peer.isBoosting ? 1 : 0.01,
          peer.isBoosting ? 1 : 0.01,
          flameScale
        );
      }
    }
  }

  private updateTitleDemo(dt: number): void {
    this.titleOrbitAngle += dt * 0.38;
    const demoSpeedMps = 44;
    this.playerSpeedMps = demoSpeedMps;
    this.playerX = THREE.MathUtils.damp(this.playerX, 1.75, 4, dt);
    this.heroCar.root.position.set(this.playerX, 0, 0);
    this.heroCar.bodyGroup.rotation.set(0, 0, 0);

    this.scrollWorldAndTraffic(dt, demoSpeedMps, false);

    const radius = 7.4;
    const camX = this.playerX + Math.sin(this.titleOrbitAngle) * radius;
    const camZ = Math.cos(this.titleOrbitAngle) * radius * 0.85 + 1.5;
    const camY = 2.35 + Math.sin(this.titleOrbitAngle * 0.7) * 0.55;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.playerX, 0.75, -1.2);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 54, 4, dt);
    this.camera.updateProjectionMatrix();
  }

  private updateCountdownGrid(dt: number): void {
    // Cars rev on the starting grid while camera frames the starting gantry
    this.heroCar.root.position.set(this.playerX, 0, 0);
    this.updateCamera(dt);
    if (Math.random() < 0.35) {
      this.spawnParticleBurst(this.playerX, 0.3, 2.4, 1, 0xf59e0b, 3, 0.65);
    }
  }

  private updatePlayingSimulation(dt: number): void {
    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      this.updateCamera(dt);
      return;
    }

    const steerLeft =
      this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft') || this.touchInput.left;
    const steerRight =
      this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight') || this.touchInput.right;
    const throttleHeld =
      this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp') || this.touchInput.throttle;
    const brakeHeld =
      this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown') || this.touchInput.brake;
    const nitroHeld =
      this.heldKeys.has('ShiftLeft') ||
      this.heldKeys.has('ShiftRight') ||
      this.heldKeys.has('KeyN') ||
      this.touchInput.nitro;
    const driftHeld = this.heldKeys.has('Space') || this.touchInput.drift;

    const difficultyMultiplier = 1 + (this.lap - 1) * 0.12;

    if (nitroHeld && this.nitro > 4 && this.playerSpeedMps > 20) {
      this.isBoosting = true;
      this.nitro = Math.max(0, this.nitro - dt * 26);
    } else {
      this.isBoosting = false;
      this.nitro = Math.min(100, this.nitro + dt * (this.isDrifting ? 14 : 4.5));
    }

    // Check online slipstream drafting behind remote peer cars
    let isSlipstreaming = false;
    for (const peer of this.remotePeers.values()) {
      if (
        peer.currentRelativeZ < -3.0 &&
        peer.currentRelativeZ > -26.0 &&
        Math.abs(peer.currentX - this.playerX) < 1.8
      ) {
        isSlipstreaming = true;
        this.nitro = Math.min(100, this.nitro + dt * 9);
        break;
      }
    }

    const targetTopSpeed =
      (this.isBoosting ? this.maxBoostSpeedMps : this.maxBaseSpeedMps) +
      (isSlipstreaming ? 7 : 0);

    if (this.isBoosting) {
      this.playerSpeedMps = THREE.MathUtils.damp(this.playerSpeedMps, targetTopSpeed, 3.2, dt);
    } else if (brakeHeld) {
      this.playerSpeedMps = Math.max(14, this.playerSpeedMps - 48 * dt);
    } else if (throttleHeld) {
      this.playerSpeedMps = Math.min(targetTopSpeed, this.playerSpeedMps + 24 * dt);
    } else {
      this.playerSpeedMps = THREE.MathUtils.damp(this.playerSpeedMps, 34, 0.85, dt);
    }

    this.heroCar.tailLightMaterial.emissiveIntensity = brakeHeld ? 6.0 : 2.2;

    const rawSteer = (steerRight ? 1 : 0) - (steerLeft ? 1 : 0);
    this.steerAngle = THREE.MathUtils.damp(this.steerAngle, rawSteer * 1.0, 9.5, dt);

    const canDrift = driftHeld && Math.abs(this.steerAngle) > 0.2 && this.playerSpeedMps > 35;
    this.isDrifting = canDrift;

    const targetDriftAngle = canDrift ? -this.steerAngle * 0.36 : 0;
    this.driftAngle = THREE.MathUtils.damp(this.driftAngle, targetDriftAngle, 6.5, dt);

    const lateralAgility = canDrift ? 18.5 : 14.5;
    this.playerVx = THREE.MathUtils.damp(this.playerVx, this.steerAngle * lateralAgility, 8.5, dt);
    this.playerX += this.playerVx * dt;

    const maxRoadX = ROAD_HALF_WIDTH - 1.15;
    if (Math.abs(this.playerX) > maxRoadX) {
      this.playerX = Math.sign(this.playerX) * maxRoadX;
      this.playerVx *= -0.35;
      this.playerSpeedMps = Math.max(22, this.playerSpeedMps - 18 * dt);
      this.cameraShake = Math.max(this.cameraShake, 0.16);
      this.spawnParticleBurst(
        this.playerX + Math.sign(this.playerX) * 0.9,
        0.4,
        0,
        4,
        0xf59e0b,
        8,
        0.9
      );
    }

    this.heroCar.root.position.x = this.playerX;
    const targetYaw = -this.steerAngle * 0.12 + this.driftAngle;
    const targetRoll = -this.steerAngle * 0.065 - this.driftAngle * 0.08;
    const targetPitch = this.isBoosting ? -0.024 : brakeHeld ? 0.032 : 0;

    this.heroCar.bodyGroup.rotation.y = THREE.MathUtils.damp(
      this.heroCar.bodyGroup.rotation.y,
      targetYaw,
      10,
      dt
    );
    this.heroCar.bodyGroup.rotation.z = THREE.MathUtils.damp(
      this.heroCar.bodyGroup.rotation.z,
      targetRoll,
      10,
      dt
    );
    this.heroCar.bodyGroup.rotation.x = THREE.MathUtils.damp(
      this.heroCar.bodyGroup.rotation.x,
      targetPitch,
      10,
      dt
    );

    this.heroCar.frontLeftPivot.rotation.y = -this.steerAngle * 0.42;
    this.heroCar.frontRightPivot.rotation.y = -this.steerAngle * 0.42;

    const flameScale = this.isBoosting ? 0.95 + Math.random() * 0.35 : 0.001;
    for (const flame of this.heroCar.nitroFlames) {
      flame.scale.set(
        this.isBoosting ? 1 : 0.01,
        this.isBoosting ? 1 : 0.01,
        flameScale
      );
    }

    if (this.isBoosting && Math.random() < 0.65) {
      this.spawnParticleBurst(this.playerX, 0.34, 2.5, 2, 0x38bdf8, 5, 1.0);
    }
    if (this.isDrifting && Math.random() < 0.75) {
      this.spawnParticleBurst(this.playerX - 0.9, 0.18, 1.4, 1, 0xf59e0b, 4, 0.85);
      this.spawnParticleBurst(this.playerX + 0.9, 0.18, 1.4, 1, 0xf59e0b, 4, 0.85);
      this.score += Math.round(65 * dt * this.combo);
    }

    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer -= dt;
      this.heroCar.paintMaterial.emissive.setHex(0xef4444);
      this.heroCar.paintMaterial.emissiveIntensity = Math.max(0, this.damageFlashTimer * 3.5);
    } else {
      this.heroCar.paintMaterial.emissiveIntensity = 0;
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
      }
    }

    if (this.eventBannerTimer > 0) {
      this.eventBannerTimer -= dt;
      if (this.eventBannerTimer <= 0) {
        this.eventBanner = null;
      }
    }

    const stepDistance = this.playerSpeedMps * dt;
    this.distanceMeters += stepDistance;
    this.lapTimeMs += dt * 1000;
    this.totalTimeMs += dt * 1000;
    this.score += Math.round(stepDistance * 1.8 * this.combo);

    const currentLapTarget = this.lap * LAP_DISTANCE_METERS;
    if (this.distanceMeters >= currentLapTarget) {
      if (this.bestLapTimeMs === null || this.lapTimeMs < this.bestLapTimeMs) {
        this.bestLapTimeMs = this.lapTimeMs;
      }
      if (this.lap >= TOTAL_LAPS) {
        soundEngine.playCheckpoint(true);
        this.emitNetworkState(true, true);
        this.syncTelemetry(true);
        this.setGameState(GameState.VICTORY);
        return;
      } else {
        this.lap += 1;
        this.lapTimeMs = 0;
        this.shield = Math.min(100, this.shield + 20);
        this.nitro = Math.min(100, this.nitro + 35);
        this.eventBanner = `LAP ${this.lap}/${TOTAL_LAPS} · CHECKPOINT BONUS +1500`;
        this.eventBannerTimer = 2.6;
        this.score += 1500;
        soundEngine.playCheckpoint(false);
      }
    }

    this.scrollWorldAndTraffic(dt * difficultyMultiplier, this.playerSpeedMps, true);
    this.updateCamera(dt);

    const speedKmh = this.playerSpeedMps * 3.6;
    const gear = Math.min(6, Math.max(1, Math.floor(speedKmh / 58) + 1));
    const gearMinSpeed = (gear - 1) * 58;
    const gearFraction = (speedKmh - gearMinSpeed) / 58;
    const rpm = Math.round(2200 + Math.min(1, Math.max(0, gearFraction)) * 6400);

    soundEngine.updateTelemetryAudio(
      rpm,
      this.playerSpeedMps / this.maxBoostSpeedMps,
      this.isBoosting,
      this.isDrifting,
      true
    );

    this.emitNetworkState(false, false);
    this.syncTelemetry(false, rpm, gear);
  }

  private emitNetworkState(finished: boolean, force: boolean): void {
    this.onNetworkTick?.(
      {
        x: Number(this.playerX.toFixed(2)),
        distanceMeters: Math.round(this.distanceMeters),
        speedMps: Number(this.playerSpeedMps.toFixed(1)),
        steerAngle: Number(this.steerAngle.toFixed(2)),
        driftAngle: Number(this.driftAngle.toFixed(2)),
        isBoosting: this.isBoosting,
        isDrifting: this.isDrifting,
        lap: this.lap,
        score: this.score,
        shield: Math.round(this.shield),
        finished,
        finishTimeMs: finished ? Math.round(this.totalTimeMs) : null,
      },
      force
    );
  }

  private scrollWorldAndTraffic(dt: number, playerSpeedMps: number, checkCollisions: boolean): void {
    const stepDistance = playerSpeedMps * dt;

    this.roadScrollOffset -= stepDistance * 0.055;
    this.roadTexture.offset.y = this.roadScrollOffset;

    const wheelSpin = stepDistance * 2.5;
    for (const w of this.heroCar.wheels) {
      w.rotation.x -= wheelSpin;
    }

    this.gantryGroup.position.z += stepDistance;
    if (this.gantryGroup.position.z > 25) {
      this.gantryGroup.position.z = -280;
    }

    for (const pad of this.boostPads) {
      pad.z += stepDistance;
      if (pad.activeCooldown > 0) pad.activeCooldown -= dt;

      if (pad.z > 22) {
        pad.z = -260 - Math.random() * 60;
        pad.x = LANE_X[Math.floor(Math.random() * 4)];
      }
      pad.mesh.position.set(pad.x, 0.03, pad.z);

      if (
        checkCollisions &&
        pad.activeCooldown <= 0 &&
        Math.abs(pad.z) < 3.4 &&
        Math.abs(pad.x - this.playerX) < 1.65
      ) {
        pad.activeCooldown = 1.5;
        this.nitro = Math.min(100, this.nitro + 35);
        this.playerSpeedMps = Math.min(this.maxBoostSpeedMps, this.playerSpeedMps + 14);
        this.score += 300 * this.combo;
        this.eventBanner = 'TURBO PAD · NITRO RECHARGED +300';
        this.eventBannerTimer = 1.6;
        soundEngine.playBoostPad();
        this.spawnParticleBurst(this.playerX, 0.3, 0, 12, 0x22d3ee, 10, 1.1);
      }
    }

    for (let i = 0; i < this.canyonPositions.length; i++) {
      const p = this.canyonPositions[i];
      p.z += stepDistance;
      if (p.z > 45) {
        p.z -= 340;
      }
    }
    this.syncCanyonInstances();

    for (let i = 0; i < this.treePositions.length; i++) {
      const p = this.treePositions[i];
      p.z += stepDistance;
      if (p.z > 40) {
        p.z -= 320;
      }
    }
    this.syncTreeInstances();

    for (let i = 0; i < this.polePositions.length; i++) {
      const p = this.polePositions[i];
      p.z += stepDistance;
      if (p.z > 32) {
        p.z -= 336;
      }
    }
    this.syncPoleInstances();

    for (const r of this.rivals) {
      const relativeSpeed = playerSpeedMps - r.speedMps;
      r.z += relativeSpeed * dt;

      for (const w of r.rig.wheels) {
        w.rotation.x -= r.speedMps * dt * 2.2;
      }

      if (r.z > 34) {
        const lane = Math.floor(Math.random() * 4);
        r.currentLane = lane;
        r.targetLane = lane;
        r.x = LANE_X[lane];
        r.z = -220 - Math.random() * 90;
        r.laneChangeWindup = 0;
        r.isChangingLane = false;
        r.nearMissAwarded = false;
      } else if (r.z < -320) {
        r.z = -240;
      }

      r.laneChangeCooldown -= dt;
      if (
        r.rig.archetype !== 'HAULER' &&
        !r.isChangingLane &&
        r.laneChangeWindup <= 0 &&
        r.laneChangeCooldown <= 0 &&
        r.z < -28 &&
        r.z > -150
      ) {
        const deltaLane =
          r.currentLane === 0
            ? 1
            : r.currentLane === 3
            ? -1
            : Math.random() < 0.5
            ? -1
            : 1;
        r.targetLane = r.currentLane + deltaLane;
        r.laneChangeWindup = 1.05;
        r.laneChangeCooldown = 4.2 + Math.random() * 3.0;
      }

      if (r.laneChangeWindup > 0) {
        r.laneChangeWindup -= dt;
        const blinkOn = Math.floor(r.laneChangeWindup * 10) % 2 === 0;
        const goingRight = r.targetLane > r.currentLane;
        r.rig.leftSignalMat.emissiveIntensity = !goingRight && blinkOn ? 4.5 : 0.0;
        r.rig.rightSignalMat.emissiveIntensity = goingRight && blinkOn ? 4.5 : 0.0;
        r.rig.root.rotation.z = (goingRight ? -1 : 1) * 0.035;

        if (r.laneChangeWindup <= 0) {
          r.isChangingLane = true;
        }
      } else if (r.isChangingLane) {
        const targetX = LANE_X[r.targetLane];
        const goingRight = targetX > r.x;
        r.rig.leftSignalMat.emissiveIntensity = !goingRight ? 3.2 : 0.0;
        r.rig.rightSignalMat.emissiveIntensity = goingRight ? 3.2 : 0.0;

        r.x = THREE.MathUtils.damp(r.x, targetX, 4.2, dt);
        r.rig.root.rotation.y = (goingRight ? -1 : 1) * 0.08;

        if (Math.abs(r.x - targetX) < 0.08) {
          r.x = targetX;
          r.currentLane = r.targetLane;
          r.isChangingLane = false;
          r.rig.leftSignalMat.emissiveIntensity = 0;
          r.rig.rightSignalMat.emissiveIntensity = 0;
          r.rig.root.rotation.set(0, 0, 0);
        }
      } else {
        r.rig.leftSignalMat.emissiveIntensity = 0;
        r.rig.rightSignalMat.emissiveIntensity = 0;
        r.rig.root.rotation.y = THREE.MathUtils.damp(r.rig.root.rotation.y, 0, 6, dt);
        r.rig.root.rotation.z = THREE.MathUtils.damp(r.rig.root.rotation.z, 0, 6, dt);
      }

      r.rig.root.position.set(r.x, 0, r.z);

      if (!checkCollisions) continue;

      const dz = Math.abs(r.z);
      const dx = Math.abs(r.x - this.playerX);
      const minZ = 2.15 + r.rig.halfLength;
      const minX = 0.98 + r.rig.halfWidth;

      if (dz < minZ && dx < minX) {
        const pushSign = this.playerX >= r.x ? 1 : -1;
        this.playerX += pushSign * (minX - dx + 0.35);
        this.playerVx = pushSign * 9.5;
        this.playerSpeedMps = Math.max(18, this.playerSpeedMps * 0.62);
        r.z -= 5.5;

        this.shield = Math.max(0, this.shield - 24);
        this.combo = 1;
        this.comboTimer = 0;
        this.hitstopTimer = 0.055;
        this.cameraShake = 0.52;
        this.damageFlashTimer = 0.45;
        this.eventBanner = 'IMPACT DETECTED · SHIELD -24%';
        this.eventBannerTimer = 1.8;

        soundEngine.playCollision(1.2);
        this.spawnParticleBurst(
          (this.playerX + r.x) * 0.5,
          0.6,
          r.z * 0.5,
          24,
          0xef4444,
          14,
          1.35
        );

        if (this.shield <= 0) {
          this.emitNetworkState(false, true);
          this.syncTelemetry(true);
          this.setGameState(GameState.GAME_OVER);
          return;
        }
      } else if (
        !r.nearMissAwarded &&
        r.z > 1.2 &&
        r.z < 6.0 &&
        dx < minX + 1.25 &&
        this.playerSpeedMps > 40
      ) {
        r.nearMissAwarded = true;
        this.nearMisses += 1;
        this.combo = Math.min(8, this.combo + 1);
        this.comboTimer = 4.5;
        const bonus = 250 * this.combo;
        this.score += bonus;
        this.nitro = Math.min(100, this.nitro + 12);
        this.eventBanner = `NEAR MISS ×${this.combo} · +${bonus} PTS`;
        this.eventBannerTimer = 1.65;
        soundEngine.playNearMiss(this.combo);
        this.spawnParticleBurst(this.playerX, 0.5, 0, 8, 0xf59e0b, 7, 0.95);
      }
    }
  }

  private updateCamera(dt: number): void {
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 1.8);
    }
    const shakeX = (Math.random() - 0.5) * this.cameraShake;
    const shakeY = (Math.random() - 0.5) * this.cameraShake * 0.7;

    let targetCamX = this.playerX * 0.82;
    let targetCamY = 2.45;
    let targetCamZ = 6.35;
    let lookAtY = 0.85;
    let lookAtZ = -14;
    let baseFov = 62;

    if (this.cameraMode === CameraMode.COCKPIT) {
      targetCamX = this.playerX;
      targetCamY = 1.18;
      targetCamZ = -0.55;
      lookAtY = 0.95;
      lookAtZ = -32;
      baseFov = 68;
    } else if (this.cameraMode === CameraMode.AERIAL) {
      targetCamX = this.playerX * 0.6;
      targetCamY = 8.8;
      targetCamZ = 11.2;
      lookAtY = 0.4;
      lookAtZ = -18;
      baseFov = 56;
    }

    const speedRatio = Math.max(0, (this.playerSpeedMps - 28) / (this.maxBoostSpeedMps - 28));
    const targetFov = baseFov + speedRatio * 10 + (this.isBoosting ? 8 : 0);

    this.camera.position.x =
      THREE.MathUtils.damp(this.camera.position.x, targetCamX, 10, dt) + shakeX;
    this.camera.position.y =
      THREE.MathUtils.damp(this.camera.position.y, targetCamY, 10, dt) + shakeY;
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, targetCamZ, 10, dt);

    const targetCameraRoll = -this.steerAngle * 0.035 - this.driftAngle * 0.05;
    this.camera.lookAt(this.playerX + this.steerAngle * 1.2, lookAtY, lookAtZ);
    this.camera.rotation.z += targetCameraRoll;

    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
    this.camera.updateProjectionMatrix();
  }

  private syncTelemetry(force: boolean, rpm: number = 3200, gear: number = 3): void {
    const now = performance.now();
    if (!force && now - this.lastUiSyncTime < 50) return;
    this.lastUiSyncTime = now;

    const totalRaceDistance = TOTAL_LAPS * LAP_DISTANCE_METERS;
    const progressRatio = Math.min(1, this.distanceMeters / totalRaceDistance);

    // If racing against online players, use server-authoritative rank; otherwise combine with AI grid
    const positionRank =
      this.onlinePlayerCount > 1 && this.authoritativeRank !== null
        ? this.authoritativeRank
        : Math.max(1, 8 - Math.floor(progressRatio * 7.4));

    const totalRacers = this.onlinePlayerCount > 1 ? this.onlinePlayerCount : 8;

    const lapStartDist = (this.lap - 1) * LAP_DISTANCE_METERS;
    const lapProgress = Math.min(
      1,
      Math.max(0, (this.distanceMeters - lapStartDist) / LAP_DISTANCE_METERS)
    );

    this.onTelemetryUpdate({
      speedKmh: Math.round(this.playerSpeedMps * 3.6),
      rpm,
      gear,
      nitro: Math.round(this.nitro),
      isBoosting: this.isBoosting,
      isDrifting: this.isDrifting,
      shield: Math.round(this.shield),
      score: this.score,
      combo: this.combo,
      nearMisses: this.nearMisses,
      lap: this.lap,
      totalLaps: TOTAL_LAPS,
      lapTimeMs: Math.round(this.lapTimeMs),
      bestLapTimeMs: this.bestLapTimeMs !== null ? Math.round(this.bestLapTimeMs) : null,
      totalTimeMs: Math.round(this.totalTimeMs),
      distanceMeters: Math.round(this.distanceMeters),
      lapProgress,
      positionRank,
      totalRacers,
      eventBanner: this.eventBanner,
    });
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);

    soundEngine.silenceContinuous();

    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material?.dispose();
        }
      }
    });

    this.renderer.dispose();
    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
