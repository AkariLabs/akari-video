import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MaterialTrialHistory } from '../lib/common/material-trial-history.js';
import * as mutations from '../lib/common/edit-v2-mutations.js';
import * as replacement from '../lib/common/material-replacement.js';
import * as playback from '../../akari-preview/lib/common/swap-trial-playback.js';
import * as trialWindow from '../lib/common/material-trial-window.js';
const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
function method(name) {
 const start = source.search(new RegExp('    (async )?' + name + '\\(')); assert.notEqual(start, -1, name);
 const rest = source.slice(start); return rest.slice(0, rest.indexOf('\n    }') + 6);
}
const Widget = new Function('edit_v2_mutations_1', 'material_replacement_1', 'timeline_empty_state_1', 'PLAYHEAD_FOLLOW_THRESHOLD', 'swap_trial_playback_1', 'material_trial_window_1', `return class {
 ${['commitEditMutation','performEditMutation','tryMaterialSwap','finishMaterialSwap','stopMaterialSwapPlayback','replayMaterialSwap','applySelection','pushSelectionSnapshot','selectedMaterialSwapTarget','selectedMaterialSwapItemId','restoreMaterialSwapSelection','handlePlaybackTick','handleCutSelection','handleLayerSelection','newMaterialSwapPlayback'].map(method).join('\n')}
}`)(mutations, replacement, { relativeTimelineMaterialPath: (_base, path) => path.replace('/project/', '') }, 0.8, playback, trialWindow);
function fixture(at = 30, mediaKind = 'audio') {
 const visual=mediaKind!=='audio';
 const path=mediaKind==='video'?'assets/broll/br-origin/clip.mp4':mediaKind==='image'?'assets/still/br-origin/broll.png':'old.wav';
 const original = JSON.stringify({ version: 2, output: { fps: 30 }, sources: [{ id: 'old', path }],
 tracks: [{ id: 'audio', lane: visual?'visual':'audio', items: [{ id: 'item', at, duration: visual?180:60, source: { kind: 'media', src: 'old', in: 0, out: mediaKind==='image'?6:2, ...(mediaKind==='video'?{mute:false,freeze:{at_sec:2,duration_sec:4}}:{}) } }] }] }, null, 4) + '\n\n';
 let disk = original; const past = [], commands = [], errors = [], warnings = [], writes = [], events = [];
 const trial = new MaterialTrialHistory();
 const uri = { toString: () => 'file:///project/edit.json', parent: { path: { toString: () => '/project' } } };
 const w = Object.assign(new Widget(), {
 id: 'test', materialSwapTokenSequence: 0, fps: 30, materialSwapGeneration: 0, materialSwapTail: Promise.resolve(), editMutationTail: Promise.resolve(),
 materialSwap: { target: { itemId: 'item', kind: visual?'visual':'audio', currentRelativePath: path }, editUri: uri.toString() },
 location: { editUri: uri, root: { toString: () => 'file:///project', resolve: path => ({ toString: () => `file:///project/${path}`, path: { toString: () => `/project/${path}` } }) } },
 editDocument: JSON.parse(disk), fileService: { readFile: async () => ({ value: disk }) },
 prepareMotionChanges: async () => [], writeMotionChanges: async () => {}, reloadCaptions: async () => {},
 writeEditSnapshotGuarded: async text => { disk = text; writes.push(text); events.push('write'); }, reloadEdit: async () => { w.editDocument = JSON.parse(disk); events.push('reload'); },
 historyService: { materialTrial: trial, setMaterialTrial: (entry, _cancel, replace) => replace ? trial.replace(entry) : trial.set(entry), finishMaterialTrial: async confirm => {
 if (confirm) trial.confirm(entry => past.push(entry)); else await trial.cancel(); } },
 refreshReferenceMediaUris: async () => {}, resolveEditMediaUri: path => ({ toString: () => `file:///project/${path}`, path: { toString: () => `/project/${path}` } }),
 annotationsService: { getAudioDuration: async () => ({ status: 'ready', durationSeconds: 3 }) },
 commandRegistry: { getCommand: () => true, executeCommand: async (id, args) => {
 commands.push([id, args]); events.push(id); if (id === 'akari.catalog.resolveMaterial') return { relativePath: `${args}.wav`, kind: 'audio' }; if (id === 'akari.preview.playSwapTrial') return 'playing'; return true; } },
 messages: { error: message => errors.push(message), warn: message => warnings.push(message) }, errorMessage: error => error.message
 });
 return { w, trial, past, commands, errors, warnings, writes, events, original, disk: () => disk };
}
const candidate = key => ({ key, title: key, originalTitle: 'old' });
const sha = text => createHash('sha256').update(text).digest('hex');
test('real commit mutation → three different candidates → cancel restores exact bytes without history', async () => {
 const f = fixture();
 for (const key of ['one','two','three','four']) {
 await f.w.tryMaterialSwap(candidate(key)); assert.deepEqual(f.errors, []); assert.notEqual(f.disk(), f.original); assert.equal(f.past.length, 0);
 assert.equal(f.trial.entry.label, 'お試し中'); assert.equal(f.w.editDocument.tracks[0].items[0].at, 30);
 }
 await f.w.finishMaterialSwap(false);
 assert.equal(f.disk(), f.original); assert.equal(f.trial.entry, undefined); assert.equal(f.past.length, 0); assert.deepEqual(f.errors, []);
 console.log(`trial sha256 before=${sha(f.original)} after=${sha(f.disk())}`);
});
test('confirm records one entry, one undo restores exact original, redo restores candidate', async () => {
 const f = fixture(); await f.w.tryMaterialSwap(candidate('one')); await f.w.tryMaterialSwap(candidate('two'));
 const after = f.disk(); await f.w.finishMaterialSwap(true);
 assert.equal(f.past.length, 1); assert.equal(f.past[0].label, '素材の入れ替え'); assert.equal(f.disk(), after);
 await f.past[0].undo(); assert.equal(f.disk(), f.original);
 await f.past[0].redo(); assert.equal(f.disk(), after);
});
test('close while resolving invalidates candidate and leaves original bytes', async () => {
 const f = fixture(); let release, entered;
 const waiting = new Promise(resolve => { entered = resolve; });
 f.w.commandRegistry.executeCommand = async id => {
 if (id === 'akari.catalog.resolveMaterial') { entered(); return new Promise(resolve => { release = resolve; }); }
 };
 const apply = f.w.tryMaterialSwap(candidate('one')); await waiting;
 const close = f.w.finishMaterialSwap(false); release({ relativePath: 'new.wav', kind: 'audio' });
 await Promise.all([apply, close]); assert.equal(f.disk(), f.original); assert.equal(f.trial.entry, undefined);
});
test('startup requests carry the same trial token and replay gets a new token', async () => {
 const f = fixture(); await f.w.tryMaterialSwap(candidate('one')); await f.w.replayMaterialSwap(); await f.w.finishMaterialSwap(false);
 const starts = f.commands.filter(([id]) => id === 'akari.preview.playSwapTrial');
 assert.equal(starts.length, 2); assert.equal(starts[0][1].time, 0.4);
 assert.notEqual(starts[0][1].token, starts[1][1].token);
 assert.ok(f.commands.some(([id,args]) => id === 'akari.preview.endSwapTrial' && args === starts[0][1].token));
});
test('failed rollback retains trial for retry', async () => {
 const trial = new MaterialTrialHistory(); let fail = true;
 trial.set({ label: 'お試し中', undo: async () => { if (fail) throw Error('disk'); }, redo: async () => {} });
 await assert.rejects(trial.cancel(), /disk/); assert.ok(trial.entry); fail = false; await trial.cancel(); assert.equal(trial.entry, undefined);
});

