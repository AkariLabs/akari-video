import assert from 'node:assert/strict';
import test from 'node:test';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decorator = () => () => {};
const stubs = {
  '@theia/core/lib/browser': { BaseWidget: class {}, codicon: () => '' },
  '@theia/core/lib/browser/dialogs': { AbstractDialog: class {}, ConfirmDialog: class {}, Dialog: {} },
  '@theia/core/lib/common': { DisposableCollection: class {}, CommandService: Symbol('CommandService') },
  '@theia/core/lib/common/preferences': { PreferenceScope: { User: 0 } },
  '@theia/core/lib/common/quick-pick-service': {},
  '@theia/core/lib/common/uri': { default: class URI {} },
  '@theia/core/shared/inversify': { inject: decorator, injectable: decorator, postConstruct: decorator },
  '@theia/filesystem/lib/browser/file-service': {}, '@theia/workspace/lib/browser/workspace-service': {},
  'akari-annotations/lib/browser/active-timeline': { onActiveTimelineEditUriChange: () => ({ dispose() {} }) },
  'akari-annotations/lib/browser/akari-edit-history-service': {},
  'akari-annotations/lib/common/akari-annotations-protocol': {},
  'akari-annotations/lib/common/edit-v2-mutations': require('akari-annotations/lib/common/edit-v2-mutations'),
  'akari-project/lib/common/akari-project-protocol': {}
};
const original = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.hasOwn(stubs, request)) return stubs[request];
  if (request.startsWith('@theia/') || request.startsWith('akari-annotations/')
    || request.startsWith('akari-project/')) return {};
  return original.call(this, request, parent, isMain);
};
let AkariDaihonWidget;
try { ({ AkariDaihonWidget } = require('../lib/browser/daihon/akari-daihon-widget.js')); }
finally { Module._load = original; }
const { isMissingDaihonFile, retryDaihonRead } = require('../lib/browser/daihon/daihon-read-retry.js');
const { shouldReloadDaihonChanges } = require('../lib/common/daihon-caption-edit-queue.js');

const missing = () => Object.assign(new Error('Unable to read file (EntryNotFound) ENOENT'), { code: 'ENOENT' });
const uri = path => ({
  toString: () => `file:///project/${path}`,
  normalizePath() { return this; },
  path: { base: path.split('/').at(-1) },
  isEqualOrParent: () => true,
  parent: { toString: () => 'file:///project', resolve: name => uri(name) }
});
const editUri = uri('edit.json');
const captionsUri = uri('captions.json');
const edit = JSON.stringify({ version: 1, sources: [{ id: 'main', path: 'main.mp4' }] });
const caption = { id: 'r1', src: 'main', start: 0, end: 2, text: 'こんにちは', speaker: null,
  sourceRef: null, edited: false, words: [] };
const captions = JSON.stringify({ captions: [caption] });

function fixture(readCaptions, readEdit = () => edit) {
  const notices = [], empty = [], waits = [], renders = [];
  const instance = Object.assign(Object.create(AkariDaihonWidget.prototype), {
    rootUri: undefined, editUri, captionsUri, reloadTail: Promise.resolve(),
    wordDrag: undefined, elements: new Map(), captionOverflowUnitsById: new Map(),
    wordUnitsByRowId: new Map(), handEditedCaptionIds: new Set(),
    sourceGroups: [], openSourceGroupIds: new Set(), savedOpenSourceGroupIds: new Set(),
    captionsButton: { disabled: false }, cutSources: [], cutSpans: [],
    async readText(target) {
      if (target === editUri) return readEdit();
      if (target === captionsUri) return readCaptions();
      return '';
    },
    waitForDaihonReadRetry(ms) { waits.push(ms); return Promise.resolve(); },
    showToast(message) {
      const toast = { message, removed: false, parentElement: null, remove() { this.removed = true; } };
      notices.push(toast);
      return toast;
    },
    showEmpty(message = 'edit.json のあるプロジェクトを開くと字幕がここに並びます') { empty.push(message); this.rows = []; },
    renderRows(next) { this.rows = next; renders.push(next); },
    closeCutRangeEditor() {}, updateCutsButton() {}, loadSilences: async () => {},
    async refreshCaptionsButton() {}, updateDisplayButton() {},
    captionExtras: () => new Map(), resolveWordPresets: () => new Map(),
    daihonCaptionsForDisplay() { return this.sourceCaptions.map(item => ({ ...item, style: null })); },
    timelineSegments: () => [{ kind: 'src', src: 'main', in: 0, out: 2, outStart: 0, outEnd: 2 }],
    rowGapsForRows: () => [], sourceIdForRow: () => 'main',
    projectService: { async readTranscribeArtifacts() { return {}; } },
    refreshDockLook() {}, notify() {}
  });
  return { instance, notices, empty, waits, renders };
}

const { DaihonReloadQueue } = require('../lib/common/daihon-caption-edit-queue.js');

