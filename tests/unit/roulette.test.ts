import RAPIER from "@dimforge/rapier3d-compat";
import { PerspectiveCamera, Quaternion, Scene, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { createRouletteScene } from "../../src/features/roulette/roulette";
import { fullTurn, pocketAngle, pocketInner, pocketOuter } from "../../src/features/roulette/wheel";
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
    expect(duration).toBeLessThan(20);
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

  it.each([
    { spin: -1, aspect: 0.78, seed: 1957 },
    { spin: 1, aspect: 1.85, seed: 31001 },
  ])(
    "드래그 $spin 방향의 반대로 공을 발사해 바깥을 네 바퀴 이상 돈 뒤 포켓에서 튕긴다",
    ({ spin, aspect, seed }) => {
      const scene = new Scene();
      const camera = new PerspectiveCamera(35, aspect, 0.1, 100);
      const draw = createRouletteScene({
        rapier: RAPIER,
        scene,
        camera,
        candidates,
        random: seededRandom(seed),
      });
      draw.world.timestep = step;

      try {
        draw.turnWheel?.(0.63 * spin);
        draw.start(spin);
        const bodies = draw.world.bodies.getAll();
        const ball = bodies.find(
          (body) =>
            body.numColliders() === 1 && body.collider(0).shapeType() === RAPIER.ShapeType.Ball,
        );
        const axle = bodies.find((body) => body !== ball && body.isKinematic());
        if (!ball || !axle) throw new Error("공과 회전축이 필요합니다.");

        const ballCollider = ball.collider(0);
        const start = ball.translation();
        let previousAngle = Math.atan2(-start.z, start.x);
        let previousHeight = start.y;
        let previousVerticalSpeed = 0;
        let outerRotation = 0;
        let leftOuterRail = false;
        let wheelSpeed = 0;
        let launchSpeed = 0;
        const deflector = {
          frame: -Infinity,
          riseStart: undefined as number | undefined,
          rebound: 0,
        };
        const divider = {
          frame: -Infinity,
          riseStart: undefined as number | undefined,
          rebound: 0,
        };
        const obstacles = [deflector, divider];
        const crossedSectors = new Set<number>();
        const localBall = new Vector3();
        const inverseWheel = new Quaternion();
        let result: DrawResult | undefined;

        for (let frame = 0; frame < 25 / step && !result; frame++) {
          draw.beforeStep?.(step);
          draw.world.step();
          result = draw.afterStep(step);
          const { x, y, z } = ball.translation();
          const verticalSpeed = ball.linvel().y;
          const radius = Math.hypot(x, z);
          const angle = Math.atan2(-z, x);
          const change = angle - previousAngle;
          const turn = Math.atan2(Math.sin(change), Math.cos(change));
          if (frame === 0) {
            launchSpeed = turn / step;
            wheelSpeed = axle.angvel().y;
          }

          leftOuterRail ||= radius < 3.83;
          if (!leftOuterRail) {
            outerRotation += Math.sign(launchSpeed) * turn;
          } else {
            draw.world.contactPairsWith(ballCollider, (obstacle) => {
              if (obstacle.shapeType() !== RAPIER.ShapeType.ConvexPolyhedron) return;
              let hit = false;
              draw.world.contactPair(ballCollider, obstacle, (manifold) => {
                for (let index = 0; index < manifold.numContacts(); index++) {
                  hit ||= manifold.contactImpulse(index) > 1e-7;
                }
              });
              if (!hit) return;
              const parent = obstacle.parent();
              if (!parent) deflector.frame = frame;
              else if (parent.handle === axle.handle) divider.frame = frame;
            });
            for (const impact of obstacles) {
              if (verticalSpeed <= 0) {
                impact.riseStart = undefined;
              } else if (previousVerticalSpeed <= 0 && frame - impact.frame <= 3) {
                impact.riseStart = previousHeight;
              }
              if (impact.riseStart !== undefined) {
                impact.rebound = Math.max(impact.rebound, y - impact.riseStart);
              }
            }
            if (radius > pocketInner && radius < pocketOuter) {
              localBall.set(x, y, z).applyQuaternion(inverseWheel.copy(axle.rotation()).invert());
              const sector = Math.round(Math.atan2(localBall.z, localBall.x) / pocketAngle);
              crossedSectors.add(sector);
            }
          }
          previousAngle = angle;
          previousHeight = y;
          previousVerticalSpeed = verticalSpeed;
        }

        const rpm = (Math.abs(launchSpeed) * 60) / fullTurn;
        expect.soft(Math.sign(wheelSpeed)).toBe(spin);
        expect.soft(Math.sign(launchSpeed)).toBe(-Math.sign(wheelSpeed));
        expect.soft(rpm).toBeGreaterThanOrEqual(55);
        expect.soft(rpm).toBeLessThanOrEqual(90);
        expect.soft(outerRotation / fullTurn).toBeGreaterThanOrEqual(4);
        expect.soft(deflector.frame).toBeGreaterThanOrEqual(0);
        expect.soft(divider.frame).toBeGreaterThanOrEqual(0);
        expect.soft(deflector.rebound).toBeGreaterThan(0.04);
        expect.soft(divider.rebound).toBeGreaterThan(0.04);
        expect.soft(crossedSectors.size).toBeGreaterThan(1);
        expect(result).toBeDefined();
        expect(draw.assignments?.get(result!.candidate.id)).toContain(result!.pocket);
      } finally {
        draw.world.free();
      }
    },
  );

  it("같은 발사 조건에서 후보 순서가 달라져도 공은 같은 포켓에 안착한다", () => {
    const first = runDraw(candidates, seededRandom(500)).result;
    const second = runDraw([...candidates].reverse(), seededRandom(500)).result;
    expect(second.pocket).toBe(first.pocket);
    expect(second.candidate.id).toBe(candidates.length - 1 - first.candidate.id);
  });
});
