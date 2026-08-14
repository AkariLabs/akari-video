// Deterministic, original CC0 fixture. It does not contain externally sourced model data.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outputPath = join(dirname(fileURLToPath(import.meta.url)), "minimal-avatar-vrm1.vrm");
const chunks = [];
const bufferViews = [];
const accessors = [];
let byteLength = 0;

function align4() {
  const padding = (4 - (byteLength % 4)) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); byteLength += padding; }
}

function appendTyped(array, target) {
  align4();
  const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const index = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buffer.length, ...(target ? { target } : {}) });
  chunks.push(buffer);
  byteLength += buffer.length;
  return index;
}

function accessor(array, type, componentType, target, includeBounds = false) {
  const view = appendTyped(array, target);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
  const entry = { bufferView: view, componentType, count: array.length / components, type };
  if (includeBounds) {
    entry.min = Array(components).fill(Infinity);
    entry.max = Array(components).fill(-Infinity);
    for (let i = 0; i < array.length; i += components) {
      for (let c = 0; c < components; c += 1) {
        entry.min[c] = Math.min(entry.min[c], array[i + c]);
        entry.max[c] = Math.max(entry.max[c], array[i + c]);
      }
    }
  }
  accessors.push(entry);
  return accessors.length - 1;
}

function flatNormals(vertexCount) {
  return new Float32Array(Array.from({ length: vertexCount }, () => [0, 0, 1]).flat());
}

function bodyGeometry() {
  const positions = [];
  const indices = [];
  const addQuad = (left, bottom, right, top, z = 0) => {
    const start = positions.length / 3;
    positions.push(left, bottom, z, right, bottom, z, right, top, z, left, top, z);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  addQuad(-0.30, 0.55, 0.30, 1.42); // torso
  addQuad(-0.72, 0.68, -0.26, 1.22); // left arm
  addQuad(0.26, 0.68, 0.72, 1.22); // right arm
  addQuad(-0.28, -0.02, -0.03, 0.62); // left leg
  addQuad(0.03, -0.02, 0.28, 0.62); // right leg
  const headCenter = positions.length / 3;
  positions.push(0, 1.68, 0);
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * Math.PI * 2;
    positions.push(Math.cos(angle) * 0.36, 1.68 + Math.sin(angle) * 0.42, 0);
  }
  for (let i = 0; i < 24; i += 1) indices.push(headCenter, headCenter + 1 + i, headCenter + 1 + ((i + 1) % 24));
  return { positions: new Float32Array(positions), indices: new Uint16Array(indices) };
}

const body = bodyGeometry();
const bodyPosition = accessor(body.positions, "VEC3", 5126, 34962, true);
const bodyNormal = accessor(flatNormals(body.positions.length / 3), "VEC3", 5126, 34962);
const bodyIndices = accessor(body.indices, "SCALAR", 5123, 34963);

const faceBase = new Float32Array([
  -0.10, -0.10, 0.012, 0.10, -0.10, 0.012, 0.10, -0.045, 0.012, -0.10, -0.045, 0.012,
  -0.22, 0.10, 0.012, -0.06, 0.10, 0.012, -0.06, 0.16, 0.012, -0.22, 0.16, 0.012,
  0.06, 0.10, 0.012, 0.22, 0.10, 0.012, 0.22, 0.16, 0.012, 0.06, 0.16, 0.012,
]);
const faceIndicesArray = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
const facePosition = accessor(faceBase, "VEC3", 5126, 34962, true);
const faceNormal = accessor(flatNormals(12), "VEC3", 5126, 34962);
const faceIndices = accessor(faceIndicesArray, "SCALAR", 5123, 34963);

