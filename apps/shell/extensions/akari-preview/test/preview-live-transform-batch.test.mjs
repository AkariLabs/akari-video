import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const previewSource = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const annotationsSource = readFileSync(new URL('../../akari-annotations/src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const inspectorSource = readFileSync(new URL('../../akari-annotations/src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} / ${end}`);
  return source.slice(from, to);
}

function sendThroughRelay(request) {
  const messages = [];
  const eventName = 'live-transform';
  const widgetCode = between(annotationsSource,
    'protected readonly inspectorRequestLivePreview =', '\n    protected inspectorBypass?');
  const widgetJs = ts.transpileModule(`class Widget { ${widgetCode} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const Widget = new Function('TIMELINE_LIVE_TRANSFORM_EVENT', `${widgetJs}; return Widget;`)(eventName);
  const relayCode = between(previewSource, 'const onLiveTransform = (event: Event): void => {',
    'window.addEventListener(TIMELINE_LIVE_TRANSFORM_EVENT, onLiveTransform);');
  const relayJs = ts.transpileModule(relayCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const editUri = 'file:///test/edit.json';
  const URI = class { constructor(value) { this.value = value; } normalizePath() { return this; } toString() { return this.value; } };
  const relay = new Function('URI', `${relayJs}; return onLiveTransform;`).call({
    openOutputPreviews: new Map([[editUri, { isAttached: true, sendMessage: message => messages.push(message) }]])
  }, URI);
  const widget = Object.assign(new Widget(), {
    dispatchPreviewEvent(type, detail) {
      assert.equal(type, eventName);
      relay({ detail: { ...detail, editUri } });
    }
  });
  widget.inspectorRequestLivePreview(request);
  return messages;
}

function receive(message, { asyncEngine = false } = {}) {
  const snapshots = [];
  const engineCalls = [];
  const liveValues = {};
  const metrics = { paints: 0, layouts: 0, ticks: 0, clears: 0 };
  let resolveEngine;
  const enginePromise = asyncEngine ? new Promise(resolve => { resolveEngine = resolve; }) : undefined;
  const window = { akari: {
    updateLayerLayout() { metrics.layouts++; snapshots.push({ ...video.dataset }); },
    frameEngineClock: {
      applyLivePreview(value) { engineCalls.push(['single', value]); },
      applyTransformPreview(target, values) {
        engineCalls.push(['batch', target, values]);
        return enginePromise;
      }
    }
  } };
  const video = { dataset: {}, style: {} };
  const body = between(previewSource,
    "if (message && message.type === 'akari-preview-live-transform' && message.target",
    '\n            });');
  const run = new Function('message', 'window', 'video', 'layersStage', 'CSS', 'updateLayerSelectBox',
    'liveValues', 'metrics', 'snapshots', `
    const liveDom = {
      update(_key, field, value) { liveValues[field] = value; },
      key() { return 'cut:0'; },
      paint() { metrics.paints++; snapshots.push({ ...video.dataset }); },
      clear() { metrics.clears++; }
    };
    const clearLiveOverride = () => liveDom.clear();
    const paintLiveOverride = () => liveDom.paint();
    const tick = () => { metrics.ticks++; };
    ${body}
  `);
  run(message, window, video, { querySelector: () => null }, { escape: value => value },
    () => {}, liveValues, metrics, snapshots);
  return { video, liveValues, snapshots, engineCalls, metrics, resolveEngine, ...metrics };
}

test('two LivePreviewRequest values reach the webview in one message', () => {
  const target = { kind: 'cut', index: 0 };
  const messages = sendThroughRelay({ target, values: { scaleX: 0.2814, scaleY: 0.8885 } });
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], {
    type: 'akari-preview-live-transform', target, values: { scaleX: 0.2814, scaleY: 0.8885 }
  });
});

test('webview applies both axes before one layout and paint', () => {
  const message = sendThroughRelay({ target: { kind: 'cut', index: 0 },
    values: { scaleX: 0.2814, scaleY: 0.8885 } })[0];
  const result = receive(message);
  assert.deepEqual(result.liveValues, message.values);
  assert.deepEqual(result.engineCalls, [['batch', message.target, message.values]]);
  assert.equal(result.video.dataset.akariTransformScaleX, '0.2814');
  assert.equal(result.video.dataset.akariTransformScaleY, '0.8885');
  assert.equal(result.layouts, 1);
  assert.equal(result.paints, 1);
  assert.ok(result.snapshots.every(snapshot =>
    snapshot.akariTransformScaleX === '0.2814' && snapshot.akariTransformScaleY === '0.8885'));
});

test('engine completion repaints with both axes already applied', async () => {
  const message = sendThroughRelay({ target: { kind: 'cut', index: 0 },
    values: { scaleX: 0.2814, scaleY: 0.8885 } })[0];
  const result = receive(message, { asyncEngine: true });
  assert.equal(result.metrics.layouts, 1);
  assert.equal(result.metrics.paints, 1);
  result.resolveEngine();
  await new Promise(setImmediate);
  assert.equal(result.metrics.layouts, 2);
  assert.equal(result.metrics.paints, 2);
  assert.ok(result.snapshots.every(snapshot =>
    snapshot.akariTransformScaleX === '0.2814' && snapshot.akariTransformScaleY === '0.8885'));
});

test('legacy one field request still relays and paints', () => {
  const target = { kind: 'cut', index: 0 };
  const messages = sendThroughRelay({ target, field: 'x', value: 42 });
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].values, { x: 42 });
  assert.equal(messages[0].field, 'x');
  assert.equal(messages[0].value, 42);
  const result = receive(messages[0]);
  assert.equal(result.video.dataset.akariTransformX, '42');
  assert.deepEqual(result.engineCalls, [['single', messages[0]]]);
  assert.equal(result.layouts, 1);
  assert.equal(result.paints, 1);
});

test('batch clear restores both axes with one engine update and tick', () => {
  const target = { kind: 'cut', index: 0 };
  const messages = sendThroughRelay({ target, values: { scaleX: 0.5, scaleY: 0.5 }, clear: true });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].clear, true);
  const result = receive(messages[0]);
  assert.deepEqual(result.engineCalls, [['batch', target, { scaleX: 0.5, scaleY: 0.5 }]]);
  assert.equal(result.clears, 1);
  assert.equal(result.ticks, 1);
});

test('frame aspect live request sends both axes once', () => {
  const ast = ts.createSourceFile('inspector.ts', inspectorSource, ts.ScriptTarget.Latest, true);
  const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
  const method = widget.members.find(node => node.name?.getText(ast) === 'sendFrameAspectLive');
  const js = ts.transpileModule(`class Harness { ${method.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const Harness = new Function(`${js}; return Harness;`)();
  const requests = [];
  const instance = Object.assign(new Harness(), {
    model: { snapshot: {}, requestLivePreview: request => requests.push(request) },
    generationIdentity: () => ({ key: 'frame', sourcePath: 'frame.png' }),
    frameAspectTargets: new Map([['frame', { kind: 'cut', index: 0 }]])
  });
  instance.sendFrameAspectLive('frame', { sourcePath: 'frame.png', live: () => ({ scaleX: 0.3, scaleY: 0.9 }) });
  assert.deepEqual(requests, [{ target: { kind: 'cut', index: 0 }, values: { scaleX: 0.3, scaleY: 0.9 } }]);
});
