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
