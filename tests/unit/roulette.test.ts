import RAPIER from "@dimforge/rapier3d-compat";
import { MathUtils, PerspectiveCamera, Quaternion, Scene, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { createRouletteScene } from "../../src/features/roulette/roulette";
import {
  ballRadius,
  fullTurn,
  pocketAngle,
  pocketFloor,
  pocketInner,
  pocketCount,
  pocketOuter,
  pocketRise,
} from "../../src/features/roulette/wheel";
import type { Candidate, DrawResult } from "../../src/lib/draw";

const step = 1 / 120;
const roundLimit = 30;
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

function pocketHeight(radius: number) {
  return pocketFloor + (pocketRise * (radius - pocketInner)) / (pocketOuter - pocketInner);
}

function pocketAtFloorContact(
  world: RAPIER.World,
  ballCollider: RAPIER.Collider,
  floor: RAPIER.Collider,
  upwardResponse: boolean,
  allowRestingGap = false,
) {
  let pocket: number | undefined;
  const ballBottom = ballCollider.translation().y - ballRadius;
  world.contactPair(ballCollider, floor, (manifold, flipped) => {
    for (let index = 0; index < manifold.numContacts(); index++) {
      if (allowRestingGap && manifold.contactDist(index) > 0.003) continue;
      const point = flipped
        ? manifold.localContactPoint1(index)
        : manifold.localContactPoint2(index);
      if (!point) continue;
      const radius = Math.hypot(point.x, point.z);
      if (radius <= pocketInner || radius >= pocketOuter) continue;
      const floorY = pocketHeight(radius);
      if (Math.abs(point.y - floorY) >= 0.004) continue;
      const impact =
        manifold.contactImpulse(index) > 1e-6 || (upwardResponse && ballBottom <= floorY + 0.006);
      if (!allowRestingGap && !impact) continue;
      const sector = Math.round(Math.atan2(point.z, point.x) / pocketAngle);
      pocket = MathUtils.euclideanModulo(sector, pocketCount);
    }
  });
  return pocket;
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
    const rotor = scene.getObjectByName("roulette-rotor");
    if (!rotor) throw new Error("룰렛 휠을 찾을 수 없습니다.");
    const sectors = entrants.map((entrant) => {
      const sector = rotor.getObjectByName(`roulette-candidate-${entrant.id}`);
      if (!sector) throw new Error("후보 구역을 찾을 수 없습니다.");
      return sector;
    });
    const coveredPockets = sectors.reduce<string[]>((names, sector) => {
      const pockets = sector.children.filter(({ name }) => name.startsWith("roulette-pocket-"));
      expect(pockets.length).toBeGreaterThanOrEqual(Math.floor(pocketCount / entrants.length));
      expect(pockets.length).toBeLessThanOrEqual(Math.ceil(pocketCount / entrants.length));
      return names.concat(pockets.map(({ name }) => name));
    }, []);
    expect(new Set(coveredPockets).size).toBe(pocketCount);
    expect(coveredPockets).toHaveLength(pocketCount);

    for (let frame = 1; frame <= roundLimit / step; frame++) {
      draw.beforeStep?.(step);
      draw.world.step();
      result = draw.afterStep(step);

      if (result) {
        draw.render();
        const ball = scene.getObjectByName("roulette-ball");
        const pocket = rotor.getObjectByName(`roulette-pocket-${result.pocketIndex}`);
        expect(pocket?.parent?.name).toBe(`roulette-candidate-${result.candidate.id}`);
        if (!ball || !pocket) throw new Error("화면에서 공 또는 포켓을 찾을 수 없습니다.");
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

    throw new Error(`룰렛 공이 ${roundLimit}초 안에 포켓에 안착하지 않았습니다.`);
  } finally {
    draw.world.free();
  }
}

describe("룰렛", () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it("공이 0.24초 연속 안착한 뒤 확대하고 다시 움직여도 줌을 유지한다", () => {
    const camera = new PerspectiveCamera(35, 1.55, 0.1, 100);
    const draw = createRouletteScene({
      rapier: RAPIER,
      scene: new Scene(),
      camera,
      candidates: candidates.slice(0, 6),
      random: seededRandom(72),
    });
    draw.world.timestep = step;

    try {
      draw.start();
      let result: DrawResult | undefined;
      const heights: number[] = [camera.position.y];
      for (let frame = 1; frame <= roundLimit / step && !result; frame++) {
        draw.beforeStep?.(step);
        draw.world.step();
        result = draw.afterStep(step);
        draw.render();
        heights.push(camera.position.y);
      }

      // Seed 72 first settles around 17.58 seconds and moves again around 18.24 seconds.
      const heightAt = (time: number) => heights[Math.round(time / step)];
      expect(result?.pocketIndex).toBe(7);
      expect(heightAt(17.8)).toBeCloseTo(heightAt(17.5), 3);
      expect(heightAt(18.2)).toBeLessThan(heightAt(17.8) - 0.4);
      const closeUp = heights.slice(Math.round(17.8 / step));
      const largestZoomOut = Math.max(
        ...closeUp.slice(1).map((height, index) => height - closeUp[index]),
      );
      expect(largestZoomOut).toBeLessThanOrEqual(1e-6);
    } finally {
      draw.world.free();
    }
  });

  it.each([
    { spin: -1, seed: 2001 },
    { spin: -1, seed: 31001 },
    { spin: -0.01, seed: 1957 },
    { spin: -0.01, seed: 2543 },
    { spin: -0.01, seed: 26391 },
    { spin: 0, seed: 2814 },
    { spin: 0.01, seed: 924 },
    { spin: 0.65, seed: 12028 },
    { spin: 1, seed: 18803 },
    { spin: 1, seed: 20971 },
    { spin: 1, seed: 31001 },
  ])(
    "회전 입력 $spin / 시드 $seed 조건에서 공이 첫 포켓 바닥 접촉 직전에 25rpm 이상 돈다",
    ({ spin, seed }) => {
      const draw = createRouletteScene({
        rapier: RAPIER,
        scene: new Scene(),
        camera: new PerspectiveCamera(35, 1.55, 0.1, 100),
        candidates,
        random: seededRandom(seed),
      });
      draw.world.timestep = step;

      try {
        draw.turnWheel?.(0.63 * Math.sign(spin));
        draw.start(spin);
        const bodies = draw.world.bodies.getAll();
        const ball = bodies.find(
          (body) =>
            body.numColliders() === 1 && body.collider(0).shapeType() === RAPIER.ShapeType.Ball,
        );
        const axle = bodies.find((body) => body !== ball && body.isKinematic());
        if (!ball || !axle) throw new Error("공과 회전축이 필요합니다.");
        const floor = axle.collider(0);
        const ballCollider = ball.collider(0);
        const approachDamping = ball.linearDamping();
        let dampingChangeFrame: number | undefined;
        let contactFrame: number | undefined;
        let entryRpm: number | undefined;
        let airborneFrames = 0;
        let maxAirborneVelocityChange = 0;

        for (let frame = 0; frame < roundLimit / step && entryRpm === undefined; frame++) {
          const wasDynamic = ball.isDynamic();
          const beforeVelocity = ball.linvel();
          const beforePosition = ball.translation();
          const surface = wasDynamic
            ? draw.world.projectPoint(beforePosition, true, undefined, undefined, ballCollider)
            : undefined;
          const airborne =
            surface &&
            !surface.isInside &&
            Math.hypot(
              beforePosition.x - surface.point.x,
              beforePosition.y - surface.point.y,
              beforePosition.z - surface.point.z,
            ) >
              ballRadius + 0.004;
          draw.beforeStep?.(step);
          const { x, z } = ball.translation();
          const velocity = ball.linvel();
          if (airborne) {
            airborneFrames++;
            maxAirborneVelocityChange = Math.max(
              maxAirborneVelocityChange,
              Math.hypot(
                velocity.x - beforeVelocity.x,
                velocity.y - beforeVelocity.y,
                velocity.z - beforeVelocity.z,
              ),
            );
          }
          const orbitalSpeed = Math.abs(x * velocity.z - z * velocity.x) / (x * x + z * z);
          draw.world.step();
          const upwardResponse = velocity.y < 0 && ball.linvel().y - velocity.y > 0.04;
          if (pocketAtFloorContact(draw.world, ballCollider, floor, upwardResponse) !== undefined) {
            contactFrame = frame;
            entryRpm = (orbitalSpeed * 60) / fullTurn;
          }
          draw.afterStep(step);
          if (ball.linearDamping() !== approachDamping) dampingChangeFrame ??= frame;
        }

        expect(entryRpm).toBeDefined();
        expect(entryRpm).toBeGreaterThanOrEqual(25);
        expect(dampingChangeFrame).toBe(contactFrame);
        expect(airborneFrames).toBeGreaterThan(0);
        expect(maxAirborneVelocityChange).toBeLessThanOrEqual(1e-6);
      } finally {
        draw.world.free();
      }
    },
  );

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
    expect(result.pocketIndex).toBeGreaterThanOrEqual(0);
    expect(result.pocketIndex).toBeLessThan(pocketCount);
    expect(duration).toBeGreaterThan(11);
    expect(duration).toBeLessThanOrEqual(roundLimit);
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
    const gentle = motion(0.15);
    expect(gentle).toBeGreaterThan(0);
    expect(motion(1)).toBeGreaterThan(gentle * 2.5);
  });

  it.each([
    { spin: -1, aspect: 0.78, seed: 31001 },
    { spin: 1, aspect: 1.85, seed: 4 },
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
        const floor = axle.collider(0);
        const start = ball.translation();
        let previousAngle = Math.atan2(-start.z, start.x);
        let previousHeight = start.y;
        let previousVerticalSpeed = 0;
        let outerRotation = 0;
        let leftOuterRail = false;
        let wheelSpeed = 0;
        let launchSpeed = 0;
        let deflectorVelocityChange = 0;
        const divider = {
          frame: -Infinity,
          riseStart: undefined as number | undefined,
          rebound: 0,
        };
        const crossedSectors = new Set<number>();
        const localBall = new Vector3();
        const inverseWheel = new Quaternion();
        let result: DrawResult | undefined;

        for (let frame = 0; frame < roundLimit / step && !result; frame++) {
          draw.beforeStep?.(step);
          const beforeVelocity = ball.linvel();
          draw.world.step();
          const afterVelocity = ball.linvel();
          result = draw.afterStep(step);
          const { x, y, z } = ball.translation();
          const verticalSpeed = afterVelocity.y;
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
              if (obstacle.parent() || obstacle.shapeType() !== RAPIER.ShapeType.ConvexPolyhedron)
                return;
              let hit = false;
              draw.world.contactPair(ballCollider, obstacle, (manifold) => {
                for (let index = 0; index < manifold.numContacts(); index++) {
                  hit ||= manifold.contactImpulse(index) > 1e-7;
                }
              });
              if (hit) {
                deflectorVelocityChange = Math.max(
                  deflectorVelocityChange,
                  Math.hypot(
                    afterVelocity.x - beforeVelocity.x,
                    afterVelocity.z - beforeVelocity.z,
                  ),
                );
              }
            });
            draw.world.contactPair(ballCollider, floor, (manifold, flipped) => {
              for (let index = 0; index < manifold.numContacts(); index++) {
                const point = flipped
                  ? manifold.localContactPoint1(index)
                  : manifold.localContactPoint2(index);
                if (!point) continue;
                const contactRadius = Math.hypot(point.x, point.z);
                if (contactRadius <= pocketInner || contactRadius >= pocketOuter) continue;
                if (point.y <= pocketHeight(contactRadius) + 0.004) continue;
                const bounced =
                  previousVerticalSpeed < 0 &&
                  verticalSpeed >= 0 &&
                  y - ballRadius <= point.y + 0.006;
                if (bounced || manifold.contactImpulse(index) > 1e-7) divider.frame = frame;
              }
            });
            if (verticalSpeed <= 0) {
              divider.riseStart = undefined;
            } else if (previousVerticalSpeed <= 0 && frame - divider.frame <= 3) {
              divider.riseStart = previousHeight;
            }
            if (divider.riseStart !== undefined) {
              divider.rebound = Math.max(divider.rebound, y - divider.riseStart);
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
        expect.soft(deflectorVelocityChange).toBeGreaterThan(0.1);
        expect.soft(divider.frame).toBeGreaterThanOrEqual(0);
        expect.soft(divider.rebound).toBeGreaterThan(0.04);
        expect.soft(crossedSectors.size).toBeGreaterThan(1);
        expect(result).toBeDefined();
        expect(candidates).toContain(result!.candidate);
      } finally {
        draw.world.free();
      }
    },
  );

  it.each([
    { spin: -1, seed: 31001 },
    { spin: 1, seed: 31001 },
  ])(
    "회전 입력 $spin 때 첫 접촉 뒤 5초 이상 포켓 구역에서 움직이고 큰 도약 없이 안착한다",
    ({ spin, seed }) => {
      const draw = createRouletteScene({
        rapier: RAPIER,
        scene: new Scene(),
        camera: new PerspectiveCamera(35, 1.55, 0.1, 100),
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
        const floor = axle.collider(0);
        const ballCollider = ball.collider(0);
        const previousPosition = new Vector3();
        const position = new Vector3();
        const inverseRotation = new Quaternion();
        let firstContactFrame: number | undefined;
        let movingFrames = 0;
        let reboundStart: number | undefined;
        let maxPocketRebound = 0;
        let maxPocketLift = 0;
        let airborneFrames = 0;
        let maxAirborneVelocityChange = 0;
        let result: DrawResult | undefined;

        for (let frame = 0; frame < roundLimit / step && !result; frame++) {
          const beforeVelocity = ball.linvel();
          const { x, y, z } = ball.translation();
          const beforeRadius = Math.hypot(x, z);
          const airborne =
            firstContactFrame !== undefined &&
            beforeRadius > pocketInner + ballRadius &&
            beforeRadius < pocketOuter - ballRadius &&
            y - ballRadius > pocketHeight(beforeRadius) + 0.04;
          draw.beforeStep?.(step);
          const afterVelocity = ball.linvel();
          if (airborne) {
            airborneFrames++;
            maxAirborneVelocityChange = Math.max(
              maxAirborneVelocityChange,
              Math.hypot(
                afterVelocity.x - beforeVelocity.x,
                afterVelocity.y - beforeVelocity.y,
                afterVelocity.z - beforeVelocity.z,
              ),
            );
          }
          draw.world.step();
          const verticalSpeed = ball.linvel().y;
          const rebounded = afterVelocity.y < 0 && verticalSpeed >= 0;
          const upwardResponse = afterVelocity.y < 0 && verticalSpeed - afterVelocity.y > 0.04;
          position
            .copy(ball.translation())
            .applyQuaternion(inverseRotation.copy(axle.rotation()).invert());
          const radius = Math.hypot(position.x, position.z);
          if (firstContactFrame === undefined || rebounded) {
            const touched = pocketAtFloorContact(draw.world, ballCollider, floor, upwardResponse);
            if (touched !== undefined) {
              firstContactFrame ??= frame;
              if (rebounded) reboundStart = previousPosition.y;
            }
          }
          if (verticalSpeed <= 0) reboundStart = undefined;

          if (firstContactFrame !== undefined) {
            const travel = Math.hypot(
              position.x - previousPosition.x,
              position.z - previousPosition.z,
            );
            if (radius <= 3.15 && travel / step > 0.24) movingFrames++;
            if (radius > pocketInner && radius < pocketOuter) {
              if (reboundStart !== undefined) {
                maxPocketRebound = Math.max(maxPocketRebound, position.y - reboundStart);
              }
              maxPocketLift = Math.max(
                maxPocketLift,
                position.y - ballRadius - pocketHeight(radius),
              );
            }
          }

          previousPosition.copy(position);
          result = draw.afterStep(step);
        }

        expect(firstContactFrame).toBeDefined();
        expect.soft(movingFrames * step).toBeGreaterThanOrEqual(5);
        expect.soft(maxPocketRebound).toBeGreaterThan(0.02);
        expect.soft(maxPocketLift).toBeLessThanOrEqual(0.27);
        expect.soft(airborneFrames).toBeGreaterThan(0);
        expect.soft(maxAirborneVelocityChange).toBeLessThanOrEqual(1e-6);
        expect(result).toBeDefined();
        expect(candidates).toContain(result!.candidate);
      } finally {
        draw.world.free();
      }
    },
  );

  it.each([
    { spin: -1, seed: 924, reachesCone: true },
    { spin: 1, seed: 924, reachesCone: false },
  ])(
    "드래그 $spin 방향에서 처음 바닥에 닿은 포켓을 벗어나 다른 포켓에 안착한다",
    ({ spin, seed, reachesCone }) => {
      const draw = createRouletteScene({
        rapier: RAPIER,
        scene: new Scene(),
        camera: new PerspectiveCamera(35, 1.55, 0.1, 100),
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
        const floor = axle.collider(0);
        const cone = reachesCone ? axle.collider(1) : undefined;
        const ballCollider = ball.collider(0);
        let firstFloorPocket: number | undefined;
        let firstFloorFrame: number | undefined;
        let coneContactFrame: number | undefined;
        let floorPocket: number | undefined;
        let floorFrame = -1;
        let result: DrawResult | undefined;

        for (let frame = 0; frame < roundLimit / step && !result; frame++) {
          draw.beforeStep?.(step);
          const incomingVerticalSpeed = ball.linvel().y;
          draw.world.step();
          const upwardResponse =
            incomingVerticalSpeed < 0 && ball.linvel().y - incomingVerticalSpeed > 0.04;
          result = draw.afterStep(step);
          floorPocket = pocketAtFloorContact(draw.world, ballCollider, floor, upwardResponse);
          if (floorPocket !== undefined) {
            floorFrame = frame;
            firstFloorPocket ??= floorPocket;
            firstFloorFrame ??= frame;
          }
          if (result)
            floorPocket = pocketAtFloorContact(
              draw.world,
              ballCollider,
              floor,
              upwardResponse,
              true,
            );
          if (
            cone &&
            firstFloorFrame !== undefined &&
            frame > firstFloorFrame &&
            coneContactFrame === undefined
          ) {
            draw.world.contactPair(ballCollider, cone, (manifold) => {
              for (let index = 0; index < manifold.numContacts(); index++) {
                if (manifold.contactDist(index) <= 0 || manifold.contactImpulse(index) > 1e-6)
                  coneContactFrame = frame;
              }
            });
          }
        }

        if (!result) throw new Error(`룰렛 공이 ${roundLimit}초 안에 포켓에 안착하지 않았습니다.`);
        expect(firstFloorPocket).toBeDefined();
        expect(floorPocket).toBe(result.pocketIndex);
        expect(firstFloorPocket).not.toBe(result.pocketIndex);
        if (reachesCone) {
          expect(coneContactFrame).toBeDefined();
          expect(floorFrame).toBeGreaterThan(coneContactFrame!);
        }
        expect(candidates).toContain(result.candidate);
      } finally {
        draw.world.free();
      }
    },
  );

  it("같은 발사 조건에서 후보 순서가 달라져도 공은 같은 포켓에 안착한다", () => {
    const first = runDraw(candidates, seededRandom(500)).result;
    const second = runDraw([...candidates].reverse(), seededRandom(500)).result;
    expect(second.pocketIndex).toBe(first.pocketIndex);
    expect(second.candidate.id).toBe(candidates.length - 1 - first.candidate.id);
  });
});
