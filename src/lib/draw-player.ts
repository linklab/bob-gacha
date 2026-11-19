import rapier from "@dimforge/rapier3d-compat";
import {
  ACESFilmicToneMapping,
  BufferGeometry,
  DirectionalLight,
  Material,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Scene,
  SpotLight,
  Texture,
  WebGLRenderer,
} from "three";

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
}

interface Round {
  scene: Scene;
  camera: PerspectiveCamera;
  simulation: DrawScene;
}

export interface DrawPlayer {
  start(candidates: readonly Candidate[]): DrawScene["assignments"];
  reset(candidates: readonly Candidate[]): void;
  dispose(): void;
}

export function createDrawPlayer(
  host: HTMLElement,
  createScene: CreateDrawScene,
  candidates: readonly Candidate[],
  events: PlayerEvents,
): DrawPlayer {
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
  const observer = new ResizeObserver(() => draw());
  renderer.domElement.addEventListener("webglcontextlost", handleContextLoss);

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
      draw();
      if (result) {
        events.onResult(result);
      } else if (elapsed >= maxDuration) {
        events.onTimeout();
      } else {
        animationFrame = requestAnimationFrame(tick);
      }
    } catch {
      events.onError();
    }
  }

  function releaseRound() {
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    if (!round) return;
    round.simulation.world.free();
    disposeScene(round.scene);
    round = undefined;
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
    });
    simulation.world.timestep = timeStep;
    simulation.resize?.(aspect);
    round = { scene, camera, simulation };
    draw();
  }

  function dispose() {
    observer.disconnect();
    releaseRound();
    renderer.domElement.removeEventListener("webglcontextlost", handleContextLoss);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  function handleContextLoss() {
    observer.disconnect();
    releaseRound();
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
    start(entries) {
      reset(entries);
      if (!round) return;
      round.simulation.start();
      previousTime = performance.now();
      pending = 0;
      elapsed = 0;
      animationFrame = requestAnimationFrame(tick);
      return round.simulation.assignments;
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
