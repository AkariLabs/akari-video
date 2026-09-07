import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
function method(name){const a=source.indexOf(`    ${name}(`);const rest=source.slice(a);return rest.slice(0,rest.indexOf('\n    }')+6);}
function fixture(){
 const document=new EventTarget(),window=new EventTarget(),element=new EventTarget();
 const Widget=new Function('document','window',`return class {${method('bindDragLifecycle')}}`)(document,window);
 const w=new Widget();let commits=0,cancels=0;const state={pointerId:1,element};w.dragState=state;
 w.cancelDrag=()=>{w.dragLifecycleCleanup();w.dragState=undefined;cancels++};
 w.bindDragLifecycle(state,()=>{w.dragLifecycleCleanup();w.dragState=undefined;commits++});
 const emit=(target,type,values={})=>{const e=new Event(type);Object.assign(e,{pointerId:1,buttons:1},values);target.dispatchEvent(e)};
 return {document,window,element,emit,w,counts:()=>({commits,cancels})};
}
test('release anywhere ends the drag exactly once',()=>{const f=fixture();f.emit(f.document,'pointerup');f.emit(f.document,'pointerup');assert.deepEqual(f.counts(),{commits:1,cancels:0});assert.equal(f.w.dragState,undefined)});
for(const [target,type,values] of [['element','lostpointercapture',{}],['document','pointercancel',{}],['window','blur',{}],['document','pointermove',{buttons:0}]]){
 test(`${type} clears a stuck drag without placing it`,()=>{const f=fixture();f.emit(f[target],type,values);f.emit(f.document,'pointerup');assert.deepEqual(f.counts(),{commits:0,cancels:1});assert.equal(f.w.dragState,undefined)});
}
test('other pointer cannot end the active gesture',()=>{const f=fixture();f.emit(f.document,'pointerup',{pointerId:2});f.emit(f.document,'pointercancel',{pointerId:2});assert.deepEqual(f.counts(),{commits:0,cancels:0});f.emit(f.document,'pointerup');assert.equal(f.counts().commits,1)});