function morph({ left, right, bottom, top, blink = false }) {
  const target = new Float32Array(faceBase.length);
  if (!blink) {
    const desired = [left, bottom, 0.012, right, bottom, 0.012, right, top, 0.012, left, top, 0.012];
    for (let i = 0; i < 12; i += 1) target[i] = desired[i] - faceBase[i];
  } else {
    for (const vertex of [4, 5, 6, 7, 8, 9, 10, 11]) target[vertex * 3 + 1] = 0.13 - faceBase[vertex * 3 + 1];
  }
  return accessor(target, "VEC3", 5126, 34962);
}

function emotionMorph(name) {
  const target = new Float32Array(faceBase.length);
  const move = (vertex, x, y) => {
    target[vertex * 3] = x;
    target[vertex * 3 + 1] = y;
  };
  if (name === "happy") {
    move(0, -0.04, 0.035); move(1, 0.04, 0.035); move(2, 0.04, 0.055); move(3, -0.04, 0.055);
  } else if (name === "sad") {
    move(0, 0.025, -0.055); move(1, -0.025, -0.055); move(2, -0.025, -0.035); move(3, 0.025, -0.035);
  } else if (name === "angry") {
    move(5, 0, -0.055); move(6, 0, -0.035); move(8, 0, -0.035); move(11, 0, -0.055);
  } else if (name === "surprised") {
    move(0, 0.025, -0.07); move(1, -0.025, -0.07); move(2, -0.025, 0.04); move(3, 0.025, 0.04);
    for (const vertex of [4, 5, 8, 9]) move(vertex, 0, -0.025);
    for (const vertex of [6, 7, 10, 11]) move(vertex, 0, 0.035);
  }
  return accessor(target, "VEC3", 5126, 34962);
}

const morphAccessors = [
  morph({ left: -0.11, right: 0.11, bottom: -0.18, top: 0.01 }),
  morph({ left: -0.18, right: 0.18, bottom: -0.10, top: -0.045 }),
  morph({ left: -0.055, right: 0.055, bottom: -0.16, top: 0.015 }),
  morph({ left: -0.20, right: 0.20, bottom: -0.105, top: -0.035 }),
  morph({ left: -0.09, right: 0.09, bottom: -0.17, top: 0.005 }),
  morph({ left: 0, right: 0, bottom: 0, top: 0, blink: true }),
];

const hairPositionsArray = new Float32Array([
  -0.36, 0.20, 0.025, 0.36, 0.20, 0.025, 0.30, 0.47, 0.025, -0.30, 0.47, 0.025,
  -0.34, 0.18, 0.025, -0.20, -0.02, 0.025, -0.08, 0.20, 0.025,
]);
const hairPosition = accessor(hairPositionsArray, "VEC3", 5126, 34962, true);
const hairNormal = accessor(flatNormals(7), "VEC3", 5126, 34962);
const hairIndices = accessor(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6]), "SCALAR", 5123, 34963);

// Appended after every v0 accessor so the existing fixture indices stay stable.
const springHairPosition = accessor(new Float32Array([
  -0.045, 0.015, 0.025, 0.045, 0.015, 0.025,
  0.035, -0.17, 0.025, -0.035, -0.17, 0.025,
]), "VEC3", 5126, 34962, true);
const springHairNormal = accessor(flatNormals(4), "VEC3", 5126, 34962);
const springHairIndices = accessor(new Uint16Array([0, 1, 2, 0, 2, 3]), "SCALAR", 5123, 34963);

// Appended after the complete v0.1 binary layout so every existing accessor/bufferView index stays stable.
morphAccessors.push(...["happy", "sad", "angry", "surprised"].map(emotionMorph));

