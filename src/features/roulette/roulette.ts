import { MathUtils, Quaternion, Vector3 } from "three";
import type { BufferGeometry } from "three";
import type { Candidate, CreateDrawScene } from "../../lib/draw";
import {
  ballRadius,
  createWheel,
  crownProfile,
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

const launchRadius = 4.01;
const launchHeight = 1.113;
const railDrag = 0.225;
const railExitSpeed = 1.26;
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
      // The ball should lose momentum to friction, not to the triangulation seams.
      rapier.TriMeshFlags.FIX_INTERNAL_EDGES,
    )
      .setFriction(friction)
      .setRestitution(0.34);
    geometry.dispose();
    return descriptor;
  }

  world.createCollider(
    makeSurface(trackProfile, 0.003)
      .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
      .setRestitution(0)
      .setRestitutionCombineRule(rapier.CoefficientCombineRule.Min),
  );
  const rotorFloor = world.createCollider(
    makeSurface(rotorProfile, 0.3)
      .setRestitution(0.65)
      .setRestitutionCombineRule(rapier.CoefficientCombineRule.Max),
    axle,
  );
  world.createCollider(makeSurface(crownProfile, 0.42), axle);

  const fret = dividerGeometry();
  const fretVertices = vertexPositions(fret);
  fret.dispose();
  for (let i = 0; i < pocketNumbers.length; i++) {
    const descriptor = rapier.ColliderDesc.convexHull(fretVertices);
    if (!descriptor) throw new Error("룰렛 구분 칸을 만들 수 없습니다.");
    rotation.setFromAxisAngle(up, -(i + 0.5) * pocketAngle);
    world.createCollider(
      descriptor
        .setRotation(rotation)
        .setFriction(0.22)
        .setRestitution(0.7)
        .setRestitutionCombineRule(rapier.CoefficientCombineRule.Max),
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
        .setFriction(0.16)
        .setRestitution(0.56),
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
      .setLinearDamping(0.13)
      .setAngularDamping(0.065)
      .setAdditionalSolverIterations(4),
  );
  const ballCollider = world.createCollider(
    rapier.ColliderDesc.ball(ballRadius).setFriction(0.34).setRestitution(0.41),
    body,
  );

  const assignments = new Map<number, number[]>();
  let candidateByPocket: Candidate[] = [];
  let active = false;
  let rotorAngle = 0;
  let rotorSpeed = 0;
  let onRail = false;
  let railAngle = idleAngle;
  let railSpeed = 0;
  let onRotor = false;
  let settlingPocket = -1;
  let settledTime = 0;
  let railView = 0;
  let cameraClose = 0;
  let aspect = camera.aspect;

  const localPosition = new Vector3();
  const previousPosition = new Vector3();
  const focus = new Vector3();
  const railNormal = new Vector3();
  const roll = new Quaternion();
  const ballRotation = new Quaternion();

  function setWheelAngle() {
    axle.setRotation(rotation.setFromAxisAngle(up, rotorAngle), true);
  }

  function setBallVelocity(angle: number, angularSpeed: number, inward = 0) {
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    const speed = angularSpeed * launchRadius;
    body.setLinvel({ x: -z * speed - x * inward, y: 0, z: x * speed - z * inward }, true);
    body.setAngvel({ x: (x * speed) / ballRadius, y: 0, z: (z * speed) / ballRadius }, true);
  }

  function stepRail(dt: number) {
    if (Math.abs(railSpeed) <= railExitSpeed) {
      onRail = false;
      body.setBodyType(rapier.RigidBodyType.Dynamic, true);
      setBallVelocity(railAngle, railSpeed, 1.35);
      return;
    }

    // The outer guide constrains the ball to a circle. At release its pose and tangential
    // momentum carry into the free Rapier body, where the deflectors and pockets take over.
    const nextSpeed = railSpeed * Math.exp(-railDrag * dt);
    const turn = (railSpeed - nextSpeed) / railDrag;
    railSpeed = nextSpeed;
    railAngle += turn;
    const x = Math.cos(railAngle);
    const z = Math.sin(railAngle);
    body.setNextKinematicTranslation({ x: launchRadius * x, y: launchHeight, z: launchRadius * z });
    railNormal.set(x, 0, z);
    ballRotation.premultiply(roll.setFromAxisAngle(railNormal, (turn * launchRadius) / ballRadius));
    body.setNextKinematicRotation(ballRotation);
  }

  return {
    world,
    assignments,
    resize(nextAspect) {
      aspect = nextAspect;
    },
    turnWheel(delta) {
      if (active) return;
      rotorAngle += delta;
      setWheelAngle();
    },
    start(spin) {
      candidateByPocket = shuffledCandidates(candidates, random);
      assignments.clear();
      for (const [index, candidate] of candidateByPocket.entries()) {
        const assigned = assignments.get(candidate.id) ?? [];
        assigned.push(pocketNumbers[index]);
        assignments.set(candidate.id, assigned);
      }

      if (spin === undefined) {
        rotorAngle = random() * fullTurn;
        rotorSpeed = MathUtils.lerp(1.82, 2.35, random());
      } else {
        rotorSpeed =
          (Math.sign(spin) || 1) * MathUtils.lerp(1.55, 3.12, Math.min(Math.abs(spin), 1));
      }
      setWheelAngle();

      railAngle = spin === undefined ? random() * fullTurn : idleAngle;
      const power = spin === undefined ? 0.5 : Math.min(Math.abs(spin), 1);
      // Positive Rapier yaw turns x toward -z; positive railAngle turns toward +z.
      railSpeed = Math.sign(rotorSpeed) * (MathUtils.lerp(7.25, 8.9, power) + random() * 0.45);
      onRail = true;
      ballRotation.identity();
      body.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
      body.setEnabled(true);
      body.setTranslation(
        {
          x: launchRadius * Math.cos(railAngle),
          y: launchHeight,
          z: launchRadius * Math.sin(railAngle),
        },
        true,
      );
      body.setRotation(ballRotation, true);
      setBallVelocity(railAngle, railSpeed);

      onRotor = false;
      railView = 0;
      cameraClose = 0;
      focus.set(0, 0, 0);
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
      const brake = settledTime > 0.18 ? 3.4 : onRotor ? 0.44 : 0.055;
      rotorSpeed *= Math.exp(-brake * dt);
      axle.setNextKinematicRotation(rotation.setFromAxisAngle(up, rotorAngle));
      if (onRail) stepRail(dt);
    },
    afterStep(dt) {
      if (!active) return undefined;

      const position = body.translation();
      inverseRotation.copy(axle.rotation()).invert();
      localPosition.copy(position).applyQuaternion(inverseRotation);
      const relativeSpeed = localPosition.distanceTo(previousPosition) / dt;
      previousPosition.copy(localPosition);

      const { x, y, z } = localPosition;
      const radius = Math.hypot(x, z);
      onRotor ||= radius < 3.12;
      const runningDownBank = 1 - MathUtils.smoothstep(radius, 3.12, 3.98);
      const viewTarget = onRotor ? (settledTime > 0 ? 1 : 0.8) : runningDownBank * 0.65;
      railView = MathUtils.damp(railView, onRail ? 1 : 0, 5.4, dt);
      cameraClose = MathUtils.damp(cameraClose, viewTarget, 3.6, dt);
      const focusBlend = 1 - Math.exp(-3.2 * dt);
      focus.x += (position.x * cameraClose * 0.56 - focus.x) * focusBlend;
      focus.z += (position.z * cameraClose * 0.56 - focus.z) * focusBlend;
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
      if (settledTime < 0.68 || Math.abs(rotorSpeed) > 0.13) return undefined;

      active = false;
      highlightPocket(pocket);
      return { candidate: candidateByPocket[pocket], pocket: pocketNumbers[pocket] };
    },
    render() {
      ball.position.copy(body.translation());
      ball.quaternion.copy(body.rotation());
      rotor.quaternion.copy(axle.rotation());
      const distance = Math.max(1, 1.06 / aspect) * MathUtils.lerp(1, 0.59, cameraClose);
      const overviewHeight = MathUtils.lerp(10.55, 13.7, railView);
      const overviewDepth = MathUtils.lerp(8.8, 4.2, railView);
      camera.position.set(
        focus.x - 2.15 * distance,
        0.42 + MathUtils.lerp(overviewHeight, 12.1, cameraClose) * distance,
        focus.z + 0.48 + MathUtils.lerp(overviewDepth, 6.1, cameraClose) * distance,
      );
      camera.lookAt(focus.x, 0.42, focus.z + 0.48);
    },
  };
};
