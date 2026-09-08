import test from 'node:test';
import assert from 'node:assert/strict';
import {buildResolvedTimelinePlan,evaluationPlanFromResolvedTimeline,evaluationPlanFromTimelineMap} from '../dist/index.js';
test('outside the video interval, the base is empty instead of holding the nearest frame',()=>{
 const timeline=buildResolvedTimelinePlan([{src:'clip',at:2,in:0,out:3}],{fps:30});
 const sources=new Map([['clip',{decode:async()=>{throw Error('not decoded')}}]]),output={width:320,height:180,colorSpace:'bt709-limited'};
 for(const seconds of [0,5.1,20]){
  assert.deepEqual(evaluationPlanFromResolvedTimeline(timeline,seconds*1e6,sources,output).base,[]);
  assert.deepEqual(evaluationPlanFromTimelineMap(timeline.map,seconds*1e6,sources,output).base,[]);
 }
 assert.equal(evaluationPlanFromResolvedTimeline(timeline,3e6,sources,output).base.length,1);
});
