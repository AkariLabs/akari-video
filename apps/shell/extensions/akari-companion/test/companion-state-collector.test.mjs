import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import uriModule from '@theia/core/lib/common/uri.js';
import { CompanionStateCollector } from '../lib/browser/companion-state-collector.js';

const URI = uriModule.default ?? uriModule;

const encoder = new TextEncoder();
const waitFor = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

function detailEvent(type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, 'detail', { value: detail });
  return event;
}

function fixture() {
  const events = new EventTarget();
  const root = new URI('file:///project');
  const editUri = root.resolve('edit.json');
  const captionsUri = root.resolve('captions.json');
  const content = new Map([
    [editUri.toString(), encoder.encode('{}')],
    [captionsUri.toString(), encoder.encode('[]')]
  ]);
  const fileListeners = [];
  const locationListeners = [];
  const light = [];
  const docs = [];
  let now = 0;
  let widgets = [{ id: 'timeline' }];
  const timers = [];
  const files = {
    exists: async uri => content.has(uri.toString()),
    readFile: async uri => ({ value: { buffer: content.get(uri.toString()) } }),
    onDidFilesChange: listener => {
      fileListeners.push(listener);
      return { dispose() {} };
    },
    watch: () => ({ dispose() {} })
  };
  const shell = {
    get widgets() { return widgets; },
    currentWidget: { id: 'timeline' }
  };
  const collector = new CompanionStateCollector({
    events,
    shell,
    files,
    currentLocation: () => ({ root, editUri, captionsUri }),
    currentProjectSessionId: () => 'session-1',
    onLocationChanged: listener => {
      locationListeners.push(listener);
      return { dispose() {} };
    },
    pushStateLight: async state => { light.push(state); },
    pushStateDocs: async state => { docs.push(state); },
    now: () => now,
    setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimeout: timer => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
    digest: async bytes => createHash('sha256').update(bytes).digest('hex')
  });
  return {
    collector, events, content, fileListeners, light, docs, timers,
    setNow(value) { now = value; },
    setWidgets(value) { widgets = value; },
    editUri, captionsUri
  };
}

async function runTimers(fixture) {
  while (fixture.timers.length) {
    const timer = fixture.timers.shift();
    fixture.setNow(fixture.light.length * 100 + 100);
    timer.fn();
    await Promise.resolve();
  }
}

test('選択・再生位置・パネルを light 状態へ反映する', async () => {
  const f = fixture();
  f.collector.start();
  await waitFor(() => f.light.length > 0 && f.docs.length > 0);
  f.setNow(100);
  f.setWidgets([{ id: 'timeline' }, { id: 'preview' }]);
  f.events.dispatchEvent(detailEvent('akari.timeline.primarySelected', {
    selection: { kind: 'cut', id: 'cut-1' }
  }));
  f.events.dispatchEvent(detailEvent('akari.timeline.overlaySelected', { overlayId: 'overlay-1' }));
  f.events.dispatchEvent(detailEvent('akari.timeline.layerSelected', { layerId: 'layer-1' }));
  f.events.dispatchEvent(detailEvent('akari.preview.playbackTick', { time: 2.5, playing: true }));
  await runTimers(f);
  await waitFor(() => f.light.some(state => state.playhead?.seconds === 2.5));
  const state = f.light.at(-1);
  assert.equal(state.type, 'light');
  assert.deepEqual(state.selection, [
    { kind: 'cut', id: 'cut-1' },
    { kind: 'overlay', id: 'overlay-1' },
    { kind: 'layer', id: 'layer-1' }
  ]);
  assert.deepEqual(state.playhead, { seconds: 2.5, playing: true });
  assert.deepEqual(state.panels, ['timeline', 'preview']);
  f.collector.stop();
});

test('文書ハッシュが変わったときだけ docs を送り大きい本文を省く', async () => {
  const f = fixture();
  f.collector.start();
  await waitFor(() => f.docs.length === 1);
  assert.equal(f.docs[0].type, 'docs');
  assert.equal(f.docs[0].edit.text, '{}');
  const change = uri => ({ contains: candidate => candidate.toString() === uri.toString() });
  f.fileListeners[0](change(f.editUri));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.docs.length, 1);
  f.content.set(f.editUri.toString(), encoder.encode('{"changed":true}'));
  f.fileListeners[0](change(f.editUri));
  await waitFor(() => f.docs.length === 2);
  assert.equal(f.docs[1].edit.text, '{"changed":true}');
  f.content.set(f.captionsUri.toString(), new Uint8Array(8 * 1024 * 1024 + 1));
  f.fileListeners[0](change(f.captionsUri));
  await waitFor(() => f.docs.length === 3);
  assert.equal(f.docs[2].captions.tooLarge, true);
  assert.equal('text' in f.docs[2].captions, false);
  f.collector.stop();
});

test('つなぎ直したら、ハッシュが変わっていなくても docs を送り直す', async () => {
  const f = fixture();
  f.collector.start();
  await waitFor(() => f.docs.length === 1);
  const first = f.docs[0];
  // ファイルは 1 バイトも変わっていない状態での再送。
  await f.collector.resendDocuments();
  assert.equal(f.docs.length, 2);
  const second = f.docs[1];
  assert.equal(second.type, 'docs');
  assert.equal(second.edit.sha256, first.edit.sha256);
  assert.equal(second.captions.sha256, first.captions.sha256);
  assert.equal(second.edit.text, '{}');
  assert.equal(second.projectSessionId, first.projectSessionId);
  // seq は単調増加（係は古い seq を捨てるため、再送は必ず新しい番号でなければならない）。
  assert.ok(second.seq > first.seq);
  f.collector.stop();
});
