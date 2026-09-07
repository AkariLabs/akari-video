import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/browser/akari-preview-open-handler.ts',import.meta.url),'utf8');
function block(name){const start=source.indexOf(`            const ${name} =`);const end=source.indexOf('\n            };',start);assert.ok(start>=0&&end>start);return source.slice(start,end+15);}
test('changing cut switches compositing depth along with transform and identity',()=>{
 const video={style:{},dataset:{}};
 const apply=new Function('video','zForTrack','window','deselectCut','applyRequestedCutSelection','updateCutSelectBox',`${block('applyCutsZIndex')}\n${block('applyCutVisual')} return applyCutVisual;`)(video,(_,track)=>track-3,{akari:{}},()=>{},()=>{},()=>{});
 apply({kind:'src',track:0,cutIndex:0});assert.equal(video.style.zIndex,'-3');
 apply({kind:'src',track:2,cutIndex:1,transform:{scale:.47}});assert.equal(video.style.zIndex,'-1');assert.equal(video.dataset.akariCutIndex,'1');assert.equal(video.dataset.akariTransformScale,'0.47');
 apply({kind:'src',track:0,cutIndex:0});assert.equal(video.style.zIndex,'-3');assert.equal(video.dataset.akariCutTransformActive,'false');assert.equal(video.dataset.akariTransformScale,'1');assert.equal(video.dataset.akariTransformX,'0');assert.equal(video.dataset.akariTransformY,'0');assert.equal(video.dataset.akariTransformRotate,'0');
});
test('timeline-selected cut highlights only when that cut is displayed',()=>{
 const video={style:{visibility:''},dataset:{akariCutIndex:'1'}};let selected=false;
 const check=new Function('video','selectCut','deselectCut',`const multiCutMode=false;let requestedCutIndex;${block('applyRequestedCutSelection')}return index=>{requestedCutIndex=index;applyRequestedCutSelection()}`)(video,()=>selected=true,()=>selected=false);
 check(1);assert.equal(selected,true);check(0);assert.equal(selected,false);check(null);assert.equal(selected,false);video.style.visibility='hidden';check(1);assert.equal(selected,false);
});
