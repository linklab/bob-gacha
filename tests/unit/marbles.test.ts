import RAPIER from "@dimforge/rapier3d-compat";
import { PerspectiveCamera, Scene } from "three";
import { beforeAll, describe, expect, it } from "vitest";

import { createMarbleRaceScene } from "../../src/features/marbles/marbles";
import type { Candidate } from "../../src/lib/draw";

const timestep = 1 / 120;

beforeAll(async () => {
  await RAPIER.init();
});

function createRace(count: number, seed: number) {
  const candidates: Candidate[] = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `참가자 ${index + 1}`,
    color: "#eea96b",
  }));
  const scene = new Scene();
  const race = createMarbleRaceScene({
    rapier: RAPIER,
    scene,
    camera: new PerspectiveCamera(35, 1.18, 0.1, 200),
    candidates,
    random: () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 0x100000000;
    },
  });
  race.world.timestep = timestep;
  return { candidates, race, scene };
}

function simulateRace(count: number, seed: number) {
  const { candidates, race } = createRace(count, seed);
  try {
    race.start();
    for (let step = 0; step < 25 / timestep; step++) {
      race.beforeStep?.(timestep);
      race.world.step();
      const result = race.afterStep(timestep);
      if (result) {
        expect(candidates).toContain(result.candidate);
        return result.candidate.id;
      }
    }
    throw new Error(`${count} marbles failed to finish within 25 seconds`);
  } finally {
    race.world.free();
  }
}

describe("3D marble race", () => {
  it.each([2, 12])("produces a seed-repeatable finisher with %i marbles", (count) => {
    expect(simulateRace(count, 34)).toBe(simulateRace(count, 34));
  });

  it("allows different candidates to win on repeated draws", () => {
    const winners = [3, 17, 34, 53, 100].map((seed) => simulateRace(12, seed));
    expect(new Set(winners).size).toBeGreaterThan(1);
  });

  it.each([
    [2, 49],
    [3, 1],
    [2, 56502658],
  ])("keeps a path open between bumpers and rails for a %i-marble race", (count, seed) => {
    expect(simulateRace(count, seed)).toBeGreaterThan(0);
  });

  it("awards a shared timestep to the marble that crossed first", () => {
    const { candidates, race, scene } = createRace(2, 34);
    try {
      race.start();
      const finish = scene.getObjectByName("Finish line")!.position;
      const [first, second] = candidates.map((candidate) =>
        [...race.world.bodies.getAll()].find((body) => body.userData === candidate)!,
      );
      first.setTranslation({ x: -2, y: finish.y + 0.9, z: finish.z - 0.08 }, true);
      second.setTranslation({ x: 2, y: finish.y + 0.9, z: finish.z - 0.02 }, true);
      for (const body of [first, second]) {
        body.setLinvel({ x: 0, y: 0, z: 14 }, true);
      }
      race.beforeStep?.(timestep);
      race.world.step();
      expect(first.translation().z).toBeGreaterThan(finish.z);
      expect(second.translation().z).toBeGreaterThan(finish.z);
      expect(race.afterStep(timestep)?.candidate).toBe(candidates[1]);
      expect(race.afterStep(timestep)).toBeUndefined();
    } finally {
      race.world.free();
    }
  });

  it("counts only crossings within the finish gate", () => {
    const { candidates, race, scene } = createRace(4, 34);
    try {
      race.start();
      const finish = scene.getObjectByName("Finish line")!.position;
      const bodies = race.world.bodies.getAll();
      const entries = [
        { x: 4.3, height: 2.2, distance: 0.02, lateralVelocity: -15 },
        { x: 0, height: -1.2, distance: 0.03, lateralVelocity: 0 },
        { x: -1, height: 4.35, distance: 0.04, lateralVelocity: 0 },
        { x: -2, height: 0.9, distance: 0.08, lateralVelocity: 0 },
      ].map(({ x, height, distance, lateralVelocity }, index) => {
        const body = bodies.find((entry) => entry.userData === candidates[index])!;
        body.setTranslation({ x, y: finish.y + height, z: finish.z - distance }, true);
        body.setLinvel({ x: lateralVelocity, y: 0, z: 14 }, true);
        return body;
      });

      race.beforeStep?.(timestep);
      race.world.step();
      for (const body of entries) expect(body.translation().z).toBeGreaterThan(finish.z);
      expect(entries[0].translation().x).toBeLessThan(4.2);
      expect(race.afterStep(timestep)?.candidate).toBe(candidates[3]);
    } finally {
      race.world.free();
    }
  });
});
