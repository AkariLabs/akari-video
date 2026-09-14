import { createCamera } from "./camera.mjs";

const COMPONENT_FLOAT = 5126;
const TRIANGLES = 4;
const SAMPLE_FPS = 60;

export function buildSpatialGlb(map, items = []) {
  const gltf = {
    asset: { version: "2.0", generator: "AKARI Video world build" },
    extensionsUsed: ["KHR_materials_unlit"],
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [],
    cameras: [], skins: [], bufferViews: [], accessors: [], animations: [],
  };
  const chunks = [];
  let byteLength = 0;
  const materialByColor = new Map();

  const addBytes = (source) => {
    while (byteLength % 4) { chunks.push(Buffer.alloc(1)); byteLength += 1; }
    const buffer = Buffer.from(source);
    const index = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buffer.length });
    chunks.push(buffer);
    byteLength += buffer.length;
    return index;
  };
  const accessor = (values, type) => {
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const flat = values.flat();
    const buffer = Buffer.alloc(flat.length * 4);
    flat.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
    const descriptor = {
      bufferView: addBytes(buffer), componentType: COMPONENT_FLOAT,
      count: flat.length / width, type,
    };
    if (type === "SCALAR" || type === "VEC3") {
      descriptor.min = Array.from({ length: width }, (_, column) => Math.min(...values.map((value) => Array.isArray(value) ? value[column] : value)));
      descriptor.max = Array.from({ length: width }, (_, column) => Math.max(...values.map((value) => Array.isArray(value) ? value[column] : value)));
    }
    return gltf.accessors.push(descriptor) - 1;
  };
  const material = (color, alpha = 1) => {
    const key = `${color}:${alpha}`;
    if (materialByColor.has(key)) return materialByColor.get(key);
    const rgb = color.match(/[0-9a-f]{2}/gi).map((part) => Number.parseInt(part, 16) / 255);
    const index = gltf.materials.push({
      name: key,
      pbrMetallicRoughness: { baseColorFactor: [...rgb, alpha], metallicFactor: 0, roughnessFactor: 1 },
      extensions: { KHR_materials_unlit: {} },
      ...(alpha < 1 ? { alphaMode: "BLEND" } : {}),
      doubleSided: true,
    }) - 1;
    materialByColor.set(key, index);
    return index;
  };
  const addMeshNode = (name, vertices, color, translation = [0, 0, 0], alpha = 1) => {
    const mesh = gltf.meshes.push({ name, primitives: [{ attributes: { POSITION: accessor(vertices, "VEC3") }, material: material(color, alpha), mode: TRIANGLES }] }) - 1;
    const node = gltf.nodes.push({ name, mesh, translation }) - 1;
    gltf.scenes[0].nodes.push(node);
    return node;
  };

  for (const world of map.worlds) {
    const center = world.spatial?.floor?.center ?? world.spatial?.c ?? [0, 0, 0];
    const size = world.spatial?.floor?.size ?? [20, 20];
    const [width, height] = size;
    const floor = [[-width / 2, -height / 2, 0], [width / 2, -height / 2, 0], [width / 2, height / 2, 0], [-width / 2, -height / 2, 0], [width / 2, height / 2, 0], [-width / 2, height / 2, 0]];
    addMeshNode(`World floor ${world.id}`, floor, world.palette?.background ?? "#30384a", center);
    const grid = floorGridVertices(width, height);
    addMeshNode(`World grid ${world.id}`, grid, world.palette?.dots ?? world.palette?.accent ?? "#8190aa", [center[0], center[1], center[2] + 0.02]);
    const board = [[-width / 2, -height / 2, 0], [width / 2, -height / 2, 0], [width / 2, height / 2, 0], [-width / 2, -height / 2, 0], [width / 2, height / 2, 0], [-width / 2, height / 2, 0]];
    for (const [index, id] of (world.spatial?.background ?? []).entries()) {
      const entry = map.inventory?.find((candidate) => candidate.id === id);
      const position = entry?.pos ?? [center[0], center[1], center[2] - 8 - index * 4];
      addMeshNode(entry?.name ?? `Background ${world.id} ${id}`, board, world.palette?.background ?? "#30384a", position);
      addMeshNode(`Background grid ${world.id} ${id}`, grid, world.palette?.dots ?? world.palette?.accent ?? "#8190aa", [position[0], position[1], position[2] + 0.02]);
    }
    for (const [index, id] of (world.spatial?.haze ?? []).entries()) {
      const entry = map.inventory?.find((candidate) => candidate.id === id);
      addMeshNode(entry?.name ?? `Haze ${world.id} ${id}`, board, world.palette?.haze ?? world.palette?.background ?? "#d9e0e8", entry?.pos ?? [center[0], center[1], center[2] - 4 - index * 3], 0.2);
    }
  }
  for (const zone of map.zones) {
    const [x, y, z] = zone.c;
    const radius = 0.35;
    const marker = [[-radius, -radius, 0], [radius, -radius, 0], [radius, radius, 0], [-radius, -radius, 0], [radius, radius, 0], [-radius, radius, 0]];
    const world = map.worlds.find((candidate) => candidate.id === zone.world);
    addMeshNode(`Zone ${zone.id}`, marker, world?.palette?.accent ?? "#ffd449", [x, y, z]);
  }

  for (const item of items) importGlb(gltf, chunks, () => byteLength, (value) => { byteLength = value; }, item);

  const duration = map.cameraStops.at(-1).leave;
  const times = Array.from({ length: Math.round(duration * SAMPLE_FPS) + 1 }, (_, index) => Math.min(index / SAMPLE_FPS, duration));
  if (times.at(-1) !== duration) times.push(duration);
  const cameraAt = createCamera(map);
  const states = times.map((time) => cameraAt(time));
  const rotations = continuousQuaternions(states.map((state) => cameraQuaternion(state.eye, state.target)));
  const cameraIndex = gltf.cameras.push({ name: "TourCamera", type: "perspective", perspective: { yfov: 42 * Math.PI / 180, aspectRatio: 16 / 9, znear: 0.1, zfar: 2000 } }) - 1;
  const cameraNode = gltf.nodes.push({ name: "TourCamera", camera: cameraIndex, translation: states[0].eye, rotation: rotations[0] }) - 1;
  gltf.scenes[0].nodes.push(cameraNode);
  const animation = { name: "Tour", samplers: [], channels: [] };
  const timeAccessor = accessor(times, "SCALAR");
  for (const [path, values, type] of [
    ["translation", states.map((state) => state.eye), "VEC3"],
    ["rotation", rotations, "VEC4"],
  ]) {
    const sampler = animation.samplers.push({ input: timeAccessor, output: accessor(values, type), interpolation: "LINEAR" }) - 1;
    animation.channels.push({ sampler, target: { node: cameraNode, path } });
  }
  for (const edge of map.edges.filter((candidate) => candidate.type !== "move" && candidate.transition?.cover > 0)) {
    const world = map.worlds.find((candidate) => candidate.id === map.cameraStops.find((stop) => stop.id === edge.from)?.world);
    const coverNode = addMeshNode(`Transition fog ${edge.id}`, sphereVertices(0.25), world?.palette?.haze ?? world?.palette?.background ?? "#d9e0e8");
    gltf.scenes[0].nodes = gltf.scenes[0].nodes.filter((node) => node !== coverNode);
    (gltf.nodes[cameraNode].children ??= []).push(coverNode);
    gltf.nodes[coverNode].scale = [0, 0, 0];
    const half = edge.transition.cover / 2;
    const values = times.map((time) => time >= edge.switchTime - half && time <= edge.switchTime + half ? [1, 1, 1] : [0, 0, 0]);
    const sampler = animation.samplers.push({ input: timeAccessor, output: accessor(values, "VEC3"), interpolation: "STEP" }) - 1;
    animation.channels.push({ sampler, target: { node: coverNode, path: "scale" } });
  }
  gltf.animations.push(animation);

  removeEmptyArrays(gltf);
  gltf.buffers = [{ byteLength }];
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonChunk = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const binary = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binary.length, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonChunk.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8); binaryHeader.writeUInt32LE(binary.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return { buffer: Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binary]), json: gltf };
}

