import test from 'node:test';
import assert from 'node:assert/strict';
import {previewContentEnd} from '../lib/common/preview-content-end.js';
test('caption, HTML and each audio kind may extend past the final video',()=>{
 assert.equal(previewContentEnd({},[{end:12}],5),12);
 assert.equal(previewContentEnd({overlays:[{start:7,duration:4}]},[],5),11);
 for(const kind of ['bgm','sfx','narration','speech']){
  const item={t:10,in:3,out:8};const audio={[kind]:kind==='bgm'?item:[item]};
  assert.equal(previewContentEnd({audio},[],5),15);
 }
 assert.equal(previewContentEnd({audio:{bgm:{sidecar:{durationSec:30}}}},[],0),30);
 assert.equal(previewContentEnd({audio:{bgm:{sidecar:{durationSec:30}}}},[],5),5);
 assert.equal(previewContentEnd({},[],5,23),23);
});
test('trims and speed bound the audible duration',()=>{
 assert.equal(previewContentEnd({audio:{sfx:[{t:2,in:5,out:9,speed:2}]}},[],0),4);
 assert.equal(previewContentEnd({audio:{sfx:[{t:2,in:0,out:30,durationSec:3}]}},[],0),5);
});
test('all BGM clips contribute their explicit end while one clip keeps legacy duration',()=>{
 const first={t:0,duration:3}; const second={t:3,duration:3};
 assert.equal(previewContentEnd({audio:{bgms:[first,second],narration:[{t:4,duration:0.5}]}},[],0),6);
 assert.equal(previewContentEnd({audio:{bgm:first}},[],0),3);
 assert.equal(previewContentEnd({audio:{bgms:[first],bgm:first}},[],0),3);
 assert.equal(previewContentEnd({audio:{bgms:[{t:0,durationSec:3},{t:3,in:1,out:4}]}},[],0),6);
});
test('multiple automatic BGM tails keep the legacy audio-only rule',()=>{
 const bgms=[{t:0,sidecar:{durationSec:3}},{t:3,sidecar:{durationSec:3}}];
 assert.equal(previewContentEnd({audio:{bgms}},[],0),6);
 assert.equal(previewContentEnd({audio:{bgms}},[],4.5),4.5);
});
