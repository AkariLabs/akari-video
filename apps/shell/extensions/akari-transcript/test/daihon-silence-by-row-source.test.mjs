import assert from 'node:assert/strict';
import test from 'node:test';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decorator = () => () => {};
class BaseWidget {}
class DisposableCollection { push() {} dispose() {} }
const stubs = {
  '@theia/core/lib/browser': { BaseWidget, codicon: () => '' },
  '@theia/core/lib/browser/dialogs': { AbstractDialog: class {}, ConfirmDialog: class {}, Dialog: {} },
  '@theia/core/lib/common': {
    DisposableCollection, CommandService: Symbol('CommandService'),
    nls: { localize: (_key, value) => value }
  },
  '@theia/core/lib/common/preferences': {}, '@theia/core/lib/common/quick-pick-service': {},
  '@theia/core/lib/common/uri': { default: class URI {} },
  '@theia/core/shared/inversify': { inject: decorator, injectable: decorator, postConstruct: decorator },
  '@theia/filesystem/lib/browser/file-service': {}, '@theia/workspace/lib/browser/workspace-service': {},
  'akari-annotations/lib/browser/akari-edit-history-service': {},
  'akari-annotations/lib/common/akari-annotations-protocol': {},
  'akari-annotations/lib/common/edit-v2-mutations': {},
  'akari-project/lib/common/akari-project-protocol': {}
};
const original = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  if (request.startsWith('@theia/') || request.startsWith('akari-annotations/')
    || request.startsWith('akari-project/')) return {};
  return original.call(this, request, parent, isMain);
};
let AkariDaihonWidget;
try { ({ AkariDaihonWidget } = require('../lib/browser/daihon/akari-daihon-widget.js')); }
finally { Module._load = original; }

function widget(overrides = {}) {
  return Object.assign(Object.create(AkariDaihonWidget.prototype), {
    silencesBySourceId: new Map(), sourceCaptions: [], segments: [], editSources: []
  }, overrides);
}

test('silencesForRow は行または字幕の src を秒より優先する', () => {
  const s1 = [{ start: 1, end: 2 }];
  const s2 = [{ start: 5, end: 9 }];
  const instance = widget({
    silencesBySourceId: new Map([['src-1', s1], ['src-2', s2]]),
    sourceCaptions: [{ id: 'caption-src', src: 'src-2' }],
    segments: [{ kind: 'src', src: 'src-1', in: 0, out: 20 }],
    editSources: [{ id: 'src-1', path: 'one.mp4' }]
  });
  assert.equal(instance.silencesForRow({ id: 'row-src', start: 1, src: 'src-2' }), s2);
  assert.equal(instance.silencesForRow({ id: 'caption-src', start: 1 }), s2);
});

test('silencesForRow は src が無ければ秒、解決不能なら空へ落ちる', () => {
  const s1 = [{ start: 1, end: 2 }];
  const bySeconds = widget({
    silencesBySourceId: new Map([['src-1', s1]]),
    segments: [{ kind: 'src', src: 'src-1', in: 0, out: 20 }],
    editSources: [{ id: 'src-1', path: 'one.mp4' }]
  });
  assert.equal(bySeconds.silencesForRow({ id: 'unknown', start: 4 }), s1);
  assert.equal(widget({
    silencesBySourceId: new Map([['src-1', s1]]),
    editSources: [{ id: 'src-1', path: 'one.mp4' }]
  }).silencesForRow({ id: 'unknown', start: 40 }), s1);
  assert.deepEqual(bySeconds.silencesForRow({ id: 'known', start: 4, src: 'missing' }), []);
  assert.deepEqual(widget().silencesForRow({ id: 'unknown', start: 4 }), []);
});

test('rowGapsForRows は各行の src に対応する無音を使う', () => {
  const s1 = [{ start: 1.8, end: 3.2 }, { start: 6.2, end: 8.2 }];
  const s2 = [{ start: 6.5, end: 8.5 }];
  const rows = [
    { id: 's1-a', start: 0, end: 2, outStart: 0 },
    { id: 's1-b', start: 3, end: 4, outStart: 3 },
    { id: 's2-a', start: 5, end: 6, outStart: 5 },
    { id: 's2-b', start: 9, end: 10, outStart: 9 }
  ];
  const instance = widget({
    silencesBySourceId: new Map([['src-1', s1], ['src-2', s2]]),
    sourceCaptions: rows.map((candidate, index) => ({
      id: candidate.id, src: index < 2 ? 'src-1' : 'src-2'
    }))
  });
  assert.deepEqual(instance.rowGapsForRows(rows).find(gap => gap.prevId === 's2-a'),
    { prevId: 's2-a', nextId: 's2-b', start: 6.5, end: 8.5, span: 2, source: 'silence' });
});

const uri = { parent: {
  resolve: p => ({ normalizePath: () => ({ toString: () => `file:///project/${p}` }) }),
  toString: () => 'file:///project'
} };

async function waveformRequest(overrides, row) {
  const calls = [];
  const instance = widget({
    editUri: uri,
    annotationsService: {
      getClipWaveform: async request => {
        calls.push(request);
        return { status: 'ready', peaks: [] };
      }
    },
    ...overrides
  });
  await instance.loadCutRangeWaveform(
    { kind: 'word', start: 5, end: 6, limitStart: 5, limitEnd: 6 },
    { start: 4, end: 7 },
    row
  );
  return calls[0];
}

test('loadCutRangeWaveform は行の src を秒引きより優先する', async () => {
  const request = await waveformRequest({
    segments: [{ kind: 'src', src: 'src-1', in: 0, out: 20 }],
    editSources: [{ id: 'src-1', path: 'one.mp4' }, { id: 'src-2', path: 'two.mp4' }]
  }, { id: 'row', src: 'src-2' });
  assert.equal(request.videoUri, 'file:///project/two.mp4');
});

test('loadCutRangeWaveform は行の src 無しなら秒引きを使う', async () => {
  const request = await waveformRequest({
    segments: [{ kind: 'src', src: 'src-2', in: 0, out: 20 }],
    editSources: [{ id: 'src-1', path: 'one.mp4' }, { id: 'src-2', path: 'two.mp4' }]
  });
  assert.equal(request.videoUri, 'file:///project/two.mp4');
});

test('loadCutRangeWaveform は行と秒で解決不能なら先頭素材を使う', async () => {
  const request = await waveformRequest({
    editSources: [{ id: 'src-1', path: 'one.mp4' }, { id: 'src-2', path: 'two.mp4' }]
  });
  assert.equal(request.videoUri, 'file:///project/one.mp4');
});
