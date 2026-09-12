import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');const rest=source.slice(source.indexOf('    handlePlaybackTick('));const method=rest.slice(0,rest.indexOf('\n    }')+6);const Widget=new Function(`const PLAYHEAD_FOLLOW_THRESHOLD=.8;return class {${method}}`)();
const fixture=()=>Object.assign(new Widget(),{canHandlePlaybackTick:()=>true,visualThumbnails:{setPaused(){}},selectionModel:{},playhead:{style:{}},viewStart:12,viewDuration:10,lastManualScrollAt:0,visibleDuration:()=>10,percent:()=>0,setViewStart(value){this.viewStart=value},resolveCaptionAtPlayhead:()=>undefined,applyCaptionStateClasses(){}});
test('paused updates after saving do not recenter the timeline',()=>{for(const time of [0,6,30]){const w=fixture();w.handlePlaybackTick({time,playing:false});assert.equal(w.playheadT,time);assert.equal(w.viewStart,12)}});
test('active playback still follows the playhead',()=>{const w=fixture();w.handlePlaybackTick({time:30,playing:true});assert.equal(w.viewStart,22)});
test('pointer gestures and recent manual interaction suspend playback following',()=>{for(const state of [{dragState:{}},{visualPointerDown:true},{lastManualScrollAt:Date.now()}]){const w=Object.assign(fixture(),state);w.handlePlaybackTick({time:30,playing:true});assert.equal(w.viewStart,12)}});
