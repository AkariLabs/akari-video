import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
function method(name){const rest=source.slice(source.indexOf('    '+name+'('));return rest.slice(0,rest.indexOf('\n    }')+6)}
const Widget=new Function(`return class {${method('videoClipLabel')} ${method('videoLayerMedia')} ${method('cutVideoUri')}}`)();
function fixture(raw){return Object.assign(new Widget(),{rawV2Item:()=>raw,sourceMap:new Map([['base',{path:'assets/grid.mp4',videoUri:'file:///grid.mp4'}]])})}
test('upper-track media uses its actual source window and the same label as a cut',()=>{
 const w=fixture({source:{kind:'media',src:'base',in:4,out:10},speed:2});
 const media=w.videoLayerMedia({id:'cut-2',kind:'video',src:'assets/grid.mp4',t:20,duration:3,track:2});
 assert.equal(media.videoUri,'file:///grid.mp4');assert.equal(media.label,w.videoClipLabel('cut-1',{src:'base'}));
 assert.deepEqual([media.segment.in,media.segment.out,media.segment.tlStart,media.segment.tlEnd,media.segment.speed],[4,10,20,23,2]);
});
test('legacy video paths and custom clip names stay supported',()=>{
 const w=fixture({name:'名前'});w.location={editUri:'edit'};w.resolveEditMediaUri=path=>({toString:()=>`file:///${path}`});
 const media=w.videoLayerMedia({id:'legacy',kind:'video',src:'other.mp4',t:2,duration:5});
 assert.equal(media.label,'名前');assert.equal(media.videoUri,'file:///other.mp4');assert.equal(media.cut.out,5);
});
