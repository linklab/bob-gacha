import RAPIER from "@dimforge/rapier3d-compat";
import { PerspectiveCamera, Scene, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { createRouletteScene } from "../../src/features/roulette/roulette";
import type { Candidate, DrawResult } from "../../src/lib/draw";

const step = 1 / 120;
const candidates = Array.from({ length: 12 }, (_, id) => ({
  id,
  name: `후보 ${id + 1}`,
  color: "#dfa55d",
}));

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function runDraw(entrants: readonly Candidate[], random: () => number) {
  const scene = new Scene();
  const draw = createRouletteScene({
    rapier: RAPIER,
    scene,
    camera: new PerspectiveCamera(35, 1.55, 0.1, 100),
    candidates: entrants,
    random,
  });
  draw.world.timestep = step;

  try {
    let result: DrawResult | undefined;
    draw.start();
    const assignments = draw.assignments;
    if (!assignments) throw new Error("후보에게 배정된 포켓이 없습니다.");

    const allocatedNumbers = Array.from(assignments.values()).reduce<number[]>(
      (all, numbers) => all.concat(numbers),
      [],
    );
    expect(allocatedNumbers.sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    for (const entrant of entrants) {
      const pocketCount = assignments.get(entrant.id)?.length ?? 0;
      expect(pocketCount).toBeGreaterThanOrEqual(Math.floor(37 / entrants.length));
      expect(pocketCount).toBeLessThanOrEqual(Math.ceil(37 / entrants.length));
    }

    for (let frame = 1; frame <= 25 / step; frame++) {
      draw.beforeStep?.(step);
      draw.world.step();
      result = draw.afterStep(step);

      if (result) {
        draw.render();
        const ball = scene.getObjectByName("roulette-ball");
        const rotor = scene.getObjectByName("roulette-rotor");
        const pocket = rotor?.getObjectByName(`roulette-pocket-${result.pocket}`);
        expect(assignments.get(result.candidate.id)).toContain(result.pocket);
        if (!ball || !rotor || !pocket)
          throw new Error("화면에서 공 또는 포켓을 찾을 수 없습니다.");
        scene.updateMatrixWorld(true);
        const localBall = rotor.worldToLocal(ball.position.clone());
        const pocketAngle = Math.atan2(pocket.position.z, pocket.position.x);
        const ballAngle = Math.atan2(localBall.z, localBall.x);
        const difference = Math.atan2(
          Math.sin(ballAngle - pocketAngle),
          Math.cos(ballAngle - pocketAngle),
        );
        expect(Math.abs(difference)).toBeLessThan(Math.PI / 37);
        return { result, duration: frame * step };
      }
    }

    throw new Error("룰렛 공이 25초 안에 포켓에 안착하지 않았습니다.");
  } finally {
    draw.world.free();
  }
}

describe("룰렛", () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it.each([
    [2, 924],
    [7, 1957],
    [12, 31001],
    [3, 19233331],
    [8, 538533268],
  ])("후보 %i명일 때 정해진 시간 안에 공이 들어간 포켓을 반환한다", (count, seed) => {
    const entrants = candidates.slice(0, count);
    const { result, duration } = runDraw(entrants, seededRandom(seed));
    expect(entrants).toContain(result.candidate);
    expect(result.pocket).toBeGreaterThanOrEqual(0);
    expect(result.pocket).toBeLessThanOrEqual(36);
    expect(duration).toBeGreaterThan(11);
    expect(duration).toBeLessThan(19);
  });

  it("드래그를 놓은 각도에서 손을 뗀 방향과 속도로 실제 휠을 돌린다", () => {
    function motion(spin: number) {
      const scene = new Scene();
      const draw = createRouletteScene({
        rapier: RAPIER,
        scene,
        camera: new PerspectiveCamera(35, 1.55, 0.1, 100),
        candidates,
        random: seededRandom(1957),
      });
      draw.world.timestep = step;
      const rotor = scene.getObjectByName("roulette-rotor")!;
      const direction = new Vector3();
      function wheelAngle() {
        draw.render();
        direction.set(1, 0, 0).applyQuaternion(rotor.quaternion);
        return Math.atan2(-direction.z, direction.x);
      }
      try {
        const previewAngle = 0.63;
        draw.turnWheel!(previewAngle);
        expect(wheelAngle()).toBeCloseTo(previewAngle);
        draw.start(spin);
        expect(wheelAngle()).toBeCloseTo(previewAngle);
        for (let frame = 0; frame < 12; frame++) {
          draw.beforeStep?.(step);
          draw.world.step();
          draw.afterStep(step);
        }
        return wheelAngle() - previewAngle;
      } finally {
        draw.world.free();
      }
    }

    expect(motion(-1)).toBeLessThan(0);
    const gentle = motion(0.2);
    expect(gentle).toBeGreaterThan(0);
    expect(motion(1)).toBeGreaterThan(gentle * 1.2);
  });

  it("같은 발사 조건에서 후보 순서가 달라져도 공은 같은 포켓에 안착한다", () => {
    const first = runDraw(candidates, seededRandom(500)).result;
    const second = runDraw([...candidates].reverse(), seededRandom(500)).result;
    expect(second.pocket).toBe(first.pocket);
    expect(second.candidate.id).toBe(candidates.length - 1 - first.candidate.id);
  });
});
