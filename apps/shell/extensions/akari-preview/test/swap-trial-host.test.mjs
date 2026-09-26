import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as playback from '../lib/common/swap-trial-playback.js';
import * as gesture from '../lib/common/preview-gesture-guard.js';
import * as refresh from '../lib/common/preview-refresh-state.js';
const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
test.before(()=>Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> '1'}}));
test.after(()=>{if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete globalThis.localStorage;});
const source=readFileSync(new URL('../lib/browser/akari-preview-open-handler.js',import.meta.url),'utf8');
const method=name=>{const start=source.search(new RegExp('    (async )?'+name+'\\('));assert.notEqual(start,-1);const rest=source.slice(start);return rest.slice(0,rest.indexOf('\n    }')+6);};
const forwarded=[];
class CustomEvent { constructor(type,options){this.type=type;this.detail=options.detail;} }
class URI{constructor(value){this.value=value;}normalizePath(){return this;}toString(){return this.value;}}
const Host=new Function('uri_1','swap_trial_playback_1','preview_gesture_guard_1','preview_refresh_state_1','window','CustomEvent','PREVIEW_PLAYBACK_TICK_EVENT',`return class { ${['beginSwapTrial','endSwapTrial','playSwapTrial','noteSwapReload','refreshSwapTrial','queueRefresh','pauseOutputPreview','forwardPlaybackTick'].map(method).join('\n')} }`)({default:URI},playback,gesture,refresh,{dispatchEvent:event=>forwarded.push(event)},CustomEvent,'akari.preview.playbackTick');
test('host sends a tokened request, checks actual page state, and retries only play after a lost first send',async()=>{
 const listeners=new Set(),messages=[], seeks=[];let attempts=0,playing=false;
 const widget={akariPreviewPlaybackPageId:'page',akariPreviewEditUri:new URI('edit'),
  sendMessage(message){messages.push(message);if(message.type==='akari-preview-set-playback')playing=++attempts===2;
   if(message.type==='akari-preview-swap-playback-query')queueMicrotask(()=>listeners.forEach(fn=>fn({type:'akari-preview-swap-playback-state',token:message.token,pageId:'page',playing})));},
  onMessage(fn){listeners.add(fn);return{dispose(){listeners.delete(fn);}};}};
 const h=Object.assign(new Host(),{swapTrialPlaybacks:new Map(),openOutputPreviews:new Map([['edit',widget]]),
  seekOutputPreview:async request=>{seeks.push(request);return 'seeked';}});
 const request={editUri:'edit',token:'test-host',startedAt:Date.now(),time:1.4};h.beginSwapTrial(request);
 assert.equal(await h.playSwapTrial(request),'playing');assert.equal(attempts,2);assert.equal(seeks.length,1);
 assert.equal(seeks[0].seek,true);assert.equal(seeks[0].swapTrialToken,request.token);assert.equal(listeners.size,0);
 h.endSwapTrial(request.token);assert.equal(await h.playSwapTrial(request),'cancelled');
});
test('current-page reload logs have matching tokens and reject stale completion',()=>{
 const logs=[],old=console.info;console.info=(...args)=>logs.push(JSON.parse(args[1]));
 try{
 const widget={akariPreviewPlaybackPageId:'new',akariPreviewEditUri:new URI('edit'),sendMessage(){}};
 const h=Object.assign(new Host(),{swapTrialPlaybacks:new Map(),openOutputPreviews:new Map([['edit',widget]])});
 h.beginSwapTrial({editUri:'edit',token:'reload',startedAt:Date.now()});
 h.noteSwapReload(widget,'reload_start');h.noteSwapReload(widget,'reload_complete','old');
 assert.equal(h.swapTrialPlaybacks.get('edit').state.loading,true);
 h.noteSwapReload(widget,'reload_complete','new');assert.equal(h.swapTrialPlaybacks.get('edit').state.loading,false);
 assert.deepEqual(logs.filter(x=>x.event.startsWith('reload')).map(x=>[x.token,x.event]),[['reload','reload_start'],['reload','reload_complete']]);
 }finally{console.info=old;}
});
test('renderer requests are idempotent and real manual stop blocks retry until a new token',()=>{
 const states=[];let toggles=0;
 const context=vm.createContext({isPlaying:false,swapTrialToken:undefined,swapTrialUserStopped:false,
  window:{akari:{reportSwapPlayback:state=>states.push(state)}}});
 context.togglePlayback=()=>{toggles++;context.isPlaying=!context.isPlaying;};
 const reportStart=source.indexOf('            const reportSwapState =');
 const reportEnd=source.indexOf("            playToggle.addEventListener('click',",reportStart);
 vm.runInContext(source.slice(reportStart,reportEnd),context);
 const start=source.indexOf("                if (message?.type === 'akari-preview-swap-trial-context')");
 const end=source.indexOf("                if (message?.type === 'akari-preview-set-crop-mode')",start);
 vm.runInContext(`function receive(message){${source.slice(start,end)}}`,context);
 context.receive({type:'akari-preview-swap-trial-context',token:'a'});
 context.receive({type:'akari-preview-set-playback',playing:true,trialToken:'a'});
 context.receive({type:'akari-preview-set-playback',playing:true,trialToken:'a'});
 assert.equal(toggles,1);assert.equal(states.at(-1).playing,true);
 vm.runInContext('stopSwapAutoplay()',context);context.isPlaying=false;
 context.receive({type:'akari-preview-set-playback',playing:true,trialToken:'a'});assert.equal(toggles,1);assert.equal(states.at(-1).userStopped,true);
 context.receive({type:'akari-preview-swap-trial-context',token:'b'});
 context.receive({type:'akari-preview-set-playback',playing:true,trialToken:'b'});assert.equal(toggles,2);
 assert.match(source,/if \(event.isTrusted\) stopSwapAutoplay\(\)/);
});

