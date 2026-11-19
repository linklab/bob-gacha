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
const railExitSpeed = 1.55;
const descentStart = 3.37;
const descentEnd = 2.81;
const pocketApproachSpeed = 3.16;
const descentDamping = 0.13;
const pocketDamping = 0.047;
const pocketMotionDuration = 5.05;
const settledSpeed = 0.24;
const descentRestitution = 0.41;
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
  const world = new rapier.World({ x: 0, y: -26, z: 0 });
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
    makeSurface(rotorProfile, 0.018)
      .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
      .setRestitution(0.15)
      .setRestitutionCombineRule(rapier.CoefficientCombineRule.Min),
    axle,
  );
  world.createCollider(makeSurface(crownProfile, 0.14).setRestitution(0.13), axle);

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
        .setFriction(0.02)
        .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
        .setRestitution(0.18)
        .setRestitutionCombineRule(rapier.CoefficientCombineRule.Min),
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
      .setLinearDamping(descentDamping)
      .setAngularDamping(0.065)
      .setAdditionalSolverIterations(4),
  );
  const ballCollider = world.createCollider(
    rapier.ColliderDesc.ball(ballRadius).setFriction(0.34).setRestitution(descentRestitution),
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
  let touchedPocket = false;
  let pocketMotion = 0;
  let rollingDirection = 1;
  let incomingVerticalSpeed = 0;
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

  function guideDescent() {
    const { x, z } = body.translation();
    const radius = Math.hypot(x, z);
    if (radius >= descentStart || radius < pocketInner - 2 * ballRadius) return;

    // Below the deflectors, the bank turns the ball inward without losing its tangential speed.
    const normalX = x / radius;
    const normalZ = z / radius;
    const velocity = body.linvel();
    const progress = 1 - MathUtils.smoothstep(radius, descentEnd, descentStart);
    const direction = Math.sign(railSpeed);
    const tangential = -normalZ * velocity.x + normalX * velocity.z;
    const minimum = radius * MathUtils.lerp(1.3, pocketApproachSpeed, progress);
    const tangentSpeed = direction * Math.max(tangential * direction, minimum);
    const radial = normalX * velocity.x + normalZ * velocity.z;
    const inward = radius > 2.38 ? Math.min(radial, -MathUtils.lerp(0.2, 1.75, progress)) : radial;
    body.setLinvel(
      {
        x: normalX * inward - normalZ * tangentSpeed,
        y: velocity.y,
        z: normalZ * inward + normalX * tangentSpeed,
      },
      true,
    );
  }

  function dampOuterRebound(dt: number) {
    const { x, z } = body.translation();
    const radius = Math.hypot(x, z);
    if (radius <= deflectorRadius) return;

    const velocity = body.linvel();
    const outwardSpeed = (x * velocity.x + z * velocity.z) / radius;
    if (outwardSpeed <= 0) return;

    // The outer bank absorbs an outward bounce without braking motion around the wheel.
    const resistance = 32 * MathUtils.smoothstep(radius, deflectorRadius, launchRadius);
    const radialLoss = (outwardSpeed * -Math.expm1(-resistance * dt)) / radius;
    body.setLinvel(
      { x: velocity.x - x * radialLoss, y: velocity.y, z: velocity.z - z * radialLoss },
      true,
    );
  }

  function stepPocketMotion(dt: number) {
    dampOuterRebound(dt);
    const { x, y, z } = body.translation();
    const radius = Math.hypot(x, z);
    if (radius === 0 || radius >= 3.4) return;

    const velocity = body.linvel();
    // Soften launches from the shoulders while preserving lateral deflections.
    const vertical = velocity.y > 1.85 ? MathUtils.damp(velocity.y, 1.85, 90, dt) : velocity.y;
    let tangentialGain = 0;
    if (
      pocketMotion < pocketMotionDuration &&
      radius > pocketInner - ballRadius &&
      radius < pocketOuter + ballRadius &&
      y < pocketFloor + pocketRise + ballRadius + 0.052
    ) {
      const tangent = (-z * velocity.x + x * velocity.z) / radius + rotorSpeed * radius;
      if (Math.abs(tangent) > 0.65) rollingDirection = Math.sign(tangent);
      const remaining = pocketMotionDuration - pocketMotion;
      const target = MathUtils.lerp(0.82, 1.68, MathUtils.smoothstep(remaining, 0, 0.5));
      // A little rolling assistance on the floor keeps slow balls crossing the low frets.
      tangentialGain =
        rollingDirection * MathUtils.clamp(target - tangent * rollingDirection, 0, 8 * dt);
    }
    if (vertical !== velocity.y || tangentialGain !== 0) {
      body.setLinvel(
        {
          x: velocity.x - (z / radius) * tangentialGain,
          y: vertical,
          z: velocity.z + (x / radius) * tangentialGain,
        },
        true,
      );
    }
  }

  function touchesPocketFloor(allowRestingGap = false) {
    let touching = false;
    const rebounded = incomingVerticalSpeed < 0 && body.linvel().y >= 0;
    world.contactPair(ballCollider, rotorFloor, (manifold, flipped) => {
      // The rotor collider also includes sloped walls beyond the pocket floor.
      for (let i = 0; i < manifold.numContacts() && !touching; i++) {
        const distance = manifold.contactDist(i);
        if (allowRestingGap && distance > 0.003) continue;
        const point = flipped ? manifold.localContactPoint1(i) : manifold.localContactPoint2(i);
        if (!point) continue;
        const radius = Math.hypot(point.x, point.z);
        if (radius <= pocketInner || radius >= pocketOuter) continue;
        const floorY =
          pocketFloor + (pocketRise * (radius - pocketInner)) / (pocketOuter - pocketInner);
        if (Math.abs(point.y - floorY) >= 0.01) continue;
        // CCD can resolve an impact after the manifold's distance was computed.
        touching =
          allowRestingGap ||
          manifold.contactImpulse(i) > 1e-6 ||
          (rebounded && localPosition.y - ballRadius <= floorY + 0.006);
      }
    });
    return touching;
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
          (Math.sign(spin) || 1) * MathUtils.lerp(0.84, 3.12, Math.min(Math.abs(spin), 1));
      }
      setWheelAngle();

      railAngle = spin === undefined ? random() * fullTurn : idleAngle;
      const power = spin === undefined ? 0.5 : Math.min(Math.abs(spin), 1);
      // Positive Rapier yaw turns x toward -z; positive railAngle turns toward +z.
      railSpeed = Math.sign(rotorSpeed) * (MathUtils.lerp(7.25, 8.9, power) + random() * 0.45);
      onRail = true;
      touchedPocket = false;
      pocketMotion = 0;
      rollingDirection = Math.sign(railSpeed);
      body.setLinearDamping(descentDamping);
      body.setAngularDamping(0.065);
      body.setGravityScale(1, true);
      ballCollider.setRestitution(descentRestitution);
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
      const brake = settledTime > 0.18 ? 3.4 : onRotor ? 0.12 : 0.055;
      rotorSpeed *= Math.exp(-brake * dt);
      axle.setNextKinematicRotation(rotation.setFromAxisAngle(up, rotorAngle));
      if (onRail) stepRail(dt);
      else if (touchedPocket) stepPocketMotion(dt);
      else guideDescent();
      incomingVerticalSpeed = body.linvel().y;
    },
    afterStep(dt) {
      if (!active) return undefined;

      const position = body.translation();
      inverseRotation.copy(axle.rotation()).invert();
      localPosition.copy(position).applyQuaternion(inverseRotation);
      const { x, y, z } = localPosition;
      const radius = Math.hypot(x, z);
      const rollingSpeed = Math.hypot(x - previousPosition.x, z - previousPosition.z) / dt;
      const relativeSpeed = localPosition.distanceTo(previousPosition) / dt;
      previousPosition.copy(localPosition);

      if (touchedPocket && radius < trackProfile[0][0] && rollingSpeed > settledSpeed) {
        pocketMotion += dt;
      }
      const mayTouchFloor =
        !touchedPocket && radius > pocketInner - ballRadius && radius < pocketOuter + ballRadius;
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
        pocketMotion >= pocketMotionDuration &&
        radius > pocketInner &&
        radius < pocketOuter &&
        y < pocketFloor + pocketRise + ballRadius + 0.024 &&
        distanceToDivider > ballRadius * 0.5 &&
        relativeSpeed < settledSpeed;

      const touchingFloor = (mayTouchFloor || withinPocket) && touchesPocketFloor(touchedPocket);
      if (!touchedPocket && touchingFloor) {
        touchedPocket = true;
        body.setLinearDamping(pocketDamping);
        body.setAngularDamping(0.02);
        body.setGravityScale(0.9, true);
        ballCollider.setRestitution(0.18);
      }

      const settling = withinPocket && touchingFloor;
      if (!settling || pocket !== settlingPocket) {
        settledTime = 0;
        settlingPocket = pocket;
      }

      if (!settling) return undefined;
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
