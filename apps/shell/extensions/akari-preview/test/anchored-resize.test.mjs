import test from 'node:test';
import assert from 'node:assert/strict';
import {computeAnchoredResize} from '../lib/common/anchored-resize.js';
for(const corner of ['nw','ne','sw','se'])for(const rotate of [0,35])test(`${corner} resize keeps the opposite corner fixed at rotation ${rotate}`,()=>{
 const original={x:12,y:-25,scale:.5,rotate};const crop={x:.1,y:.2,w:.7,h:.6};const a=computeAnchoredResize(original,640,360,corner,.5,crop),b=computeAnchoredResize(original,640,360,corner,1.3,crop);
 assert.ok(Math.abs(a.anchor.x-b.anchor.x)<1e-8);assert.ok(Math.abs(a.anchor.y-b.anchor.y)<1e-8);
 const recheck=computeAnchoredResize(b.transform,640,360,corner,1.3,crop);assert.ok(Math.abs(recheck.anchor.x-a.anchor.x)<1e-8);assert.ok(Math.abs(recheck.anchor.y-a.anchor.y)<1e-8);
});
test('bottom-right enlargement from a top-left aligned half-size box fills the canvas exactly',()=>{
 const result=computeAnchoredResize({x:-160,y:-90,scale:.5,rotate:0},640,360,'se',1);
 assert.deepEqual(result.transform,{x:0,y:0,scale:1,rotate:0});assert.deepEqual(result.anchor,{x:-320,y:-180});
});