test('explicit saved-state refresh starts immediately, shares a later notification and ignores an old token',async()=>{
 const widget={akariPreviewConfigured:true,akariPreviewEditUri:new URI('edit'),sendMessage(){}},calls=[];
 const h=Object.assign(new Host(),{swapTrialPlaybacks:new Map(),openOutputPreviews:new Map([['edit',widget]]),
  previewGestureGuards:new Map(),reviewTransportByEdit:new Map(),
  markRecentWrite:uri=>calls.push(['recent',uri.toString()]),
  refreshPreview:async(...args)=>{calls.push(['refresh',args[5]]);},handleRefreshFailure(){}});
 h.beginSwapTrial({editUri:'edit',token:'current',startedAt:Date.now()});
 assert.equal(h.refreshSwapTrial({editUri:'edit',editSource:'stale',token:'old'}),false);
 assert.deepEqual(calls,[]);
 assert.equal(h.refreshSwapTrial({editUri:'edit',editSource:'saved',token:'current'}),true);
 const pending=widget.akariPreviewRefresh;
 await Promise.resolve();assert.deepEqual(calls,[['recent','edit'],['refresh','saved']]);
 h.queueRefresh(widget,new URI('edit'),'output',undefined,false,'saved');
 assert.equal(widget.akariPreviewRefresh,pending);
 await pending;assert.equal(calls.filter(c=>c[0]==='refresh').length,1);
 h.endSwapTrial('current');
 assert.equal(h.refreshSwapTrial({editUri:'edit',editSource:'late',token:'current'}),false);
});

test('window_end pauses once without cancelling an in-flight playing result or removing the trial',async()=>{
 const messages=[],logs=[],old=console.info;
 const widget={sendMessage:message=>messages.push(message)};
 const h=Object.assign(new Host(),{swapTrialPlaybacks:new Map(),openOutputPreviews:new Map([['edit',widget]]),getExternalPreviewWidget:()=>widget});
 console.info=(...args)=>logs.push(JSON.parse(args[1]));
 try {
  h.beginSwapTrial({editUri:'edit',token:'window',startedAt:Date.now()});
  const trial=h.swapTrialPlaybacks.get('edit');let now=0;
  trial.state=playback.initialSwapPlaybackState(now);
  const result=await trial.run({now:()=>now,wait:async ms=>{now+=ms;},prepare:async()=>{},fallbackSeek:async()=>{},query:async()=>({playing:false}),log(){},
   play:async()=>{
    trial.event({type:'observed',playing:true});
    assert.equal(await h.pauseOutputPreview({editUri:'edit',trialToken:'window',reason:'window_end'}),true);
    trial.event({type:'observed',playing:false});
   }});
  assert.equal(result,'playing');assert.equal(trial.state.cancelled,false);assert.equal(trial.signal.aborted,false);
  assert.equal(h.swapTrialPlaybacks.get('edit'),trial);
  assert.equal(messages.filter(m=>m.type==='akari-preview-set-playback'&&m.playing===false).length,1);
  assert.ok(logs.some(log=>log.event==='playback_pause'&&log.reason==='window_end'));
  assert.equal(logs.some(log=>log.event==='playback_cancel'),false);
  assert.equal(await h.pauseOutputPreview({editUri:'edit',trialToken:'old',reason:'window_end'}),false);
  h.endSwapTrial('window');
  assert.equal(await h.pauseOutputPreview({editUri:'edit',trialToken:'window',reason:'window_end'}),false);
 }finally{console.info=old;}
});
test('ordinary user pause still cancels retries',async()=>{
 const widget={sendMessage(){}};
 const h=Object.assign(new Host(),{swapTrialPlaybacks:new Map(),openOutputPreviews:new Map([['edit',widget]]),getExternalPreviewWidget:()=>widget});
 h.beginSwapTrial({editUri:'edit',token:'manual',startedAt:Date.now()});
 const trial=h.swapTrialPlaybacks.get('edit');await h.pauseOutputPreview({editUri:'edit'});
 assert.equal(trial.state.cancelled,true);assert.equal(trial.signal.aborted,true);
});
test('timeline ticks ignore stale pages and ticks before initial positioning',()=>{
 const widget={akariPreviewEditUri:new URI('edit'),akariPreviewPlaybackPageId:'current-page'};
 const h=Object.assign(new Host(),{swapTrialPlaybacks:new Map(),reviewTransportByEdit:new Map()});
 forwarded.length=0;
 h.forwardPlaybackTick(widget,{time:11.23,playing:true,pageId:'old-page',positionReady:true,trialToken:'trial'});
 h.forwardPlaybackTick(widget,{time:0,playing:false,pageId:'current-page',positionReady:false});
 assert.equal(forwarded.length,0);
 assert.equal(h.reviewTransportByEdit.size,0);
 h.forwardPlaybackTick(widget,{time:1.4,playing:true,pageId:'current-page',positionReady:true,trialToken:'trial'});
 assert.equal(forwarded.at(-1).detail.trialToken,'trial');assert.equal(forwarded.at(-1).detail.time,1.4);
});
