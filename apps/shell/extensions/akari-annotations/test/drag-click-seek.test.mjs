import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
function method(name){const at=source.indexOf(`    ${name}(`),rest=source.slice(at);assert.ok(at>=0);return rest.slice(0,rest.indexOf('\n    }')+6);}
const Widget=new Function('Element',`return class {${['cancelDrag','onStripClick'].map(method).join('\n')}}`)(class{});
test('a drag-ending click cannot seek after a refresh replaces the original clip',()=>{
 const w=Object.assign(new Widget(),{hideSnapGuide(){},hideTrackInsertIndicator(){},dragFeedback:{style:{}},applySelection(){},selectTimeAtClientX(){this.seeks=(this.seeks??0)+1}});
 const state={dragged:true,element:{dataset:{},style:{},hasPointerCapture:()=>false,querySelector:()=>null},ghost:{remove(){}}};w.dragState=state;
 w.cancelDrag(state);assert.equal(w.suppressNextStripClick,true);w.onStripClick({target:{},clientX:500});assert.equal(w.seeks,undefined);assert.equal(w.suppressNextStripClick,false);
 w.onStripClick({target:{},clientX:500});assert.equal(w.seeks,1);
});
test('strip clicks do not seek while a clip or playhead drag is active',()=>{
 const w=Object.assign(new Widget(),{applySelection(){assert.fail()},selectTimeAtClientX(){assert.fail()}});w.dragState={};w.onStripClick({});w.dragState=undefined;w.cancelPlayheadDrag=()=>{};w.onStripClick({});
});
