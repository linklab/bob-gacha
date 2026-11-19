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
  pocketIndex?: number;
}

export type DrawImpact = "bumper" | "fret" | "bowl" | "cone";

export interface DrawSound {
  audible(): boolean;
  roll(speed: number, pan: number, onRail: boolean): void;
  impact(kind: DrawImpact, strength: number, pan: number): void;
}

export interface DrawSceneContext {
  rapier: typeof RAPIER;
  scene: Scene;
  camera: PerspectiveCamera;
  candidates: readonly Candidate[];
  random: () => number;
  sound?: DrawSound;
}

export interface DrawScene {
  world: RAPIER.World;
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
