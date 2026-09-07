import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
const start=source.indexOf('    updateDragPreview('),rest=source.slice(start),method=rest.slice(0,rest.indexOf('\n    }')+6);
for(const kind of ['cut-move','layer'])test(`${kind}: stale snap line disappears when free-slot placement moves the ghost`,()=>{
 let plan={accepted:true,time:5};
 const Widget=new Function('visual_tracks_1',`const DRAG_THRESHOLD_PX=3;return class {${method}}`)({planVisualMove:()=>plan});
 const w=Object.assign(new Widget(),{formatTimestamp:String,snapEnabled:true,strip:{getBoundingClientRect:()=>({width:100})},visibleDuration:()=>10,hideSnapGuide(){this.guide=false},setGhostSnapped(){},snapMovingRangeInOutputSpace(start,duration,show){this.guide=show;return {time:3,snapped:true}},visualRowDropAtClientY:()=>({kind:'track',id:'dest',top:100,height:72}),setGhostRange(g,start,end){this.range=[start,end]},setGhostRejected(){},hideTrackInsertIndicator(){},updateDragFeedback(){}});
 const state={kind,index:0,id:'blue',mode:'move',originalAt:0,originalT:0,originalTrack:0,duration:2,originalDuration:2,startClientX:0,ghost:{style:{}}};
 w.updateDragPreview(state,30,100,true);assert.deepEqual(w.range,[5,7]);assert.equal(w.guide,false);
 plan={accepted:true,time:3};w.updateDragPreview(state,30,100,true);assert.equal(w.guide,true);
 plan={accepted:false,reason:'locked'};w.updateDragPreview(state,30,100,true);assert.equal(w.guide,false);
});
function extract(name){const at=source.indexOf(`    ${name}(`),text=source.slice(at);return text.slice(0,text.indexOf('\n    }')+6);}
const SnapWidget=new Function(`return class {${['snapMovingRangeInOutputSpace','snapTimeInOutputSpaceWithResult','outputSnapCandidates','nearestCandidate'].map(extract).join('\n')}}`)();
test('magnet uses other material edges, without grid, playhead, selection or original-edge snapping',()=>{
 const w=Object.assign(new SnapWidget(),{snapEnabled:true,segments:[{index:0,tlStart:0,tlEnd:2}],layers:[{t:4,duration:2}],overlays:[],audioSfx:[],playheadT:2.37,selectedSourceT:2.37,snapThresholdSeconds:()=>.08,hideSnapGuide(){this.guide=undefined},showSnapGuideAt(t){this.guide=t}});
 assert.deepEqual(w.snapMovingRangeInOutputSpace(2.37,1,true),{time:2.37,snapped:false});assert.equal(w.guide,undefined);
 assert.deepEqual(w.snapMovingRangeInOutputSpace(2.04,1,true),{time:2,snapped:true});assert.equal(w.guide,2);
 assert.deepEqual(w.snapMovingRangeInOutputSpace(3.04,1,true),{time:3,snapped:true});assert.equal(w.guide,4);
 w.dragState={kind:'cut-move',index:0};
 assert.deepEqual(w.snapMovingRangeInOutputSpace(2.04,1,true,[{time:0},{time:2}]),{time:2.04,snapped:false});assert.equal(w.guide,undefined);
 assert.deepEqual(w.snapTimeInOutputSpaceWithResult(2.37,true),{time:2.37,snapped:false});
});

for(const kind of ['cut-move','layer'])test(`${kind}: equal-length peers remain snap targets and show both aligned edges`,()=>{
 const w=Object.assign(new SnapWidget(),{snapEnabled:true,segments:[{index:0,tlStart:0,tlEnd:2},{index:1,tlStart:0,tlEnd:2}],layers:[{id:'blue',t:0,duration:2}],overlays:[],audioSfx:[],dragState:{kind,index:0,id:'blue'},snapEndGuide:{style:{}},percent:t=>t*10,snapThresholdSeconds:()=>.08,hideSnapGuide(){this.guide=undefined;this.snapEndGuide.style.display='none'},showSnapGuideAt(t){this.guide=t;this.snapEndGuide.style.display='none'}});
 assert.deepEqual(w.snapMovingRangeInOutputSpace(.03,2,true,[{time:0},{time:2}]),{time:0,snapped:true});
 assert.equal(w.guide,0);assert.equal(w.snapEndGuide.style.left,'20%');assert.equal(w.snapEndGuide.style.display,'block');
 w.snapMovingRangeInOutputSpace(.4,2,true);assert.equal(w.guide,undefined);assert.equal(w.snapEndGuide.style.display,'none');
});