export function spatialSceneDeclaration(map, model = "assets/world/world.glb") {
  const first = map.worlds[0];
  const descriptor = {
    model,
    camera: { fromModel: "TourCamera" },
    animationClip: "Tour",
    environment: { intensity: 0, exposure: 1 },
    lights: [],
  };
  if (first?.palette?.haze) descriptor.fog = { color: first.palette.haze, near: 1, far: spatialFar(map) };
  if (first?.palette?.background) descriptor.background = { color: first.palette.background };
  return descriptor;
}

export function renderSpatialWorldHtml(map, model = "assets/world/world.glb") {
  const declaration = JSON.stringify(spatialSceneDeclaration(map, model)).replaceAll("</script", "<\\/script");
  return `<div class="akari-spatial-world"><style>.akari-spatial-world{position:absolute;inset:0}.akari-spatial-world canvas{width:100%;height:100%;display:block}</style><canvas></canvas><script type="application/json" data-akari-3d-scene>${declaration}</script></div>\n`;
}

function importGlb(gltf, chunks, getByteLength, setByteLength, item) {
  const parsed = parseGlb(item.buffer);
  const source = parsed.json;
  if ((source.buffers?.length ?? 0) > 1) throw new Error(`world item ${item.id} の GLB は複数 buffer に未対応です`);
  const supportedExtensions = new Set(["KHR_materials_unlit", "KHR_materials_emissive_strength"]);
  const unsupported = (source.extensionsRequired ?? []).filter((name) => !supportedExtensions.has(name));
  if (unsupported.length) throw new Error(`world item ${item.id} の GLB は必須 extension に未対応です: ${unsupported.join(", ")}`);
  if ((source.images ?? []).some((image) => image.uri !== undefined)) throw new Error(`world item ${item.id} の GLB は画像を BIN chunk に埋め込む必要があります`);
  let byteLength = getByteLength();
  while (byteLength % 4) { chunks.push(Buffer.alloc(1)); byteLength += 1; }
  const baseOffset = byteLength;
  chunks.push(parsed.binary); byteLength += parsed.binary.length; setByteLength(byteLength);
  const offsets = Object.fromEntries(["bufferViews", "accessors", "samplers", "images", "textures", "materials", "meshes", "cameras", "skins", "nodes"].map((key) => [key, gltf[key].length]));
  for (const view of source.bufferViews ?? []) gltf.bufferViews.push({ ...view, buffer: 0, byteOffset: baseOffset + (view.byteOffset ?? 0) });
  for (const value of source.accessors ?? []) gltf.accessors.push(remap(value, { bufferView: offsets.bufferViews }));
  for (const value of source.samplers ?? []) gltf.samplers.push(structuredClone(value));
  for (const value of source.images ?? []) gltf.images.push(remap(value, { bufferView: offsets.bufferViews }));
  for (const value of source.textures ?? []) gltf.textures.push(remap(value, { sampler: offsets.samplers, source: offsets.images }));
  for (const value of source.materials ?? []) gltf.materials.push(remapMaterial(value, offsets.textures));
  for (const value of source.meshes ?? []) gltf.meshes.push({ ...remapMesh(value, offsets), ...(value.name ? { name: `${item.id}:${value.name}` } : {}) });
  for (const value of source.cameras ?? []) gltf.cameras.push({ ...structuredClone(value), ...(value.name ? { name: `${item.id}:${value.name}` } : {}) });
  for (const value of source.skins ?? []) gltf.skins.push({ ...structuredClone(value), inverseBindMatrices: add(value.inverseBindMatrices, offsets.accessors), skeleton: add(value.skeleton, offsets.nodes), joints: (value.joints ?? []).map((index) => index + offsets.nodes) });
  for (const value of source.nodes ?? []) gltf.nodes.push({ ...remap(value, { mesh: offsets.meshes, camera: offsets.cameras, skin: offsets.skins }, { children: offsets.nodes }), ...(value.name ? { name: `${item.id}:${value.name}` } : {}) });
  for (const value of source.animations ?? []) {
    const samplerOffset = 0;
    gltf.animations.push({ ...structuredClone(value), name: `${item.id}:${value.name ?? "animation"}`, samplers: value.samplers.map((sampler) => ({ ...sampler, input: sampler.input + offsets.accessors, output: sampler.output + offsets.accessors })), channels: value.channels.map((channel) => ({ ...channel, sampler: channel.sampler + samplerOffset, target: { ...channel.target, node: channel.target.node + offsets.nodes } })) });
  }
  const roots = (source.scenes?.[source.scene ?? 0]?.nodes ?? []).map((index) => index + offsets.nodes);
  const zone = item.zone;
  const offset = item.offset ?? [0, 0];
  const scale = item.scale ?? 1;
  const parent = gltf.nodes.push({ name: `World item ${item.id}`, translation: [zone.c[0] + offset[0], zone.c[1] + offset[1], zone.c[2]], scale: [scale, scale, scale], children: roots }) - 1;
  gltf.scenes[0].nodes.push(parent);
  for (const extension of source.extensionsUsed ?? []) if (!gltf.extensionsUsed.includes(extension)) gltf.extensionsUsed.push(extension);
  for (const extension of source.extensionsRequired ?? []) (gltf.extensionsRequired ??= []).push(extension);
  if (gltf.extensionsRequired) gltf.extensionsRequired = [...new Set(gltf.extensionsRequired)];
}

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2) throw new Error("world item は glTF 2.0 GLB である必要があります");
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error("GLB の JSON chunk がありません");
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").trim());
  const binaryHeader = 20 + jsonLength;
  const binaryLength = buffer.readUInt32LE(binaryHeader);
  if (buffer.readUInt32LE(binaryHeader + 4) !== 0x004e4942) throw new Error("GLB の BIN chunk がありません");
  return { json, binary: buffer.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength) };
}

