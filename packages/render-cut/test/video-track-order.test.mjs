import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrackOrder, usesDefaultTrackOrder } from '../src/track-order.mjs';
const edit={cuts:[{in:0,out:2,track:1}],layers:[{id:'l',kind:'video',src:'b.mp4',t:0,duration:2,track:0}],timeline:{tracks:[{id:'a',kind:'video',ref:0},{id:'b',kind:'video',ref:1}]}};
test('video rows expand native media in declared bottom-to-top order',()=>{
 assert.deepEqual(resolveTrackOrder(edit).map(t=>[t.kind,t.ref]),[['layers',0],['cuts',1]]);
 assert.equal(usesDefaultTrackOrder(edit),false);
 assert.deepEqual(resolveTrackOrder({...edit,timeline:{tracks:[...edit.timeline.tracks].reverse()}}).map(t=>[t.kind,t.ref]),[['cuts',1],['layers',0]]);
});
test('non-overlapping native streams share one declared video row',()=>{
 const mixed={...edit,layers:[{...edit.layers[0],track:1,t:2}]};
 assert.deepEqual(resolveTrackOrder(mixed).map(t=>[t.kind,t.ref]),[['cuts',1],['layers',1]]);
 assert.equal(usesDefaultTrackOrder(mixed),false);
});

test('malformed optional declarations do not crash shared-track detection', async () => {
 const {hasVideoTrackContent}=await import('../src/track-order.mjs');
 assert.equal(hasVideoTrackContent({timeline:{tracks:{}}}),false);
 assert.equal(hasVideoTrackContent({timeline:{tracks:[null,{kind:'video',ref:0}]},cuts:{}}),false);
});
