import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { Material, Scene } from "three";

import type { DrawSceneContext } from "../../lib/draw";

type Rapier = DrawSceneContext["rapier"];

const ramps = [
  { end: 11, grade: 0.25 },
  { end: 25, grade: 0.15 },
  { end: 50, grade: 0.21 },
];

const trackHalfWidth = 4.25;
const trackOpeningHeight = 10;
const lastRamp = ramps[ramps.length - 1];
export const finishGate = { z: 45, halfWidth: 4.225, height: 3.55 };

function track(z: number) {
  let start = 0;
  let height = trackOpeningHeight;
  for (const ramp of ramps) {
    if (z <= ramp.end || ramp === lastRamp) {
      return { height: height - (z - start) * ramp.grade, angle: Math.atan(ramp.grade) };
    }
    height -= (ramp.end - start) * ramp.grade;
    start = ramp.end;
  }
  throw new Error("Marble course is missing a ramp");
}

export function trackHeight(z: number) {
  return track(z).height;
}

export function createLabelTexture(label: string, isNumber = true) {
  if (typeof document === "undefined") return;
  const canvas = document.createElement("canvas");
  canvas.width = isNumber ? 128 : 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (isNumber) {
    ctx.fillStyle = "#fff5de";
    ctx.beginPath();
    ctx.arc(64, 64, 55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = isNumber ? "bold 74px sans-serif" : "bold 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isNumber ? "#192522" : "#fff5de";
  ctx.fillText(label, canvas.width / 2, 67);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function buildCourse(scene: Scene, rapier: Rapier, world: InstanceType<Rapier["World"]>) {
  const backdrop = new Color("#10211c");
  scene.background = backdrop;
  scene.fog = new Fog(backdrop, 37, 86);

  const surface = new MeshStandardMaterial({ color: "#354943", roughness: 0.82 });
  const guard = new MeshStandardMaterial({ color: "#172925", roughness: 0.55 });
  const edge = new MeshStandardMaterial({ color: "#b7ceaa", roughness: 0.54 });
  const support = new MeshStandardMaterial({ color: "#263633", roughness: 0.82 });
  const markings = new MeshStandardMaterial({ color: "#60786b", roughness: 0.79 });
  const bright = new MeshStandardMaterial({ color: "#fff0cf", roughness: 0.65 });
  const obstacle = new MeshStandardMaterial({ color: "#f39b64", roughness: 0.36 });
  const spinnerPaint = new MeshStandardMaterial({ color: "#e7ca66", roughness: 0.36 });
  const vertical = new Vector3(0, 1, 0);
  const keyOffset = new Vector3(-8, 15, -3);
  const key = new DirectionalLight("#fff0dd", 2.1);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, far: 36 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.025;
  const fill = new DirectionalLight("#a3e2c6", 0.85);
  fill.position.set(8, 4, 6);
  scene.add(new AmbientLight("#dbeadf", 1.1), key, key.target, fill);

  function addBox(
    width: number,
    height: number,
    length: number,
    material: Material,
    position: Vector3,
    angle = 0,
    collider = false,
  ) {
    const mesh = new Mesh(new BoxGeometry(width, height, length), material);
    mesh.position.copy(position);
    mesh.rotation.x = angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (collider) {
      world.createCollider(
        rapier.ColliderDesc.cuboid(width / 2, height / 2, length / 2)
          .setTranslation(position.x, position.y, position.z)
          .setRotation(mesh.quaternion)
          .setFriction(0.43)
          .setRestitution(0.17),
      );
    }
    return mesh;
  }

  function raised(x: number, z: number, height: number) {
    const { angle, height: y } = track(z);
    return new Vector3(x, y + height * Math.cos(angle), z + height * Math.sin(angle));
  }

  const floor = new Mesh(
    new PlaneGeometry(125, 145),
    new MeshStandardMaterial({ color: "#142722", roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -1.7, 23);
  floor.receiveShadow = true;
  scene.add(floor);

  let start = 0;
  for (const { end } of ramps) {
    const z = (start + end) / 2;
    const { angle } = track(z);
    const length = (end - start) / Math.cos(angle) + 0.075;
    addBox(trackHalfWidth * 2, 0.48, length, surface, raised(0, z, -0.24), angle, true);
    for (const side of [-1, 1]) {
      const x = side * (trackHalfWidth + 0.02);
      addBox(0.24, 1.3, length + 0.1, guard, raised(x, z, 0.58), angle, true);
      addBox(0.26, 0.055, length, edge, raised(x, z, 1.25), angle);
    }
    start = end;
  }

  const opening = track(3.85);
  addBox(8.25, 0.018, 0.12, bright, raised(0, 3.85, 0.008), opening.angle);
  addBox(8.5, 0.77, 0.22, guard, raised(0, 0.13, 0.36), opening.angle, true);
  const runoff = track(49.85);
  addBox(8.5, 1.1, 0.22, guard, raised(0, 49.85, 0.5), runoff.angle, true);

  for (let z = 4; z < finishGate.z; z += 3.8) {
    for (const side of [-1, 1]) {
      addBox(0.3, 0.015, 0.8, markings, raised(side * 3.83, z, 0.012), track(z).angle);
    }
  }
  for (const z of [1, 11, 23, 35, 47]) {
    const height = trackHeight(z) + 1.35;
    for (const side of [-1, 1]) {
      addBox(0.52, height, 0.68, support, new Vector3(side * 3.55, height / 2 - 1.7, z));
    }
    addBox(8.7, 0.34, 0.74, support, raised(0, z, -0.6), track(z).angle);
  }

  const bumperGeometry = new CylinderGeometry(0.57, 0.57, 0.62, 28);
  const capGeometry = new CylinderGeometry(0.52, 0.57, 0.17, 28);
  // Leave room for two marbles to pass between a bumper and either rail.
  for (const [x, z] of [
    [-1.45, 8],
    [1.55, 11.9],
    [-0.15, 15.3],
    [-1.5, 18.7],
    [1.55, 20.2],
    [-0.65, 29.1],
    [1.45, 32.4],
    [-1.55, 34.1],
    [0.6, 37.7],
  ]) {
    const bumper = new Mesh(bumperGeometry, guard);
    bumper.position.copy(raised(x, z, 0.27));
    bumper.rotation.x = track(z).angle;
    bumper.castShadow = true;
    bumper.receiveShadow = true;
    scene.add(bumper);

    const cap = new Mesh(capGeometry, obstacle);
    cap.position.copy(raised(x, z, 0.66));
    cap.rotation.copy(bumper.rotation);
    cap.castShadow = true;
    scene.add(cap);
    const position = raised(x, z, 0.34);
    world.createCollider(
      rapier.ColliderDesc.cylinder(0.42, 0.57)
        .setTranslation(position.x, position.y, position.z)
        .setRotation(bumper.quaternion)
        .setRestitution(0.29)
        .setFriction(0.25),
    );
  }

  const spinner = new Group();
  spinner.position.copy(raised(0, 24, 0.46));
  scene.add(spinner);
  const blade = new Mesh(new BoxGeometry(5.2, 0.32, 0.4), spinnerPaint);
  const hub = new Mesh(new CylinderGeometry(0.4, 0.42, 0.65, 24), guard);
  blade.castShadow = hub.castShadow = true;
  blade.receiveShadow = hub.receiveShadow = true;
  spinner.add(blade, hub);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const stripe = new Mesh(new BoxGeometry(0.14, 0.019, 0.402), guard);
      stripe.position.set(side * (1.9 + i * 0.25), 0.161, 0);
      spinner.add(stripe);
    }
  }
  const spinnerBase = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), track(24).angle);
  const spinnerSpin = new Quaternion();
  const spinBody = world.createRigidBody(
    rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spinner.position.x,
      spinner.position.y,
      spinner.position.z,
    ),
  );
  world.createCollider(
    rapier.ColliderDesc.cuboid(2.6, 0.16, 0.2).setRestitution(0.24).setFriction(0.35),
    spinBody,
  );
  world.createCollider(rapier.ColliderDesc.cylinder(0.325, 0.4), spinBody);

  const finish = track(finishGate.z);
  const finishLine = new Group();
  finishLine.name = "Finish line";
  finishLine.position.set(0, finish.height, finishGate.z);
  finishLine.rotation.x = finish.angle;
  scene.add(finishLine);
  const checkerGeometry = new BoxGeometry(8.25 / 14, 0.019, 0.31);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 14; col++) {
      const tile = new Mesh(checkerGeometry, (row + col) % 2 === 0 ? bright : guard);
      tile.position.set(((col + 0.5) / 14 - 0.5) * 8.25, 0.015, (row - 0.5) * 0.31);
      tile.receiveShadow = true;
      finishLine.add(tile);
    }
  }
  const postWidth = 0.27;
  const postX = finishGate.halfWidth + postWidth / 2;
  const signHeight = 0.64;
  const signY = finish.height + finishGate.height + signHeight / 2;
  for (const side of [-1, 1]) {
    addBox(
      postWidth,
      3.9,
      0.29,
      edge,
      new Vector3(side * postX, finish.height + 1.95, finishGate.z),
    );
  }
  addBox(8.97, signHeight, 0.33, guard, new Vector3(0, signY, finishGate.z));
  const sign = createLabelTexture("결승", false);
  if (sign) {
    const label = new Mesh(
      new PlaneGeometry(2.06, 0.52),
      new MeshBasicMaterial({ map: sign, transparent: true, depthWrite: false }),
    );
    label.position.set(0, signY, finishGate.z - 0.169);
    label.rotation.y = Math.PI;
    scene.add(label);
  }

  function aimSpinner(phase: number) {
    spinnerSpin.setFromAxisAngle(vertical, phase);
    spinner.quaternion.copy(spinnerBase).multiply(spinnerSpin);
    return spinner.quaternion;
  }

  return {
    positionSpinner(phase: number) {
      spinBody.setRotation(aimSpinner(phase), true);
    },
    stepSpinner(phase: number) {
      spinBody.setNextKinematicRotation(aimSpinner(phase));
    },
    lightAt(z: number) {
      key.target.position.set(0, trackHeight(z), z);
      key.position.copy(key.target.position).add(keyOffset);
    },
  };
}
