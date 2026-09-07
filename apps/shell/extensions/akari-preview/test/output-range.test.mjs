import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/browser/akari-preview-open-handler.ts',import.meta.url),'utf8');
const start=source.indexOf('            const seekTimelineTime ='),end=source.indexOf('\n            };',start);const block=source.slice(start,end+15);
test('seeking beyond all output retains the requested cursor and marks the view out of range',()=>{
 const elements=new Map();const document={getElementById(id){if(!elements.has(id))elements.set(id,{hidden:false});return elements.get(id)}};let reported;
 const factory=new Function('document','window',`const initial={kind:'output'},totalTimelineDuration=6,fps=30;let outputTime=0,outsideOutput=false,isPlaying=false,activeSegmentIndex=0;const video={pause(){}};const layersStage={style:{}},stage={style:{}},layerEntries=[];const stopAnimation=()=>{},selectLayer=()=>{},deselectCut=()=>{},deselectCaption=()=>{},updateTransport=()=>{},enterSegment=()=>{},timelineToSource=()=>({index:0,kind:'gap'});${block}return {seek:seekTimelineTime,state:()=>({outputTime,outsideOutput,activeSegmentIndex})}`);
 const w=factory(document,{akari:{previewAudio:{pause(){}},playbackTick:t=>reported=t,reviewTransport(){}}});
 w.seek(20);assert.deepEqual(w.state(),{outputTime:20,outsideOutput:true,activeSegmentIndex:-1});assert.equal(reported,20);assert.equal(elements.get('outside-output').hidden,false);
 w.seek(5);assert.equal(w.state().outputTime,5);assert.equal(w.state().outsideOutput,false);assert.equal(elements.get('outside-output').hidden,true);assert.equal(elements.get('preview-output-frame').hidden,false);
});
