import { MathUtils, Quaternion, Vector3 } from "three";
import type { BufferGeometry } from "three";
import type { Candidate, CreateDrawScene, DrawImpact } from "../../lib/draw";
import {
  ballRadius,
  createWheel,
  crownProfile,
  deflectorAngles,
  deflectorGeometry,
  deflectorRadius,
  fullTurn,
  pocketFloor,
  pocketInner,
  pocketOuter,
  pocketRise,
  radialSurface,
  rotorGeometry,
  trackProfile,
} from "./wheel";

const launchRadius = 4.01;
const launchHeight = 1.113;
const railDrag = 0.225;
const railExitSpeed = 1.65;
const descentStart = 3.31;
const descentEnd = 2.89;
const pocketApproachSpeed = 3.15;
const descentDamping = 0.09;
const pocketDamping = 0.037;
const pocketMotionDuration = 5.05;
const settledSpeed = 0.24;
const closeUpDelay = 0.24;
const descentRestitution = 0.41;
const up = new Vector3(0, 1, 0);

function createPocketLayout(candidates: readonly Candidate[], random: () => number): Candidate[] {
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const index = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[index]] = [shuffled[index], shuffled[i]];
  }

  // Use complete cycles so each candidate gets the same number of pockets.
  const cycles = Math.round(37 / shuffled.length);
  return Array.from(
    { length: cycles * shuffled.length },
    (_, index) => shuffled[index % shuffled.length],
  );
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
  sound,
}) => {
  const pockets = createPocketLayout(candidates, random);
  const pocketCount = pockets.length;
  const pocketAngle = fullTurn / pocketCount;
  const { ball, rotor, highlightPocket } = createWheel(scene, pockets);
  const world = new rapier.World({ x: 0, y: -36, z: 0 });
  const axle = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased());
  const rotation = new Quaternion();
  const inverseRotation = new Quaternion();

  function makeSurface(geometry: BufferGeometry, friction: number) {
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

  const bank = world.createCollider(
    makeSurface(radialSurface(trackProfile), 0.003)
      .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
      .setRestitution(0)
      .setRestitutionCombineRule(rapier.CoefficientCombineRule.Min),
  );
  const rotorFloor = world.createCollider(
    makeSurface(rotorGeometry(pocketCount), 0.005)
      .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
      .setRestitution(0.07)
      .setRestitutionCombineRule(rapier.CoefficientCombineRule.Min),
    axle,
  );
  const crown = world.createCollider(
    makeSurface(radialSurface(crownProfile), 0.05)
      .setRestitution(0.07)
      .setRestitutionCombineRule(rapier.CoefficientCombineRule.Min),
    axle,
  );

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
        .setRestitution(0.16),
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

  let active = false;
  let rotorAngle = 0;
  let rotorSpeed = 0;
  let onRail = false;
  let railAngle = idleAngle;
  let railSpeed = 0;
  let touchedPocket = false;
  let pocketMotion = 0;
  let lastSoundPocket: number | undefined;
  let incomingVerticalSpeed = 0;
  let onRotor = false;
  let settlingPocket = -1;
  let settledTime = 0;
  let railView = 0;
  let cameraClose = 0;
  let finalCloseUp = false;
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
    const position = body.translation();
    const { x, y, z } = position;
    const radius = Math.hypot(x, z);
    if (radius >= descentStart || radius < pocketInner - 2 * ballRadius) return;

    // The last CCD manifold may still report contact after the ball has left the bank.
    const support = world.projectPoint(position, false, undefined, undefined, ballCollider);
    if (!support || support.point.y >= y) return;
    const gap = Math.hypot(x - support.point.x, y - support.point.y, z - support.point.z);
    if (gap > ballRadius + 0.0005) return;

    // The bank guides the ball inward while it has a surface to push against.
    const normalX = x / radius;
    const normalZ = z / radius;
    const velocity = body.linvel();
    const progress = 1 - MathUtils.smoothstep(radius, descentEnd, descentStart);
    const direction = Math.sign(railSpeed);
    const tangential = -normalZ * velocity.x + normalX * velocity.z;
    const minimum = radius * MathUtils.lerp(1.3, pocketApproachSpeed, progress);
    const tangentSpeed = direction * Math.max(tangential * direction, minimum);
    const radial = normalX * velocity.x + normalZ * velocity.z;
    const inward = radius > 2.38 ? Math.min(radial, -MathUtils.lerp(0.2, 6.8, progress)) : radial;
    body.setLinvel(
      {
        x: normalX * inward - normalZ * tangentSpeed,
        y: velocity.y,
        z: normalZ * inward + normalX * tangentSpeed,
      },
      true,
    );
  }

  function touchesPocketFloor(allowRestingGap = false) {
    let touching = false;
    const slowedFall = incomingVerticalSpeed < 0 && body.linvel().y - incomingVerticalSpeed > 0.04;
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
        if (Math.abs(point.y - floorY) >= 0.004) continue;
        // CCD can resolve an impact after the manifold's distance was computed.
        touching =
          allowRestingGap ||
          manifold.contactImpulse(i) > 1e-6 ||
          (slowedFall && localPosition.y - ballRadius <= floorY + 0.006);
      }
    });
    return touching;
  }

  function observeSound(
    rollingSpeed: number,
    radius: number,
    pocket: number,
    pan: number,
    firstPocketTouch: boolean,
  ) {
    if (!sound?.audible()) {
      lastSoundPocket = undefined;
      return;
    }
    if (onRail) {
      sound.roll(Math.abs(railSpeed) * launchRadius, pan, true);
      return;
    }

    const velocity = body.linvel();
    const mass = body.mass();
    const rebound = incomingVerticalSpeed < -0.35 ? velocity.y - incomingVerticalSpeed : 0;
    let supported = false;
    let onMovingSurface = false;
    let onPocketFloor = false;
    let strongest = 0.49;
    let impact: DrawImpact | undefined;
    world.contactPairsWith(ballCollider, (surface) => {
      const onBank = surface.handle === bank.handle;
      const onFloor = surface.handle === rotorFloor.handle;
      const onCrown = surface.handle === crown.handle;
      const kind = onCrown ? "cone" : onFloor || onBank ? "bowl" : "bumper";
      world.contactPair(ballCollider, surface, (manifold, flipped) => {
        for (let i = 0; i < manifold.numContacts(); i++) {
          const close = manifold.contactDist(i) <= 0.004;
          supported ||= close && (onBank || onFloor || onCrown);
          onMovingSurface ||= close && (onFloor || onCrown);
          onPocketFloor ||= close && onFloor;
          const kick = Math.max(
            manifold.contactImpulse(i) / mass,
            close && (onFloor || onBank) ? rebound : 0,
          );
          if (kick <= strongest) continue;
          strongest = kick;
          impact = kind;
          if (!onFloor) continue;
          const point = flipped ? manifold.localContactPoint1(i) : manifold.localContactPoint2(i);
          if (!point) continue;
          const contactRadius = Math.hypot(point.x, point.z);
          if (contactRadius <= pocketInner || contactRadius >= pocketOuter) continue;
          const base =
            pocketFloor +
            (pocketRise * (contactRadius - pocketInner)) / (pocketOuter - pocketInner);
          if (point.y > base + 0.004) impact = "fret";
        }
      });
    });
    const speed = onMovingSurface ? rollingSpeed : Math.hypot(velocity.x, velocity.z);
    sound.roll(supported ? speed : 0, pan, radius > trackProfile[0][0]);
    const inPockets = radius > pocketInner && radius < pocketOuter;
    const crossedFret =
      inPockets &&
      onPocketFloor &&
      lastSoundPocket !== undefined &&
      lastSoundPocket !== pocket &&
      rollingSpeed > 0.55;
    lastSoundPocket = inPockets ? pocket : undefined;
    if (!firstPocketTouch && crossedFret && impact !== "fret") {
      sound.impact("fret", MathUtils.clamp(rollingSpeed / 14, 0.06, 0.56), pan);
    } else if (impact || firstPocketTouch) {
      const kick = Math.max(strongest - 0.34, firstPocketTouch ? 0.7 : 0);
      sound.impact(impact ?? "bowl", 1 - Math.exp(-kick * 0.62), pan);
    }
  }

  return {
    world,
    resize(nextAspect) {
      aspect = nextAspect;
    },
    turnWheel(delta) {
      if (active) return;
      rotorAngle += delta;
      setWheelAngle();
    },
    start(spin) {
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
      lastSoundPocket = undefined;
      body.setLinearDamping(descentDamping);
      body.setAngularDamping(0.065);
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
      finalCloseUp = false;
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
      const brake = settledTime > 0.18 ? 3.4 : onRotor ? 0.145 : 0.055;
      rotorSpeed *= Math.exp(-brake * dt);
      axle.setNextKinematicRotation(rotation.setFromAxisAngle(up, rotorAngle));
      if (onRail) stepRail(dt);
      else if (!touchedPocket) guideDescent();
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
      const sector = Math.atan2(z, x) / pocketAngle;
      const nearestPocket = Math.round(sector);
      const pocket = MathUtils.euclideanModulo(nearestPocket, pocketCount);
      const distanceToDivider = (0.5 - Math.abs(sector - nearestPocket)) * pocketAngle * radius;

      const withinPocket =
        pocketMotion >= pocketMotionDuration &&
        radius > pocketInner - 0.025 &&
        radius < pocketOuter + 0.025 &&
        y < pocketFloor + pocketRise + ballRadius + 0.024 &&
        distanceToDivider > 0.025 &&
        relativeSpeed < settledSpeed;

      const touchingFloor = (mayTouchFloor || withinPocket) && touchesPocketFloor(touchedPocket);
      const firstPocketTouch = !touchedPocket && touchingFloor;
      if (firstPocketTouch) {
        touchedPocket = true;
        body.setLinearDamping(pocketDamping);
        body.setAngularDamping(0.019);
        ballCollider.setRestitution(0.18);
      }

      observeSound(rollingSpeed, radius, pocket, position.x / launchRadius, firstPocketTouch);
      const settling = withinPocket && touchingFloor;
      if (!settling || pocket !== settlingPocket) {
        settledTime = 0;
        settlingPocket = pocket;
      }
      if (settling) settledTime += dt;

      // Keep the final shot through brief interruptions in the settling check.
      finalCloseUp ||= settledTime >= closeUpDelay;
      const runningDownBank = 1 - MathUtils.smoothstep(radius, 3.12, 3.98);
      const viewTarget = onRotor ? (finalCloseUp ? 1 : 0.8) : runningDownBank * 0.65;
      railView = MathUtils.damp(railView, onRail ? 1 : 0, 5.4, dt);
      cameraClose = MathUtils.damp(cameraClose, viewTarget, 3.6, dt);
      const focusBlend = 1 - Math.exp(-3.2 * dt);
      focus.x += (position.x * cameraClose * 0.56 - focus.x) * focusBlend;
      focus.z += (position.z * cameraClose * 0.56 - focus.z) * focusBlend;

      if (settledTime < 0.68 || Math.abs(rotorSpeed) > 0.13) return undefined;

      active = false;
      highlightPocket(pocket);
      return { candidate: pockets[pocket], pocketIndex: pocket };
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
