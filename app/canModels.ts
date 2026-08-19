import * as THREE from "three";
import { withBasePath } from "./assetPath";

export type ShoulderStyle = "dome" | "stepped";

export type CanDefinition = {
  slug: string;
  name: string;
  shortName: string;
  subtitle: string;
  ounces: number;
  bodyRadius: number;
  bodyHeight: number;
  shoulderStyle: ShoulderStyle;
  shoulderShellRatio: number;
  capRadiusRatio: number;
  capHeightRatio: number;
  labelTopInset: number;
  labelBottomInset: number;
  cvVRange: [number, number];
  directVRange: [number, number];
  frontU: number;
  directFrontU: number;
  undistortedFrontU: number;
  sourceTexture: string;
  restoredTexture: string;
  directTexture: string;
  undistortedTexture: string;
  sourceSize: [number, number];
  restoredSize: [number, number];
  directSize: [number, number];
  undistortedSize: [number, number];
  accent: string;
  capColor?: number;
};

export type CanModel = {
  root: THREE.Group;
  definition: CanDefinition;
  renderParts: {
    bodyBase: THREE.Mesh;
    body: THREE.Mesh;
    shoulder: THREE.Mesh;
    bottom: THREE.Mesh;
    gasket: THREE.Mesh;
    cap: THREE.Mesh;
  };
  sharedMaterials: {
    label: THREE.MeshStandardMaterial;
    bodyBase: THREE.MeshStandardMaterial;
    metal: THREE.MeshStandardMaterial;
    rim: THREE.MeshStandardMaterial;
    cap: THREE.MeshStandardMaterial;
    gasket: THREE.MeshStandardMaterial;
    paintedShoulder: THREE.MeshStandardMaterial;
  };
  dispose: () => void;
};

const BASE_RADIUS = 1.375;