for (const [label, selection] of [['timeline other audio', { kind: 'audio', id: 'other' }], ['preview other cut', { kind: 'cut', index: 0 }], ['deselect', undefined]]) {
 test(`${label} goes through the shared selection cancellation path`, async () => {
  const f = fixture();
  Object.assign(f.w, { selection: { kind: 'audio', id: 'item' }, multiSelection: [], cutItemIds: ['main'], selectionModel: {},
   exitTrimmerModeUnlessSelected() {}, selectionKey: value => JSON.stringify(value), applySelectionClass() {},
   snapshotForSelection: value => value, revealOutputPreview() {}, syncRightPane() {}, canHandlePlaybackTick: () => true, revealPreviewSelection() {} });
  await f.w.tryMaterialSwap(candidate('one'));
  if (label === 'preview other cut') f.w.handleCutSelection('file:///project/edit.json', 'main');
  else f.w.applySelection(selection, false);
  await f.w.materialSwapTail;
  assert.equal(f.disk(), f.original); assert.equal(f.trial.entry, undefined); assert.equal(f.w.materialSwap, undefined);
  assert.ok(f.commands.some(([id]) => id === 'akari.catalog.closeSwap'));
 });
}

test('cancel while startup is pending invalidates its token immediately and restores original bytes', async () => {
 const f = fixture(); let ready, entered;
 const waiting = new Promise(resolve => { entered = resolve; });
 const execute = f.w.commandRegistry.executeCommand;
 f.w.commandRegistry.executeCommand = async (id, args) => {
  const result = await execute(id,args);
  if (id === 'akari.preview.playSwapTrial') { entered(); await new Promise(resolve => { ready = resolve; }); }
  return result;
 };
 const operation = f.w.tryMaterialSwap(candidate('one')); await waiting;
 const token = f.w.materialSwapPlayback.token;
 assert.ok(f.trial.entry); assert.ok(f.commands.some(([id,args]) => id === 'akari.preview.materialTrial' && args.title));
 const cancel = f.w.finishMaterialSwap(false);
 assert.ok(f.commands.some(([id,args]) => id === 'akari.preview.endSwapTrial' && args === token));
 ready(); await Promise.all([operation,cancel]); assert.equal(f.disk(),f.original);
});
for (const failure of ['failed','throw']) test(`startup ${failure} retains confirm/cancel and only reports a real playback failure`, async () => {
 const f = fixture(), execute = f.w.commandRegistry.executeCommand;
 f.w.commandRegistry.executeCommand = async (id,args) => {
  const result = await execute(id,args);
  if (id === 'akari.preview.playSwapTrial') { if (failure === 'throw') throw Error('unavailable'); return 'failed'; }
  return result;
 };
 await f.w.tryMaterialSwap(candidate('one')); assert.ok(f.trial.entry);assert.equal(f.errors.length,1);
 assert.match(f.errors[0],/再生できませんでした/);assert.equal(f.warnings.length,0);
 const show=f.commands.findIndex(([id,args])=>id==='akari.preview.materialTrial'&&args.title);
 assert.ok(show>=0&&show<f.commands.findIndex(([id])=>id==='akari.preview.playSwapTrial'));
 await f.w.finishMaterialSwap(failure==='failed');
 if(failure==='failed'){assert.equal(f.past[0].label,'素材の入れ替え');await f.past[0].undo();}
 assert.equal(f.disk(),f.original);
});
test('successful or user-cancelled playback produces no fallback toast', async () => {
 for(const status of ['playing','cancelled']) {
  const f=fixture(),execute=f.w.commandRegistry.executeCommand;
  f.w.commandRegistry.executeCommand=async(id,args)=>id==='akari.preview.playSwapTrial'?status:execute(id,args);
  await f.w.tryMaterialSwap(candidate('one'));assert.deepEqual(f.errors,[]);assert.deepEqual(f.warnings,[]);
  await f.w.finishMaterialSwap(false);
 }
});