function watchChanges(run) {
  let onChange;
  const root = uri('');
  Object.assign(run.instance, {
    captionEditQueue: { hasOwnedCaptionChange: () => false, hasPendingVisibleWrite: () => false },
    reloadQueue: new DaihonReloadQueue(() => run.instance.reload(), () => true),
    preferences: { get: () => undefined }, updateAttachmentModeButtons() {},
    workspaceService: { ready: Promise.resolve(), roots: Promise.resolve([{ resource: root }]) },
    locateProject() { this.editUri = editUri; this.captionsUri = captionsUri; },
    toDispose: { push() {} },
    fileService: {
      onDidFilesChange(listener) { onChange = listener; return { dispose() {} }; },
      async watch() { return { dispose() {} }; }
    }
  });
  return (resource, type = 0) => onChange({ changes: [{ resource, type }] });
}

test('欠落は空表示になり、作成イベントで字幕を読み込む', async () => {
  let present = false;
  let source = captions;
  const run = fixture(() => present ? source : Promise.reject(missing()));
  const change = watchChanges(run);
  await run.instance.configure();
  assert.match(run.empty.at(-1), /まだ字幕がありません/u);
  assert.equal(run.notices.length, 0);
  assert.deepEqual(run.waits, [100, 200, 300]);
  assert.equal(shouldReloadDaihonChanges([captionsUri.toString()], captionsUri.toString(), false), true);
  present = true;
  change(captionsUri, 1);
  await run.instance.reloadTail;
  assert.equal(run.instance.rows[0].text, 'こんにちは');
  for (const [type, text] of [[0, '更新しました'], [1, '置き換えました']]) {
    source = JSON.stringify({ captions: [{ ...caption, text }] });
    change(captionsUri, type);
    await run.instance.reloadTail;
    assert.equal(run.instance.rows[0].text, text);
  }
  assert.equal(run.notices.length, 0);
});

test('字幕だけの変更と watcher エコーは素材別の再取得を起こさない', async () => {
  let source = captions;
  let silences = 0;
  let artifacts = 0;
  let renders = 0;
  const run = fixture(() => source);
  run.instance.loadSilences = async () => { silences++; };
  run.instance.projectService.readTranscribeArtifacts = async () => { artifacts++; return {}; };
  run.instance.renderRows = next => { run.instance.rows = next; renders++; };
  const change = watchChanges(run);
  await run.instance.configure();
  assert.equal(silences, 1);
  assert.equal(artifacts, 1);
  source = JSON.stringify({ captions: [{ ...caption, text: '更新' }] });
  change(captionsUri);
  await run.instance.reloadTail;
  assert.equal(run.instance.rows[0].text, '更新');
  assert.equal(silences, 1);
  assert.equal(artifacts, 1);
  const afterChange = renders;
  change(captionsUri);
  await run.instance.reloadTail;
  assert.equal(renders, afterChange);
  assert.equal(silences, 1);
  assert.equal(artifacts, 1);
});

test('同じ字幕本文の watcher と保存後要求は処理中でも reload 一回に合流する', async () => {
  const run = fixture(() => captions);
  let reloads = 0;
  let release;
  run.instance.requestReload = async () => {
    reloads++;
    await new Promise(resolve => { release = resolve; });
  };
  const first = run.instance.queueCaptionReloadIfChanged();
  await Promise.resolve();
  await run.instance.queueCaptionReloadIfChanged();
  assert.equal(reloads, 1);
  release();
  await first;
});

test('字幕本文が同じでも edit の変更は台本へ反映する', async () => {
  let editSource = edit;
  const run = fixture(() => captions, () => editSource);
  const change = watchChanges(run);
  await run.instance.configure();
  const before = run.renders.length;
  editSource = JSON.stringify({ ...JSON.parse(edit), output: { fps: 24 } });
  change(editUri);
  await run.instance.reloadTail;
  assert.equal(run.renders.length, before + 1);
  assert.equal(run.instance.editFps, 24);
});

test('初回読み込みが失敗しても次の変更イベント 1 回で復帰する', async () => {
  let editSource = JSON.stringify({ version: 1, tracks: {} });
  const run = fixture(() => captions, () => editSource);
  const change = watchChanges(run);
  await assert.rejects(run.instance.configure(), TypeError);
  editSource = edit;
  change(editUri);
  await run.instance.reloadTail;
  assert.equal(run.instance.rows[0].text, 'こんにちは');
  assert.equal(run.notices.some(notice => notice.message.includes('台本を更新できません')), false);
});

