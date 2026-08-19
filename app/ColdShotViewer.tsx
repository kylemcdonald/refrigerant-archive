"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  CAN_DEFINITIONS,
  canBaseOffset,
  createCanModel,
  type CanModel,
} from "./canModels";
import { createCanRainSystem, type CanRainSystem } from "./canRain";
import { withBasePath } from "./assetPath";
import { CylinderReviewPanel } from "./CylinderReviewPanel";

type ViewerMode = "collection" | "single" | "rain";

type ViewerApi = {
  reset: () => void;
  setAutoRotate: (enabled: boolean) => void;
  setMode: (mode: ViewerMode) => void;
  setSingleCan: (index: number) => void;
  setRainTarget: (count: number) => void;
  clearRain: () => void;
};

type CameraTween = {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  started: number;
  duration: number;
};

const COLLECTION_TARGET = new THREE.Vector3(0, 2.7, 0);
const SINGLE_TARGET = new THREE.Vector3(0, 3.05, 0);
const RAIN_TARGET = new THREE.Vector3(0, 4.1, 0);
const RAIN_FLOOR_Y = -3.7;
const RAIN_MAX_DISTANCE = 125;
const SINGLE_MAX_DISTANCE = 32;
const ACTIVE_LABEL_NAME = "Fitted GPT";

function collectionCamera(aspect: number) {
  if (aspect < 0.62) return new THREE.Vector3(0.4, 14.2, 66);
  if (aspect < 0.9) return new THREE.Vector3(0.5, 10.4, 43);
  if (aspect < 1.25) return new THREE.Vector3(0.7, 8.2, 28);
  return new THREE.Vector3(0, 5.25, 23);
}

function singleCamera(aspect: number) {
  if (aspect < 0.62) return new THREE.Vector3(0.25, 7.2, 24);
  if (aspect < 0.9) return new THREE.Vector3(0.2, 5.8, 18.5);
  return new THREE.Vector3(0.15, 4.8, 15.5);
}

function rainCamera(aspect: number) {
  if (aspect < 0.62) return new THREE.Vector3(0, 18.5, 78);
  if (aspect < 0.9) return new THREE.Vector3(0, 15.5, 55);
  return new THREE.Vector3(17.5, 11.4, 29.5);
}

