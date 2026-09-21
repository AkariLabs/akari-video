import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MaterialTrialHistory } from '../lib/common/material-trial-history.js';
import * as mutations from '../lib/common/edit-v2-mutations.js';
import * as replacement from '../lib/common/material-replacement.js';
const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
function method(name) {
 const start = source.search(new RegExp('    (async )?' + name + '\\(')); assert.notEqual(start, -1, name);
 const rest = source.slice(start); return rest.slice(0, rest.indexOf('\n    }') + 6);
}
const Widget = new Function('edit_v2_mutations_1', 'material_replacement_1', 'timeline_empty_state_1', 'PLAYHEAD_FOLLOW_THRESHOLD', `return class {
 ${['commitEditMutation','performEditMutation','tryMaterialSwap','finishMaterialSwap','stopMaterialSwapPlayback','replayMaterialSwap','applySelection','pushSelectionSnapshot','selectedMaterialSwapTarget','handlePlaybackTick','handleCutSelection','handleLayerSelection'].map(method).join('\n')}
}`)(mutations, replacement, { relativeTimelineMaterialPath: (_base, path) => path.replace('/project/', '') }, 0.8);
function fixture() {
 const original = JSON.stringify({ version: 2, output: { fps: 30 }, sources: [{ id: 'old', path: 'old.wav' }],
 tracks: [{ id: 'audio', lane: 'audio', items: [{ id: 'item', at: 30, duration: 60, source: { kind: 'media', src: 'old', in: 0, out: 2 } }] }] }, null, 4) + '\n\n';
 let disk = original; const past = [], commands = [], errors = [], warnings = [];
 const trial = new MaterialTrialHistory();
 const uri = { toString: () => 'file:///project/edit.json', parent: { path: { toString: () => '/project' } } };
 const w = Object.assign(new Widget(), {
 fps: 30, materialSwapGeneration: 0, materialSwapTail: Promise.resolve(), editMutationTail: Promise.resolve(),
 materialSwap: { target: { itemId: 'item', kind: 'audio', currentRelativePath: 'old.wav' }, editUri: uri.toString() },
 location: { editUri: uri, root: { toString: () => 'file:///project', resolve: path => ({ toString: () => `file:///project/${path}`, path: { toString: () => `/project/${path}` } }) } },
 editDocument: JSON.parse(disk), fileService: { readFile: async () => ({ value: disk }) },
 prepareMotionChanges: async () => [], writeMotionChanges: async () => {}, reloadCaptions: async () => {},
 writeEditSnapshotGuarded: async text => { disk = text; }, reloadEdit: async () => { w.editDocument = JSON.parse(disk); },
 historyService: { materialTrial: trial, setMaterialTrial: entry => trial.set(entry), finishMaterialTrial: async confirm => {
 if (confirm) trial.confirm(entry => past.push(entry)); else await trial.cancel(); } },
 annotationsService: { getAudioDuration: async () => ({ status: 'ready', durationSeconds: 3 }) },
 commandRegistry: { getCommand: () => true, executeCommand: async (id, args) => {
 commands.push([id, args]); if (id === 'akari.catalog.resolveMaterial') return { relativePath: `${args}.wav`, kind: 'audio' }; if (id === 'akari.preview.seekOutput') return 'seeked'; return true; } },
 messages: { error: message => errors.push(message), warn: message => warnings.push(message) }, errorMessage: error => error.message
 });
 return { w, trial, past, commands, errors, warnings, original, disk: () => disk };
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
 assert.equal(f.past.length, 1); assert.equal(f.past[0].label, '素材を入れ替え'); assert.equal(f.disk(), after);
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
test('playback seeks 0.6 seconds before item, replays, and pauses on cancel', async () => {
 const f = fixture(); await f.w.tryMaterialSwap(candidate('one')); await f.w.replayMaterialSwap(); await f.w.finishMaterialSwap(false);
 const seeks = f.commands.filter(([id]) => id === 'akari.preview.seekOutput');
 assert.equal(seeks.length, 2); assert.equal(seeks[0][1].time, 0.4);
 assert.equal(f.commands.filter(([id]) => id === 'akari.preview.play').length, 2);
 assert.ok(f.commands.some(([id]) => id === 'akari.preview.pause'));
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

test('initial trial waits for ready seek; no wall-clock cutoff; playback tick stops at the item window', async () => {
 const f = fixture(); let ready, entered;
 const waiting = new Promise(resolve => { entered = resolve; });
 const execute = f.w.commandRegistry.executeCommand;
 f.w.commandRegistry.executeCommand = async (id, args) => {
  if (id === 'akari.preview.seekOutput') {
   assert.equal(args.waitForReady, true); entered();
   await new Promise(resolve => { ready = resolve; });
  }
  return execute(id, args);
 };
 const trial = f.w.tryMaterialSwap(candidate('one')); await waiting;
 assert.equal(f.commands.some(([id]) => id === 'akari.preview.play'), false);
 assert.equal(f.w.materialSwapPlaybackEnd, undefined);
 assert.ok(f.trial.entry);
 assert.ok(f.commands.some(([id, args]) => id === 'akari.preview.materialTrial' && args.title === 'one'));
 ready(); await trial;
 assert.equal(f.w.materialSwapPlaybackEnd, 4); // item at 1s, adopted audio 3s
 assert.equal(f.w.materialSwapPlaybackTimer, undefined);
 Object.assign(f.w, { canHandlePlaybackTick: uri => uri === 'edit', visualThumbnails: { setPaused() {} },
  selectionModel: {}, visibleDuration: () => 10, viewStart: 0, playhead: { style: {} }, percent: t => t,
  resolveCaptionAtPlayhead: () => undefined });
 const pauses = () => f.commands.filter(([id]) => id === 'akari.preview.pause').length;
 const before = pauses();
 f.w.handlePlaybackTick({ videoUri: 'other', time: 8, playing: true }); assert.equal(pauses(), before);
 f.w.handlePlaybackTick({ videoUri: 'edit', time: 3.9, playing: true }); assert.equal(pauses(), before);
 f.w.handlePlaybackTick({ videoUri: 'edit', time: 4, playing: true }); assert.equal(pauses(), before + 1);
 await f.w.finishMaterialSwap(false);
});
test('cancel while readiness is pending never starts playback and restores original bytes', async () => {
 const f = fixture(); let ready, entered;
 const waiting = new Promise(resolve => { entered = resolve; });
 const execute = f.w.commandRegistry.executeCommand;
 f.w.commandRegistry.executeCommand = async (id, args) => {
  if (id === 'akari.preview.seekOutput') { entered(); await new Promise(resolve => { ready = resolve; }); }
  return execute(id, args);
 };
 const trial = f.w.tryMaterialSwap(candidate('one')); await waiting;
 const cancel = f.w.finishMaterialSwap(false); ready(); await Promise.all([trial, cancel]);
 assert.equal(f.commands.some(([id]) => id === 'akari.preview.play'), false);
 assert.equal(f.disk(), f.original);
});

for (const failure of ['seek', 'play']) test(`playback ${failure} failure preserves the trial and its confirm/cancel controls`, async () => {
 const f = fixture(), execute = f.w.commandRegistry.executeCommand;
 f.w.commandRegistry.executeCommand = async (id, args) => {
  const result = await execute(id, args);
  if (id === 'akari.preview.seekOutput' && (args.waitForReady || failure === 'seek')) throw Error('not ready');
  if (id === 'akari.preview.play') throw Error('play failed');
  return result;
 };
 await f.w.tryMaterialSwap(candidate('one'));
 assert.ok(f.trial.entry); assert.notEqual(f.disk(), f.original);
 const show = f.commands.findIndex(([id, args]) => id === 'akari.preview.materialTrial' && args.title === 'one');
 const seek = f.commands.findIndex(([id]) => id === 'akari.preview.seekOutput');
 assert.ok(show >= 0 && show < seek);
 assert.equal(f.commands.slice(show + 1).some(([id, args]) => id === 'akari.preview.materialTrial' && !args.title), false);
 assert.equal(f.errors.length, 1); assert.match(f.errors[0], /再生できませんでした.*もう一度/);
 assert.doesNotMatch(f.errors[0], /お試しできません/);
 assert.equal(f.commands.filter(([id]) => id === 'akari.preview.seekOutput').length, 2);
 if (failure === 'play') {
  await f.w.finishMaterialSwap(true); assert.equal(f.past.length, 1); await f.past[0].undo();
 } else await f.w.finishMaterialSwap(false);
 assert.equal(f.disk(), f.original); assert.equal(f.trial.entry, undefined);
});

test('failed ready acknowledgement falls back to ordinary seek then play exactly once', async () => {
 const f = fixture(), execute = f.w.commandRegistry.executeCommand;
 f.w.commandRegistry.executeCommand = async (id, args) => {
  const result = await execute(id, args);
  if (id === 'akari.preview.seekOutput' && args.waitForReady) throw Error('timeout');
  return result;
 };
 await f.w.tryMaterialSwap(candidate('one'));
 assert.deepEqual(f.commands.filter(([id]) => ['akari.preview.seekOutput','akari.preview.play'].includes(id)).map(([id,args]) => [id,args.waitForReady]),
  [['akari.preview.seekOutput',true],['akari.preview.seekOutput',undefined],['akari.preview.play',undefined]]);
 assert.ok(f.trial.entry); assert.equal(f.errors.length, 0); assert.match(f.warnings[0], /もう一度/);
 await f.w.finishMaterialSwap(true); assert.equal(f.past.length, 1); await f.past[0].undo(); assert.equal(f.disk(), f.original);
});
