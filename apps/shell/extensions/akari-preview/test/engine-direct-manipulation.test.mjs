import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/browser/akari-preview-open-handler.ts',import.meta.url),'utf8');
function fragment(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)))}
const gesture=fragment('            const beginMediaTransformDrag =','            const beginLayerMoveDrag =');
const guard=fragment('            let selectionDragActive =','            let suppressClick =');
function fixture(staleRead=false){const window=new EventTarget();window.akari={reportGesture(){},interaction:{hideSnapGuides(){}}};let value={x:0,y:0},writes=[];const target={transformNow:()=>staleRead?{x:0,y:0}:{...value},applyTransform:v=>value=v,flushTransform(){},canWrite:()=>true,write:async v=>writes.push(v)};
 const document={body:{classList:{add(){},remove(){}},style:{},appendChild(){}},createElement:()=>({style:{},setAttribute(){},remove(){}})};
 const begin=new Function('window','document',`${guard};let isPlaying=false;const togglePlayback=()=>{};const CLICK_THRESHOLD_PX=3;${gesture};return beginMediaTransformDrag;`)(window,document);
 const capture={setPointerCapture(){},hasPointerCapture:()=>false};begin(target,{pointerId:1,currentTarget:capture,clientX:0,clientY:0,preventDefault(){},stopPropagation(){}},e=>({x:e.clientX,y:e.clientY}));
 const emit=(type,x,y)=>{const e=new Event(type);Object.assign(e,{pointerId:1,clientX:x,clientY:y});window.dispatchEvent(e)};return {emit,writes,value:()=>value};}
test('release-only displacement is committed exactly once',async()=>{const f=fixture();f.emit('pointerup',40,20);f.emit('pointerup',40,20);await Promise.resolve();assert.deepEqual(f.writes,[{transform:{x:40,y:20}}])});
test('media drag commits its live pose even if keyframe evaluation makes a later DOM read stale',async()=>{const f=fixture(true);f.emit('pointermove',40,20);f.emit('pointerup',40,20);await Promise.resolve();assert.deepEqual(f.value(),{x:40,y:20});assert.deepEqual(f.writes,[{transform:{x:40,y:20}}])});
test('pointer cancellation restores the transform without saving',async()=>{const f=fixture();f.emit('pointermove',40,20);f.emit('pointercancel',40,20);await Promise.resolve();assert.deepEqual(f.value(),{x:0,y:0});assert.equal(f.writes.length,0)});
test('selected cut pointerdown suppresses the overlay capture for that gesture',async()=>{
 const begin=source.indexOf("            window.addEventListener('pointerdown', event => {",source.indexOf("const cutSelectBox ="));
 const end=source.indexOf('            let selectionCutSource;',begin);
 assert.ok(begin>=0&&end>begin);
 let handler;const enabled=[];const video={};
 const window={akari:{interaction:{setEnabled:value=>enabled.push(value)}},addEventListener:(_type,callback)=>{handler=callback}};
 new Function('window','video','stillImage','findVisualMediaHitAt','cutSelected','Element',source.slice(begin,end))
   (window,video,{},()=>video,true,class Element{});
 handler({button:0,target:{}});
 assert.deepEqual(enabled,[false]);
 await Promise.resolve();
 assert.deepEqual(enabled,[false,true]);
});
test('selected cut leaves Alt overlay drag enabled when the overlay is visibly on top', () => {
 const begin=source.indexOf("            window.addEventListener('pointerdown', event => {",source.indexOf("const cutSelectBox ="));
 const end=source.indexOf('            let selectionCutSource;',begin);
 let handler;const enabled=[];const video={};
 class Element { closest(selector) { return selector.includes('[data-overlay-id]') ? this : null; } }
 const window={akari:{interaction:{setEnabled:value=>enabled.push(value)}},addEventListener:(_type,callback)=>{handler=callback}};
 new Function('window','video','stillImage','findVisualMediaHitAt','cutSelected','Element',source.slice(begin,end))
   (window,video,{},()=>video,true,Element);
 handler({button:0,altKey:true,target:new Element()});
 assert.deepEqual(enabled,[]);
});
test('cut keyframe evaluation yields to an active handle gesture',()=>{
 assert.match(fragment('            const applyCutKeyframesToMedia =','            const clearAdjustBaseFilter ='),
   /selectionGestureProtects\('cut'\)/u);
 assert.match(fragment('            const cutSelectionVideo =','            const cutInteractionMedia ='),
   /!selectionGestureProtects\('cut'\)/u);
});
test('frame-engine live cut pose updates the playhead point for rendering',()=>{
 const match=source.match(/applyTransformPreview\(target, transform, playheadSeconds\) \{([\s\S]*?)\n\s*\},\n\s*applyLivePreview/u);
 assert.ok(match);
 const current={output:{fps:30},cuts:[{at:0,keyframes:[{t:0,transform:{x:0}},{t:3,transform:{x:30}}]}]};
 const run=new Function('queueEngineSummaryUpdate','summaryWithLivePreview',
   `return function(target,transform,playheadSeconds){${match[1]}}`)
   (fn=>fn(current),()=>assert.fail('static path used'));
 const result=run({kind:'cut',index:0},{x:50,y:10,scale:1.2,rotate:15},1);
 assert.equal(result.cuts[0].keyframes.find(point=>point.t===1).transform.x,50);
 assert.equal(result.cuts[0].keyframes.length,3);
 assert.equal(current.cuts[0].keyframes.length,2);
 const staticSummary={output:{fps:30},cuts:[{at:0,transform:{x:0}}]};
 let staticFields=0;
 const staticRun=new Function('queueEngineSummaryUpdate','summaryWithLivePreview',
   `return function(target,transform,playheadSeconds){${match[1]}}`)
   (fn=>fn(staticSummary),(value,message)=>{staticFields++;return {...value,cuts:[{...value.cuts[0],transform:{...value.cuts[0].transform,[message.field]:message.value}}]};});
 assert.equal(staticRun({kind:'cut',index:0},{x:50,y:10,scale:1.2,rotate:15},1).cuts[0].transform.x,50);
 assert.equal(staticFields,4);
});
test('engine cut visibility follows the timeline, not the intentionally hidden legacy video',()=>{const code=fragment('            const cutInteractionVisible =','            // frame-engine 面では本編');const run=new Function('frameEngineMediaIdle','segments','allTracksHiddenByScope','hiddenTracksByScope',`const video={style:{visibility:'hidden'}},stillImage={style:{display:'none'}},activeSegmentIndex=0;const cutInteractionSegment=()=>segments[activeSegmentIndex];${code};return cutInteractionVisible();`);assert.equal(run(true,[{kind:'src',track:0}],{cuts:false},{cuts:new Set()}),true);assert.equal(run(true,[{kind:'gap'}],{cuts:false},{cuts:new Set()}),false);assert.equal(run(true,[{kind:'src',track:0}],{cuts:true},{cuts:new Set()}),false);assert.equal(run(false,[],{cuts:false},{cuts:new Set()}),false)});