// Left-to-right order, silhouette heights, shoulder profiles, and printed-panel
// insets are fitted to the six-can studio reference photograph.
export const CAN_DEFINITIONS: CanDefinition[] = [
  {
    slug: "sercon-1",
    name: "Sercon Refrigerant 12 Black",
    shortName: "Sercon Black",
    subtitle: "Technical Chemical Company",
    ounces: 12,
    bodyRadius: BASE_RADIUS,
    bodyHeight: BASE_RADIUS * 3.55,
    shoulderStyle: "dome",
    shoulderShellRatio: 0.7,
    capRadiusRatio: 0.63,
    capHeightRatio: 0.14,
    labelTopInset: 0,
    labelBottomInset: 0,
    cvVRange: [0, 1],
    directVRange: [0.035, 0.91],
    frontU: 0.6751364338485246,
    directFrontU: 0.18,
    undistortedFrontU: 0.22,
    sourceTexture: "/assets/sercon-1/label-source.webp",
    restoredTexture: "/assets/sercon-1/label-restored.webp",
    directTexture: "/assets/sercon-1/label-direct.webp",
    undistortedTexture: "/assets/sercon-1/label-undistorted.webp",
    sourceSize: [3072, 1721],
    restoredSize: [2048, 1152],
    directSize: [2048, 1152],
    undistortedSize: [2048, 1152],
    accent: "#e3bc00",
  },
  {
    slug: "du-pont-freon",
    name: "Du Pont Freon 12",
    shortName: "Du Pont Freon",
    subtitle: "IG-LO / Automotive air conditioning",
    ounces: 12,
    bodyRadius: 1.3,
    bodyHeight: 1.3 * 3.47,
    shoulderStyle: "stepped",
    shoulderShellRatio: 0.76,
    capRadiusRatio: 0.58,
    capHeightRatio: 0.13,
    labelTopInset: 0,
    labelBottomInset: 0,
    cvVRange: [0, 1],
    directVRange: [0.045, 0.94],
    frontU: 0.28370883807570113,
    directFrontU: 0.39,
    undistortedFrontU: 0.25,
    sourceTexture: "/assets/du-pont-freon/label-source.webp",
    restoredTexture: "/assets/du-pont-freon/label-restored.webp",
    directTexture: "/assets/du-pont-freon/label-direct.webp",
    undistortedTexture: "/assets/du-pont-freon/label-undistorted-v3.webp",
    sourceSize: [3072, 1701],
    restoredSize: [2048, 1136],
    directSize: [2048, 1152],
    undistortedSize: [2064, 1136],
    accent: "#ce332c",
  },
  {
    slug: "interdynamics",
    name: "Interdynamics Refrigerant 12",
    shortName: "Interdynamics",
    subtitle: "Unique can design / Model FRS-12",
    ounces: 12,
    bodyRadius: 1.36,
    bodyHeight: 1.36 * 3.34,
    shoulderStyle: "stepped",
    shoulderShellRatio: 0.75,
    capRadiusRatio: 0.53,
    capHeightRatio: 0.12,
    labelTopInset: 0,
    labelBottomInset: 0,
    cvVRange: [0, 1],
    directVRange: [0.055, 0.93],
    frontU: 0.22537957555780552,
    directFrontU: 0.17,
    undistortedFrontU: 0.2,
    sourceTexture: "/assets/interdynamics/label-source.webp",
    restoredTexture: "/assets/interdynamics/label-restored.webp",
    directTexture: "/assets/interdynamics/label-direct.webp",
    undistortedTexture: "/assets/interdynamics/label-undistorted-v3.webp",
    sourceSize: [3072, 1687],
    restoredSize: [2048, 1120],
    directSize: [2048, 1152],
    undistortedSize: [2048, 1088],
    accent: "#cc2b2b",
  },
  {
    slug: "cold-shot",
    name: "Cold Shot R-12",
    shortName: "Cold Shot",
    subtitle: "Gunk / Radiator Specialty Company",
    ounces: 12,
    bodyRadius: 1.37,
    bodyHeight: 1.37 * 3.61,
    shoulderStyle: "dome",
    shoulderShellRatio: 0.68,
    capRadiusRatio: 0.57,
    capHeightRatio: 0.13,
    labelTopInset: 0.075,
    labelBottomInset: 0.065,
    cvVRange: [0, 1],
    directVRange: [0, 1],
    frontU: 0.2718538553266667,
    directFrontU: 0.59,
    undistortedFrontU: 0.3,
    sourceTexture: "/assets/cold-shot/label-albedo.webp",
    restoredTexture: "/assets/cold-shot/label-print-albedo.webp",
    directTexture: "/assets/cold-shot/label-direct.webp",
    undistortedTexture: "/assets/cold-shot/label-undistorted-v2.webp",
    sourceSize: [4096, 2268],
    restoredSize: [1683, 934],
    directSize: [2048, 1152],
    undistortedSize: [2048, 1008],
    accent: "#0878bf",
  },
  {
    slug: "chargette",
    name: "Chargette Refrigerant 12",
    shortName: "Chargette",
    subtitle: "Aerosol Company / Neodesha, Kansas",
    ounces: 14,
    bodyRadius: 1.38,
    bodyHeight: 1.38 * 3.675,
    shoulderStyle: "dome",
    shoulderShellRatio: 0.64,
    capRadiusRatio: 0.63,
    capHeightRatio: 0.16,
    labelTopInset: 0.105,
    labelBottomInset: 0.06,
    cvVRange: [0.02, 0.98],
    directVRange: [0.1, 0.9],
    frontU: 0.3143451126291582,
    directFrontU: 0.55,
    undistortedFrontU: 0.2,
    sourceTexture: "/assets/chargette/label-source.webp",
    restoredTexture: "/assets/chargette/label-restored.webp",
    directTexture: "/assets/chargette/label-direct.webp",
    undistortedTexture: "/assets/chargette/label-undistorted-v2.webp",
    sourceSize: [3072, 1789],
    restoredSize: [2048, 1184],
    directSize: [2048, 1152],
    undistortedSize: [2064, 1008],
    accent: "#a3221d",
    capColor: 0x715548,
  },
  {
    slug: "sercon-2",
    name: "Sercon Refrigerant 12 White",
    shortName: "Sercon White",
    subtitle: "Technical Chemical Company",
    ounces: 14,
    bodyRadius: 1.365,
    bodyHeight: 1.365 * 3.62,
    shoulderStyle: "dome",
    shoulderShellRatio: 0.68,
    capRadiusRatio: 0.57,
    capHeightRatio: 0.13,
    labelTopInset: 0,
    labelBottomInset: 0,
    cvVRange: [0, 1],
    directVRange: [0.025, 0.96],
    frontU: 0.21215173877724347,
    directFrontU: 0.39,
    undistortedFrontU: 0.2,
    sourceTexture: "/assets/sercon-2/label-source.webp",
    restoredTexture: "/assets/sercon-2/label-restored.webp",
    directTexture: "/assets/sercon-2/label-direct.webp",
    undistortedTexture: "/assets/sercon-2/label-undistorted.webp",
    sourceSize: [3072, 1789],
    restoredSize: [2048, 1184],
    directSize: [2048, 1152],
    undistortedSize: [2064, 1184],
    accent: "#5c7828",
  },
];

