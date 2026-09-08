import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestTimelineViewStart as reveal} from '../lib/common/selection-reveal.js';
test('already visible clips do not move the timeline',()=>{assert.equal(reveal(10,10,12,18,15),10);assert.equal(reveal(10,10,5,30,24),10)});
test('offscreen clips use the smallest shift that reveals them',()=>{assert.equal(reveal(10,10,2,6,4),2);assert.equal(reveal(10,10,24,28,26),18)});
test('a long offscreen clip reveals the current position without changing zoom',()=>{assert.equal(reveal(0,10,40,80,65),60)});
