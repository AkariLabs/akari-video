import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as store from '../../../../../packages/edit-store/lib/edit-store.js';
import * as visual from '../../../../../packages/edit-store/lib/visual-tracks.js';
const code=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
const rest=code.slice(code.indexOf('    async commitLegacyMediaMove('));
const method=rest.slice(0,rest.indexOf('\n    }')+6);
const Widget=new Function('edit_store_1','visual_tracks_1',`return class {${method}}`)(store,visual);
const seed={version:1,sources:[{id:'base',path:'base.mp4'}],cuts:[{src:'base',in:0,out:2},{src:'base',in:2,out:4}],layers:[{id:'title',kind:'baked',src:'title.mov',t:1,duration:2,track:0}],overlays:[{id:'html',html:'title.html',start:1,duration:2,track:0,transform:{x:40}}],captions:[{text:'字幕'}]};
for(const [name,preview,check] of [
 ['HTML move',{kind:'overlay-move',id:'html',start:3,track:1},e=>{assert.equal(e.overlays[0].start,3);assert.equal(e.overlays[0].transform.x,40)}],
 ['HTML trim',{kind:'overlay-resize',id:'html',duration:1},e=>assert.equal(e.overlays[0].duration,1)],
 ['legacy baked track',{kind:'layer',id:'title',t:4,duration:2,track:1},e=>assert.equal(e.layers[0].t,4)],
 ['legacy cut keeps next implicit cut fixed',{kind:'cut-move',index:0,at:5,track:0},e=>{assert.equal(e.cuts[0].at,5);assert.equal(e.cuts[1].at,2)}]
]) test(name,async()=>{let committed;const w=Object.assign(new Widget(),{location:{editUri:{}},displayedEditSource:JSON.stringify(seed),commitTimelineSnapshot:async(before,after)=>{committed=JSON.parse(after)}});await w.commitLegacyMediaMove(preview);check(committed);assert.deepEqual(committed.captions,seed.captions)});
