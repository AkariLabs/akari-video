import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-preview-open-handler.js',import.meta.url),'utf8');
function method(name){const at=source.indexOf(`    async ${name}(`),rest=source.slice(at);return rest.slice(0,rest.indexOf('\n    }')+6);}
for(const kind of ['Cut','Layer'])test(`preview ${kind} write emits a shared undo snapshot after a successful save`,async()=>{
 const events=[];const Handler=new Function('window','CustomEvent','buffer_1',`return class {${method('handle'+kind+'Write')}}`)({dispatchEvent:e=>events.push(e)},class{constructor(type,init){this.type=type;this.detail=init.detail}},{BinaryBuffer:{fromString:s=>s}});
 const original=JSON.stringify({cuts:[{in:0,out:2}],layers:[{id:'blue',transform:{scale:1}}]});let saved;
 const h=Object.assign(new Handler(),{readText:async()=>original,objectRecord:x=>x??{},validateLayerTransformPatch:()=>undefined,validateLayerCropPatch:()=>undefined,validateLayerPerspectivePatch:()=>undefined,previewService:{lintEditCandidate:async()=>({pass:true})},recentWrites:new Map(),fileService:{writeFile:async(_,value)=>saved=value}});
 await h['handle'+kind+'Write']({akariPreviewEditUri:{toString:()=>'/edit.json'},sendMessage(){}},{requestId:'1',cutIndex:0,layerId:'blue',patch:{transform:{scale:.5}}});
 assert.equal(events.length,1);assert.equal(events[0].type,'akari.preview.editCommitted');assert.equal(events[0].detail.before,original);assert.equal(events[0].detail.after,saved);
 events.length=0;h.previewService.lintEditCandidate=async()=>({pass:false,errors:['invalid']});await h['handle'+kind+'Write']({akariPreviewEditUri:{toString:()=>'/edit.json'},sendMessage(){}},{requestId:'2',cutIndex:0,layerId:'blue',patch:{transform:{scale:.4}}});assert.equal(events.length,0);
});
