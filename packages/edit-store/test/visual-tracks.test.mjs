import test from 'node:test';
import assert from 'node:assert/strict';
import { moveVisualItemInSource, createVisualTrackInSource, planVisualMove, visualTrackIntervals, findVisualFreeSlot } from '../lib/visual-tracks.js';
import { computeCutTrackSegments, parseEdit } from '../lib/edit-store.js';
const rows = [{id:'base',kind:'cuts',ref:0},{id:'upper',kind:'layers',ref:0}];
function fixture() { return {
    version:0, output:{width:640,height:360,fps:30}, source:{path:'assets/a.mp4',proxy:null},
    cuts:[{in:1,out:5,speed:2,opacity:.8,transform:{x:12},fx:[{id:'example'}],custom:{keep:true}}, {in:5,out:8}],
    layers:[{id:'overlay',kind:'video',src:'assets/b.mp4',t:0,duration:2,blend:'screen',chroma_key:{color:'#00ff00'},custom:{keep:true}}],
    tracks:{cuts:[{muted:true}],layers:[{hidden:true}]}, audio:{bgm:{path:'song.wav',gain_db:-12}},
    customProject:{unchanged:true}
}; }
function mediaProps(item) { const {at,track,t,...rest}=item; return rest; }
test('cut crosses into layer row without conversion; trim/speed/audio/unknown fields and follower time survive',()=>{
 const before=fixture();const after=JSON.parse(moveVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},'upper',2));
 assert.deepEqual(mediaProps(after.cuts[0]),mediaProps(before.cuts[0]));
 assert.equal(after.cuts[0].track,1);assert.equal(after.cuts[0].at,2);
 assert.equal(after.cuts[1].at,2);assert.equal(after.cuts[1].track,0);
 assert.deepEqual(after.audio,before.audio);assert.deepEqual(after.customProject,before.customProject);
 assert.equal(after.layers[0].track,1);assert.deepEqual(mediaProps(after.layers[0]),mediaProps(before.layers[0]));
 assert.deepEqual(after.timeline.tracks,rows.map((r,i)=>({...r,kind:'video',ref:i})));
 assert.deepEqual(after.tracks.cuts[0],{muted:true});assert.deepEqual(after.tracks.layers[1],{hidden:true});
 assert.deepEqual(parseEdit(JSON.stringify(after)).warnings,[]);
});
test('layer can move into cut row and back while preserving its complete payload and native type',()=>{
 const before=fixture();const moved=moveVisualItemInSource(JSON.stringify(before),rows,{kind:'layer',id:'overlay'},'base',0);
 const after=JSON.parse(moved);assert.equal(after.layers[0].track,0);assert.equal(after.layers[0].t,0);
 assert.deepEqual(mediaProps(after.layers[0]),mediaProps(before.layers[0]));assert.equal(after.cuts.length,2);
 const returned=JSON.parse(moveVisualItemInSource(moved,[],{kind:'layer',id:'overlay'},'upper',0));
 assert.equal(returned.layers[0].track,1);assert.equal(returned.timeline.tracks.length,2);
 assert.deepEqual(computeCutTrackSegments(parseEdit(moved).cuts).map(s=>s.at),[0,2]);
});
test('source and destination row IDs/labels remain stable through a swap',()=>{
 const before=fixture();before.cuts.pop();before.timeline={tracks:rows.map(r=>({...r,label:r.id}))};
 const moved=moveVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},'upper',0);
 const after=JSON.parse(moved);assert.equal(after.timeline.tracks[0].id,'base');assert.equal(after.timeline.tracks[0].label,'base');
 const back=JSON.parse(moveVisualItemInSource(moved,rows,{kind:'cut',index:0},'base',0));assert.equal(back.cuts[0].track,0);
});
test('locked targets and occupied native cut intervals reject without changing input',()=>{
 const before=JSON.stringify(fixture());assert.throws(()=>moveVisualItemInSource(before,[rows[0],{...rows[1],locked:true}],{kind:'cut',index:0},'upper',0),/ロック/);
 assert.throws(()=>moveVisualItemInSource(before,rows,{kind:'cut',index:0},'base',1),/重な/);
 assert.throws(()=>moveVisualItemInSource(before,rows,{kind:'layer',id:'overlay'},'base',-1),/時刻/);
});

test('ordinary same-row movement does not opt a legacy project into a new timeline declaration',()=>{
 const before=fixture();before.cuts.pop();before.captions={display_policy:{custom:'unchanged'}};
 const result=JSON.parse(moveVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},'base',2));
 assert.equal(result.timeline,undefined);assert.deepEqual(result.captions,before.captions);assert.equal(result.cuts[0].at,2);
});

