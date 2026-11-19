import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
} from "three";
import type { Scene } from "three";

export const pocketNumbers = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;
export const fullTurn = Math.PI * 2;
export const pocketAngle = fullTurn / pocketNumbers.length;

export const ballRadius = 0.12;
export const pocketInner = 1.91;
export const pocketOuter = 2.66;
export const pocketFloor = 0.218;
export const pocketRise = 0.065;
export const trackProfile = [
  [3.15, 0.605],
  [3.37, 0.705],
  [3.67, 0.865],
  [3.83, 0.955],
  [4.11, 1.011],
  [4.132, 1.046],
  [4.138, 1.498],
] as const;
export const rotorProfile = [
  [1.71, 0.541],
  [1.829, 0.463],
  [pocketInner, pocketFloor],
  [pocketOuter, pocketFloor + pocketRise],
  [2.722, 0.426],
  [3.145, 0.606],
] as const;

const brass = "#c39a57";
const ivory = "#f5ead7";
const tileColors = ["#287455", "#a73930", "#212624"];
const pocketCenter = (pocketInner + pocketOuter) / 2;

type Profile = readonly (readonly [number, number])[];

export function radialSurface(profile: Profile, from = 0, to = fullTurn, segments = 192) {
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const fraction = i / segments;
    const angle = i === segments && to - from === fullTurn ? from : from + (to - from) * fraction;
    for (let row = 0; row < profile.length; row++) {
      const [radius, height] = profile[row];
      positions.push(radius * Math.cos(angle), height, radius * Math.sin(angle));
      uvs.push(1 - fraction, 1 - row / (profile.length - 1));

      if (i < segments && row + 1 < profile.length) {
        const vertex = i * profile.length + row;
        const next = vertex + profile.length;
        indices.push(vertex, next, vertex + 1, next, next + 1, vertex + 1);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ridgeGeometry(
  inner: number,
  outer: number,
  innerHeight: number,
  outerHeight: number,
  width: number,
  height: number,
) {
  const halfWidth = width / 2;
  const base = 0.012;
  const positions = [
    inner,
    innerHeight - base,
    -halfWidth,
    inner,
    innerHeight - base,
    halfWidth,
    inner,
    innerHeight + height,
    0,
    outer,
    outerHeight - base,
    -halfWidth,
    outer,
    outerHeight - base,
    halfWidth,
    outer,
    outerHeight + height,
    0,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 3, 5, 4, 0, 2, 5, 0, 5, 3, 2, 1, 4, 2, 4, 5, 1, 0, 3, 1, 3, 4]);
  const faceted = geometry.toNonIndexed();
  geometry.dispose();
  faceted.computeVertexNormals();
  return faceted;
}

export const dividerGeometry = () =>
  ridgeGeometry(pocketInner, pocketOuter, pocketFloor, pocketFloor + pocketRise, 0.053, 0.128);
export const deflectorGeometry = () => ridgeGeometry(-0.15, 0.15, 0.738, 0.894, 0.19, 0.04);
export const deflectorAngles = Array.from({ length: 8 }, (_, i) => (fullTurn * (i + 0.5)) / 8);
export const deflectorRadius = 3.58;

function material(color: string, roughness: number, metalness = 0) {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function addMesh(parent: Group | Scene, geometry: BufferGeometry, surface: MeshStandardMaterial) {
  const mesh = new Mesh(geometry, surface);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addRing(parent: Group, profile: Profile, surface: MeshStandardMaterial) {
  return addMesh(parent, radialSurface(profile), surface);
}

function makeNumberAtlas() {
  if (typeof document === "undefined") return undefined;

  const canvas = document.createElement("canvas");
  const cell = 64;
  canvas.width = cell * pocketNumbers.length;
  canvas.height = cell;
  const canvasContext = canvas.getContext("2d");
  if (!canvasContext) return undefined;

  canvasContext.font = "700 50px Arial, sans-serif";
  canvasContext.textAlign = "center";
  canvasContext.textBaseline = "middle";
  canvasContext.fillStyle = ivory;
  pocketNumbers.forEach((number, index) => {
    canvasContext.fillText(String(number), (index + 0.5) * cell, cell * 0.52);
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function addPocket(
  parent: Group,
  index: number,
  surface: MeshStandardMaterial,
  labelSurface: MeshBasicMaterial | undefined,
  floorGeometry: BufferGeometry,
  tileGeometry: BufferGeometry,
) {
  const angle = index * pocketAngle;
  const pocket = new Group();
  pocket.name = `roulette-pocket-${pocketNumbers[index]}`;
  pocket.position.set(pocketCenter * Math.cos(angle), 0, pocketCenter * Math.sin(angle));
  pocket.rotation.y = -angle;
  parent.add(pocket);

  addMesh(pocket, floorGeometry, surface).position.x = -pocketCenter;
  const tile = addMesh(pocket, tileGeometry, surface);
  tile.position.x = -pocketCenter;

  if (labelSurface) {
    const labelGeometry = radialSurface(
      [
        [2.746, 0.459],
        [3.113, 0.615],
      ],
      -pocketAngle * 0.477,
      pocketAngle * 0.477,
      6,
    );
    const uv = labelGeometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      uv.setX(i, (index + uv.getX(i)) / pocketNumbers.length);
    }
    const label = new Mesh(labelGeometry, labelSurface);
    label.position.x = -pocketCenter;
    pocket.add(label);
  }

  return tile;
}

export function createWheel(scene: Scene) {
  const room = new HemisphereLight("#fff4dd", "#625851", 1.5);
  scene.add(room);

  const key = new DirectionalLight("#fff0dc", 2.75);
  key.position.set(-3.5, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -5.5;
  key.shadow.camera.right = key.shadow.camera.top = 5.5;
  key.shadow.camera.far = 25;
  key.shadow.normalBias = 0.017;
  key.shadow.bias = -0.00015;
  scene.add(key);

  const fill = new DirectionalLight("#cef0e1", 1.1);
  fill.position.set(4, 6, -7);
  scene.add(fill);

  const stationary = new Group();
  scene.add(stationary);
  const rotor = new Group();
  rotor.name = "roulette-rotor";
  scene.add(rotor);

  const wood = material("#4d2520", 0.36);
  const woodEdge = material("#713b2a", 0.45);
  const brassMetal = material(brass, 0.3, 0.36);
  const bronze = material("#755939", 0.39, 0.28);
  const paleBrass = material("#dfb77a", 0.34, 0.28);
  const bank = material("#765335", 0.43, 0.22);
  const darkBand = material("#191e1a", 0.6, 0.07);

  addRing(
    stationary,
    [
      [4.199, 1.488],
      [4.278, 1.485],
      [4.358, 1.457],
      [4.419, 1.392],
      [4.443, 1.295],
      [4.429, 0.33],
      [4.463, 0.245],
      [4.462, 0.112],
      [4.414, 0.033],
    ],
    wood,
  );

  addRing(
    stationary,
    [
      [4.431, 0.342],
      [4.471, 0.28],
      [4.476, 0.237],
      [4.464, 0.214],
    ],
    woodEdge,
  );

  addRing(
    stationary,
    [
      [4.44, 1.32],
      [4.453, 1.3],
      [4.453, 1.267],
      [4.444, 1.251],
    ],
    bronze,
  );

  addRing(
    stationary,
    [
      [4.135, 1.443],
      [4.139, 1.496],
      [4.16, 1.512],
      [4.211, 1.51],
      [4.232, 1.492],
      [4.234, 1.474],
    ],
    brassMetal,
  );

  addRing(
    stationary,
    [
      [4.286, 1.485],
      [4.308, 1.483],
      [4.329, 1.476],
    ],
    bronze,
  );

  addRing(stationary, trackProfile, bank);
  addRing(
    stationary,
    [
      [3.152, 0.609],
      [3.173, 0.619],
      [3.212, 0.64],
      [3.225, 0.64],
    ],
    paleBrass,
  );

  const deflector = deflectorGeometry();
  for (const angle of deflectorAngles) {
    const stud = addMesh(stationary, deflector, paleBrass);
    stud.position.set(deflectorRadius * Math.cos(angle), 0, deflectorRadius * Math.sin(angle));
    stud.rotation.y = -angle;
    stud.castShadow = true;
  }

  addRing(rotor, rotorProfile, darkBand);

  const pocketMaterials = tileColors.map((color) => material(color, 0.72));
  const atlas = makeNumberAtlas();
  const labelSurface = atlas
    ? new MeshBasicMaterial({
        map: atlas,
        transparent: true,
        alphaTest: 0.1,
        depthWrite: false,
        toneMapped: false,
      })
    : undefined;
  const floorGeometry = radialSurface(
    [
      [pocketInner, pocketFloor + 0.006],
      [pocketOuter, pocketFloor + pocketRise + 0.006],
    ],
    -pocketAngle * 0.5,
    pocketAngle * 0.5,
    6,
  );
  const tileGeometry = radialSurface(
    [
      [2.704, 0.394],
      [2.722, 0.434],
      [3.145, 0.614],
    ],
    -pocketAngle * 0.484,
    pocketAngle * 0.484,
    6,
  );
  const divider = dividerGeometry();
  const tiles = pocketNumbers.map((_, index) => {
    const surface = pocketMaterials[index === 0 ? 0 : 1 + ((index - 1) % 2)];
    const tile = addPocket(rotor, index, surface, labelSurface, floorGeometry, tileGeometry);
    const fret = addMesh(rotor, divider, paleBrass);
    fret.rotation.y = -(index + 0.5) * pocketAngle;
    fret.castShadow = true;
    return tile;
  });

  addRing(
    rotor,
    [
      [1.731, 0.534],
      [1.778, 0.523],
      [1.815, 0.486],
      [1.858, 0.411],
    ],
    brassMetal,
  );

  addRing(
    rotor,
    [
      [0.001, 0.94],
      [0.385, 0.938],
      [0.781, 0.864],
      [1.594, 0.626],
      [1.689, 0.585],
      [1.731, 0.541],
    ],
    woodEdge,
  );

  addRing(
    rotor,
    [
      [1.555, 0.643],
      [1.582, 0.636],
      [1.612, 0.625],
    ],
    bronze,
  );

  addRing(
    rotor,
    [
      [0.001, 1.663],
      [0.118, 1.656],
      [0.18, 1.605],
      [0.193, 1.532],
      [0.164, 1.475],
      [0.113, 1.446],
      [0.094, 1.24],
      [0.158, 1.183],
      [0.22, 1.15],
      [0.235, 1.023],
      [0.288, 0.969],
      [0.486, 0.937],
      [0.505, 0.917],
    ],
    brassMetal,
  );

  for (let index = 0; index < 4; index++) {
    const angle = (index * fullTurn) / 4;
    const finial = addMesh(rotor, new SphereGeometry(0.119, 14, 9), brassMetal);
    const arm = addMesh(rotor, new SphereGeometry(1, 14, 9), brassMetal);
    arm.scale.set(0.235, 0.042, 0.041);
    arm.rotation.y = -angle;
    arm.position.set(0.28 * Math.cos(angle), 1.34, 0.28 * Math.sin(angle));
    finial.position.set(0.515 * Math.cos(angle), 1.34, 0.515 * Math.sin(angle));
    finial.castShadow = arm.castShadow = true;
  }

  const ball = addMesh(scene, new SphereGeometry(ballRadius, 32, 20), material(ivory, 0.21));
  ball.name = "roulette-ball";
  ball.castShadow = true;

  function highlightPocket(index: number) {
    const tile = tiles[index];
    const highlight = tile.material.clone();
    highlight.emissive = new Color("#c67c39");
    highlight.emissiveIntensity = 0.46;
    tile.material = highlight;
  }

  return { rotor, ball, highlightPocket };
}
