import * as THREE from "three";
import type {
  ColliderDesc,
  RigidBody,
  World,
} from "@dimforge/rapier3d-compat";
import {
  canShoulderHeight,
  type CanDefinition,
  type CanModel,
} from "./canModels";

const MAX_CANS = 420;
const CAN_TYPE_COUNT = 6;
const PER_TYPE_CAPACITY = Math.ceil(MAX_CANS / CAN_TYPE_COUNT) + 4;
const FLOOR_Y = -3.7;

type RapierModule = typeof import("@dimforge/rapier3d-compat");

type RainBody = {
  rigidBody: RigidBody;
  visual: RainVisuals;
  slot: number;
};

type RainVisuals = {
  definition: CanDefinition;
  bodyBase: THREE.InstancedMesh;
  body: THREE.InstancedMesh;
  shoulder: THREE.InstancedMesh;
  bottom: THREE.InstancedMesh;
  gasket: THREE.InstancedMesh;
  cap: THREE.InstancedMesh;
  localMatrices: {
    bodyBase: THREE.Matrix4;
    body: THREE.Matrix4;
    shoulder: THREE.Matrix4;
    bottom: THREE.Matrix4;
    gasket: THREE.Matrix4;
    cap: THREE.Matrix4;
  };
  count: number;
};

export type CanRainSystem = {
  root: THREE.Group;
  update: (deltaSeconds: number) => void;
  setTarget: (count: number) => void;
  clear: () => void;
  getCount: () => number;
  dispose: () => void;
};

function dynamicMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
) {
  const mesh = new THREE.InstancedMesh(geometry, material, PER_TYPE_CAPACITY);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

function createVisuals(model: CanModel) {
  const definition = model.definition;
  const labelMaterial = model.sharedMaterials.label;
  const materialFor = (part: THREE.Mesh) => {
    if (Array.isArray(part.material)) {
      throw new Error(`${part.name} unexpectedly uses a material array`);
    }
    return part.material;
  };
  const localMatrixFor = (part: THREE.Mesh) => {
    part.updateMatrix();
    return part.matrix.clone();
  };
  const parts = model.renderParts;

  const bodyBase = dynamicMesh(
    parts.bodyBase.geometry,
    materialFor(parts.bodyBase),
    `${definition.shortName} rain painted bodies`,
  );
  const body = dynamicMesh(
    parts.body.geometry,
    labelMaterial,
    `${definition.shortName} rain bodies`,
  );
  const shoulder = dynamicMesh(
    parts.shoulder.geometry,
    materialFor(parts.shoulder),
    `${definition.shortName} rain shoulders`,
  );
  const bottom = dynamicMesh(
    parts.bottom.geometry,
    materialFor(parts.bottom),
    `${definition.shortName} rain rolled lower chimes`,
  );
  const gasket = dynamicMesh(
    parts.gasket.geometry,
    materialFor(parts.gasket),
    `${definition.shortName} rain gaskets`,
  );
  const cap = dynamicMesh(
    parts.cap.geometry,
    materialFor(parts.cap),
    `${definition.shortName} rain caps`,
  );
  return {
    definition,
    bodyBase,
    body,
    shoulder,
    bottom,
    gasket,
    cap,
    localMatrices: {
      bodyBase: localMatrixFor(parts.bodyBase),
      body: localMatrixFor(parts.body),
      shoulder: localMatrixFor(parts.shoulder),
      bottom: localMatrixFor(parts.bottom),
      gasket: localMatrixFor(parts.gasket),
      cap: localMatrixFor(parts.cap),
    },
    count: 0,
  } satisfies RainVisuals;
}

function applyColliderSurface(collider: ColliderDesc) {
  return collider.setFriction(0.74).setRestitution(0.16).setDensity(0.82);
}

export async function createCanRainSystem(
  models: CanModel[],
): Promise<CanRainSystem> {
  const RAPIER: RapierModule = await import("@dimforge/rapier3d-compat");
  await RAPIER.init();
  const world: World = new RAPIER.World({ x: 0, y: -17.5, z: 0 });
  world.timestep = 1 / 60;
  const root = new THREE.Group();
  root.name = "Can rain instanced collection";
  const visuals = models.map((model) => createVisuals(model));
  for (const visual of visuals) {
    root.add(
      visual.bodyBase,
      visual.body,
      visual.shoulder,
      visual.bottom,
      visual.gasket,
      visual.cap,
    );
  }

  // The visible studio plane is the only static boundary. A broad floor lets
  // the pile spread naturally without the old invisible containment walls.
  const floorCollider = RAPIER.ColliderDesc.cuboid(35.5, 0.5, 35.5)
    .setTranslation(0, FLOOR_Y - 0.5, 0)
    .setFriction(0.82)
    .setRestitution(0.1);
  world.createCollider(floorCollider);

  const bodies: RainBody[] = [];
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const worldMatrix = new THREE.Matrix4();
  const resultMatrix = new THREE.Matrix4();
  let targetCount = 300;
  let spawnAccumulator = 0;
  let simulationAccumulator = 0;
  let disposed = false;

  const spawn = () => {
    if (bodies.length >= Math.min(targetCount, MAX_CANS)) return;
    const visual = visuals[bodies.length % visuals.length];
    if (visual.count >= PER_TYPE_CAPACITY) return;
    const definition = visual.definition;
    const index = bodies.length;
    const lane = index % 11;
    const layer = Math.floor(index / 11);
    const x = (lane - 5) * 1.9 + (Math.random() - 0.5) * 1.15;
    const z = (Math.random() - 0.5) * 10.8;
    const y = 13 + (layer % 8) * 3.8 + Math.random() * 4.5;
    const euler = new THREE.Euler(
      Math.random() * Math.PI,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI,
    );
    const rotation = new THREE.Quaternion().setFromEuler(euler);
    const rigidBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({
          x: rotation.x,
          y: rotation.y,
          z: rotation.z,
          w: rotation.w,
        })
        .setLinearDamping(0.055)
        .setAngularDamping(0.075),
    );
    const shoulderHeight = canShoulderHeight(definition) * 0.84;
    const colliderHeight =
      definition.bodyHeight + shoulderHeight + definition.bodyRadius * 0.12;
    const boxCollider = applyColliderSurface(
      RAPIER.ColliderDesc.cuboid(
        definition.bodyRadius * 0.79,
        colliderHeight * 0.5,
        definition.bodyRadius * 0.79,
      ).setTranslation(0, shoulderHeight * 0.5, 0),
    );
    world.createCollider(boxCollider, rigidBody);
    const slot = visual.count;
    visual.count += 1;
    visual.bodyBase.count = visual.count;
    visual.body.count = visual.count;
    visual.shoulder.count = visual.count;
    visual.bottom.count = visual.count;
    visual.gasket.count = visual.count;
    visual.cap.count = visual.count;
    bodies.push({ rigidBody, visual, slot });
  };

  const updateMatrices = () => {
    for (const entry of bodies) {
      const translation = entry.rigidBody.translation();
      const rotation = entry.rigidBody.rotation();
      position.set(translation.x, translation.y, translation.z);
      quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      worldMatrix.compose(position, quaternion, scale);
      const applyPartMatrix = (
        mesh: THREE.InstancedMesh,
        local: THREE.Matrix4,
      ) => {
        resultMatrix.multiplyMatrices(worldMatrix, local);
        mesh.setMatrixAt(entry.slot, resultMatrix);
      };
      applyPartMatrix(
        entry.visual.bodyBase,
        entry.visual.localMatrices.bodyBase,
      );
      applyPartMatrix(entry.visual.body, entry.visual.localMatrices.body);
      applyPartMatrix(entry.visual.shoulder, entry.visual.localMatrices.shoulder);
      applyPartMatrix(entry.visual.bottom, entry.visual.localMatrices.bottom);
      applyPartMatrix(entry.visual.gasket, entry.visual.localMatrices.gasket);
      applyPartMatrix(entry.visual.cap, entry.visual.localMatrices.cap);
    }
    for (const visual of visuals) {
      visual.bodyBase.instanceMatrix.needsUpdate = true;
      visual.body.instanceMatrix.needsUpdate = true;
      visual.shoulder.instanceMatrix.needsUpdate = true;
      visual.bottom.instanceMatrix.needsUpdate = true;
      visual.gasket.instanceMatrix.needsUpdate = true;
      visual.cap.instanceMatrix.needsUpdate = true;
    }
  };

  const clear = () => {
    for (const entry of bodies) world.removeRigidBody(entry.rigidBody);
    bodies.length = 0;
    spawnAccumulator = 0;
    for (const visual of visuals) {
      visual.count = 0;
      visual.bodyBase.count = 0;
      visual.body.count = 0;
      visual.shoulder.count = 0;
      visual.bottom.count = 0;
      visual.gasket.count = 0;
      visual.cap.count = 0;
    }
  };

  return {
    root,
    update: (deltaSeconds) => {
      if (disposed) return;
      const delta = Math.min(deltaSeconds, 0.05);
      spawnAccumulator += delta * 90;
      while (spawnAccumulator >= 1 && bodies.length < targetCount) {
        spawn();
        spawnAccumulator -= 1;
      }
      simulationAccumulator += delta;
      let steps = 0;
      while (simulationAccumulator >= 1 / 60 && steps < 3) {
        world.step();
        simulationAccumulator -= 1 / 60;
        steps += 1;
      }
      updateMatrices();
    },
    setTarget: (count) => {
      targetCount = THREE.MathUtils.clamp(Math.round(count), 24, MAX_CANS);
      if (targetCount < bodies.length) {
        clear();
      }
    },
    clear,
    getCount: () => bodies.length,
    dispose: () => {
      disposed = true;
      clear();
      world.free();
      root.clear();
    },
  };
}
