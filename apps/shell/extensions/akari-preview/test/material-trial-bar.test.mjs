import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as readySeek from '../lib/common/preview-ready-seek.js';
import * as gesture from '../lib/common/preview-gesture-guard.js';
import * as refresh from '../lib/common/preview-refresh-state.js';
const source = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
function method(name) {
 const start = source.search(new RegExp('    (async )?' + name + '\\(')); assert.notEqual(start, -1);
 const rest = source.slice(start); return rest.slice(0, rest.indexOf('\n    }') + 6);
}
class Element {
 constructor() { this.children = []; this.dataset = {}; this.style = {}; }
 appendChild(child) { child.parent = this; this.children.push(child); }
 querySelector() { return this.children.find(child => child.dataset.akariMaterialTrial); }
 remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
}
class URI { constructor(value) { this.value = value; } normalizePath() { return this; } toString() { return this.value; } }
const Handler = new Function('uri_1', 'document', 'preview_ready_seek_1', 'webview_1', 'preview_gesture_guard_1', 'preview_refresh_state_1', `return class { ${method('showMaterialTrial')} ${method('seekOutputPreview')} ${method('queueRefresh')} }`)(
 { default: URI }, { createElement: () => new Element() }, readySeek, { WebviewWidget: { FACTORY_ID: 'webview' } }, gesture, refresh);
test('trial banner lives only above output, routes three actions and disappears when cleared', async () => {
 const output = { node: new Element(), isAttached: true }, raw = { node: new Element() }, calls = [];
 const handler = Object.assign(new Handler(), { openOutputPreviews: new Map([['edit', output]]), openPreviews: new Map([['raw', raw]]),
 commandRegistry: { executeCommand: (...args) => calls.push(args) }, shell: { revealWidget() {} } });
 await handler.showMaterialTrial({ editUri: 'raw' }); assert.equal(raw.node.children.length, 0);
 await handler.showMaterialTrial({ editUri: 'edit', originalTitle: 'A', title: 'B' });
 const bar = output.node.children[0];
 const overlayCss = readFileSync(new URL('../../../node_modules/@theia/core/src/browser/style/index.css', import.meta.url), 'utf8');
 const overlayZ = Number(overlayCss.match(/\.theia-transparent-overlay\s*\{[^}]*z-index:\s*(\d+)/)[1]);
 assert.ok(Number(bar.style.cssText.match(/z-index:(\d+)/)[1]) > overlayZ, 'real mouse release stays above the Theia overlay');
 assert.equal(bar.children[0].textContent, 'お試し中: A → B');
 for (const button of bar.children.slice(1)) button.onclick();
 assert.deepEqual(calls, [['akari.timeline.replayMaterialSwap', undefined], ['akari.timeline.finishMaterialSwap', true], ['akari.timeline.finishMaterialSwap', false]]);
 await handler.showMaterialTrial({ editUri: 'edit', originalTitle: 'A', title: 'C' }); assert.equal(output.node.children.length, 1);
 await handler.showMaterialTrial({ editUri: 'edit' }); assert.equal(output.node.children.length, 0);
});
test('seek waits for the saved replacement preview refresh before sending playback position', async () => {
 let done; const messages = [];
 const output = { akariPreviewConfigured: true, akariPreviewSeekable: true, isAttached: true, id: 'preview',
 akariPreviewRefresh: new Promise(resolve => { done = resolve; }), sendMessage: message => messages.push(message) };
 const handler = Object.assign(new Handler(), { openOutputPreviews: new Map([['edit', output]]), shell: { revealWidget() {} } });
 const seek = handler.seekOutputPreview({ editUri: 'edit', time: 1.4 });
 await Promise.resolve(); assert.equal(messages.length, 0); done();
 assert.equal(await seek, 'seeked'); assert.deepEqual(messages, [{ type: 'akari-preview-seek', time: 1.4 }]);
});