function remap(value, scalar = {}, arrays = {}) {
  const result = structuredClone(value);
  for (const [key, offset] of Object.entries(scalar)) if (result[key] !== undefined) result[key] += offset;
  for (const [key, offset] of Object.entries(arrays)) if (result[key]) result[key] = result[key].map((index) => index + offset);
  return result;
}
function remapMaterial(value, textureOffset) {
  const result = structuredClone(value);
  for (const info of [result.pbrMetallicRoughness?.baseColorTexture, result.pbrMetallicRoughness?.metallicRoughnessTexture, result.normalTexture, result.occlusionTexture, result.emissiveTexture]) if (info?.index !== undefined) info.index += textureOffset;
  return result;
}
function remapMesh(value, offsets) {
  const result = structuredClone(value);
  for (const primitive of result.primitives ?? []) {
    for (const key of Object.keys(primitive.attributes ?? {})) primitive.attributes[key] += offsets.accessors;
    if (primitive.indices !== undefined) primitive.indices += offsets.accessors;
    if (primitive.material !== undefined) primitive.material += offsets.materials;
    for (const target of primitive.targets ?? []) for (const key of Object.keys(target)) target[key] += offsets.accessors;
  }
  return result;
}
function add(value, offset) { return value === undefined ? undefined : value + offset; }
function spatialFar(map) { return Math.max(20, ...map.worlds.map((world) => Math.max(...(world.spatial?.floor?.size ?? [20, 20])) * 4)); }
function removeEmptyArrays(gltf) { for (const key of ["textures", "images", "samplers", "skins"]) if (gltf[key].length === 0) delete gltf[key]; }

