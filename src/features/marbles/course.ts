import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShadowMaterial,
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
    ctx.fillStyle = "#f4f4f6";
    ctx.beginPath();
    ctx.arc(64, 64, 55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = isNumber ? "bold 74px sans-serif" : "bold 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isNumber ? "#17191e" : "#f4f4f6";
  ctx.fillText(label, canvas.width / 2, 67);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function buildCourse(scene: Scene, rapier: Rapier, world: InstanceType<Rapier["World"]>) {
  scene.fog = new Fog(new Color("#101116"), 30, 77);

  const surface = new MeshStandardMaterial({ color: "#303744", roughness: 0.86 });
  const guard = new MeshStandardMaterial({ color: "#28313e", roughness: 0.64 });
  const edge = new MeshStandardMaterial({ color: "#b9c4cd", roughness: 0.47, metalness: 0.27 });
  const beam = new MeshStandardMaterial({ color: "#59697d", roughness: 0.53, metalness: 0.22 });
  const support = new MeshStandardMaterial({ color: "#3c4857", roughness: 0.62, metalness: 0.17 });
  const markings = new MeshStandardMaterial({ color: "#8896a5", roughness: 0.85 });
  const bright = new MeshStandardMaterial({ color: "#e4e6e5", roughness: 0.67 });
  const obstacle = new MeshStandardMaterial({ color: "#cf6030", roughness: 0.37, metalness: 0.15 });
  const capAccent = new MeshStandardMaterial({ color: "#e69c66", roughness: 0.44, metalness: 0.1 });
  const vertical = new Vector3(0, 1, 0);
  const keyOffset = new Vector3(-9, 18, -8);
  const key = new DirectionalLight("#fff2ea", 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.intensity = 0.58;
  key.shadow.radius = 2;
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, far: 40 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.025;
  const fill = new DirectionalLight("#bdcaff", 1.55);
  fill.position.set(6, 5, 7);
  scene.add(new HemisphereLight("#e9eeff", "#8c7b83", 1.16), key, key.target, fill);

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

  const floor = new Mesh(new PlaneGeometry(125, 145), new ShadowMaterial({ opacity: 0.4 }));
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
      addBox(0.3, 0.12, length, edge, raised(x, z, 1.25), angle);
      addBox(0.14, 0.3, length, beam, raised(x + side * 0.115, z, 0.07), angle);
      addBox(0.055, 0.012, length, markings, raised(side * 3.94, z, 0.01), angle);
    }
    start = end;
  }

  const opening = track(3.85);
  addBox(8.25, 0.018, 0.12, bright, raised(0, 3.85, 0.008), opening.angle);
  addBox(8.5, 0.77, 0.22, guard, raised(0, 0.13, 0.36), opening.angle, true);
  addBox(8.45, 0.07, 0.045, edge, raised(0, 0.035, 0.68), opening.angle);
  const runoff = track(49.85);
  addBox(8.5, 1.1, 0.22, guard, raised(0, 49.85, 0.5), runoff.angle, true);

  for (let z = 5.1; z < finishGate.z; z += 3.8) {
    for (const side of [-1, 1]) {
      addBox(0.25, 0.015, 0.64, bright, raised(side * 3.72, z, 0.012), track(z).angle);
    }
  }
  const braceGeometry = new BoxGeometry(1, 1, 1);
  const braceAxis = new Vector3();
  for (const z of [1, 11, 23, 35, 47]) {
    const height = trackHeight(z) + 1.35;
    for (const side of [-1, 1]) {
      addBox(0.52, height, 0.68, support, new Vector3(side * 3.55, height / 2 - 1.7, z));
      addBox(1.12, 0.12, 1.22, beam, new Vector3(side * 3.55, -1.62, z));
    }
    addBox(8.7, 0.34, 0.74, support, raised(0, z, -0.6), track(z).angle);
    const brace = new Mesh(braceGeometry, support);
    braceAxis.set(6.7, height * 0.7, 0);
    brace.scale.set(0.28, braceAxis.length(), 0.32);
    brace.position.set(0, height / 2 - 1.7, z);
    brace.quaternion.setFromUnitVectors(vertical, braceAxis.normalize());
    brace.castShadow = brace.receiveShadow = true;
    scene.add(brace);
  }

  const bumperGeometry = new CylinderGeometry(0.57, 0.57, 0.62, 28);
  const capGeometry = new CylinderGeometry(0.52, 0.57, 0.17, 28);
  const insetGeometry = new CylinderGeometry(0.29, 0.29, 0.018, 28);
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
    const inset = new Mesh(insetGeometry, capAccent);
    inset.position.copy(raised(x, z, 0.748));
    inset.rotation.copy(bumper.rotation);
    scene.add(inset);
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
  const blade = new Mesh(new BoxGeometry(5.2, 0.32, 0.4), obstacle);
  const hub = new Mesh(new CylinderGeometry(0.4, 0.42, 0.65, 24), beam);
  const hubCap = new Mesh(insetGeometry, edge);
  hubCap.position.y = 0.33;
  blade.castShadow = hub.castShadow = true;
  blade.receiveShadow = hub.receiveShadow = true;
  spinner.add(blade, hub, hubCap);
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
  addBox(8.97, 0.07, 0.37, edge, new Vector3(0, signY + 0.3, finishGate.z));
  for (const side of [-1, 1]) {
    addBox(1.75, 0.085, 0.035, obstacle, new Vector3(side * 2.6, signY, finishGate.z - 0.17));
  }
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