for (const initiallyOpen of [true, false, 'unconfigured']) test(`ready seek waits for current renderer and model (open=${initiallyOpen})`, async () => {
 let listener, rendererReady = false, finishModel, opened = 0;
 const model = new Promise(resolve => { finishModel = resolve; });
 const calls = [];
 const output = { id: 'preview', akariPreviewConfigured: initiallyOpen === true, akariPreviewSeekable: true, isAttached: true,
  akariPreviewPlaybackPageId: 'new-page',
  onMessage: fn => { listener = fn; return { dispose() { listener = undefined; } }; },
  sendMessage: message => {
   // A ready reply from the iframe being replaced must not release the wait.
   listener?.({ type: 'akari-preview-ready-seeked', requestId: message.requestId, pageId: 'old-page' });
   void respond(message);
  }
 };
 const respond = readySeek.createReadySeekResponder({ pageId: 'new-page', ready: () => rendererReady,
  pendingModel: () => model, seek: time => calls.push(['seek', time]), reply: message => listener?.(message) });
 const handler = Object.assign(new Handler(), {
  openOutputPreviews: new Map(initiallyOpen ? [['edit', output]] : []),
  getOrOpenPreview: async () => { opened++; return output; },
  fileService: { readFile: async () => ({ value: 'new edit' }) },
  queueRefresh: (widget, _uri, _kind, _seek, _force, editSource) => {
   assert.equal(initiallyOpen, true); assert.equal(editSource, 'new edit'); widget.akariPreviewRefresh = Promise.resolve();
  },
  attachTimelinePassively() {}, shell: { revealWidget() {} }
 });
 const operation = handler.seekOutputPreview({ editUri: 'edit', time: 1.333, waitForReady: true }).then(value => {
  assert.equal(value, 'seeked'); calls.push(['play']);
 });
 await new Promise(resolve => setTimeout(resolve, 120)); assert.deepEqual(calls, []);
 rendererReady = true;
 await new Promise(resolve => setTimeout(resolve, 120)); assert.deepEqual(calls, []);
 finishModel(); await operation;
 assert.deepEqual(calls, [['seek', 1.333], ['play']]); assert.equal(opened, initiallyOpen === true ? 0 : 1); assert.equal(listener, undefined);
});

test('renderer bridge waits for mount/engine and cancels initial playback restoration before seeking', () => {
 assert.match(source, /ready: \(\) => playbackMountReady/);
 assert.match(source, /getElementById\('frame-engine-preview'\)\?\.dataset.frameEngineReady === 'true'/);
 assert.match(source, /initialPositionApplied = true;\s*initialPlaybackRestorePending = false/);
 assert.match(source, /initialPlaybackRestorePending = false;[\s\S]*?seekTimelineTime\(time\)/);
 assert.match(source, /reply: message => window.akari.reportReadySeek\(message\)/);
 assert.match(source, /window.akari.reportReadySeek = message => vscode.postMessage\(message\)/);
 assert.match(source, /playbackModelUpdate = window.akari.frameEngineClock.updateModel\(nextSummary\)/);
});

test('trial controls are attached even when no output preview has been configured yet', async () => {
 const output = { id: 'output', node: new Element(), title: {}, isAttached: false };
 const handler = Object.assign(new Handler(), { openOutputPreviews: new Map(), hash: () => 'hash',
  widgetManager: { getOrCreateWidget: async () => output },
  shell: { addWidget(widget) { widget.isAttached = true; }, revealWidget() {} } });
 await handler.showMaterialTrial({ editUri: 'edit', title: 'B', originalTitle: 'A' });
 assert.equal(handler.openOutputPreviews.get('edit'), output);
 assert.equal(output.isAttached, true); assert.equal(output.akariPreviewConfigured, undefined);
 assert.equal(output.node.children[0].children[0].textContent, 'お試し中: A → B');
});

test('save notification and ready-seek share one update for identical edit text, in either order', async () => {
 for (const first of ['notification', 'ready-seek']) {
  const calls = [], uri = new URI('edit'), widget = { akariPreviewEditUri: uri };
  const handler = Object.assign(new Handler(), { previewGestureGuards: new Map(), reviewTransportByEdit: new Map(),
   refreshPreview: async (...args) => { calls.push(args[5]); }, handleRefreshFailure() {} });
  handler.queueRefresh(widget, uri, 'output', undefined, false, 'same edit');
  const pending = widget.akariPreviewRefresh;
  handler.queueRefresh(widget, uri, 'output', undefined, false, 'same edit');
  assert.equal(widget.akariPreviewRefresh, pending, first);
  await pending; assert.deepEqual(calls, ['same edit']);
  handler.queueRefresh(widget, uri, 'output', undefined, false, 'next edit');
  await widget.akariPreviewRefresh; assert.deepEqual(calls, ['same edit', 'next edit']);
 }
});

test('at-zero frame-engine and still-only readiness do not depend on the unused video clock', () => {
 const expression = source.match(/ready: \(\) => (playbackMountReady[\s\S]*?),\n\s*pendingModel:/)[1];
 const ready = new Function('playbackMountReady','frameEngineMediaIdle','document','initialPositionApplied','isStillSegment','segments','activeSegmentIndex','video', `return ${expression}`);
 const document = { getElementById: () => ({ dataset: { frameEngineReady: 'true' } }) };
 assert.equal(ready(true,true,document,false,()=>false,[],0,{readyState:0,seeking:true}), true);
 assert.equal(ready(true,false,document,true,()=>true,[{kind:'src'}],0,{readyState:0,seeking:true}), true);
 assert.equal(ready(true,false,document,true,()=>false,[{kind:'gap'}],0,{readyState:0,seeking:true}), true);
 assert.equal(ready(true,false,document,true,()=>false,[{kind:'src'}],0,{readyState:0,seeking:false}), false);
});
