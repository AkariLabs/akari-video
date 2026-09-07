import test from 'node:test';
import assert from 'node:assert/strict';
import { moveVisualItemInSource, insertVisualItemInSource, createVisualTrackInSource, planVisualMove,
    visualTrackIntervals, findVisualFreeSlot, resolveVisualRowDrop, pruneEmptyVisualTracksInSource } from '../lib/visual-tracks.js';
import { parseEdit } from '../lib/edit-store.js';
const rows=[{id:'base',kind:'cuts',ref:0},{id:'upper',kind:'layers',ref:0}];
function fixture(){return {version:0,output:{width:640,height:360,fps:30},source:{path:'a.mp4',proxy:null},
 cuts:[{in:1,out:5,speed:2,custom:{keep:true}}],layers:[{id:'b',kind:'video',src:'b.mp4',t:0,duration:4,blend:'screen',custom:{keep:true}}],
 audio:{bgm:{path:'music.wav',gain_db:-12}}};}
function props(item){const {at,track,t,...rest}=item;return rest;}
test('occupied row uses its next free interval; the existing clip never moves',()=>{
 const before=fixture();const after=JSON.parse(moveVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},'upper',0));
 assert.equal(after.cuts[0].at,4);assert.equal(after.layers[0].t,0);assert.equal(after.cuts[0].track,after.layers[0].track);
 assert.deepEqual(props(after.cuts[0]),props(before.cuts[0]));assert.deepEqual(props(after.layers[0]),props(before.layers[0]));assert.deepEqual(after.audio,before.audio);
 assert.equal(after.timeline.tracks.length,1);assert.equal(after.timeline.tracks[0].id,'upper');
});
test('free space on an occupied row accepts the requested time unchanged',()=>{
 const before=fixture(), parsed=parseEdit(JSON.stringify(before));
 const plan=planVisualMove(parsed.cuts,parsed.layers,rows,{kind:'cut',index:0},'upper',5);
 assert.equal(plan.accepted,true);assert.equal(plan.time,5);
});
test('multiple collisions advance to free space instead of rejecting or swapping',()=>{
 const before=fixture();before.layers.push({...before.layers[0],id:'c',t:4,duration:3});
 const after=JSON.parse(moveVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},'upper',0));
 assert.equal(after.cuts[0].at,7);assert.deepEqual(after.layers.map(i=>i.t),[0,4]);
});
test('inserting sole V2 clip below V1 reorders the two occupied rows; no V3 or empty row',()=>{
 const before=fixture();const after=JSON.parse(insertVisualItemInSource(JSON.stringify(before),rows,{kind:'layer',id:'b'},0,undefined,'base'));
 assert.deepEqual(after.timeline.tracks.map(r=>r.id),['upper','base']);assert.equal(after.cuts.length,1);assert.equal(after.layers.length,1);
 assert.equal(after.layers[0].t,0);assert.deepEqual(props(after.layers[0]),props(before.layers[0]));
 const parsed=parseEdit(JSON.stringify(after));const items=visualTrackIntervals(parsed.cuts,parsed.layers,parsed.timeline.tracks);
 for(const row of parsed.timeline.tracks)assert.equal(items.filter(item=>item.rowId===row.id).length,1);
});
test('inserting bottom clip above top clip reuses its row ID',()=>{
 const after=JSON.parse(insertVisualItemInSource(JSON.stringify(fixture()),rows,{kind:'cut',index:0},0,'upper'));
 assert.deepEqual(after.timeline.tracks.map(r=>r.id),['upper','base']);assert.equal(after.cuts[0].at,0);
});
test('splitting one of several clips into a new row adds an occupied row only',()=>{
 const before=fixture();before.cuts.push({in:5,out:7,at:3});
 const after=JSON.parse(insertVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},0,undefined,'base'));
 assert.equal(after.timeline.tracks.length,3);assert.equal(after.cuts[1].at,3);
 const parsed=parseEdit(JSON.stringify(after)), intervals=visualTrackIntervals(parsed.cuts,parsed.layers,parsed.timeline.tracks);
 for(const row of parsed.timeline.tracks)assert.ok(intervals.some(item=>item.rowId===row.id));
});
test('empty persisted video declarations are pruned; other domains are retained',()=>{
 const value=fixture();value.timeline={tracks:[...rows,{id:'empty',kind:'video',ref:9},{id:'captions',kind:'captions'}]};
 const after=JSON.parse(pruneEmptyVisualTracksInSource(JSON.stringify(value)));
 assert.deepEqual(after.timeline.tracks.map(r=>r.id),['base','upper','captions']);
});
test('locked source or target rejects movement without a partial write',()=>{
 const source=JSON.stringify(fixture());assert.throws(()=>moveVisualItemInSource(source,[rows[0],{...rows[1],locked:true}],{kind:'cut',index:0},'upper',0),/ロック/);
 assert.throws(()=>insertVisualItemInSource(source,[{...rows[0],locked:true},rows[1]],{kind:'cut',index:0},0,'upper'),/ロック/);
});
test('row interiors and before/after boundaries match the legacy timeline convention',()=>{
 const geometry=[{id:'upper',top:100,height:60},{id:'middle',top:166,height:60},{id:'lower',top:232,height:60}];
 assert.deepEqual(resolveVisualRowDrop(geometry,95,'upper'),{kind:'none'});
 assert.deepEqual(resolveVisualRowDrop(geometry,300,'upper'),{kind:'between',belowId:'lower',top:292});
 assert.deepEqual(resolveVisualRowDrop(geometry,230,'upper'),{kind:'between',aboveId:'lower',top:232});
 assert.equal(resolveVisualRowDrop(geometry,190,'upper').kind,'track');
 assert.equal(resolveVisualRowDrop(geometry,166,'upper').kind,'none');
});
test('half-open free slots allow touching endpoints and respect gaps',()=>{
 assert.equal(findVisualFreeSlot([{start:0,end:2},{start:2,end:4}],0,1),4);
 assert.equal(findVisualFreeSlot([{start:0,end:1},{start:3,end:4}],1,2),1);
});
test('temporary insertion candidate allocates a unique ref and preserves row metadata',()=>{
 const value=fixture();value.timeline={tracks:rows.map(r=>({...r,customColor:'keep'}))};
 const inserted=createVisualTrackInSource(JSON.stringify(value),rows,undefined,'base');
 const after=JSON.parse(inserted.source);assert.equal(after.timeline.tracks[0].id,inserted.track.id);assert.equal(inserted.track.ref,1);
 assert.equal(after.timeline.tracks.find(r=>r.id==='base').customColor,'keep');
});

