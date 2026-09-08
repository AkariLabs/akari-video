import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/browser/akari-preview-open-handler.ts',import.meta.url),'utf8');
function fragment(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)))}
const gesture=fragment('            const beginMediaTransformDrag =','            const beginLayerMoveDrag =');
function fixture(){const window=new EventTarget();window.akari={interaction:{hideSnapGuides(){}}};let value={x:0,y:0},writes=[];const target={transformNow:()=>({...value}),applyTransform:v=>value=v,flushTransform(){},canWrite:()=>true,write:async v=>writes.push(v)};
 const begin=new Function('window',`let selectionDragActive=false,isPlaying=false;const togglePlayback=()=>{};const CLICK_THRESHOLD_PX=3;${gesture};return beginMediaTransformDrag;`)(window);
 const capture={setPointerCapture(){},hasPointerCapture:()=>false};begin(target,{pointerId:1,currentTarget:capture,clientX:0,clientY:0,preventDefault(){},stopPropagation(){}},e=>({x:e.clientX,y:e.clientY}));
 const emit=(type,x,y)=>{const e=new Event(type);Object.assign(e,{pointerId:1,clientX:x,clientY:y});window.dispatchEvent(e)};return {emit,writes,value:()=>value};}
test('release-only displacement is committed exactly once',async()=>{const f=fixture();f.emit('pointerup',40,20);f.emit('pointerup',40,20);await Promise.resolve();assert.deepEqual(f.writes,[{transform:{x:40,y:20}}])});
test('pointer cancellation restores the transform without saving',async()=>{const f=fixture();f.emit('pointermove',40,20);f.emit('pointercancel',40,20);await Promise.resolve();assert.deepEqual(f.value(),{x:0,y:0});assert.equal(f.writes.length,0)});
test('engine cut visibility follows the timeline, not the intentionally hidden legacy video',()=>{const code=fragment('            const cutInteractionVisible =','            // frame-engine 面では本編');const run=new Function('frameEngineMediaIdle','segments','allTracksHiddenByScope','hiddenTracksByScope',`const video={style:{visibility:'hidden'}},stillImage={style:{display:'none'}},activeSegmentIndex=0;const cutInteractionSegment=()=>segments[activeSegmentIndex];${code};return cutInteractionVisible();`);assert.equal(run(true,[{kind:'src',track:0}],{cuts:false},{cuts:new Set()}),true);assert.equal(run(true,[{kind:'gap'}],{cuts:false},{cuts:new Set()}),false);assert.equal(run(true,[{kind:'src',track:0}],{cuts:true},{cuts:new Set()}),false);assert.equal(run(false,[],{cuts:false},{cuts:new Set()}),false)});