test('確定済みの欠落は待たず、成功後の欠落は再び短く待つ', async () => {
  let present = false;
  const run = fixture(() => present ? captions : Promise.reject(missing()));
  await run.instance.reload();
  assert.deepEqual(run.waits, [100, 200, 300]);
  assert.match(run.empty.at(-1), /まだ字幕がありません/u);
  await run.instance.reload();
  assert.deepEqual(run.waits, [100, 200, 300]);
  assert.match(run.empty.at(-1), /まだ字幕がありません/u);
  assert.equal(run.notices.length, 0);
  present = true;
  await run.instance.reload();
  assert.equal(run.instance.rows[0].text, 'こんにちは');
  present = false;
  await run.instance.reload();
  assert.deepEqual(run.waits, [100, 200, 300, 100, 200, 300]);
  assert.match(run.empty.at(-1), /まだ字幕がありません/u);
  assert.equal(run.notices.length, 0);
});

test('確定済みの欠落後でも権限エラーを再試行し、次の欠落も再試行する', async () => {
  let mode = 'missing';
  const run = fixture(() => {
    if (mode === 'denied') throw Object.assign(new Error('denied'), { code: 'EACCES' });
    throw missing();
  });
  await run.instance.reload();
  mode = 'denied';
  const previous = console.warn;
  console.warn = () => {};
  try { await run.instance.reload(); }
  finally { console.warn = previous; }
  assert.deepEqual(run.waits, [100, 200, 300, 100, 200, 300]);
  assert.match(run.notices.at(-1).message, /台本を読み取れません/u);
  mode = 'missing';
  await run.instance.reload();
  assert.deepEqual(run.waits, [100, 200, 300, 100, 200, 300, 100, 200, 300]);
  assert.match(run.empty.at(-1), /まだ字幕がありません/u);
  assert.equal(run.notices.at(-1).removed, true);
});

test('一度出た読み込みエラーは成功時に消え、ほかの通知は残る', async () => {
  let source = '{';
  const run = fixture(() => source);
  const warnings = [], previous = console.warn;
  console.warn = (...args) => warnings.push(args);
  try { await run.instance.reload(); }
  finally { console.warn = previous; }
  assert.equal(run.notices.length, 1);
  const unrelated = run.instance.showToast('別のエラー', true);
  source = captions;
  await run.instance.reload();
  assert.equal(run.notices[0].removed, true);
  assert.equal(unrelated.removed, false);
  assert.equal(run.instance.rows.length, 1);
  assert.equal(warnings.length, 1);
});

test('壊れた JSON の画面表示は日本語のみで、詳細はコンソールへ送る', async () => {
  const run = fixture(() => '{');
  const warnings = [], previous = console.warn;
  console.warn = (...args) => warnings.push(args);
  try { await run.instance.reload(); }
  finally { console.warn = previous; }
  assert.match(run.notices[0].message, /台本を読み取れません/u);
  assert.doesNotMatch(run.notices[0].message, /Unable to read|EntryNotFound|\/private\/|SyntaxError/u);
  assert.equal(warnings.length, 1);
  assert.deepEqual(run.waits, [100, 200, 300]);
  const previousWarn = console.warn;
  console.warn = () => {};
  try { run.instance.showError(new Error('Unable to read file captions.json (EntryNotFound)')); }
  finally { console.warn = previousWarn; }
  assert.doesNotMatch(run.notices.at(-1).message, /Unable to read|EntryNotFound/u);
});

test('一時的な欠落と書き込み途中の JSON は短い再試行で回復する', async () => {
  let calls = 0;
  const run = fixture(() => {
    calls++;
    if (calls === 1) throw missing();
    return calls === 2 ? '{' : captions;
  });
  await run.instance.reload();
  assert.equal(calls, 3);
  assert.deepEqual(run.waits, [100, 200]);
  assert.equal(run.instance.rows[0].text, 'こんにちは');
  assert.equal(run.notices.length, 0);
});

test('欠落判定と待ち時間の差し替え', async () => {
  assert.equal(isMissingDaihonFile(new Error('Unable to read file (EntryNotFound)')), true);
  assert.equal(isMissingDaihonFile(Object.assign(new Error('missing'), { code: 'FileNotFound' })), true);
  assert.equal(isMissingDaihonFile(Object.assign(new Error('denied'), { code: 'EACCES' })), false);
  const waits = [];
  let attempt = 0;
  const result = await retryDaihonRead(async () => {
    if (attempt++ < 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    return 'ok';
  }, ms => { waits.push(ms); return Promise.resolve(); });
  assert.equal(result, 'ok');
  assert.deepEqual(waits, [100, 200]);
  for (const error of [Object.assign(new Error('locked'), { code: 'EPERM' }),
    new Error('Unable to read file (EACCES)')]) {
    let reads = 0;
    assert.equal(await retryDaihonRead(async () => {
      if (reads++ === 0) throw error;
      return 'recovered';
    }, () => Promise.resolve()), 'recovered');
    assert.equal(reads, 2);
  }
});

test('edit.json が無いときは従来の空表示を保つ', async () => {
  const run = fixture(() => captions);
  run.instance.editUri = undefined;
  run.instance.captionsUri = undefined;
  await run.instance.reload();
  assert.equal(run.empty.at(-1), 'edit.json のあるプロジェクトを開くと字幕がここに並びます');
  assert.equal(run.notices.length, 0);
});
