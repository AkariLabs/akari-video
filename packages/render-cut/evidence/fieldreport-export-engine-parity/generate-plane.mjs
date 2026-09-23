import { writeFileSync } from 'node:fs';
import { encodeRgbaPng } from '../../../osr-export/src/png.mjs';

const root = new URL('./fixture-3d-plane/overlays/', import.meta.url);
const size = 64;
const pixels = Buffer.alloc(size * size * 4);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const offset = (y * size + x) * 4;
  const light = ((x >> 3) + (y >> 3)) % 2 === 0;
  pixels.set(light ? [205, 195, 130, 255] : [45, 75, 125, 255], offset);
}
const png = encodeRgbaPng(pixels, size, size);
const positions = new Float32Array([-5,-3,-1, 5,-3,1, 5,3,1, -5,3,-1]);
const texcoords = new Float32Array([0,0, 40,0, 40,24, 0,24]);
const indices = new Uint16Array([0,1,2, 0,2,3]);
const aligned = bytes => Buffer.concat([bytes, Buffer.alloc((4 - bytes.length % 4) % 4)]);
const chunks = [Buffer.from(positions.buffer), Buffer.from(texcoords.buffer), Buffer.from(indices.buffer), png].map(aligned);
const offsets = chunks.map((_, index) => chunks.slice(0, index).reduce((total, part) => total + part.length, 0));
const binary = Buffer.concat(chunks);
const json = {
  asset: { version: '2.0', generator: 'neutral-plane-fixture' },
  extensionsUsed: ['KHR_materials_unlit'],
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
  materials: [{ doubleSided: true, extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
  textures: [{ sampler: 0, source: 0 }], samplers: [{ wrapS: 10497, wrapT: 10497 }],
  images: [{ bufferView: 3, mimeType: 'image/png' }],
  buffers: [{ byteLength: binary.length }],
  bufferViews: chunks.map((part, index) => ({ buffer: 0, byteOffset: offsets[index], byteLength: index === 3 ? png.length : part.length })),
  accessors: [
    { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-5,-3,-1], max: [5,3,1] },
    { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
    { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
  ],
};
const jsonBytes = aligned(Buffer.from(JSON.stringify(json)));
jsonBytes.fill(0x20, Buffer.byteLength(JSON.stringify(json)));
const output = Buffer.alloc(12 + 8 + jsonBytes.length + 8 + binary.length);
let at = 0;
for (const value of [0x46546c67, 2, output.length, jsonBytes.length, 0x4e4f534a]) { output.writeUInt32LE(value, at); at += 4; }
jsonBytes.copy(output, at); at += jsonBytes.length;
output.writeUInt32LE(binary.length, at); at += 4;
output.writeUInt32LE(0x004e4942, at); at += 4;
binary.copy(output, at);
writeFileSync(new URL('plane.glb', root), output);
