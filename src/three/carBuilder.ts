import * as THREE from 'three';
import { CarPaintPreset } from '../types/game';

export interface HeroCarRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  paintMaterial: THREE.MeshPhysicalMaterial;
  accentMaterial: THREE.MeshStandardMaterial;
  tailLightMaterial: THREE.MeshStandardMaterial;
  frontLeftPivot: THREE.Group;
  frontRightPivot: THREE.Group;
  wheels: THREE.Group[];
  nitroFlames: THREE.Mesh[];
}

export type RivalArchetype = 'RIVAL_GT' | 'INTERCEPTOR' | 'HAULER';

export interface RivalCarRig {
  root: THREE.Group;
  archetype: RivalArchetype;
  wheels: THREE.Group[];
  leftSignalMat: THREE.MeshStandardMaterial;
  rightSignalMat: THREE.MeshStandardMaterial;
  halfWidth: number;
  halfLength: number;
}

/**
 * Builds a composite 3-part wheel (rubber tire tread, 5-spoke brushed alloy rim, brake caliper)
 */
function createCompositeWheel(
  radius: number,
  width: number,
  tireMat: THREE.Material,
  rimMat: THREE.Material,
  caliperMat: THREE.Material,
  isLeft: boolean
): THREE.Group {
  const wheelGroup = new THREE.Group();

  // 1. Tire rubber cylinder
  const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 24);
  tireGeo.rotateZ(Math.PI / 2);
  const tireMesh = new THREE.Mesh(tireGeo, tireMat);
  tireMesh.castShadow = true;
  tireMesh.receiveShadow = true;
  wheelGroup.add(tireMesh);

  // 2. Recessed alloy rim barrel + 5 spokes
  const rimRadius = radius * 0.68;
  const rimGeo = new THREE.CylinderGeometry(rimRadius, rimRadius, width * 1.03, 16);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  wheelGroup.add(rimMesh);

  const spokeGeo = new THREE.BoxGeometry(width * 1.06, rimRadius * 1.75, radius * 0.14);
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    spoke.rotation.x = (i * Math.PI) / 5;
    wheelGroup.add(spoke);
  }

  // 3. Center hub nut (accent caliper material)
  const hubGeo = new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, width * 1.08, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const hubMesh = new THREE.Mesh(hubGeo, caliperMat);
  wheelGroup.add(hubMesh);

  // 4. Non-rotating appearance brake disc accent
  const sideSign = isLeft ? -1 : 1;
  const caliperGeo = new THREE.BoxGeometry(width * 0.25, radius * 0.55, radius * 0.35);
  const caliperMesh = new THREE.Mesh(caliperGeo, caliperMat);
  caliperMesh.position.set(sideSign * width * 0.38, radius * 0.22, -radius * 0.25);
  wheelGroup.add(caliperMesh);

  return wheelGroup;
}

/**
 * Builds the 10-part Hero GT Supercar with sculpted ExtrudeGeometry bodywork,
 * transmissive cockpit glass, carbon fiber aero kit, and dynamic nitro thrusters.
 */
