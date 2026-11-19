import { MathUtils, Quaternion, Vector3 } from "three";
import type { BufferGeometry } from "three";
import type { Candidate, CreateDrawScene } from "../../lib/draw";
import {
  ballRadius,
  createWheel,
  deflectorAngles,
  deflectorGeometry,
  deflectorRadius,
  dividerGeometry,
  fullTurn,
  pocketAngle,
  pocketFloor,
  pocketInner,
  pocketNumbers,
  pocketOuter,
  pocketRise,
  radialSurface,
  rotorProfile,
  trackProfile,
} from "./wheel";

const launchRadius = 3.96;
const launchHeight = 1.13;
const up = new Vector3(0, 1, 0);

function shuffledCandidates(candidates: readonly Candidate[], random: () => number) {
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const index = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[index]] = [shuffled[index], shuffled[i]];
  }

  // A uniformly shuffled order gives each candidate the same chance at any pocket,
  // including when 37 does not divide evenly by the number of candidates.
  return pocketNumbers.map((_, index) => shuffled[index % shuffled.length]);
}

function vertexPositions(geometry: BufferGeometry) {
  return new Float32Array(geometry.getAttribute("position").array);
}

export const createRouletteScene: CreateDrawScene = ({
  rapier,
  scene,
  camera,
  candidates,
  random,
}) => {
  const { ball, rotor, highlightPocket } = createWheel(scene);
  const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
  const axle = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased());
  const rotation = new Quaternion();
  const inverseRotation = new Quaternion();

  function makeSurface(profile: Parameters<typeof radialSurface>[0], friction: number) {
    const geometry = radialSurface(profile);
    const descriptor = rapier.ColliderDesc.trimesh(
      vertexPositions(geometry),
      new Uint32Array(geometry.getIndex()!.array),
    )
      .setFriction(friction)
      .setRestitution(0.12);
    geometry.dispose();
    return descriptor;
  }

  world.createCollider(
    makeSurface(trackProfile, 0.065)
      .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
      .setRestitution(0)
      .setRestitutionCombineRule(rapier.CoefficientCombineRule.Min),
  );
  const rotorFloor = world.createCollider(makeSurface(rotorProfile, 0.8), axle);

  const fret = dividerGeometry();
  const fretVertices = vertexPositions(fret);
  fret.dispose();
  for (let i = 0; i < pocketNumbers.length; i++) {
    const descriptor = rapier.ColliderDesc.convexHull(fretVertices);
    if (!descriptor) throw new Error("룰렛 구분 칸을 만들 수 없습니다.");
    rotation.setFromAxisAngle(up, -(i + 0.5) * pocketAngle);
    world.createCollider(
      descriptor.setRotation(rotation).setFriction(0.63).setRestitution(0.24),
      axle,
    );
  }

  const deflector = deflectorGeometry();
  const deflectorVertices = vertexPositions(deflector);
  deflector.dispose();
  for (const angle of deflectorAngles) {
    const descriptor = rapier.ColliderDesc.convexHull(deflectorVertices);
    if (!descriptor) throw new Error("룰렛 범퍼를 만들 수 없습니다.");
    rotation.setFromAxisAngle(up, -angle);
    world.createCollider(
      descriptor
        .setTranslation(deflectorRadius * Math.cos(angle), 0, deflectorRadius * Math.sin(angle))
        .setRotation(rotation)
        .setFriction(0.28)
        .setRestitution(0.1),
    );
  }

  const idleAngle = 0.82;
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.dynamic()
      .setTranslation(
        launchRadius * Math.cos(idleAngle),
        launchHeight,
        launchRadius * Math.sin(idleAngle),
      )
      .setEnabled(false)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0.12)
      .setAngularDamping(0.16)
      .setAdditionalSolverIterations(4),
  );
  const ballCollider = world.createCollider(
    rapier.ColliderDesc.ball(ballRadius).setFriction(0.43).setRestitution(0.24),
    body,
  );

  const assignments = new Map<number, number[]>();
  let candidateByPocket: Candidate[] = [];
  let active = false;
  let rotorAngle = 0;
  let rotorSpeed = 0;
  let settlingPocket = -1;
  let settledTime = 0;

  const localPosition = new Vector3();
  const previousPosition = new Vector3();

  function resize(aspect: number) {
    const scale = Math.max(1, 1.14 / aspect);
    camera.position.set(0, 13.05 * scale, 8.05 * scale);
    camera.lookAt(0, 0.73, 0.6);
  }

  resize(camera.aspect);

  return {
    world,
    assignments,
    resize,
    start() {
      candidateByPocket = shuffledCandidates(candidates, random);
      assignments.clear();
      for (const [index, candidate] of candidateByPocket.entries()) {
        const assigned = assignments.get(candidate.id) ?? [];
        assigned.push(pocketNumbers[index]);
        assignments.set(candidate.id, assigned);
      }

      rotorAngle = random() * fullTurn;
      rotorSpeed = MathUtils.lerp(0.95, 1.28, random());
      rotation.setFromAxisAngle(up, rotorAngle);
      axle.setRotation(rotation, true);

      const angle = random() * fullTurn;
      const speed = MathUtils.lerp(6.5, 7.5, random());
      const facingX = Math.cos(angle);
      const facingZ = Math.sin(angle);
      body.setEnabled(true);
      body.setTranslation(
        { x: launchRadius * facingX, y: launchHeight, z: launchRadius * facingZ },
        true,
      );
      body.setLinvel({ x: -facingZ * speed, y: -0.08, z: facingX * speed }, true);
      body.setAngvel(
        { x: (facingX * speed) / ballRadius, y: 0, z: (facingZ * speed) / ballRadius },
        true,
      );

      settlingPocket = -1;
      settledTime = 0;
      previousPosition
        .copy(body.translation())
        .applyQuaternion(inverseRotation.copy(rotation).invert());
      active = true;
    },
    beforeStep(dt) {
      if (!active) return;

      // Keep the quaternion continuous across full turns so the axle does not jolt the ball.
      rotorAngle += rotorSpeed * dt;
      rotorSpeed *= Math.exp(-0.22 * dt);
      axle.setNextKinematicRotation(rotation.setFromAxisAngle(up, rotorAngle));
    },
    afterStep(dt) {
      if (!active) return undefined;

      inverseRotation.copy(axle.rotation()).invert();
      localPosition.copy(body.translation()).applyQuaternion(inverseRotation);
      const relativeSpeed = localPosition.distanceTo(previousPosition) / dt;
      previousPosition.copy(localPosition);

      const { x, y, z } = localPosition;
      const radius = Math.hypot(x, z);
      const sector = Math.atan2(z, x) / pocketAngle;
      const nearestPocket = Math.round(sector);
      const pocket = MathUtils.euclideanModulo(nearestPocket, pocketNumbers.length);
      const distanceToDivider = (0.5 - Math.abs(sector - nearestPocket)) * pocketAngle * radius;

      const withinPocket =
        radius > pocketInner &&
        radius < pocketOuter &&
        y < pocketFloor + pocketRise + ballRadius + 0.024 &&
        distanceToDivider > ballRadius * 0.5 &&
        relativeSpeed < 0.24;

      let touchingFloor = false;
      if (withinPocket) {
        world.contactPair(ballCollider, rotorFloor, (manifold) => {
          for (let i = 0; i < manifold.numContacts(); i++) {
            touchingFloor ||= manifold.contactDist(i) < 0.003;
          }
        });
      }

      if (!touchingFloor || pocket !== settlingPocket) {
        settledTime = 0;
        settlingPocket = pocket;
      }

      if (!touchingFloor) return undefined;
      settledTime += dt;
      if (settledTime < 0.58 || rotorSpeed > 0.16) return undefined;

      active = false;
      highlightPocket(pocket);
      return { candidate: candidateByPocket[pocket], pocket: pocketNumbers[pocket] };
    },
    render() {
      ball.position.copy(body.translation());
      ball.quaternion.copy(body.rotation());
      rotor.quaternion.copy(axle.rotation());
    },
  };
};