test('inserting above a reordered shared row never shifts only one native stream',()=>{
 const moved=JSON.parse(moveVisualItemInSource(JSON.stringify(fixture()),rows,{kind:'cut',index:0},'upper',0));
 moved.timeline.tracks.reverse();
 const insertion=createVisualTrackInSource(JSON.stringify(moved),[],'base');
 const created=JSON.parse(insertion.source);
 assert.deepEqual(created.cuts,moved.cuts);assert.deepEqual(created.layers,moved.layers);
 assert.equal(insertion.track.ref,2);
 assert.deepEqual(created.timeline.tracks.map(t=>t.id),['upper','base',insertion.track.id]);
 const final=JSON.parse(moveVisualItemInSource(insertion.source,[],{kind:'cut',index:0},insertion.track.id,0));
 assert.equal(final.cuts[0].track,final.timeline.tracks.find(t=>t.id===insertion.track.id).ref);
 assert.equal(final.layers[0].track,final.timeline.tracks.find(t=>t.id==='base').ref);
});

test('normalization and insertion retain unknown visual and nonvisual row metadata',()=>{
 const before=fixture();before.timeline={tracks:[...rows.map(r=>({...r,customColor:'keep'})),{id:'audio',kind:'audio',ref:0,customRole:'keep'}]};
 const moved=moveVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},'upper',0);
 const normalized=JSON.parse(moved);assert.equal(normalized.timeline.tracks[0].customColor,'keep');assert.equal(normalized.timeline.tracks[2].customRole,'keep');
 const added=JSON.parse(createVisualTrackInSource(moved,[]).source);assert.equal(added.timeline.tracks.find(r=>r.id==='audio').customRole,'keep');
});

test('occupied cross-kind destination swaps the two videos, with no duplicates or overlapping row',()=>{
 const before=fixture();const after=JSON.parse(moveVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},'upper',0));
 assert.equal(after.cuts.length,before.cuts.length);assert.equal(after.layers.length,before.layers.length);
 assert.equal(after.cuts[0].track,1);assert.equal(after.layers[0].track,0);assert.equal(after.layers[0].t,0);
 assert.deepEqual(mediaProps(after.cuts[0]),mediaProps(before.cuts[0]));assert.deepEqual(mediaProps(after.layers[0]),mediaProps(before.layers[0]));
 const parsed=parseEdit(JSON.stringify(after));const intervals=visualTrackIntervals(parsed.cuts,parsed.layers,parsed.timeline.tracks);
 for(const row of parsed.timeline.tracks){const items=intervals.filter(i=>i.rowId===row.id).sort((a,b)=>a.start-b.start);for(let i=1;i<items.length;i++)assert.ok(items[i-1].end<=items[i].start);}
});
test('a non-overlapping time on an occupied row is a normal move, not a swap',()=>{
 const before=fixture();const parsed=parseEdit(JSON.stringify(before));const plan=planVisualMove(parsed.cuts,parsed.layers,rows,{kind:'cut',index:0},'upper',2);
 assert.equal(plan.accepted,true);assert.equal(plan.mode,'move');assert.equal(plan.swap,undefined);
 const after=JSON.parse(moveVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},'upper',2));
 assert.equal(after.layers[0].track,1);assert.equal(after.layers[0].t,0);assert.equal(after.cuts[0].at,2);
});
test('cross-row swaps preserve the displaced video start time',()=>{
 const before=fixture();before.cuts.pop();before.layers[0].t=.5;before.layers[0].duration=1;
 const after=JSON.parse(moveVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},'upper',0));
 assert.equal(after.layers[0].t,.5);assert.equal(after.layers[0].duration,1);assert.equal(after.layers[0].track,0);
});
test('a swap that cannot fit its receiving row is rejected without a partial move',()=>{
 const before=fixture();before.layers[0].duration=4;const source=JSON.stringify(before);
 assert.throws(()=>moveVisualItemInSource(source,rows,{kind:'cut',index:0},'upper',0),/入れ替え先/);
 assert.deepEqual(JSON.parse(source),before);
});
test('a move overlapping multiple videos is rejected rather than stacking or discarding them',()=>{
 const before=fixture();before.layers.push({...before.layers[0],id:'second',t:2});before.cuts[0].speed=1;
 assert.throws(()=>moveVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},'upper',0),/複数/);
});
test('same-row swap is atomic even for two native cuts',()=>{
 const before=fixture();before.layers=[];before.cuts=[{in:0,out:2},{in:2,out:4}];
 const after=JSON.parse(moveVisualItemInSource(JSON.stringify(before),[rows[0]],{kind:'cut',index:0},'base',2));
 assert.deepEqual(after.cuts.map(c=>[c.in,c.out,c.at]),[[0,2,2],[2,4,0]]);
});
test('new material uses the first free time across both native storage kinds; touching endpoints is allowed',()=>{
 assert.equal(findVisualFreeSlot([{start:0,end:2},{start:2,end:4}],0,1),4);
 assert.equal(findVisualFreeSlot([{start:0,end:1},{start:3,end:4}],1,2),1);
 assert.equal(findVisualFreeSlot([{start:0,end:1},{start:3,end:4}],1,2.1),4);
});

test('moving into a free time slot retains an empty source row',()=>{
 const before=fixture();before.cuts.pop();
 const after=JSON.parse(moveVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},'upper',2));
 assert.equal(after.timeline.tracks.length,2);assert.equal(after.cuts[0].track,1);assert.equal(after.layers[0].track,1);
 assert.equal(after.cuts[0].at,2);assert.equal(after.layers[0].t,0);
});
