import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(tmpdir(), 'fieldreport-export-engine-parity-video-fixture');
mkdirSync(join(root, 'assets'), { recursive: true });
mkdirSync(join(root, 'overlays'), { recursive: true });
const arrays = [
  new Float32Array([-1,-0.5,0, 1,-0.5,0, 1,1.5,0, -1,1.5,0]),
  new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1]),
  new Float32Array([0,0, 1,0, 1,1, 0,1]),
  new Uint16Array([0,1,2, 0,2,3]),
];
const chunks = arrays.map(array => Buffer.from(array.buffer));
const offsets = chunks.map((_, index) => chunks.slice(0,index).reduce((sum,part)=>sum+part.length,0));
const binary = Buffer.concat(chunks);
const gltf = {
  asset:{version:'2.0',generator:'neutral-video-fixture'}, buffers:[{byteLength:binary.length}],
  bufferViews:chunks.map((part,index)=>({buffer:0,byteOffset:offsets[index],byteLength:part.length,target:index===3?34963:34962})),
  accessors:[
    {bufferView:0,componentType:5126,count:4,type:'VEC3',min:[-1,-0.5,0],max:[1,1.5,0]},
    {bufferView:1,componentType:5126,count:4,type:'VEC3'},
    {bufferView:2,componentType:5126,count:4,type:'VEC2'},
    {bufferView:3,componentType:5123,count:6,type:'SCALAR'},
  ],
  materials:[{name:'ScreenMaterial',doubleSided:true,emissiveFactor:[1,1,1],pbrMetallicRoughness:{baseColorFactor:[0,0,0,1],metallicFactor:0,roughnessFactor:1}}],
  meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],
  nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0,
};
const aligned = (data, pad) => Buffer.concat([data,Buffer.alloc((4-data.length%4)%4,pad)]);
const json=aligned(Buffer.from(JSON.stringify(gltf)),0x20);
const bin=aligned(binary,0);
const header=Buffer.alloc(12);
header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+8+bin.length,8);
const jsonHeader=Buffer.alloc(8);jsonHeader.writeUInt32LE(json.length,0);jsonHeader.writeUInt32LE(0x4e4f534a,4);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(bin.length,0);binHeader.writeUInt32LE(0x004e4942,4);
writeFileSync(join(root,'assets','screen.glb'),Buffer.concat([header,jsonHeader,json,binHeader,bin]));
const inputs=['red','green','blue','yellow'].flatMap(color=>['-f','lavfi','-i',`color=c=${color}:s=128x72:r=10:d=1`]);
execFileSync('ffmpeg',['-y','-v','error',...inputs,'-filter_complex','[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,format=yuv420p[v]','-map','[v]','-c:v','libx264','-g','10',join(root,'assets','colors.mp4')]);
writeFileSync(join(root,'overlays','screen.html'),'<div style="position:absolute;inset:0;background:#101820"><canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas><script type="application/json" data-akari-3d-scene>{"model":"assets/screen.glb","camera":{"position":[0,0.5,3],"lookAt":[0,0.5,0]},"materialOverrides":{"ScreenMaterial":{"texture":"assets/colors.mp4"}}}</script></div>');
writeFileSync(join(root,'edit.json'),JSON.stringify({version:2,output:{width:320,height:180,fps:10},sources:[],tracks:[{id:'screen',lane:'visual',items:[{id:'screen',at:20,duration:30,source:{kind:'html',path:'overlays/screen.html'}}]}]}));
console.log('generated neutral video-texture fixture');