test('dropping a sole clip below its own row is a no-op, never an empty extra track',()=>{
 const value=fixture();value.layers=[];const source=JSON.stringify(value);
 assert.equal(insertVisualItemInSource(source,[rows[0]],{kind:'cut',index:0},0,undefined,'base'),source);
});

test('multi-clip source can split into its adjacent gap, and beyond either outer boundary',()=>{
 const geometry=[{id:'upper',top:100,height:60},{id:'lower',top:166,height:60}];
 for(const y of [160,163,166]) assert.deepEqual(resolveVisualRowDrop(geometry,y,'upper',2),{kind:'between',aboveId:'lower',top:166});
 assert.deepEqual(resolveVisualRowDrop(geometry,95,'upper',2),{kind:'between',aboveId:'upper',top:100});
 assert.deepEqual(resolveVisualRowDrop(geometry,230,'lower',2),{kind:'between',belowId:'lower',top:226});
});

test('splitting two clips on the only row works above and below without changing time',()=>{
 const value={version:0,source:{path:'red.webm',proxy:null},cuts:[{in:0,out:2,at:0,track:0},{in:0,out:2,at:4,track:0}],layers:[],timeline:{tracks:[{id:'only',kind:'video',ref:0}]}};
 for(const above of [true,false]){
  const moved=JSON.parse(insertVisualItemInSource(JSON.stringify(value),[],{kind:'cut',index:1},4,above?'only':undefined,above?undefined:'only'));
  assert.equal(moved.timeline.tracks.length,2);assert.equal(moved.cuts[1].at,4);
  assert.notEqual(moved.cuts[0].track,moved.cuts[1].track);
  assert.equal(moved.timeline.tracks[above?0:1].id,'only');
 }
});