const nodes = [
  { name: "hips", translation: [0, 0.9, 0], children: [1, 11, 14] },
  { name: "spine", translation: [0, 0.28, 0], children: [2] },
  { name: "chest", translation: [0, 0.30, 0], children: [3, 5, 8] },
  { name: "neck", translation: [0, 0.14, 0], children: [4] },
  { name: "head", translation: [0, 0.20, 0], children: [17, 18, 20, 24, 28] },
  { name: "leftUpperArm", translation: [0.24, 0.12, 0], children: [6] },
  { name: "leftLowerArm", translation: [0.28, -0.14, 0], children: [7] },
  { name: "leftHand", translation: [0.18, -0.16, 0] },
  { name: "rightUpperArm", translation: [-0.24, 0.12, 0], children: [9] },
  { name: "rightLowerArm", translation: [-0.28, -0.14, 0], children: [10] },
  { name: "rightHand", translation: [-0.18, -0.16, 0] },
  { name: "leftUpperLeg", translation: [0.14, -0.18, 0], children: [12] },
  { name: "leftLowerLeg", translation: [0, -0.42, 0], children: [13] },
  { name: "leftFoot", translation: [0, -0.34, 0.08] },
  { name: "rightUpperLeg", translation: [-0.14, -0.18, 0], children: [15] },
  { name: "rightLowerLeg", translation: [0, -0.42, 0], children: [16] },
  { name: "rightFoot", translation: [0, -0.34, 0.08] },
  { name: "face", mesh: 1 },
  { name: "hair-alpha", mesh: 2 },
  { name: "body-graphic", mesh: 0 },
  { name: "spring-hair-left-0", translation: [-0.25, 0.09, 0.055], mesh: 3, children: [21] },
  { name: "spring-hair-left-1", translation: [0, -0.15, 0], mesh: 3, children: [22] },
  { name: "spring-hair-left-2", translation: [0, -0.15, 0], mesh: 3, children: [23] },
  { name: "spring-hair-left-tip", translation: [0, -0.15, 0] },
  { name: "spring-hair-center-0", translation: [0, 0.11, 0.065], mesh: 3, children: [25] },
  { name: "spring-hair-center-1", translation: [0, -0.16, 0], mesh: 3, children: [26] },
  { name: "spring-hair-center-2", translation: [0, -0.16, 0], mesh: 3, children: [27] },
  { name: "spring-hair-center-tip", translation: [0, -0.16, 0] },
  { name: "spring-hair-right-0", translation: [0.25, 0.09, 0.055], mesh: 3, children: [29] },
  { name: "spring-hair-right-1", translation: [0, -0.15, 0], mesh: 3, children: [30] },
  { name: "spring-hair-right-2", translation: [0, -0.15, 0], mesh: 3, children: [31] },
  { name: "spring-hair-right-tip", translation: [0, -0.15, 0] },
];

const humanBones = Object.fromEntries([
  "hips", "spine", "chest", "neck", "head", "leftUpperArm", "leftLowerArm", "leftHand",
  "rightUpperArm", "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot",
].map((name) => [name, { node: nodes.findIndex((node) => node.name === name) }]));

