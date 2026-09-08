import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildTimelineMap} from '../../../../../packages/edit-store/lib/timeline-map.js';
const source=readFileSync(new URL('../src/browser/akari-preview-open-handler.ts',import.meta.url),'utf8');
const fragment=source.slice(source.indexOf('            let selectionCutSource;'),source.indexOf('            const cutInteractionMedia ='));
test('selected cut uses its full interval and own transform even when another cut is on top',()=>{
 const summary={output:{fps:30},cuts:[{id:'base',at:0,in:0,out:10,transform:{x:20,scale:1}},{id:'upper',at:2,in:0,out:4,transform:{x:100,scale:.5}}]};
 const run=new Function('summary','window',`let requestedCutId='base';const segments=[{id:'upper'}],activeSegmentIndex=0,video={dataset:{akariCutId:'upper'}},frameEngineMediaIdle=true,selectionDragActive=false,outputTime=3;const document={createElement:()=>({dataset:{}})},writeCutLayerStyleBase=()=>{},applyCutKeyframesToMedia=()=>{};${fragment};return {segment:cutInteractionSegment,media:cutSelectionVideo,select:id=>requestedCutId=id};`)(summary,{AkariEditKernel:{buildTimelineMap}});
 assert.equal(run.segment().outStart,0);assert.equal(run.segment().outEnd,10);assert.equal(run.media().dataset.akariCutId,'base');assert.equal(run.media().dataset.akariTransformX,'20');
 run.media().dataset.akariTransformX='42';assert.equal(run.media().dataset.akariTransformX,'42');
 run.select('upper');assert.equal(run.media().dataset.akariCutIndex,'1');assert.equal(run.media().dataset.akariTransformScale,'0.5');
});
