import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { insertTrack, insertItem, indexEditV2Items } from '../lib/common/edit-v2-mutations.js';

const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
const start = source.indexOf('    async commitEmptyFrame(');
const end = source.indexOf('    onStripPointerDown(', start);
const Widget = new Function('edit_v2_mutations_1', 'akari_annotations_commands_2',
  `return class { ${source.slice(start, end)} }`)(
  { insertTrack, insertItem, indexEditV2Items }, { OPEN_AKARI_INSPECTOR_ID: 'akari.inspector.open' });

function fixture(service) {
  let doc = { version: 2, output: { fps: 30 }, sources: [], tracks: [
    { id: 'a1', lane: 'audio', items: [] }, { id: 'v1', lane: 'visual', items: [] }
  ] };
  const before = JSON.stringify(doc), history = [];
  const uri = { toString: () => 'file:///frame-anywhere' };
  const widget = Object.assign(new Widget(), {
    location: { root: uri, editUri: uri }, editDocument: doc, annotationsService: service,
    isTrackLocked: () => false, showNotice() {}, errorMessage: e => e.message,
    commands: { async executeCommand() {} }, cutItemIds: [], timelineTreeRows: [],
    applySelection(value) { this.selection = value; },
    async commitEditMutation(label, mutate) {
      const old = doc; doc = mutate(doc); history.push({ label, undo: () => { doc = old; } });
      this.cutItemIds = doc.tracks.flatMap(track => track.lane === 'visual' ? track.items.map(item => item.id) : []);
    }
  });
  return { widget, before, history, get doc() { return doc; } };
}

test('audio RPC failure does not change edit or undo history', async () => {
  const f = fixture({ createEmptyAudioFrame: async () => { throw new Error('ffmpeg failed'); } });
  await f.widget.commitEmptyFrame({ lane: 'audio', insertIndex: 0 }, { at: 60, duration: 75 }, 30);
  assert.equal(JSON.stringify(f.doc), f.before); assert.equal(f.history.length, 0);
});

for (const [lane, index, path] of [
  ['visual', 2, 'assets/generated/frame.png'],
  ['audio', 0, 'assets/generated/frame-audio.wav']
]) test(`${lane} new track, source and frame disappear with one undo`, async () => {
  const result = { relativePath: path, sha256: 'a'.repeat(64), durationSeconds: 2.5 };
  const f = fixture({ createEmptyGenerationFrame: async () => result, createEmptyAudioFrame: async () => result });
  await f.widget.commitEmptyFrame({ lane, insertIndex: index }, { at: 60, duration: 75 }, 30);
  assert.equal(f.history.length, 1); assert.equal(f.doc.tracks.length, 3);
  assert.equal(f.doc.tracks[index].lane, lane); assert.equal(f.doc.tracks[index].items.length, 1);
  assert.equal(f.doc.sources.length, 1);
  if (lane === 'audio') {
    assert.equal(f.doc.tracks[index].items[0].role, 'narration');
    assert.deepEqual(f.widget.selection, { kind: 'audio', id: f.doc.tracks[index].items[0].id });
  }
  f.history[0].undo(); assert.equal(JSON.stringify(f.doc), f.before);
});