const expressionNames = ["aa", "ih", "ou", "ee", "oh", "blink", "happy", "sad", "angry", "surprised"];
const gltf = {
  asset: { version: "2.0", generator: "AKARI Video deterministic CC0 VRM fixture generator" },
  extensionsUsed: ["VRMC_vrm", "VRMC_materials_mtoon", "VRMC_springBone"],
  extensionsRequired: ["VRMC_vrm", "VRMC_materials_mtoon", "VRMC_springBone"],
  extensions: {
    VRMC_vrm: {
      specVersion: "1.0",
      meta: {
        name: "AKARI minimal expression fixture", version: "1.0.0", authors: ["AKARI Video"],
        copyrightInformation: "CC0-1.0", contactInformation: "", references: [],
        thirdPartyLicenses: "None", avatarPermission: "everyone", allowExcessivelyViolentUsage: false,
        licenseUrl: "https://vrm.dev/licenses/1.0/",
        allowExcessivelySexualUsage: false, commercialUsage: "personalProfit", allowPoliticalOrReligiousUsage: true,
        allowAntisocialOrHateUsage: false, creditNotation: "unnecessary", allowRedistribution: true,
        modification: "allowModificationRedistribution",
        otherLicenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      },
      humanoid: { humanBones },
      expressions: {
        preset: Object.fromEntries(expressionNames.map((name, index) => [name, {
          morphTargetBinds: [{ node: 17, index, weight: 1 }],
          isBinary: true,
          overrideBlink: "none", overrideLookAt: "none", overrideMouth: "none",
        }])),
      },
    },
    VRMC_springBone: {
      specVersion: "1.0",
      colliders: [],
      colliderGroups: [],
      springs: [
        { name: "left-hair", joints: [20, 21, 22, 23].map((node) => ({ node, stiffness: 0.8, gravityPower: 0.02, gravityDir: [0, -1, 0], dragForce: 0.28 })), colliderGroups: [] },
        { name: "center-hair", joints: [24, 25, 26, 27].map((node) => ({ node, stiffness: 0.9, gravityPower: 0.02, gravityDir: [0, -1, 0], dragForce: 0.32 })), colliderGroups: [] },
        { name: "right-hair", joints: [28, 29, 30, 31].map((node) => ({ node, stiffness: 0.75, gravityPower: 0.02, gravityDir: [0, -1, 0], dragForce: 0.24 })), colliderGroups: [] },
      ],
    },
  },
  scene: 0,
  scenes: [{ nodes: [0, 19] }],
  nodes,
  meshes: [
    { name: "body", primitives: [{ attributes: { POSITION: bodyPosition, NORMAL: bodyNormal }, indices: bodyIndices, material: 0 }] },
    {
      name: "expression-face",
      weights: expressionNames.map(() => 0),
      extras: { targetNames: expressionNames },
      primitives: [{
        attributes: { POSITION: facePosition, NORMAL: faceNormal }, indices: faceIndices, material: 1,
        targets: morphAccessors.map((POSITION) => ({ POSITION })),
      }],
    },
    { name: "transparent-hair", primitives: [{ attributes: { POSITION: hairPosition, NORMAL: hairNormal }, indices: hairIndices, material: 2 }] },
    { name: "spring-hair-segment", primitives: [{ attributes: { POSITION: springHairPosition, NORMAL: springHairNormal }, indices: springHairIndices, material: 3 }] },
  ],
  materials: [
    {
      name: "body-mtoon", doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: [0.95, 0.55, 0.30, 1], metallicFactor: 0, roughnessFactor: 1 },
      extensions: { VRMC_materials_mtoon: { specVersion: "1.0", shadeColorFactor: [0.75, 0.30, 0.20] } },
    },
    {
      name: "face-mtoon", doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: [0.08, 0.03, 0.06, 1], metallicFactor: 0, roughnessFactor: 1 },
      extensions: { VRMC_materials_mtoon: { specVersion: "1.0", shadeColorFactor: [0.03, 0.01, 0.02] } },
    },
    {
      name: "alpha-edge-mtoon", doubleSided: true, alphaMode: "BLEND",
      pbrMetallicRoughness: { baseColorFactor: [0.15, 0.75, 1, 0.55], metallicFactor: 0, roughnessFactor: 1 },
      extensions: { VRMC_materials_mtoon: { specVersion: "1.0", transparentWithZWrite: false, shadeColorFactor: [0.05, 0.35, 0.60] } },
    },
    {
      name: "spring-hair-mtoon", doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: [0.20, 0.30, 0.95, 1], metallicFactor: 0, roughnessFactor: 1 },
      extensions: { VRMC_materials_mtoon: { specVersion: "1.0", shadeColorFactor: [0.06, 0.10, 0.50] } },
    },
  ],
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
};

const json = Buffer.from(JSON.stringify(gltf));
const jsonPadding = (4 - (json.length % 4)) % 4;
const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
align4();
const binaryChunk = Buffer.concat(chunks);
const totalLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binaryChunk.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
writeFileSync(outputPath, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binaryChunk]));
process.stdout.write(`${outputPath}\n`);
