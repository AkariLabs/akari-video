import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceMaterialTrialWindow } from '../lib/common/material-trial-window.js';
const fresh = () => ({ token: 'current', start: 1.4, end: 5.2, started: false, seenStart: false, stopped: false });
function run(state, time, playing = true, trialToken = 'current', activeToken = 'current') {
 return advanceMaterialTrialWindow(state, activeToken, {time, playing, trialToken});
}
test('measured old positions 11.23 / 7.08 / 6.93 are ignored until the seek window is observed', () => {
 let state = fresh(), pauses = 0;
 for (const time of [11.23,7.08,6.93,1.40,1.43,5.19,5.21,5.24,11.23]) {
  const next = run(state,time); state = next.state; pauses += Number(next.pause);
  if(time===11.23 && !state.seenStart) assert.equal(next.pause,false);
  if(time===5.19) assert.equal(pauses,0);
 }
 assert.equal(pauses,1);assert.equal(state.stopped,true);
});
test('observing the head without playback, or playback without the head, cannot arm stopping', () => {
 let state = run(fresh(),1.4,false).state;
 assert.equal(run(state,5.3,false).pause,false);
 state = run(fresh(),11.23,true).state;
 assert.equal(run(state,5.3,true).pause,false);
});
test('lower tolerance is inclusive, end is exclusive for arming', () => {
 assert.equal(run(fresh(),1.4-0.25).state.seenStart,true);
 assert.equal(run(fresh(),1.4-0.25-0.001).state.seenStart,false);
 assert.equal(run(fresh(),5.2).state.seenStart,false);
 const armed=run(fresh(),1.4).state;
 assert.equal(run(armed,5.2,false).pause,true,'natural end may already report paused');
});
test('zero-start still clips use the same protection', () => {
 let state={...fresh(),start:0,end:2};
 assert.equal(run(state,6.93).pause,false);
 state=run(state,0).state;
 assert.equal(run(state,2.06).pause,true);
});
test('foreign tokens, ended trials and invalid times are inert and input remains immutable', () => {
 const state=Object.freeze(fresh());
 assert.equal(run(state,1.4,true,'old').state,state);
 assert.equal(run(state,1.4,true,'current','next').state,state);
 assert.equal(advanceMaterialTrialWindow(state,undefined,{trialToken:'current',time:6,playing:true}).pause,false);
 assert.equal(run(undefined,6).pause,false);
 for(const time of [NaN,Infinity])assert.equal(run(state,time).state,state);
 run(state,1.4);assert.equal(state.seenStart,false);
});