test('old positions cannot end startup; window pause keeps the trial, controls and pending playing result', async () => {
 const f=fixture(60),execute=f.w.commandRegistry.executeCommand;let release,entered;
 const waiting=new Promise(resolve=>{entered=resolve;});
 f.w.commandRegistry.executeCommand=async(id,args)=>{
  const result=await execute(id,args);
  if(id==='akari.preview.playSwapTrial'){entered();await new Promise(resolve=>{release=resolve;});}
  return result;
 };
 const operation=f.w.tryMaterialSwap(candidate('one'));await waiting;
 const token=f.w.materialSwapPlayback.token;
 Object.assign(f.w,{canHandlePlaybackTick:uri=>uri==='edit',visualThumbnails:{setPaused(){}},selectionModel:{},
  visibleDuration:()=>10,viewStart:0,playhead:{style:{}},percent:t=>t,resolveCaptionAtPlayhead:()=>undefined});
 const pauses=()=>f.commands.filter(([id])=>id==='akari.preview.pause');
 const ends=()=>f.commands.filter(([id])=>id==='akari.preview.endSwapTrial').length;
 const before=pauses().length,beforeEnds=ends();
 const tick=(time,trialToken=token,playing=true)=>f.w.handlePlaybackTick({videoUri:'edit',time,playing,trialToken});
 tick(11.23);tick(7.08);tick(6.93);assert.equal(pauses().length,before);
 tick(1.40,'previous');tick(11.23);assert.equal(pauses().length,before);
 tick(1.40);tick(1.43);tick(4.99);assert.equal(pauses().length,before);
 tick(5.03);tick(5.1);assert.equal(pauses().length,before+1);
 assert.equal(ends(),beforeEnds);assert.deepEqual(pauses().at(-1)[1],{editUri:'file:///project/edit.json',trialToken:token,reason:'window_end'});
 assert.ok(f.trial.entry);assert.ok(f.w.materialSwap);assert.ok(f.w.materialSwapLabels);
 release();await operation;assert.deepEqual(f.errors,[]);
 await f.w.finishMaterialSwap(false);const after=pauses().length;
 tick(10);assert.equal(pauses().length,after);assert.equal(f.disk(),f.original);
});

