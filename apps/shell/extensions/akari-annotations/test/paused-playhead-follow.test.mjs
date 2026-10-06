import test from 'node:test';
import assert from 'node:assert/strict';
import { readCompiledSource } from './helpers/widget-source.mjs';
import { TimelinePlayheadFollow } from '../lib/browser/timeline/timeline-playhead-follow.js';
const source=readCompiledSource('widget').text;const rest=source.slice(source.indexOf('    handlePlaybackTick('));const method=rest.slice(0,rest.indexOf('\n    }')+6);const Widget=new Function(`return class {${method}}`)();
const fixture=()=>{
 const widget=Object.assign(new Widget(),{canHandlePlaybackTick:()=>true,visualThumbnails:{setPaused(){}},selectionModel:{},playhead:{style:{}},viewStart:12,viewDuration:10,lastManualScrollAt:0,visibleDuration:()=>10,percent:()=>0,setViewStart(value){this.viewStart=value},resolveCaptionAtPlayhead:()=>undefined,applyCaptionStateClasses(){}});
 widget.playheadFollow=new TimelinePlayheadFollow({viewStart:()=>widget.viewStart,visibleDuration:()=>widget.visibleDuration(),canFollow:()=>!widget.dragState&&!widget.visualPointerDown&&Date.now()-widget.lastManualScrollAt>=3000,setViewStart:value=>widget.setViewStart(value)});
 return widget;
};
test('paused updates after saving do not recenter the timeline',()=>{for(const time of [0,6,30]){const w=fixture();w.handlePlaybackTick({time,playing:false});assert.equal(w.playheadT,time);assert.equal(w.viewStart,12)}});
test('active playback still follows the playhead',()=>{const w=fixture();w.handlePlaybackTick({time:30,playing:true});assert.equal(w.viewStart,22.2)});
test('pointer gestures and recent manual interaction suspend playback following',()=>{for(const state of [{dragState:{}},{visualPointerDown:true},{lastManualScrollAt:Date.now()}]){const w=Object.assign(fixture(),state);w.handlePlaybackTick({time:30,playing:true});assert.equal(w.viewStart,12)}});