function cameraQuaternion(eye, target) {
  const z = normalize(eye.map((value, index) => value - target[index]));
  let x = normalize(cross([0, 1, 0], z));
  if (!x.every(Number.isFinite)) x = [1, 0, 0];
  const y = cross(z, x);
  const matrix = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  const trace = matrix[0] + matrix[4] + matrix[8];
  if (trace > 0) { const s = Math.sqrt(trace + 1) * 2; return [(matrix[7] - matrix[5]) / s, (matrix[2] - matrix[6]) / s, (matrix[3] - matrix[1]) / s, s / 4]; }
  const axis = matrix[0] > matrix[4] && matrix[0] > matrix[8] ? 0 : matrix[4] > matrix[8] ? 1 : 2;
  const j = (axis + 1) % 3, k = (axis + 2) % 3;
  const s = Math.sqrt(1 + matrix[axis * 3 + axis] - matrix[j * 3 + j] - matrix[k * 3 + k]) * 2;
  const quaternion = [0, 0, 0, 0]; quaternion[axis] = s / 4; quaternion[j] = (matrix[j * 3 + axis] + matrix[axis * 3 + j]) / s; quaternion[k] = (matrix[k * 3 + axis] + matrix[axis * 3 + k]) / s; quaternion[3] = (matrix[k * 3 + j] - matrix[j * 3 + k]) / s;
  return quaternion;
}
function normalize(vector) { const length = Math.hypot(...vector); return vector.map((value) => value / length); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function floorGridVertices(width, height) {
  const vertices = [];
  const step = 4;
  const thickness = 0.3;
  const rectangle = (x0, y0, x1, y1) => vertices.push([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y0, 0], [x1, y1, 0], [x0, y1, 0]);
  for (let x = -width / 2; x <= width / 2 + 1e-9; x += step) rectangle(x - thickness / 2, -height / 2, x + thickness / 2, height / 2);
  for (let y = -height / 2; y <= height / 2 + 1e-9; y += step) rectangle(-width / 2, y - thickness / 2, width / 2, y + thickness / 2);
  return vertices;
}
function sphereVertices(radius, longitudeSteps = 24, latitudeSteps = 12) {
  const vertices = [];
  const point = (longitude, latitude) => {
    const theta = longitude / longitudeSteps * Math.PI * 2;
    const phi = latitude / latitudeSteps * Math.PI - Math.PI / 2;
    const ring = Math.cos(phi) * radius;
    return [Math.cos(theta) * ring, Math.sin(phi) * radius, Math.sin(theta) * ring];
  };
  for (let latitude = 0; latitude < latitudeSteps; latitude += 1) for (let longitude = 0; longitude < longitudeSteps; longitude += 1) {
    const next = (longitude + 1) % longitudeSteps;
    const a = point(longitude, latitude), b = point(next, latitude), c = point(next, latitude + 1), d = point(longitude, latitude + 1);
    vertices.push(a, b, c, a, c, d);
  }
  return vertices;
}
function continuousQuaternions(values) {
  const result = [];
  for (const value of values) {
    const previous = result.at(-1);
    result.push(previous && value.reduce((sum, part, column) => sum + part * previous[column], 0) < 0 ? value.map((part) => -part) : value);
  }
  return result;
}
