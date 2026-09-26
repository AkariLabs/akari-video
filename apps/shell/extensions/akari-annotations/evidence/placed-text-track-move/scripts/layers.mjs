// プレビューの重なり（映像の面・字幕面・字幕行のプレートの z）を JSON で出す（ラッパー作成の検証スクリプト・r1）。
// 使い方: node layers.mjs <project> [case 説明]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { view } from './l1-common.mjs';
const [project, label = ''] = process.argv.slice(2);
const edit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
const v = await view(Number(process.env.CDP_PORT || 9627));
const dom = await v.eval(`(()=>{const stage=document.getElementById('preview-stage');const host=stage;const z=e=>getComputedStyle(e).zIndex;
const layers=[...host.querySelectorAll('canvas, #caption-plate, .akari-media-plane, [data-akari-media-plane], [data-overlay-id]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({tag:e.tagName,id:e.id||null,cls:String(e.className||'').slice(0,60)||null,z:z(e),plane:e.dataset?.akariMediaPlane??e.dataset?.plane??null,parentZ:e.parentElement?z(e.parentElement):null}));
const plates=[...document.querySelectorAll('.caption-row-plate')].filter(p=>p.getBoundingClientRect().width>0).map(p=>({id:p.id,text:(p.textContent||'').trim().slice(0,16),plateZ:z(p),layerZ:p.parentElement?z(p.parentElement):null}));
return {stageLayers:layers,captionPlates:plates}})()`);
console.log(JSON.stringify({ case: label, tracksBottomToTop: edit.tracks.map(t => t.id), ...dom }, null, 1));
process.exit(0);
