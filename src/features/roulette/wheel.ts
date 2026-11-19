import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShadowMaterial,
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
export const pocketFloor = 0.367;
export const pocketRise = 0.019;
export const trackProfile = [
  [3.15, 0.484],
  [3.27, 0.542],
  [3.39, 0.614],
  [3.51, 0.701],
  [3.65, 0.806],
  [3.78, 0.898],
  [3.9, 0.97],
  [4.025, 1.007],
  [4.11, 1.011],
  [4.132, 1.046],
  [4.138, 1.498],
] as const;
const numberBank = [
  [pocketOuter, pocketFloor + pocketRise],
  [2.79, 0.402],
  [2.89, 0.414],
  [3.0, 0.434],
  [3.075, 0.455],
  trackProfile[0],
] as const;
const pocketProfile = [
  [pocketInner, pocketFloor],
  [pocketInner + 0.13, pocketFloor + (0.13 * pocketRise) / (pocketOuter - pocketInner)],
  [
    pocketOuter - 0.13,
    pocketFloor + pocketRise - (0.13 * pocketRise) / (pocketOuter - pocketInner),
  ],
] as const;
const crownFoot = [1.6, 0.41] as const;
const rotorProfile = [
  crownFoot,
  [1.7, 0.392],
  [1.78, 0.381],
  [1.855, 0.376],
  ...pocketProfile,
  ...numberBank,
] as const;
export const crownProfile = [
  [0.001, 0.62],
  [0.34, 0.611],
  [0.56, 0.585],
  [0.81, 0.538],
  [1.05, 0.486],
  [1.27, 0.448],
  [1.48, 0.427],
  crownFoot,
] as const;

const ivory = "#fff6e7";
const tileColors = ["#147257", "#9e2c42", "#171a21"];
const pocketCenter = (pocketInner + pocketOuter) / 2;

type Profile = readonly (readonly [number, number])[];

function fretLift(radius: number, angle: number) {
  if (radius <= pocketInner - 0.09 || radius >= pocketOuter + 0.12) return 0;
  const edgeDistance =
    Math.abs(MathUtils.euclideanModulo(angle, pocketAngle) - pocketAngle * 0.5) * radius;
  const innerShoulder = MathUtils.smoothstep(radius, pocketInner - 0.09, pocketInner + 0.08);
  const outerShoulder = 1 - MathUtils.smoothstep(radius, pocketOuter - 0.08, pocketOuter + 0.12);
  return 0.016 * (1 - MathUtils.smoothstep(edgeDistance, 0, 0.128)) * innerShoulder * outerShoulder;
}