export function canBaseOffset(definition: CanDefinition) {
  return definition.bodyHeight * 0.5 + definition.bodyRadius * 0.22;
}

export function canShoulderHeight(definition: CanDefinition) {
  return definition.bodyRadius * (
    definition.shoulderShellRatio + 0.035 + definition.capHeightRatio
  );
}

export function canTotalHeight(definition: CanDefinition) {
  return (
    definition.bodyHeight
    + definition.bodyRadius * 0.22
    + canShoulderHeight(definition)
  );
}

export function configureLabelTexture(
  texture: THREE.Texture,
  renderer: THREE.WebGLRenderer,
  definition: CanDefinition,
  frontU = definition.frontU,
  vRange: [number, number] = definition.cvVRange,
) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.offset.x = frontU;
  texture.offset.y = 1 - vRange[1];
  texture.repeat.y = vRange[1] - vRange[0];
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);
  texture.needsUpdate = true;
  return texture;
}

export function createGlossyLabelMaterial(texture: THREE.Texture) {
  return new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xcccccc,
    metalness: 0,
    roughness: 0.22,
    envMapIntensity: 0.52,
    // The label is a thin shell over the painted body. Pull its depth forward
    // slightly so distant instanced cans do not flicker against that base.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
}

export function createMetalMaterials(definition: CanDefinition) {
  const metal = new THREE.MeshStandardMaterial({
    color: 0x9ba1a2,
    metalness: 0.96,
    roughness: 0.43,
    envMapIntensity: 1.02,
  });
  const rim = metal.clone();
  rim.color.set(0x858c8d);
  rim.roughness = 0.48;
  rim.side = THREE.DoubleSide;
  const cap = metal.clone();
  cap.color.set(definition.capColor ?? 0x9aa0a1);
  cap.roughness = definition.capColor ? 0.52 : 0.4;
  cap.metalness = definition.capColor ? 0.62 : 0.94;
  const gasket = new THREE.MeshStandardMaterial({
    color: 0x353936,
    metalness: 0.55,
    roughness: 0.48,
    envMapIntensity: 0.72,
  });
  const paintedShoulder = new THREE.MeshStandardMaterial({
    color: 0xd9dcdb,
    metalness: 0.04,
    roughness: 0.25,
    envMapIntensity: 0.64,
  });
  const bodyBase = paintedShoulder.clone();
  bodyBase.color.set(0xe0e2e1);
  bodyBase.roughness = 0.23;
  return { metal, rim, cap, gasket, paintedShoulder, bodyBase };
}

function lathe(
  profile: Array<[number, number]>,
  material: THREE.Material,
  segments = 96,
) {
  const geometry = new THREE.LatheGeometry(
    profile.map(([radius, y]) => new THREE.Vector2(radius, y)),
    segments,
  );
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = Math.PI;
  return mesh;
}

function domeProfile(definition: CanDefinition): Array<[number, number]> {
  const r = definition.bodyRadius;
  const y = definition.bodyHeight * 0.5;
  const shell = r * definition.shoulderShellRatio;
  const capRadius = r * definition.capRadiusRatio;
  return [
    [r * 0.98, y - r * 0.018],
    [r * 1.025, y],
    [r * 1.075, y + shell * 0.05],
    [r * 1.085, y + shell * 0.12],
    [r * 1.055, y + shell * 0.19],
    [r * 0.95, y + shell * 0.25],
    [r * 0.86, y + shell * 0.34],
    [r * 0.79, y + shell * 0.48],
    [r * 0.74, y + shell * 0.64],
    [r * 0.71, y + shell * 0.79],
    [r * 0.68, y + shell * 0.9],
    [capRadius, y + shell],
  ];
}

function steppedProfile(definition: CanDefinition): Array<[number, number]> {
  const r = definition.bodyRadius;
  const y = definition.bodyHeight * 0.5;
  const shell = r * definition.shoulderShellRatio;
  const capRadius = r * definition.capRadiusRatio;
  return [
    [r * 0.99, y - r * 0.01],
    [r * 1.02, y + shell * 0.04],
    [r * 1.01, y + shell * 0.15],
    [r * 0.95, y + shell * 0.18],
    [r * 0.95, y + shell * 0.31],
    [r * 0.88, y + shell * 0.35],
    [r * 0.88, y + shell * 0.48],
    [r * 0.8, y + shell * 0.53],
    [r * 0.8, y + shell * 0.67],
    [r * 0.7, y + shell * 0.73],
    [r * 0.67, y + shell * 0.87],
    [capRadius, y + shell],
  ];
}