test('switching candidates saves only final states, retains original before bytes and refreshes before UI reload', async () => {
 const f=fixture();
 for (const key of ['one','two','three','four']) {
  const count=f.writes.length;
  await f.w.tryMaterialSwap(candidate(key));
  assert.equal(f.writes.length,count+1,'one save per candidate, no intermediate undo save');
  assert.equal(f.trial.entry.before,f.original);
  assert.equal(f.trial.entry.after,f.disk());
  assert.equal(JSON.parse(f.disk()).sources.length,2,'previous candidate sources do not accumulate');
 }
 assert.equal(f.writes.includes(f.original),false);
 const refresh=f.events.indexOf('akari.preview.refreshSwapTrial');
 assert.ok(f.events.indexOf('write')<refresh && refresh<f.events.indexOf('reload'));
 const request=f.commands.find(([id])=>id==='akari.preview.refreshSwapTrial')[1];
 assert.equal(request.editSource,f.writes[0]);
 await f.w.finishMaterialSwap(false);assert.equal(f.disk(),f.original);assert.equal(f.writes.length,5);
});
for (const mode of ['missing','throw','probe','mutation','save']) test(`failed candidate ${mode} restores the original once and drops provisional history`,async()=>{
 const f=fixture();await f.w.tryMaterialSwap(candidate('one'));
 const execute=f.w.commandRegistry.executeCommand;
 f.w.commandRegistry.executeCommand=async(id,args,...rest)=>{
  if(id==='akari.catalog.resolveMaterial') {
   if(mode==='missing') return undefined;
   if(mode==='throw') throw Error('resolve failed');
   if(mode==='mutation') return {relativePath:'bad.png',kind:'image'};
  }
  return execute(id,args,...rest);
 };
 if(mode==='probe') f.w.annotationsService.getAudioDuration=async()=>({status:'unavailable'});
 if(mode==='save') {
  const write=f.w.writeEditSnapshotGuarded;let fail=true;
  f.w.writeEditSnapshotGuarded=async text=>{if(fail){fail=false;throw Error('disk failed');}return write(text);};
 }
 await f.w.tryMaterialSwap(candidate('two'));
 assert.equal(f.disk(),f.original);assert.equal(f.trial.entry,undefined);assert.equal(f.past.length,0);
 assert.equal(f.writes.length,2,'only prior apply and the failure rollback are saved');
});
test('cancel during resolution of another candidate restores the original and never writes the pending candidate',async()=>{
 const f=fixture();await f.w.tryMaterialSwap(candidate('one'));let release,entered;
 const waiting=new Promise(resolve=>{entered=resolve;}),execute=f.w.commandRegistry.executeCommand;
 f.w.commandRegistry.executeCommand=async(id,args)=>{
  if(id==='akari.catalog.resolveMaterial'){entered();return new Promise(resolve=>{release=resolve;});}
  return execute(id,args);
 };
 const next=f.w.tryMaterialSwap(candidate('two'));await waiting;
 assert.equal(f.writes.length,1);assert.notEqual(f.disk(),f.original);
 const cancel=f.w.finishMaterialSwap(false);release({relativePath:'two.wav',kind:'audio',cached:true});
 await Promise.all([next,cancel]);assert.equal(f.writes.length,2);assert.equal(f.disk(),f.original);
});
test('provisional replacement rejects a different baseline without losing the rollback entry',()=>{
 const h=new MaterialTrialHistory(),entry={label:'お試し中',before:'original',undo:async()=>{},redo:async()=>{}};
 h.set(entry);assert.throws(()=>h.replace({...entry,before:'different'}),/一致/);assert.equal(h.entry,entry);
});

