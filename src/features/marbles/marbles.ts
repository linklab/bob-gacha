import {
  Color,
  Group,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";

import type { CreateDrawScene } from "../../lib/draw";
import { buildCourse, createLabelTexture, finishGate, spinnerZ, trackHeight } from "./course";

const radius = 0.47;
const stripeHighlight = new Color("#fff2da");
const finishFloor = trackHeight(finishGate.z);
const finishCeiling = finishFloor + finishGate.height;
const spinnerSpeed = 1.85;

function launchPositions(count: number, random: () => number) {
  const rows = Math.ceil(count / 6);
  const columns = Math.ceil(count / rows);
  const positions = Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const rowWidth = Math.min(columns, count - row * columns);
    const z = 3.08 - row * 1.43;
    const x = ((index % columns) - (rowWidth - 1) / 2) * 1.17;
    return new Vector3(x, trackHeight(z) + radius + 0.025, z);
  });
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions;
}

export const createMarbleRaceScene: CreateDrawScene = ({
  camera,
  candidates,
  random,
  rapier,
  scene,
}) => {
  const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
  const { lightAt, positionSpinner, stepSpinner } = buildCourse(scene, rapier, world);
  let spinnerAngle = random() * Math.PI * 2;
  let angularSpeed = spinnerSpeed;
  let reversed = false;
  positionSpinner(spinnerAngle);

  const positions = launchPositions(candidates.length, random);
  const sphere = new SphereGeometry(radius, 28, 20);
  const stripe = new SphereGeometry(radius + 0.002, 28, 6, 0, Math.PI * 2, 1.3, 0.43);
  const racers = candidates.map((candidate, index) => {
    const position = positions[index];
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setCcdEnabled(true)
        .setLinearDamping(0.15)
        .setAngularDamping(0.045)
        .setCanSleep(false)
        .setEnabled(false)
        .setUserData(candidate),
    );
    world.createCollider(
      rapier.ColliderDesc.ball(radius).setDensity(1).setRestitution(0.25).setFriction(0.48),
      body,
    );
    const object = new Group();
    object.position.copy(position);
    const color = new Color(candidate.color);
    const marble = new Mesh(
      sphere,
      new MeshPhysicalMaterial({ color, roughness: 0.29, clearcoat: 1, clearcoatRoughness: 0.2 }),
    );
    const band = new Mesh(
      stripe,
      new MeshStandardMaterial({
        color: color.clone().lerp(stripeHighlight, 0.57),
        roughness: 0.28,
      }),
    );
    band.rotation.z = Math.PI / 5;
    marble.castShadow = true;
    marble.receiveShadow = true;
    object.add(marble, band);
    scene.add(object);
    const texture = createLabelTexture(String(candidate.id));
    const number = texture
      ? new Sprite(new SpriteMaterial({ map: texture, depthWrite: false }))
      : undefined;
    if (number) {
      number.scale.setScalar(0.64);
      number.center.set(0.5, 0);
      scene.add(number);
    }
    return { candidate, body, object, number, previousPosition: position.clone() };
  });

  let started = false;
  let finished = false;
  let lead = 0;
  let cameraZ = 5.1;
  let aspect = camera.aspect;
  const facing = new Vector3();

  function render() {
    const wide = MathUtils.smoothstep(aspect, 1.34, 1.9);
    const overview = wide * (1 - MathUtils.smoothstep(cameraZ, 5.6, 12.5));
    const finishApproach = MathUtils.smoothstep(cameraZ, finishGate.z - 18, finishGate.z - 4);
    const spinnerApproach =
      MathUtils.smoothstep(cameraZ, spinnerZ - 17, spinnerZ - 9) *
      (1 - MathUtils.smoothstep(cameraZ, spinnerZ - 3, spinnerZ + 9));
    const scale = Math.max(1.08, 1.32 / aspect);
    const followZ = MathUtils.lerp(
      cameraZ + 1.3 + spinnerApproach * 2.3,
      finishGate.z - 3.1,
      finishApproach,
    );
    const lookZ = MathUtils.lerp(followZ, finishGate.z * 0.39, overview);
    const lookY = trackHeight(lookZ) + MathUtils.lerp(0.32, -6.3, overview);
    camera.position.set(
      MathUtils.lerp((MathUtils.lerp(-8.1, -11, wide) - 3 * finishApproach) * scale, -40, overview),
      lookY + MathUtils.lerp((13.3 + spinnerApproach * 1.5) * scale, 50, overview),
      lookZ - MathUtils.lerp((13.7 - finishApproach * 2.7) * scale, 25, overview),
    );
    camera.lookAt(0, lookY, lookZ);
    lightAt(cameraZ);

    for (const { body, object, number } of racers) {
      object.position.copy(body.translation());
      object.quaternion.copy(body.rotation());
      if (number) {
        facing.subVectors(camera.position, object.position).setLength(radius + 0.055);
        number.position.copy(object.position).add(facing);
      }
    }
  }

  render();

  function canReverseSpinner() {
    return started && !finished && !reversed && lead < spinnerZ + 3;
  }

  return {
    world,
    canReverseSpinner,
    reverseSpinner() {
      if (!canReverseSpinner()) return false;
      reversed = true;
      return true;
    },
    start() {
      if (started) return;
      started = true;
      for (const { body } of racers) {
        body.setEnabled(true);
        body.setLinvel({ x: (random() - 0.5) * 0.8, y: 0, z: 1.45 + random() * 1.15 }, true);
      }
    },
    beforeStep(dt) {
      if (!started) return;
      angularSpeed = MathUtils.damp(angularSpeed, reversed ? -spinnerSpeed : spinnerSpeed, 23, dt);
      spinnerAngle += angularSpeed * dt;
      stepSpinner(spinnerAngle);
      for (const { body, previousPosition } of racers) previousPosition.copy(body.translation());
    },
    afterStep(dt) {
      if (!started) return;
      let furthest = 0;
      let earliest = Infinity;
      let winner;
      for (const { candidate, body, previousPosition } of racers) {
        const { x, y, z } = body.translation();
        furthest = Math.max(furthest, z);
        if (finished || previousPosition.z >= finishGate.z || z < finishGate.z) continue;
        const crossing = (finishGate.z - previousPosition.z) / (z - previousPosition.z);
        if (crossing >= earliest) continue;
        const crossingX = MathUtils.lerp(previousPosition.x, x, crossing);
        const crossingY = MathUtils.lerp(previousPosition.y, y, crossing);
        if (
          Math.abs(crossingX) > finishGate.halfWidth ||
          crossingY < finishFloor ||
          crossingY > finishCeiling
        )
          continue;
        earliest = crossing;
        winner = candidate;
      }
      lead = Math.max(lead, furthest);
      const target = Math.min(finishGate.z, Math.max(4, furthest));
      cameraZ += (target - cameraZ) * (1 - Math.exp(-3.25 * dt));
      if (winner) {
        finished = true;
        return { candidate: winner };
      }
    },
    render,
    resize(nextAspect) {
      aspect = nextAspect;
    },
  };
};
