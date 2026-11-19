import rapier from "@dimforge/rapier3d-compat";
import {
  ACESFilmicToneMapping,
  BufferGeometry,
  DirectionalLight,
  Material,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  PointLight,
  Raycaster,
  Scene,
  SpotLight,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

import { createRouletteSound } from "../features/roulette/sound";
import type { Candidate, CreateDrawScene, DrawMode, DrawResult, DrawScene } from "./draw";

const timeStep = 1 / 120;
const maxDuration = 30;

let initializeRapier: Promise<void> | undefined;

export async function loadDrawScene(mode: DrawMode): Promise<CreateDrawScene> {
  initializeRapier ??= rapier.init().catch((error) => {
    initializeRapier = undefined;
    throw error;
  });
  const scene =
    mode === "roulette"
      ? import("../features/roulette/roulette").then((module) => module.createRouletteScene)
      : import("../features/marbles/marbles").then((module) => module.createMarbleRaceScene);
  const [createScene] = await Promise.all([scene, initializeRapier]);
  return createScene;
}

interface PlayerEvents {
  onResult(result: DrawResult): void;
  onTimeout(): void;
  onError(): void;
  onContextLost(): void;
  onSpinnerAvailabilityChange(available: boolean): void;
}

interface Round {
  scene: Scene;
  camera: PerspectiveCamera;
  simulation: DrawScene;
}

export interface DrawPlayer {
  start(candidates: readonly Candidate[], spin?: number): DrawScene["assignments"];
  wheelPointAt(clientX: number, clientY: number, insideWheel?: boolean): Vector2 | undefined;
  turnWheel(delta: number): void;
  reverseSpinner(): boolean;
  setSoundEnabled(enabled: boolean): void;
  reset(candidates: readonly Candidate[]): void;
  dispose(): void;
}

export function createDrawPlayer(
  host: HTMLElement,
  createScene: CreateDrawScene,
  candidates: readonly Candidate[],
  events: PlayerEvents,
  soundEnabled?: boolean,
): DrawPlayer {
  const sound = soundEnabled === undefined ? undefined : createRouletteSound(soundEnabled);
  const renderer = new WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.append(renderer.domElement);

  let round: Round | undefined;
  let animationFrame: number | undefined;
  let previousTime = 0;
  let elapsed = 0;
  let pending = 0;
  let started = false;
  let spinnerAvailable = false;
  const wheelPlane = new Plane(new Vector3(0, 1, 0), -1.05);
  const wheelRay = new Raycaster();
  const pointer = new Vector2();
  const hit = new Vector3();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const observer = new ResizeObserver(() => draw());
  renderer.domElement.addEventListener("webglcontextlost", handleContextLoss);
  if (sound) document.addEventListener("visibilitychange", quietWhenHidden);

  function quietWhenHidden() {
    if (document.hidden) sound?.quiet();
  }

  function draw() {
    if (!round) return;
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    const aspect = width / height;
    const canvas = renderer.domElement;
    const ratio = renderer.getPixelRatio();
    if (
      canvas.width !== Math.floor(width * ratio) ||
      canvas.height !== Math.floor(height * ratio)
    ) {
      renderer.setSize(width, height, false);
    }
    if (round.camera.aspect !== aspect) {
      round.camera.aspect = aspect;
      round.camera.updateProjectionMatrix();
      round.simulation.resize?.(aspect);
    }
    round.simulation.render();
    renderer.render(round.scene, round.camera);
  }

  function tick(now: number) {
    animationFrame = undefined;
    if (!round) return;
    try {
      pending += Math.min((now - previousTime) / 1000, 0.25);
      previousTime = now;
      let result: DrawResult | undefined;
      while (pending >= timeStep && !result && elapsed < maxDuration) {
        round.simulation.beforeStep?.(timeStep);
        round.simulation.world.step();
        result = round.simulation.afterStep(timeStep);
        pending -= timeStep;
        elapsed += timeStep;
      }
      if (!reducedMotion.matches || result || elapsed >= maxDuration) draw();
      setSpinnerAvailability(!result && elapsed < maxDuration && canReverseSpinner());
      if (result) {
        sound?.finish();
        events.onResult(result);
      } else if (elapsed >= maxDuration) {
        sound?.stop();
        events.onTimeout();
      } else {
        animationFrame = requestAnimationFrame(tick);
      }
    } catch {
      sound?.stop();
      setSpinnerAvailability(false);
      events.onError();
    }
  }

  function releaseRound() {
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    started = false;
    sound?.stop();
    setSpinnerAvailability(false);
    if (!round) return;
    round.simulation.world.free();
    disposeScene(round.scene);
    round = undefined;
  }

  function canReverseSpinner() {
    return round?.simulation.canReverseSpinner?.() === true;
  }

  function setSpinnerAvailability(available: boolean) {
    if (available === spinnerAvailable) return;
    spinnerAvailable = available;
    events.onSpinnerAvailabilityChange(available);
  }

  function reset(entries: readonly Candidate[]) {
    releaseRound();
    const scene = new Scene();
    const aspect = Math.max(host.clientWidth, 1) / Math.max(host.clientHeight, 1);
    const camera = new PerspectiveCamera(35, aspect, 0.1, 180);
    const simulation = createScene({
      rapier,
      scene,
      camera,
      candidates: entries,
      random: Math.random,
      sound: sound?.signals,
    });
    simulation.world.timestep = timeStep;
    simulation.resize?.(aspect);
    round = { scene, camera, simulation };
    draw();
  }

  function dispose() {
    observer.disconnect();
    releaseRound();
    document.removeEventListener("visibilitychange", quietWhenHidden);
    sound?.dispose();
    renderer.domElement.removeEventListener("webglcontextlost", handleContextLoss);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  function handleContextLoss() {
    observer.disconnect();
    releaseRound();
    sound?.dispose();
    events.onContextLost();
  }

  try {
    reset(candidates);
    observer.observe(host);
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    start(entries, spin) {
      if (!round || started) reset(entries);
      if (!round) return;
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
      started = true;
      round.simulation.start(spin);
      sound?.start();
      setSpinnerAvailability(canReverseSpinner());
      previousTime = performance.now();
      pending = 0;
      elapsed = 0;
      animationFrame = requestAnimationFrame(tick);
      return round.simulation.assignments;
    },
    wheelPointAt(clientX, clientY, insideWheel = false) {
      if (!round?.simulation.turnWheel) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((clientY - rect.top) / rect.height) * 2,
      );
      wheelRay.setFromCamera(pointer, round.camera);
      if (!wheelRay.ray.intersectPlane(wheelPlane, hit)) return;
      if (insideWheel && Math.hypot(hit.x, hit.z) > 4.6) return;
      return new Vector2(hit.x, -hit.z);
    },
    turnWheel(delta) {
      if (started || !round?.simulation.turnWheel) return;
      round.simulation.turnWheel(delta);
      if (animationFrame === undefined) {
        animationFrame = requestAnimationFrame(() => {
          animationFrame = undefined;
          draw();
        });
      }
    },
    reverseSpinner() {
      const reversed = round?.simulation.reverseSpinner?.() === true;
      setSpinnerAvailability(canReverseSpinner());
      return reversed;
    },
    setSoundEnabled(enabled) {
      sound?.setEnabled(enabled);
    },
    reset,
    dispose,
  };
}

function disposeScene(scene: Scene) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  scene.traverse((object) => {
    if ("geometry" in object && object.geometry instanceof BufferGeometry) {
      geometries.add(object.geometry);
    }
    if ("material" in object) {
      const entries = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of entries) {
        if (material instanceof Material) materials.add(material);
      }
    }
    if (
      object instanceof DirectionalLight ||
      object instanceof PointLight ||
      object instanceof SpotLight
    ) {
      object.shadow.dispose();
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  scene.clear();
}