export function ColdShotViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ViewerApi | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [textureOpen, setTextureOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [mode, setMode] = useState<ViewerMode>("collection");
  const [selectedCanIndex, setSelectedCanIndex] = useState(0);
  const [physicsReady, setPhysicsReady] = useState(false);
  const [rainTarget, setRainTarget] = useState(300);
  const [canCount, setCanCount] = useState(0);
  const [fps, setFps] = useState(60);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    let disposed = false;
    let animationFrame = 0;
    let cameraTween: CameraTween | undefined;
    let models: CanModel[] = [];
    let rainSystem: CanRainSystem | undefined;
    let rainPromise: Promise<CanRainSystem | undefined> | undefined;
    let activeMode: ViewerMode = "collection";
    let activeSingleIndex = 0;
    let requestedRainCount = 300;
    let viewportAspect = 1;
    let userMovedCamera = false;
    let lastFrame = performance.now();
    let statStarted = lastFrame;
    let statFrames = 0;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.68;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe4e7eb);
    const fog = new THREE.Fog(0xe4e7eb, 50, 120);
    scene.fog = fog;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environmentTarget = pmrem.fromScene(room, 0.035);
    scene.environment = environmentTarget.texture;
    room.dispose();

    // A tighter near plane preserves depth precision when rain is viewed from
    // far away, where the label and painted body are nearly coplanar.
    const camera = new THREE.PerspectiveCamera(33, 1, 0.5, 260);
    camera.position.copy(collectionCamera(1.6));
    camera.lookAt(COLLECTION_TARGET);

    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(COLLECTION_TARGET);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.42;
    controls.enablePan = false;
    controls.minDistance = 14;
    controls.maxDistance = 42;
    controls.minPolarAngle = 0.34;
    controls.maxPolarAngle = Math.PI * 0.53;

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0xb8bdc2, 0.72);
    scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xfffdf7, 1.15);
    key.position.set(-8.5, 15.5, 12.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -13;
    key.shadow.camera.right = 13;
    key.shadow.camera.top = 16;
    key.shadow.camera.bottom = -5;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 42;
    key.shadow.bias = -0.00018;
    key.shadow.normalBias = 0.025;
    scene.add(key);

    const leftSoftbox = new THREE.RectAreaLight(0xfffdf8, 2.4, 7, 12);
    leftSoftbox.position.set(-9, 7.5, 8);
    leftSoftbox.lookAt(0, 2.6, 0);
    scene.add(leftSoftbox);

    const rightSoftbox = new THREE.RectAreaLight(0xdcecff, 1.75, 6, 10);
    rightSoftbox.position.set(10, 6, 5);
    rightSoftbox.lookAt(0, 2.4, 0);
    scene.add(rightSoftbox);

    const topSoftbox = new THREE.RectAreaLight(0xffffff, 1.3, 12, 5);
    topSoftbox.position.set(0, 14, -2);
    topSoftbox.lookAt(0, 1, 0);
    scene.add(topSoftbox);

    const groundMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xd9dde2,
      roughness: 0.88,
      metalness: 0,
      envMapIntensity: 0.35,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(72, 72), groundMaterial);
    ground.name = "cool-white seamless studio floor";
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    const galleryRoot = new THREE.Group();
    galleryRoot.name = "six-can archive collection";
    scene.add(galleryRoot);

    const setCameraPreset = (
      position: THREE.Vector3,
      target: THREE.Vector3,
      duration = 720,
    ) => {
      cameraTween = {
        fromPosition: camera.position.clone(),
        toPosition: position,
        fromTarget: controls.target.clone(),
        toTarget: target.clone(),
        started: performance.now(),
        duration,
      };
    };

    const cameraForMode = (nextMode: ViewerMode) => {
      if (nextMode === "rain") return rainCamera(viewportAspect);
      if (nextMode === "single") return singleCamera(viewportAspect);
      return collectionCamera(viewportAspect);
    };

    const targetForMode = (nextMode: ViewerMode) => {
      if (nextMode === "rain") return RAIN_TARGET;
      if (nextMode === "single") return SINGLE_TARGET;
      return COLLECTION_TARGET;
    };

    const maxDistanceForMode = (nextMode: ViewerMode) => {
      if (nextMode === "rain") return RAIN_MAX_DISTANCE;
      if (nextMode === "single") return SINGLE_MAX_DISTANCE;
      return Math.max(42, collectionCamera(viewportAspect).length() * 1.16);
    };

    const layoutGallery = () => {
      const spacing = 3.08;
      models.forEach((model, index) => {
        const isSelected = index === activeSingleIndex;
        model.root.visible = activeMode !== "single" || isSelected;
        model.root.position.set(
          activeMode === "single"
            ? 0
            : (index - (models.length - 1) * 0.5) * spacing,
          canBaseOffset(model.definition),
          0,
        );
      });
      renderer.shadowMap.needsUpdate = true;
    };

    const ensureRain = async () => {
      if (rainSystem) return rainSystem;
      if (rainPromise) return rainPromise;
      rainPromise = createCanRainSystem(models)
        .then((system) => {
          if (disposed) {
            system.dispose();
            return undefined;
          }
          rainSystem = system;
          rainSystem.root.visible = activeMode === "rain";
          rainSystem.setTarget(requestedRainCount);
          scene.add(rainSystem.root);
          setPhysicsReady(true);
          return rainSystem;
        })
        .catch((error) => {
          console.error("Could not initialize can physics", error);
          if (!disposed) setLoadError(true);
          return undefined;
        });
      return rainPromise;
    };

    apiRef.current = {
      reset: () => {
        userMovedCamera = false;
        setCameraPreset(
          cameraForMode(activeMode),
          targetForMode(activeMode),
        );
      },
      setAutoRotate: (enabled) => {
        controls.autoRotate = enabled;
      },
      setMode: (nextMode) => {
        activeMode = nextMode;
        controls.autoRotate = false;
        setAutoRotate(false);
        galleryRoot.visible = nextMode !== "rain";
        layoutGallery();
        ground.position.y = nextMode === "rain" ? RAIN_FLOOR_Y : 0;
        fog.near = nextMode === "rain" ? 70 : 50;
        fog.far = nextMode === "rain" ? 240 : 120;
        if (rainSystem) rainSystem.root.visible = nextMode === "rain";
        controls.minDistance =
          nextMode === "rain" ? 18 : nextMode === "single" ? 8 : 14;
        controls.maxDistance = maxDistanceForMode(nextMode);
        userMovedCamera = false;
        setCameraPreset(
          cameraForMode(nextMode),
          targetForMode(nextMode),
          880,
        );
        if (nextMode === "rain") void ensureRain();
      },
      setSingleCan: (index) => {
        activeSingleIndex =
          ((index % CAN_DEFINITIONS.length) + CAN_DEFINITIONS.length) %
          CAN_DEFINITIONS.length;
        layoutGallery();
        if (activeMode === "single") {
          userMovedCamera = false;
          setCameraPreset(
            singleCamera(viewportAspect),
            SINGLE_TARGET,
            560,
          );
        }
      },
      setRainTarget: (count) => {
        requestedRainCount = count;
        rainSystem?.setTarget(count);
      },
      clearRain: () => {
        rainSystem?.clear();
        setCanCount(0);
      },
    };

    const stopAutomaticCamera = () => {
      userMovedCamera = true;
      cameraTween = undefined;
      if (controls.autoRotate) {
        controls.autoRotate = false;
        setAutoRotate(false);
      }
    };
    controls.addEventListener("start", stopAutomaticCamera);

    const resize = () => {
      const width = Math.max(stage.clientWidth, 1);
      const height = Math.max(stage.clientHeight, 1);
      viewportAspect = width / height;
      renderer.setSize(width, height, false);
      camera.aspect = viewportAspect;
      camera.updateProjectionMatrix();
      controls.maxDistance = maxDistanceForMode(activeMode);
      if (!userMovedCamera && !cameraTween) {
        camera.position.copy(cameraForMode(activeMode));
        controls.target.copy(targetForMode(activeMode));
        camera.lookAt(controls.target);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();

    void Promise.all(
      CAN_DEFINITIONS.map((definition) =>
        createCanModel(renderer, definition),
      ),
    )
      .then((loadedModels) => {
        if (disposed) {
          loadedModels.forEach((model) => model.dispose());
          return;
        }
        models = loadedModels;
        loadedModels.forEach((model) => galleryRoot.add(model.root));
        layoutGallery();
        setReady(true);
      })
      .catch((error) => {
        console.error("Could not load reconstructed can assets", error);
        if (!disposed) setLoadError(true);
      });

    const animate = (now: number) => {
      const delta = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      if (cameraTween) {
        const elapsed = Math.min(
          (now - cameraTween.started) / cameraTween.duration,
          1,
        );
        const eased = 1 - Math.pow(1 - elapsed, 3);
        camera.position.lerpVectors(
          cameraTween.fromPosition,
          cameraTween.toPosition,
          eased,
        );
        controls.target.lerpVectors(
          cameraTween.fromTarget,
          cameraTween.toTarget,
          eased,
        );
        if (elapsed === 1) cameraTween = undefined;
      }

      controls.update();
      if (activeMode === "rain" && rainSystem) rainSystem.update(delta);
      renderer.render(scene, camera);

      statFrames += 1;
      if (now - statStarted >= 750) {
        const measuredFps = Math.round((statFrames * 1000) / (now - statStarted));
        setFps(Math.min(measuredFps, 99));
        if (activeMode === "rain" && rainSystem) {
          setCanCount(rainSystem.getCount());
        }
        statFrames = 0;
        statStarted = now;
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      controls.removeEventListener("start", stopAutomaticCamera);
      controls.dispose();
      models.forEach((model) => model.dispose());
      rainSystem?.dispose();
      ground.geometry.dispose();
      groundMaterial.dispose();
      environmentTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      apiRef.current = null;
    };
  }, []);

  const chooseMode = (nextMode: ViewerMode) => {
    setMode(nextMode);
    if (nextMode === "single") {
      apiRef.current?.setSingleCan(selectedCanIndex);
    }
    apiRef.current?.setMode(nextMode);
  };

  const chooseSingleCan = (index: number) => {
    const normalized =
      ((index % CAN_DEFINITIONS.length) + CAN_DEFINITIONS.length) %
      CAN_DEFINITIONS.length;
    setSelectedCanIndex(normalized);
    apiRef.current?.setSingleCan(normalized);
    if (mode !== "single") {
      setMode("single");
      apiRef.current?.setMode("single");
    }
  };

  const toggleAutoRotate = () => {
    const next = !autoRotate;
    setAutoRotate(next);
    apiRef.current?.setAutoRotate(next);
  };

  const changeRainTarget = (value: number) => {
    setRainTarget(value);
    apiRef.current?.setRainTarget(value);
  };

  const selectedCan = CAN_DEFINITIONS[selectedCanIndex];

  return (
    <main className={`viewer-shell mode-${mode}`}>
      <div className="atmosphere" aria-hidden="true" />
      <div className="stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className="webgl-canvas"
          aria-label="Interactive three-dimensional collection of six vintage refrigerant cans"
          tabIndex={0}
        />
      </div>

      <header className="viewer-header">
        <div className="identity">
          <p className="eyebrow">Photo-fitted study · Six archival objects</p>
          <h1>
            Refrigerant <span>Archive</span>
          </h1>
          <p className="dek">
            Measured can profiles and cylindrical label reconstructions from
            thirty-three 50&nbsp;mm RAW photographs.
          </p>
        </div>
        <div className="fit-readout" aria-label="Rendering details">
          <span className="fit-dot" aria-hidden="true" />
          <span>
            {mode === "rain"
              ? `${canCount} / ${rainTarget} cans`
              : mode === "single"
                ? `${String(selectedCanIndex + 1).padStart(2, "0")} / 06 · ${selectedCan.shortName}`
                : "06 cans aligned"}
          </span>
          <span className="fit-separator">·</span>
          <span>{ACTIVE_LABEL_NAME}</span>
          {mode === "rain" && (
            <>
              <span className="fit-separator">·</span>
              <span>{fps} fps</span>
            </>
          )}
        </div>
      </header>

      <nav className="mode-tabs" aria-label="Scene mode">
        <button
          type="button"
          className={mode === "collection" ? "active" : ""}
          aria-pressed={mode === "collection"}
          onClick={() => chooseMode("collection")}
        >
          Collection
        </button>
        <button
          type="button"
          className={mode === "single" ? "active" : ""}
          aria-pressed={mode === "single"}
          onClick={() => chooseMode("single")}
          data-testid="single-mode-button"
        >
          Single can
        </button>
        <button
          type="button"
          className={mode === "rain" ? "active" : ""}
          aria-pressed={mode === "rain"}
          onClick={() => chooseMode("rain")}
          data-testid="rain-mode-button"
        >
          Can rain
        </button>
      </nav>

      <ol className="can-index" aria-label="Cans in the archive">
        {CAN_DEFINITIONS.map((definition, index) => (
          <li
            key={definition.slug}
            className={
              mode === "single" && selectedCanIndex === index ? "active" : ""
            }
            style={{ "--can-accent": definition.accent } as React.CSSProperties}
          >
            <button
              type="button"
              aria-label={`View ${definition.name} by itself`}
              aria-current={
                mode === "single" && selectedCanIndex === index
                  ? "true"
                  : undefined
              }
              onClick={() => chooseSingleCan(index)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{definition.shortName}</strong>
              <small>{definition.ounces} oz</small>
            </button>
          </li>
        ))}
      </ol>

      <div className="interaction-hint">
        <span className="drag-mark" aria-hidden="true" />
        <span>Drag to orbit</span>
        <span className="hint-separator">/</span>
        <span>Scroll to zoom</span>
      </div>

      <div className="transport" aria-label="Viewer controls">
        <button type="button" onClick={() => apiRef.current?.reset()}>
          Reset view
        </button>
        {mode !== "rain" && (
          <>
            <span className="transport-rule" aria-hidden="true" />
            <button
              type="button"
              className={autoRotate ? "active" : ""}
              aria-pressed={autoRotate}
              onClick={toggleAutoRotate}
            >
              {autoRotate ? "Pause orbit" : "Auto orbit"}
            </button>
          </>
        )}
        <span className="transport-rule" aria-hidden="true" />
        <button
          type="button"
          className="review-trigger"
          data-testid="cylinder-review-trigger"
          onClick={() => {
            setTextureOpen(false);
            setReviewOpen(true);
          }}
        >
          <span className="review-trigger-long">Cylinder fits · 33</span>
          <span className="review-trigger-short">Fits · 33</span>
        </button>
        <span className="transport-rule" aria-hidden="true" />
        <button
          type="button"
          onClick={() => {
            setReviewOpen(false);
            setTextureOpen(true);
          }}
        >
          Flat labels
        </button>
      </div>

      {mode === "single" && (
        <aside
          className="single-controls"
          aria-label="Single can navigation"
          data-testid="single-can-controls"
          style={{ "--single-accent": selectedCan.accent } as React.CSSProperties}
        >
          <div className="single-heading">
            <div>
              <p className="eyebrow">
                Object {String(selectedCanIndex + 1).padStart(2, "0")} of 06
              </p>
              <h2>{selectedCan.shortName}</h2>
            </div>
            <span>{selectedCan.ounces} oz</span>
          </div>
          <p>{selectedCan.subtitle}</p>
          <div className="single-navigation">
            <button
              type="button"
              aria-label="Previous can"
              onClick={() => chooseSingleCan(selectedCanIndex - 1)}
            >
              ←
            </button>
            <div className="single-dots" role="group" aria-label="Choose a can">
              {CAN_DEFINITIONS.map((definition, index) => (
                <button
                  type="button"
                  key={definition.slug}
                  className={selectedCanIndex === index ? "active" : ""}
                  aria-label={`View ${definition.shortName}`}
                  aria-pressed={selectedCanIndex === index}
                  onClick={() => chooseSingleCan(index)}
                >
                  {String(index + 1).padStart(2, "0")}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="Next can"
              onClick={() => chooseSingleCan(selectedCanIndex + 1)}
            >
              →
            </button>
          </div>
        </aside>
      )}

      {mode === "rain" && (
        <aside className="rain-controls" aria-label="Can rain controls">
          <div className="rain-heading">
            <div>
              <p className="eyebrow">Rigid-body simulation</p>
              <h2>Stack size</h2>
            </div>
            <output>{rainTarget}</output>
          </div>
          <input
            type="range"
            min="60"
            max="420"
            step="30"
            value={rainTarget}
            aria-label="Target number of raining cans"
            onChange={(event) => changeRainTarget(Number(event.target.value))}
          />
          <div className="rain-scale" aria-hidden="true">
            <span>60</span>
            <span>420</span>
          </div>
          <p>
            Collection geometry + shaders · box collider fallback · fixed 60 Hz
          </p>
          <button type="button" onClick={() => apiRef.current?.clearRain()}>
            Clear &amp; restart
          </button>
        </aside>
      )}

      <aside className="object-note">
        <span>
          {mode === "rain"
            ? "Rapier box bodies"
            : mode === "single"
              ? `${selectedCan.name} · ${selectedCan.ounces} oz`
              : "12–14 oz steel cans"}
        </span>
        <span>
          {mode === "rain"
            ? "Collection meshes + shaders"
            : mode === "single"
              ? "Isolated collection mesh"
              : "Glossy print · albedo only"}
        </span>
      </aside>

      <div
        className={`loading-veil ${ready || loadError ? "hidden" : ""}`}
        role="status"
        aria-live="polite"
        data-testid="loading-veil"
      >
        <span className="loading-line" aria-hidden="true" />
        <p>Resolving six cylindrical textures</p>
      </div>

      {mode === "rain" && !physicsReady && !loadError && (
        <div className="physics-status" role="status">
          Initializing rigid bodies…
        </div>
      )}

      {loadError && (
        <div className="error-card" role="alert">
          The reconstructed assets could not be loaded. Refresh the local viewer
          to retry.
        </div>
      )}

      <section
        className={`texture-panel ${textureOpen ? "open" : ""}`}
        aria-hidden={!textureOpen}
        aria-label="Flat unwrapped label textures"
      >
        <div className="texture-panel-bar">
          <div>
            <p className="eyebrow">Six cylindrical albedos · approved source</p>
            <h2>GPT labels from fitted unwrapped views</h2>
          </div>
          <div className="texture-panel-actions">
            <button type="button" onClick={() => setTextureOpen(false)}>
              Close
            </button>
          </div>
        </div>
        <div className="texture-grid">
          {CAN_DEFINITIONS.map((definition, index) => {
            const image = withBasePath(definition.undistortedTexture);
            const [width, height] = definition.undistortedSize;
            return (
              <article className="texture-card" key={definition.slug}>
                <div className="texture-card-heading">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{definition.shortName}</h3>
                  <small>{width} × {height}</small>
                </div>
                <div className="texture-image-wrap">
                  <Image
                    src={image}
                    alt={`Flat Fitted GPT cylindrical label for ${definition.name}`}
                    width={width}
                    height={height}
                    unoptimized
                  />
                </div>
                <div className="texture-card-meta">
                  <span>{definition.subtitle}</span>
                  <a href={image} download>
                    Download WEBP
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {reviewOpen && (
        <CylinderReviewPanel onClose={() => setReviewOpen(false)} />
      )}
    </main>
  );
}
