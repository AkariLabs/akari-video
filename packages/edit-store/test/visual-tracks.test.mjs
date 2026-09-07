import test from 'node:test';
import assert from 'node:assert/strict';
import { moveVisualItemInSource, createVisualTrackInSource } from '../lib/visual-tracks.js';
import { computeCutTrackSegments, parseEdit } from '../lib/edit-store.js';
const rows = [{id:'base',kind:'cuts',ref:0},{id:'upper',kind:'layers',ref:0}];
function fixture() { return {
    version:0, output:{width:640,height:360,fps:30}, source:{path:'assets/a.mp4',proxy:null},
    cuts:[{in:1,out:5,speed:2,opacity:.8,transform:{x:12},fx:[{id:'example'}],custom:{keep:true}}, {in:5,out:8}],
    layers:[{id:'overlay',kind:'video',src:'assets/b.mp4',t:0,duration:4,blend:'screen',chroma_key:{color:'#00ff00'},custom:{keep:true}}],
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
 const before=fixture();const moved=moveVisualItemInSource(JSON.stringify(before),rows,{kind:'layer',id:'overlay'},'base',1);
 const after=JSON.parse(moved);assert.equal(after.layers[0].track,0);assert.equal(after.layers[0].t,1);
 assert.deepEqual(mediaProps(after.layers[0]),mediaProps(before.layers[0]));assert.equal(after.cuts.length,2);
 const returned=JSON.parse(moveVisualItemInSource(moved,[],{kind:'layer',id:'overlay'},'upper',0));
 assert.equal(returned.layers[0].track,1);assert.equal(returned.timeline.tracks.length,2);
 assert.deepEqual(computeCutTrackSegments(parseEdit(moved).cuts).map(s=>s.at),[0,2]);
});
test('source and destination row IDs/labels remain stable, including empty rows',()=>{
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
 assert.equal(final.layers[0].track,final.timeline.tracks.find(t=>t.id==='upper').ref);
});

test('normalization and insertion retain unknown visual and nonvisual row metadata',()=>{
 const before=fixture();before.timeline={tracks:[...rows.map(r=>({...r,customColor:'keep'})),{id:'audio',kind:'audio',ref:0,customRole:'keep'}]};
 const moved=moveVisualItemInSource(JSON.stringify(before),rows,{kind:'cut',index:0},'upper',0);
 const normalized=JSON.parse(moved);assert.equal(normalized.timeline.tracks[0].customColor,'keep');assert.equal(normalized.timeline.tracks[2].customRole,'keep');
 const added=JSON.parse(createVisualTrackInSource(moved,[]).source);assert.equal(added.timeline.tracks.find(r=>r.id==='audio').customRole,'keep');
});
