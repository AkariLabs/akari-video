import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
const start=source.indexOf('    onTrackHeaderPointerDown('), end=source.indexOf('\n    /**',start);
function fixture() {
 const listeners=new Map();const document={addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const Widget=new Function('document','Element',`const DRAG_THRESHOLD_PX=3;return class {${source.slice(start,end)}}`)(document,class {});
 const tracks=[{id:'lower',kind:'cuts',ref:0},{id:'upper',kind:'layers',ref:0}];
 const nodes=[...tracks].reverse().map((t,i)=>({style:{},dataset:{akariTimelineTrackId:t.id,akariKind:t.kind},classList:{add(){},remove(){}},getBoundingClientRect:()=>({top:i*40,bottom:(i+1)*40})}));
 const widget=Object.assign(new Widget(),{pinTimelineViewport() {},trackHeaders:{querySelectorAll:()=>nodes},renderStrip(){this.rendered=true},mutateTimelineTracks(label,fn){this.result=fn(tracks)}});
 widget.onTrackHeaderPointerDown({button:0,pointerId:7,clientY:20,target:{},currentTarget:nodes[0],preventDefault(){}},tracks[1]);
 const emit=(name,extra={})=>listeners.get(name)?.({pointerId:7,clientY:65,preventDefault(){},...extra});
 return {widget,listeners,emit};
}
test('header drag persists through pending redraw and commits by stable row IDs',()=>{
 const {widget,emit,listeners}=fixture();assert.equal(widget.headerDragActive,true);
 widget.renderStripPending=true;emit('pointermove');emit('pointerup');
 assert.deepEqual(widget.result.map(t=>t.id),['upper','lower']);assert.equal(widget.headerDragActive,false);assert.equal(listeners.size,0);
});
for(const action of ['pointercancel','Escape'])test(`${action} cancels reorder without writing`,()=>{
 const {widget,emit,listeners}=fixture();widget.renderStripPending=true;emit('pointermove');
 if(action==='Escape')emit('keydown',{key:'Escape'});else emit(action);
 assert.equal(widget.result,undefined);assert.equal(widget.headerDragActive,false);assert.equal(widget.rendered,true);assert.equal(listeners.size,0);
});
test('a second pointer cannot move or complete a header drag',()=>{
 const {widget,emit}=fixture();emit('pointermove',{pointerId:8});emit('pointerup',{pointerId:8});assert.equal(widget.headerDragActive,true);emit('pointerup');assert.equal(widget.result,undefined);
});
