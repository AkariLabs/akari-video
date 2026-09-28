// 検証用: 単色 unlit の四角板 glb を作る（node gen-glb.mjs <out.glb> <r> <g> <b> [halfSize]）
import fs from 'node:fs';
const [out, r, g, b, half = '1.2'] = process.argv.slice(2);
const h = Number(half);
const pos = new Float32Array([-h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0]);
const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
const bin = Buffer.alloc(48 + 12 + 0);
Buffer.from(pos.buffer).copy(bin, 0);
Buffer.from(idx.buffer).copy(bin, 48);
const json = {
  asset: { version: '2.0', generator: 'p3d-probe' },
  extensionsUsed: ['KHR_materials_unlit'],
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
  materials: [{ doubleSided: true, extensions: { KHR_materials_unlit: {} },
    pbrMetallicRoughness: { baseColorFactor: [Number(r), Number(g), Number(b), 1] } }],
  buffers: [{ byteLength: 60 }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48 }, { buffer: 0, byteOffset: 48, byteLength: 12 }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-h, -h, 0], max: [h, h, 0] },
    { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
  ],
};
let js = Buffer.from(JSON.stringify(json), 'utf8');
const jpad = (4 - (js.length % 4)) % 4; js = Buffer.concat([js, Buffer.alloc(jpad, 0x20)]);
const bpad = (4 - (bin.length % 4)) % 4; const binP = Buffer.concat([bin, Buffer.alloc(bpad, 0)]);
const total = 12 + 8 + js.length + 8 + binP.length;
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(binP.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(out, Buffer.concat([head, jh, js, bh, binP]));
console.log('wrote', out, total);