export function buildHeroSupercar(
  paintPreset: CarPaintPreset,
  carbonTexture: THREE.CanvasTexture,
  shadowTexture: THREE.CanvasTexture
): HeroCarRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  // Calibrated PBR Materials (varying roughness by >= 0.25 across adjacent parts)
  const paintMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(paintPreset.hex),
    metalness: paintPreset.metalness,
    roughness: paintPreset.roughness,
    clearcoat: paintPreset.clearcoat,
    clearcoatRoughness: 0.08,
    anisotropy: 0.7,
  });

  const carbonMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e2430,
    map: carbonTexture,
    roughness: 0.48,
    metalness: 0.35,
  });

  const darkTrimMaterial = new THREE.MeshStandardMaterial({
    color: 0x0f131a,
    roughness: 0.78,
    metalness: 0.15,
  });

  const canopyGlassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x0c192c,
    metalness: 0.1,
    roughness: 0.06,
    transmission: 0.86,
    ior: 1.52,
    thickness: 1.2,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });

  const chromeRimMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xe2e8f0,
    metalness: 0.95,
    roughness: 0.15,
    anisotropy: 0.8,
  });

  const tireRubberMaterial = new THREE.MeshStandardMaterial({
    color: 0x121418,
    roughness: 0.88,
    metalness: 0.05,
  });

  const accentMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(paintPreset.accentHex),
    emissive: new THREE.Color(paintPreset.accentHex),
    emissiveIntensity: 0.65,
    roughness: 0.25,
    metalness: 0.6,
  });

  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xe0f2fe,
    emissiveIntensity: 2.8,
    roughness: 0.1,
  });

  const tailLightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff1e27,
    emissive: 0xef4444,
    emissiveIntensity: 2.4,
    roughness: 0.15,
  });

  // 1. Contact Shadow Plane (grounded at y = 0.02 with polygonOffset)
  const shadowGeo = new THREE.PlaneGeometry(3.1, 5.8);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.y = 0.02;
  root.add(shadowMesh);

  // 2. Sculpted Side Profile Main Hull (ExtrudeGeometry)
  // Car points toward -Z (forward), length ~4.5m, width ~2.08m
  const sideProfile = new THREE.Shape();
  sideProfile.moveTo(-2.25, 0.22); // Front splitter tip
  sideProfile.lineTo(-2.12, 0.56); // Nose cone
  sideProfile.lineTo(-1.15, 0.78); // Hood slope
  sideProfile.lineTo(-0.35, 0.84); // Cowl
  sideProfile.lineTo(1.45, 0.88);  // Rear deck
  sideProfile.lineTo(2.18, 0.78);  // Rear tail fascia
  sideProfile.lineTo(2.24, 0.30);  // Rear diffuser base
  sideProfile.lineTo(-2.25, 0.22);

  const hullGeo = new THREE.ExtrudeGeometry(sideProfile, {
    steps: 1,
    depth: 1.78,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.12,
    bevelSegments: 3,
  });
  // Center along X and orient length along Z
  hullGeo.rotateY(Math.PI / 2);
  hullGeo.translate(-0.89, 0, 0);
  hullGeo.computeVertexNormals();

  const mainHull = new THREE.Mesh(hullGeo, paintMaterial);
  mainHull.castShadow = true;
  mainHull.receiveShadow = true;
  bodyGroup.add(mainHull);

  // 3. Sculpted Widebody Fender Arches & Side Aero Pods
  const fenderGeo = new THREE.BoxGeometry(2.14, 0.44, 1.32);
  const frontFenders = new THREE.Mesh(fenderGeo, paintMaterial);
  frontFenders.position.set(0, 0.48, -1.36);
  frontFenders.castShadow = true;
  bodyGroup.add(frontFenders);

  const rearFenderGeo = new THREE.BoxGeometry(2.22, 0.52, 1.48);
  const rearFenders = new THREE.Mesh(rearFenderGeo, paintMaterial);
  rearFenders.position.set(0, 0.54, 1.32);
  rearFenders.castShadow = true;
  bodyGroup.add(rearFenders);

  // Side intake scoops (dark carbon trim)
  const scoopGeo = new THREE.BoxGeometry(2.18, 0.28, 1.15);
  const sideScoops = new THREE.Mesh(scoopGeo, darkTrimMaterial);
  sideScoops.position.set(0, 0.46, 0.15);
  bodyGroup.add(sideScoops);

  // 4. Optical Tinted Glass Teardrop Canopy
  const canopyProfile = new THREE.Shape();
  canopyProfile.moveTo(-0.98, 0.76);
  canopyProfile.quadraticCurveTo(-0.25, 1.28, 0.42, 1.22);
  canopyProfile.lineTo(1.38, 0.85);
  canopyProfile.lineTo(-0.98, 0.76);

  const canopyGeo = new THREE.ExtrudeGeometry(canopyProfile, {
    steps: 1,
    depth: 1.24,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.08,
    bevelSegments: 3,
  });
  canopyGeo.rotateY(Math.PI / 2);
  canopyGeo.translate(-0.62, 0, 0);
  canopyGeo.computeVertexNormals();

  const canopyMesh = new THREE.Mesh(canopyGeo, canopyGlassMaterial);
  canopyMesh.renderOrder = 2;
  bodyGroup.add(canopyMesh);

  // Interior dark cockpit tub & seats (visible through transmissive canopy)
  const cockpitTubGeo = new THREE.BoxGeometry(1.16, 0.34, 1.5);
  const cockpitTub = new THREE.Mesh(cockpitTubGeo, darkTrimMaterial);
  cockpitTub.position.set(0, 0.74, 0.1);
  bodyGroup.add(cockpitTub);

  // 5. Carbon-Fiber Front Splitter & Side Skirts
  const splitterGeo = new THREE.BoxGeometry(2.18, 0.07, 0.65);
  const frontSplitter = new THREE.Mesh(splitterGeo, carbonMaterial);
  frontSplitter.position.set(0, 0.18, -2.08);
  frontSplitter.castShadow = true;
  bodyGroup.add(frontSplitter);

  // Glowing front aero accent strip
  const accentStripGeo = new THREE.BoxGeometry(2.16, 0.03, 0.08);
  const frontAccent = new THREE.Mesh(accentStripGeo, accentMaterial);
  frontAccent.position.set(0, 0.22, -2.38);
  bodyGroup.add(frontAccent);

  const skirtGeo = new THREE.BoxGeometry(2.24, 0.08, 2.3);
  const sideSkirts = new THREE.Mesh(skirtGeo, carbonMaterial);
  sideSkirts.position.set(0, 0.19, 0.0);
  bodyGroup.add(sideSkirts);

  // 6. Carbon-Fiber Swan-Neck Rear GT Wing & Endplates
  const wingBladeGeo = new THREE.BoxGeometry(2.18, 0.06, 0.42);
  const wingBlade = new THREE.Mesh(wingBladeGeo, carbonMaterial);
  wingBlade.position.set(0, 1.24, 2.08);
  wingBlade.rotation.x = 0.14;
  wingBlade.castShadow = true;
  bodyGroup.add(wingBlade);

  const pylonGeo = new THREE.BoxGeometry(0.06, 0.42, 0.28);
  const leftPylon = new THREE.Mesh(pylonGeo, carbonMaterial);
  leftPylon.position.set(-0.52, 1.02, 1.98);
  leftPylon.rotation.x = -0.22;
  bodyGroup.add(leftPylon);

  const rightPylon = new THREE.Mesh(pylonGeo, carbonMaterial);
  rightPylon.position.set(0.52, 1.02, 1.98);
  rightPylon.rotation.x = -0.22;
  bodyGroup.add(rightPylon);

  const endplateGeo = new THREE.BoxGeometry(0.05, 0.28, 0.56);
  const leftEndplate = new THREE.Mesh(endplateGeo, paintMaterial);
  leftEndplate.position.set(-1.09, 1.22, 2.08);
  bodyGroup.add(leftEndplate);

  const rightEndplate = new THREE.Mesh(endplateGeo, paintMaterial);
  rightEndplate.position.set(1.09, 1.22, 2.08);
  bodyGroup.add(rightEndplate);

  // 7. Rear Diffuser & Twin Brushed-Titanium Exhausts
  const diffuserGeo = new THREE.BoxGeometry(1.92, 0.26, 0.35);
  const rearDiffuser = new THREE.Mesh(diffuserGeo, carbonMaterial);
  rearDiffuser.position.set(0, 0.28, 2.2);
  bodyGroup.add(rearDiffuser);

  const exhaustGeo = new THREE.CylinderGeometry(0.095, 0.105, 0.28, 16);
  exhaustGeo.rotateX(Math.PI / 2);
  const leftExhaust = new THREE.Mesh(exhaustGeo, chromeRimMaterial);
  leftExhaust.position.set(-0.42, 0.34, 2.34);
  bodyGroup.add(leftExhaust);

  const rightExhaust = new THREE.Mesh(exhaustGeo, chromeRimMaterial);
  rightExhaust.position.set(0.42, 0.34, 2.34);
  bodyGroup.add(rightExhaust);

  // 8. Nitro Afterburner Flame Cones (hidden/small until boosting)
  const flameGeo = new THREE.ConeGeometry(0.11, 0.95, 14);
  flameGeo.rotateX(Math.PI / 2);
  flameGeo.translate(0, 0, 0.45);
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const leftFlame = new THREE.Mesh(flameGeo, flameMat);
  leftFlame.position.set(-0.42, 0.34, 2.42);
  leftFlame.scale.set(0.01, 0.01, 0.01);
  bodyGroup.add(leftFlame);

  const rightFlame = new THREE.Mesh(flameGeo, flameMat);
  rightFlame.position.set(0.42, 0.34, 2.42);
  rightFlame.scale.set(0.01, 0.01, 0.01);
  bodyGroup.add(rightFlame);

  // 9. Twin LED Projector Headlights & Full-Width Rear Light Bar
  const headLightGeo = new THREE.BoxGeometry(0.48, 0.08, 0.16);
  const leftHeadlight = new THREE.Mesh(headLightGeo, headlightMaterial);
  leftHeadlight.position.set(-0.74, 0.52, -2.22);
  leftHeadlight.rotation.y = 0.18;
  bodyGroup.add(leftHeadlight);

  const rightHeadlight = new THREE.Mesh(headLightGeo, headlightMaterial);
  rightHeadlight.position.set(0.74, 0.52, -2.22);
  rightHeadlight.rotation.y = -0.18;
  bodyGroup.add(rightHeadlight);

  const tailBarGeo = new THREE.BoxGeometry(1.94, 0.09, 0.1);
  const tailBar = new THREE.Mesh(tailBarGeo, tailLightMaterial);
  tailBar.position.set(0, 0.68, 2.26);
  bodyGroup.add(tailBar);

  // 10. 4 Composite Wheels (Front pair mounted on steering pivots)
  const wheelRadius = 0.38;
  const wheelWidth = 0.32;
  const wheels: THREE.Group[] = [];

  const frontLeftPivot = new THREE.Group();
  frontLeftPivot.position.set(-1.02, wheelRadius, -1.38);
  const flWheel = createCompositeWheel(
    wheelRadius,
    wheelWidth,
    tireRubberMaterial,
    chromeRimMaterial,
    accentMaterial,
    true
  );
  frontLeftPivot.add(flWheel);
  root.add(frontLeftPivot);
  wheels.push(flWheel);

  const frontRightPivot = new THREE.Group();
  frontRightPivot.position.set(1.02, wheelRadius, -1.38);
  const frWheel = createCompositeWheel(
    wheelRadius,
    wheelWidth,
    tireRubberMaterial,
    chromeRimMaterial,
    accentMaterial,
    false
  );
  frontRightPivot.add(frWheel);
  root.add(frontRightPivot);
  wheels.push(frWheel);

  const rlWheel = createCompositeWheel(
    wheelRadius * 1.05,
    wheelWidth * 1.15,
    tireRubberMaterial,
    chromeRimMaterial,
    accentMaterial,
    true
  );
  rlWheel.position.set(-1.05, wheelRadius * 1.05, 1.34);
  root.add(rlWheel);
  wheels.push(rlWheel);

  const rrWheel = createCompositeWheel(
    wheelRadius * 1.05,
    wheelWidth * 1.15,
    tireRubberMaterial,
    chromeRimMaterial,
    accentMaterial,
    false
  );
  rrWheel.position.set(1.05, wheelRadius * 1.05, 1.34);
  root.add(rrWheel);
  wheels.push(rrWheel);

  return {
    root,
    bodyGroup,
    paintMaterial,
    accentMaterial,
    tailLightMaterial,
    frontLeftPivot,
    frontRightPivot,
    wheels,
    nitroFlames: [leftFlame, rightFlame],
  };
}

