import type RAPIER from "@dimforge/rapier3d-compat";
import type { PerspectiveCamera, Scene } from "three";

export type DrawMode = "roulette" | "race";

export interface Candidate {
  id: number;
  name: string;
  color: string;
}

export interface DrawResult {
  candidate: Candidate;
  pocket?: number;
}

export interface DrawSceneContext {
  rapier: typeof RAPIER;
  scene: Scene;
  camera: PerspectiveCamera;
  candidates: readonly Candidate[];
  random: () => number;
}

export interface DrawScene {
  world: RAPIER.World;
  assignments?: ReadonlyMap<number, readonly number[]>;
  start(spin?: number): void;
  turnWheel?(delta: number): void;
  canReverseSpinner?(): boolean;
  reverseSpinner?(): boolean;
  beforeStep?(dt: number): void;
  afterStep(dt: number): DrawResult | undefined;
  render(): void;
  resize?(aspect: number): void;
}

export type CreateDrawScene = (context: DrawSceneContext) => DrawScene;