function bottomProfile(definition: CanDefinition): Array<[number, number]> {
  const r = definition.bodyRadius;
  const y = -definition.bodyHeight * 0.5;
  return [
    [r * 0.98, y + r * 0.018],
    [r * 1.02, y],
    [r * 1.055, y - r * 0.055],
    [r * 1.06, y - r * 0.115],
    [r * 1.035, y - r * 0.17],
    [r * 0.97, y - r * 0.205],
    [r * 0.82, y - r * 0.22],
    [r * 0.4, y - r * 0.2],
    [0, y - r * 0.18],
  ];
}

export async function createCanModel(
  renderer: THREE.WebGLRenderer,
  definition: CanDefinition,
): Promise<CanModel> {
  const loader = new THREE.TextureLoader();
  const undistortedTexture = await loader.loadAsync(
    withBasePath(definition.undistortedTexture),
  );
  configureLabelTexture(
    undistortedTexture,
    renderer,
    definition,
    definition.undistortedFrontU,
    [0, 1],
  );

  const undistortedMaterial = createGlossyLabelMaterial(undistortedTexture);
  const materials = createMetalMaterials(definition);
  const root = new THREE.Group();
  root.name = definition.name;
  root.userData.canSlug = definition.slug;

  const bodyBase = new THREE.Mesh(
    new THREE.CylinderGeometry(
      definition.bodyRadius,
      definition.bodyRadius,
      definition.bodyHeight,
      128,
      1,
      true,
    ),
    materials.bodyBase,
  );
  bodyBase.name = `${definition.name} painted steel body`;
  root.add(bodyBase);

  const labelTopInset = definition.bodyHeight * definition.labelTopInset;
  const labelBottomInset = definition.bodyHeight * definition.labelBottomInset;
  const labelHeight = definition.bodyHeight - labelTopInset - labelBottomInset;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(
      definition.bodyRadius * 1.003,
      definition.bodyRadius * 1.003,
      labelHeight,
      128,
      1,
      true,
    ),
    undistortedMaterial,
  );
  body.name = `${definition.name} glossy printed body`;
  body.position.y = (labelBottomInset - labelTopInset) * 0.5;
  root.add(body);

  const shoulderMaterial =
    definition.shoulderStyle === "stepped"
      ? materials.paintedShoulder
      : materials.metal;
  const shoulder = lathe(
    definition.shoulderStyle === "dome"
      ? domeProfile(definition)
      : steppedProfile(definition),
    shoulderMaterial,
  );
  shoulder.name = `${definition.shoulderStyle} shoulder`;
  root.add(shoulder);

  const bottom = lathe(bottomProfile(definition), materials.rim);
  bottom.name = "rolled lower chime";
  root.add(bottom);

  const r = definition.bodyRadius;
  const bodyTop = definition.bodyHeight * 0.5;
  const shoulderTop = bodyTop + r * definition.shoulderShellRatio;
  const capRadius = r * definition.capRadiusRatio;
  const gasketHeight = r * 0.035;
  const gasket = new THREE.Mesh(
    new THREE.CylinderGeometry(
      capRadius * 0.94,
      capRadius * 0.97,
      gasketHeight,
      72,
    ),
    materials.gasket,
  );
  gasket.position.y = shoulderTop + gasketHeight * 0.5;
  root.add(gasket);

  const capHeight = r * definition.capHeightRatio;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(
      capRadius * 0.98,
      capRadius,
      capHeight,
      72,
      1,
    ),
    materials.cap,
  );
  cap.name = "pierce valve cap";
  cap.position.y = shoulderTop + gasketHeight + capHeight * 0.5;
  root.add(cap);

  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  const disposableMaterials: THREE.Material[] = [
    undistortedMaterial,
    ...Object.values(materials),
  ];
  return {
    root,
    definition,
    renderParts: { bodyBase, body, shoulder, bottom, gasket, cap },
    sharedMaterials: {
      label: undistortedMaterial,
      ...materials,
    },
    dispose: () => {
      root.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
      disposableMaterials.forEach((material) => material.dispose());
      undistortedTexture.dispose();
    },
  };
}