/**
 * Builds a composite AI Rival or Highway Hazard vehicle with turn-signal telegraph lights.
 */
export function buildRivalVehicle(
  archetype: RivalArchetype,
  bodyColorHex: number,
  shadowTexture: THREE.CanvasTexture
): RivalCarRig {
  const root = new THREE.Group();
  const isHauler = archetype === 'HAULER';

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: bodyColorHex,
    metalness: isHauler ? 0.55 : 0.82,
    roughness: isHauler ? 0.38 : 0.22,
    clearcoat: isHauler ? 0.4 : 0.9,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x11151d,
    roughness: 0.75,
    metalness: 0.2,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f172a,
    metalness: 0.1,
    roughness: 0.1,
    clearcoat: 1.0,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x111317,
    roughness: 0.88,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.85,
    roughness: 0.22,
  });

  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xef4444,
    emissiveIntensity: 2.0,
  });

  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfffbeb,
    emissiveIntensity: 2.0,
  });

  const leftSignalMat = new THREE.MeshStandardMaterial({
    color: 0x451a03,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.0,
  });

  const rightSignalMat = new THREE.MeshStandardMaterial({
    color: 0x451a03,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.0,
  });

  const shadowGeo = new THREE.PlaneGeometry(isHauler ? 3.4 : 2.9, isHauler ? 7.8 : 5.4);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMesh = new THREE.Mesh(
    shadowGeo,
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  shadowMesh.position.y = 0.02;
  root.add(shadowMesh);

  const wheels: THREE.Group[] = [];

  if (isHauler) {
    // Heavy Cyber Hauler Truck (cab + cargo container + roof light bar + 6 wheels)
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.45, 6.6), trimMat);
    chassis.position.set(0, 0.46, 0);
    chassis.castShadow = true;
    root.add(chassis);

    const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.95, 4.4), bodyMat);
    cargo.position.set(0, 1.66, 0.95);
    cargo.castShadow = true;
    root.add(cargo);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.36, 1.55, 1.95), bodyMat);
    cab.position.set(0, 1.46, -2.25);
    cab.castShadow = true;
    root.add(cab);

    const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.62, 0.14), glassMat);
    windshield.position.set(0, 1.72, -3.22);
    root.add(windshield);

    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.1), tailMat);
    tailBar.position.set(0, 0.65, 3.31);
    root.add(tailBar);

    const leftSig = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.12), leftSignalMat);
    leftSig.position.set(-1.05, 0.98, 3.31);
    root.add(leftSig);

    const rightSig = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.12), rightSignalMat);
    rightSig.position.set(1.05, 0.98, 3.31);
    root.add(rightSig);

    const zPositions = [-2.2, 0.85, 2.35];
    for (const zPos of zPositions) {
      for (const side of [-1, 1]) {
        const w = createCompositeWheel(0.46, 0.34, tireMat, rimMat, tailMat, side < 0);
        w.position.set(side * 1.18, 0.46, zPos);
        root.add(w);
        wheels.push(w);
      }
    }

    return {
      root,
      archetype,
      wheels,
      leftSignalMat,
      rightSignalMat,
      halfWidth: 1.32,
      halfLength: 3.35,
    };
  }

  // Sleek Rival GT / Interceptor Coupe
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.54, 4.35), bodyMat);
  hull.position.set(0, 0.48, 0);
  hull.castShadow = true;
  root.add(hull);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.46, 2.05), glassMat);
  cabin.position.set(0, 0.94, 0.15);
  root.add(cabin);

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.1, 4.45), trimMat);
  splitter.position.set(0, 0.22, 0);
  root.add(splitter);

  if (archetype === 'INTERCEPTOR') {
    // Interceptor roof lightbar telegraph
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.1, 0.28), trimMat);
    barBase.position.set(0, 1.22, 0.1);
    root.add(barBase);
  } else {
    // Rival GT rear spoiler
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.08, 0.32), trimMat);
    spoiler.position.set(0, 0.96, 1.98);
    root.add(spoiler);
  }

  const headBar = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.1, 0.08), headMat);
  headBar.position.set(0, 0.52, -2.18);
  root.add(headBar);

  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.08), tailMat);
  tailBar.position.set(0, 0.58, 2.18);
  root.add(tailBar);

  // Left & Right Turn Signal Windup Telegraph Lights (visible from rear & front)
  const leftSig = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 4.42), leftSignalMat);
  leftSig.position.set(-0.88, 0.58, 0);
  root.add(leftSig);

  const rightSig = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 4.42), rightSignalMat);
  rightSig.position.set(0.88, 0.58, 0);
  root.add(rightSig);

  for (const zPos of [-1.32, 1.32]) {
    for (const side of [-1, 1]) {
      const w = createCompositeWheel(0.36, 0.28, tireMat, rimMat, tailMat, side < 0);
      w.position.set(side * 0.98, 0.36, zPos);
      root.add(w);
      wheels.push(w);
    }
  }

  return {
    root,
    archetype,
    wheels,
    leftSignalMat,
    rightSignalMat,
    halfWidth: 1.06,
    halfLength: 2.22,
  };
}
