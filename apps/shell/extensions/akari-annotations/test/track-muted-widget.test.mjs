import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { projectLegacyEdit, readInternalEdit } from '@akari-video/edit-store';
import { withCaptionsDisplaySupplement } from '../lib/common/derive-timeline-tracks.js';
import {
  prepareV2KeyframeDistribution, setTrackFlag, stringifyEditV2,
} from '../lib/common/edit-v2-mutations.js';

// Execute the real handlers and commit path without booting Theia DOM / DI.
const source = ts.createSourceFile('akari-annotations-widget.ts', readFileSync(
  new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'
), ts.ScriptTarget.Latest, true);
const names = [
  'trackFlagStorageKey', 'applyStoredTrackFlags', 'toggleTimelineTrackFlag',
  'commitEditMutation', 'writeEditSnapshotGuarded',
];
const widget = source.statements.find(statement => ts.isClassDeclaration(statement)
  && statement.members.some(member => member.name?.getText(source) === 'commitEditMutation'));
const methods = names.map(name => {
  const method = widget.members.find(member => member.name?.getText(source) === name);
  assert.ok(method, name);
  return method.getText(source);
});
const code = ts.transpileModule(`class Handler { ${methods.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;
const Handler = new Function(
  'setV2TrackFlag', 'prepareV2KeyframeDistribution', 'stringifyEditV2', 'TRACK_FLAG_STORAGE_PREFIX', 'withCaptionsDisplaySupplement',
  `${code}\nreturn Handler;`
)(setTrackFlag, prepareV2KeyframeDistribution, stringifyEditV2, 'test-track-flags', withCaptionsDisplaySupplement);

function fixture() {
  const context = new Handler();
  context.localLockedTrackIds = new Set();
  context.computeAudioDisplayTracks = () => { context.displayTimelineTracks = context.timelineTracks; };
  context.computeBgmDisplayTrack = () => {};
  context.computeCaptionsDisplayTrack = () => {};
  const doc = {
    version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'media', path: 'media.mp4' }],
    tracks: ['visual', 'audio'].map(lane => ({
      id: lane, lane, items: [{ id: `${lane}-item`, at: 0, duration: 30,
        source: { kind: 'media', src: 'media', in: 0, out: 1 } }],
    })),
  };
  let text = stringifyEditV2(doc);
  context.location = { editUri: 'edit.json', root: '.' };
  context.footer = {};
  context.errorMessage = error => error.message;
  context.history = [];
  context.pushHistory = entry => context.history.push(entry);
  context.prepareMotionChanges = async writes => { assert.deepEqual(writes, []); return []; };
  context.writeMotionChanges = async () => {};
  context.writes = [];
  context.fileService = {
    readFile: async () => ({ value: { toString: () => text } }),
    writeFile: async (uri, value) => {
      if (context.failWrite) throw new Error('write failed');
      assert.equal(uri, 'edit.json');
      text = value;
      context.writes.push(text);
    },
  };
  context.annotationsService = {
    writeEditSnapshot: async request => context.fileService.writeFile(request.editUri, request.editSource),
  };
  const stored = new Map();
  context.storageWrites = [];
  context.storage = {
    getData: async (key, fallback) => stored.has(key) ? stored.get(key) : fallback,
    setData: async (key, value) => {
      context.storageWrites.push({ key, value });
      if (value === undefined) stored.delete(key);
      else stored.set(key, value);
    },
  };
  context.syncCount = 0;
  context.renderCount = 0;
  context.syncTimelineTrackTogglesToPreview = () => { context.syncCount++; };
  context.renderStrip = () => { context.renderCount++; };
  const refreshTracks = () => {
    context.editDocument = JSON.parse(text);
    context.timelineTracks = projectLegacyEdit(readInternalEdit(context.editDocument)).timeline.tracks;
  };
  context.reloadEdit = async () => {
    refreshTracks();
    await context.applyStoredTrackFlags();
    context.syncTimelineTrackTogglesToPreview();
    context.renderStrip();
  };
  refreshTracks();
  return {
    context, stored,
    key: (id, field = 'muted') => context.trackFlagStorageKey('edit.json', id, field),
    read: () => JSON.parse(text),
    replace: value => { text = stringifyEditV2(value); refreshTracks(); },
  };
}

test('speaker toggle writes tracks[].muted through commit and undo/redo; unmute deletes the key', async () => {
  const { context, read } = fixture();
  assert.deepEqual(context.timelineTracks.map(track => track.id), read().tracks.map(track => track.id));
  await context.toggleTimelineTrackFlag(context.timelineTracks[0], 'muted');
  assert.equal(read().tracks[0].muted, true);
  assert.equal(context.timelineTracks[0].muted, true);
  assert.equal(context.footer.textContent, 'トラックの音声をオフにしました。');
  assert.equal(context.writes.length, 1);
  assert.equal(context.history.length, 1);
  assert.equal(context.syncCount, 1);
  assert.equal(context.renderCount, 1);
  await context.history[0].undo();
  assert.equal(Object.hasOwn(read().tracks[0], 'muted'), false);
  await context.history[0].redo();
  assert.equal(read().tracks[0].muted, true);
  await context.toggleTimelineTrackFlag(context.timelineTracks[0], 'muted');
  assert.equal(Object.hasOwn(read().tracks[0], 'muted'), false);
  assert.equal(context.timelineTracks[0].muted, undefined);
  assert.equal(context.footer.textContent, 'トラックの音声をオンにしました。');
  assert.deepEqual(context.storageWrites, []);
});

test('stored mute migrates all tracks once without history or reload and deletes only mute keys', async () => {
  const { context, read, stored, key } = fixture();
  stored.set(key('visual'), true);
  stored.set(key('audio'), true);
  stored.set(key('visual', 'hidden'), true);
  await context.applyStoredTrackFlags();
  assert.deepEqual(read().tracks.map(track => track.muted), [true, true]);
  assert.deepEqual(context.timelineTracks.map(track => track.muted), [true, true]);
  assert.equal(context.timelineTracks[0].hidden, true);
  assert.equal(context.writes.length, 1);
  assert.equal(context.history.length, 0);
  assert.equal(context.syncCount, 0);
  assert.equal(stored.has(key('visual')), false);
  assert.equal(stored.has(key('audio')), false);
  assert.equal(stored.get(key('visual', 'hidden')), true);
  assert.deepEqual(context.storageWrites.map(entry => entry.value), [undefined, undefined]);
  await context.reloadEdit();
  assert.equal(context.writes.length, 1);
  assert.equal(context.storageWrites.length, 2);
});

test('doc mute stays authoritative and stored false never overrides or migrates it', async () => {
  const { context, stored, key, read, replace } = fixture();
  const doc = read();
  doc.tracks[0].muted = true;
  replace(doc);
  stored.set(key('visual'), false);
  stored.set(key('audio'), false);
  await context.applyStoredTrackFlags();
  assert.equal(context.timelineTracks[0].muted, true);
  assert.equal(context.timelineTracks[1].muted, undefined);
  assert.equal(context.writes.length, 0);
});

test('failed migration retains storage and document state and can retry', async t => {
  t.mock.method(console, 'warn', () => {});
  const { context, stored, key, read } = fixture();
  stored.set(key('visual'), true);
  context.failWrite = true;
  await context.applyStoredTrackFlags();
  assert.equal(Object.hasOwn(read().tracks[0], 'muted'), false);
  assert.equal(context.timelineTracks[0].muted, undefined);
  assert.equal(stored.get(key('visual')), true);
  assert.deepEqual(context.storageWrites, []);
  assert.match(context.footer.textContent, /保存できません.*write failed/u);
  context.failWrite = false;
  await context.applyStoredTrackFlags();
  assert.equal(read().tracks[0].muted, true);
  assert.equal(stored.has(key('visual')), false);
});

test('derived track toggle and migration fail without creating a track or falling back to storage', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const { context, read, stored, key } = fixture();
  const before = read();
  const derived = { id: 'implicit', kind: 'audio', ref: 9 };
  await context.toggleTimelineTrackFlag(derived, 'muted');
  assert.match(context.footer.textContent, /編集できません/u);
  assert.deepEqual(context.storageWrites, []);
  context.timelineTracks.push(derived);
  stored.set(key('implicit'), true);
  await context.applyStoredTrackFlags();
  assert.equal(stored.get(key('implicit')), true);
  assert.deepEqual(read(), before);
  assert.equal(context.writes.length, 0);
  assert.equal(warn.mock.callCount(), 2);
});

test('mute toggle handles missing edit and non-v2 documents without writing', async t => {
  t.mock.method(console, 'warn', () => {});
  for (const missing of [true, false]) {
    const { context } = fixture();
    if (missing) context.location = undefined;
    else {
      // Keep the displayed track while the file on disk is replaced by a legacy document.
      context.fileService.readFile = async () => ({ value: JSON.stringify({ version: 0 }) });
    }
    await context.toggleTimelineTrackFlag(context.timelineTracks[0], 'muted');
    assert.match(context.footer.textContent, /編集できません/u);
    assert.equal(context.writes.length, 0);
    assert.deepEqual(context.storageWrites, []);
  }
});

test('hidden toggle retains storage, manual display update, preview sync and render behavior', async () => {
  const { context, read, stored, key } = fixture();
  const before = read();
  await context.toggleTimelineTrackFlag(context.timelineTracks[0], 'hidden');
  assert.equal(stored.get(key('visual', 'hidden')), true);
  assert.equal(context.timelineTracks[0].hidden, true);
  assert.equal(context.syncCount, 1);
  assert.equal(context.renderCount, 1);
  assert.deepEqual(read(), before);
  assert.equal(context.writes.length, 0);
});