export function radialSurface(
  profile: Profile,
  from = 0,
  to = fullTurn,
  segments = 192,
  lift?: (radius: number, angle: number) => number,
) {
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const fraction = i / segments;
    const angle = i === segments && to - from === fullTurn ? from : from + (to - from) * fraction;
    for (let row = 0; row < profile.length; row++) {
      const [radius, height] = profile[row];
      positions.push(
        radius * Math.cos(angle),
        height + (lift?.(radius, angle) ?? 0),
        radius * Math.sin(angle),
      );
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

// A single surface lets the ball pass from the floor onto a fret without overlapping contacts.
const rotorSegments = 16 * pocketNumbers.length;
export const rotorGeometry = () =>
  radialSurface(rotorProfile, 0, fullTurn, rotorSegments, fretLift);

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

export const deflectorGeometry = () => ridgeGeometry(-0.15, 0.15, 0.643, 0.859, 0.29, 0.038);
const deflectorCount = 12;
export const deflectorAngles = Array.from(
  { length: deflectorCount },
  (_, i) => (fullTurn * (i + 0.5)) / deflectorCount,
);
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

function makeWoodGrain() {
  if (typeof document === "undefined") return undefined;

  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) return undefined;

  const grain = context.createImageData(canvas.width, canvas.height);
  for (let x = 0; x < canvas.width; x++) {
    const angle = (x / canvas.width) * fullTurn;
    const curve = Math.sin(angle * 3) * 4 + Math.sin(angle * 9) * 1.8;
    for (let y = 0; y < canvas.height; y++) {
      const row = y + curve;
      const shade =
        Math.sin(row * 0.55) * 3.6 +
        Math.sin(row * 1.62 + angle * 25) * 1.6 +
        Math.sin(row * 0.11) * 3;
      const pixel = (y * canvas.width + x) * 4;
      grain.data[pixel] = 83 + shade;
      grain.data[pixel + 1] = 44 + shade;
      grain.data[pixel + 2] = 50 + shade;
      grain.data[pixel + 3] = 255;
    }
  }
  context.putImageData(grain, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeStudioReflection() {
  if (typeof document === "undefined") return undefined;

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return undefined;

  const ambient = context.createLinearGradient(0, 0, 0, canvas.height);
  ambient.addColorStop(0, "#6f727e");
  ambient.addColorStop(0.46, "#353744");
  ambient.addColorStop(0.7, "#151319");
  ambient.addColorStop(1, "#242129");
  context.fillStyle = ambient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff1e5";
  context.fillRect(30, 24, 82, 14);
  context.fillStyle = "#dbe5ff";
  context.fillRect(169, 40, 31, 7);

  const texture = new CanvasTexture(canvas, EquirectangularReflectionMapping);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function makeNumberAtlas() {
  if (typeof document === "undefined") return undefined;

  const canvas = document.createElement("canvas");
  const cell = 64;
  canvas.width = cell * pocketNumbers.length;
  canvas.height = cell;
  const canvasContext = canvas.getContext("2d");
  if (!canvasContext) return undefined;

  canvasContext.font = "700 54px Arial, sans-serif";
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
      numberBank.slice(1).map(([radius, height]) => [radius, height + 0.016]),
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
  const room = new HemisphereLight("#e8edff", "#5e4951", 1.25);
  scene.add(room);

  const key = new DirectionalLight("#ffeadb", 2.2);
  key.position.set(-5.5, 9, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -5.5;
  key.shadow.camera.right = key.shadow.camera.top = 5.5;
  key.shadow.camera.far = 25;
  key.shadow.normalBias = 0.017;
  key.shadow.bias = -0.00015;
  key.shadow.intensity = 0.62;
  scene.add(key);

  const fill = new DirectionalLight("#d1deff", 1.5);
  fill.position.set(3, 5, -8);
  const rim = new DirectionalLight("#fff5eb", 0.65);
  rim.position.set(5, 1.5, 6);
  scene.add(fill, rim);

  const floor = new Mesh(new PlaneGeometry(24, 24), new ShadowMaterial({ opacity: 0.38 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  floor.receiveShadow = true;
  scene.add(floor);

  const stationary = new Group();
  scene.add(stationary);
  const rotor = new Group();
  rotor.name = "roulette-rotor";
  scene.add(rotor);

  const reflection = makeStudioReflection() ?? null;
  const grain = makeWoodGrain();
  const wood = new MeshPhysicalMaterial({
    color: grain ? "#ddd0d7" : "#4b2631",
    map: grain,
    roughness: 0.36,
    clearcoat: 0.75,
    clearcoatRoughness: 0.35,
    envMap: reflection,
    envMapIntensity: 0.75,
  });
  const woodEdge = wood.clone();
  woodEdge.color.multiplyScalar(0.55);
  const brassMetal = new MeshStandardMaterial({
    color: "#cda983",
    roughness: 0.26,
    metalness: 0.77,
    envMap: reflection,
    envMapIntensity: 1.6,
  });
  const bronze = brassMetal.clone();
  bronze.color.set("#91725c");
  bronze.roughness = 0.39;
  const paleBrass = brassMetal.clone();
  paleBrass.color.set("#f3d5af");
  paleBrass.roughness = 0.33;
  paleBrass.metalness = 0.53;
  const bank = material("#343138", 0.34, 0.19);
  const darkBand = material("#171a1d", 0.55, 0.15);

  const cabinet = addRing(
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
  cabinet.castShadow = true;

  addRing(
    stationary,
    [
      [4.431, 0.342],
      [4.471, 0.28],
      [4.476, 0.237],
      [4.464, 0.214],
    ],
    bronze,
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
      [4.43, 0.875],
      [4.448, 0.84],
      [4.447, 0.8],
      [4.432, 0.767],
    ],
    woodEdge,
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
      [3.152, 0.491],
      [3.173, 0.503],
      [3.212, 0.52],
      [3.225, 0.526],
    ],
    brassMetal,
  );

  const deflector = deflectorGeometry();
  for (const angle of deflectorAngles) {
    const stud = addMesh(stationary, deflector, paleBrass);
    stud.position.set(deflectorRadius * Math.cos(angle), 0, deflectorRadius * Math.sin(angle));
    stud.rotation.y = -angle;
    stud.castShadow = true;
  }

  addMesh(rotor, rotorGeometry(), darkBand);

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
    [...pocketProfile, numberBank[0]],
    -pocketAngle * 0.5,
    pocketAngle * 0.5,
    16,
    (radius, angle) => 0.005 + fretLift(radius, angle),
  );
  const tileGeometry = radialSurface(
    numberBank,
    -pocketAngle * 0.484,
    pocketAngle * 0.484,
    16,
    (radius, angle) => 0.008 + fretLift(radius, angle),
  );
  const divider = radialSurface(
    [...pocketProfile, numberBank[0]],
    -pocketAngle * 0.1875,
    pocketAngle * 0.1875,
    6,
    (radius, angle) => 0.009 + fretLift(radius, angle + pocketAngle * 0.5),
  );
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
      [1.6, 0.416],
      [1.7, 0.398],
      [1.78, 0.387],
    ],
    brassMetal,
  );

  addRing(rotor, crownProfile, wood);

  addRing(
    rotor,
    [
      [1.484, 0.432],
      [1.527, 0.426],
      [1.56, 0.422],
    ],
    bronze,
  );

  addRing(
    rotor,
    [
      [0.502, 0.598],
      [0.528, 0.595],
      [0.546, 0.593],
      [0.571, 0.588],
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
      [0.142, 1.12],
      [0.16, 0.93],
      [0.185, 0.74],
      [0.285, 0.643],
      [0.486, 0.598],
      [0.505, 0.596],
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

  const ballSurface = new MeshPhysicalMaterial({
    color: ivory,
    roughness: 0.23,
    clearcoat: 0.9,
    emissive: "#fff4de",
    emissiveIntensity: 0.09,
  });
  const ball = addMesh(scene, new SphereGeometry(ballRadius, 32, 20), ballSurface);
  ball.name = "roulette-ball";
  ball.castShadow = true;

  function highlightPocket(index: number) {
    const tile = tiles[index];
    const highlight = tile.material.clone();
    highlight.emissive = new Color("#e8a865");
    highlight.emissiveIntensity = 0.6;
    tile.material = highlight;
  }

  return { rotor, ball, highlightPocket };
}