test('trying the same candidate again does not write or replace the baseline',async()=>{
 const f=fixture();await f.w.tryMaterialSwap(candidate('one'));const entry=f.trial.entry;
 await f.w.tryMaterialSwap(candidate('one'));
 assert.equal(f.writes.length,1);assert.equal(f.trial.entry,entry);assert.equal(entry.before,f.original);
 await f.w.finishMaterialSwap(false);assert.equal(f.disk(),f.original);
});

for(const confirm of [false,true])test(`video → still → another still ${confirm?'confirm/undo':'cancel'} restores original bytes`,async()=>{
 const f=fixture(0,'video'),execute=f.w.commandRegistry.executeCommand;
 f.w.commandRegistry.executeCommand=async(id,args,...rest)=>id==='akari.catalog.resolveMaterial'
  ?{relativePath:`assets/still/br-${args}/broll.png`,kind:'image',cached:true}:execute(id,args,...rest);
 for(const key of ['photo-a','photo-b']){
  await f.w.tryMaterialSwap(candidate(key));assert.deepEqual(f.errors,[]);assert.ok(f.trial.entry);assert.ok(f.w.materialSwap);
  const item=JSON.parse(f.disk()).tracks[0].items[0];assert.equal(item.duration,180);assert.equal(item.source.out,6);assert.equal('freeze' in item.source,false);
 }
 await f.w.finishMaterialSwap(confirm);
 if(confirm){assert.equal(f.past.length,1);await f.past[0].undo();}
 assert.equal(f.disk(),f.original);
});
test('still → short video keeps trial alive and cancels back to the still bytes',async()=>{
 const f=fixture(0,'image'),execute=f.w.commandRegistry.executeCommand;
 f.w.commandRegistry.executeCommand=async(id,args,...rest)=>id==='akari.catalog.resolveMaterial'
  ?{relativePath:'assets/broll/br-short/clip.mp4',kind:'video',cached:true}:execute(id,args,...rest);
 await f.w.tryMaterialSwap(candidate('video'));assert.deepEqual(f.errors,[]);assert.ok(f.trial.entry);
 const item=JSON.parse(f.disk()).tracks[0].items[0];assert.equal(item.duration,180);assert.equal(item.source.out,3);
 assert.deepEqual(item.source.freeze,{at_sec:3,duration_sec:3});
 await f.w.finishMaterialSwap(false);assert.equal(f.disk(),f.original);
});
