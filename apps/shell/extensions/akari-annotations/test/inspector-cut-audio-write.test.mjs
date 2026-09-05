import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { readEditV2 } from '@akari-video/edit-store/lib/edit-v2.js';
import { readInternalEdit, projectLegacyEdit } from '@akari-video/edit-store/lib/internal-model.js';
import { updateItem } from '../lib/common/edit-v2-mutations.js';
import { composeInspectorSections } from '../lib/browser/inspector/section-model.js';
import { readCutFreeze } from '../lib/browser/inspector/freeze-fields.js';
import { toV2Edit } from './helpers/v2-fixture.mjs';

// audio-clip-fx-fixture と同じく、Theia の DOM / DI を起動せず実 factory / handler を実行する。
function sourceFile(name) {
  return ts.createSourceFile(name, readFileSync(new URL(`../src/browser/${name}`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
}

function compile(code, bindings, result) {
  const output = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
  }).outputText;
  return new Function(...Object.keys(bindings), `${output}\nreturn ${result};`)(...Object.values(bindings));
}

const inspector = sourceFile('akari-inspector-widget.ts');
const cutFactory = inspector.statements.find(statement => ts.isFunctionDeclaration(statement)
  && statement.name.text === 'CUT_SECTIONS');
const cutSections = compile(cutFactory.getText(inspector), {
  composeInspectorSections,
  cutFramingFields: () => [],
  cutFreezeFields: () => []
}, 'CUT_SECTIONS');

const timeline = sourceFile('akari-annotations-widget.ts');
const widget = timeline.statements.find(statement => ts.isClassDeclaration(statement)
  && statement.members.some(member => member.name?.getText(timeline) === 'handleInspectorWriteV2'));
const methodNames = ['snapshotForSelection', 'handleInspectorWriteV2'];
const methods = widget.members.filter(member => methodNames.includes(member.name?.getText(timeline)));
const Handler = compile(`class Handler { ${methods.map(method => method.getText(timeline)).join('\n')} }`, {
  readCutFreeze,
  readInspectorAdjustSnapshot: () => undefined,
  updateV2Item: updateItem
}, 'Handler');

function fixture(sourceFields = {}) {
  const context = new Handler();
  context.editDocument = toV2Edit({ cuts: [{ in: 0, out: 5 }] });
  const itemId = context.editDocument.tracks[0].items[0].id;
  Object.assign(context.editDocument.tracks[0].items[0].source, sourceFields);
  context.cuts = projectLegacyEdit(readInternalEdit(context.editDocument)).cuts;
  context.segments = [{ tlStart: 0, tlEnd: 5 }];
  context.sourceMap = new Map();
  context.playheadT = 0;
  context.cutItemId = () => itemId;
  context.rawV2Item = () => context.editDocument.tracks[0].items[0];
  context.rawKeyframeItem = context.rawV2Item;
  context.trackDisplayNameForItem = () => 'Video';
  context.cutSourceName = () => 'main';
  context.hideNotice = () => {};
  context.showNotice = () => {};
  context.errorMessage = error => error.message;
  context.footer = {};
  context.labels = [];
  context.commitEditMutation = async (label, mutate) => {
    const next = mutate(context.editDocument);
    readEditV2(next);
    context.editDocument = next;
    context.labels.push(label);
  };
  const snapshot = context.snapshotForSelection({ kind: 'cut', index: 0 });
  const sections = cutSections(snapshot, request => context.handleInspectorWriteV2(request));
  const fields = Object.fromEntries(sections.find(section => section.id === 'audio').fields.map(field => [field.name, field]));
  return { context, snapshot, sections, fields, source: () => context.rawV2Item().source };
}

test('v2 cut snapshot は埋め込み音声を読み、audio 節の2項目とミュート表示へ渡す', () => {
  const { snapshot, sections, fields } = fixture({ gain_db: -12, mute: true });
  assert.equal(snapshot.audioGainDb, -12);
  assert.equal(snapshot.audioMute, true);
  assert.deepEqual(sections.slice(-3).map(section => section.id), ['timing', 'audio', 'info']);
  assert.deepEqual(Object.keys(fields), ['gain-db', 'mute']);
  assert.equal(fields['gain-db'].getValue(snapshot), '-12（ミュート中）');
  assert.equal(fields['gain-db'].getEditValue(snapshot), '-12');
  assert.equal(fields['gain-db'].unit, 'dB');
  assert.equal(fields['gain-db'].scrubStep, 0.5);
  assert.equal(fields.mute.inputKind, 'boolean-select');
  assert.equal(fields.mute.getValue(snapshot), 'true');
  const defaults = fixture();
  assert.equal(defaults.fields['gain-db'].getValue(defaults.snapshot), '0');
  assert.equal(defaults.fields.mute.getValue(defaults.snapshot), 'false');
});

test('gain-db の実 write は source.gain_db を変更し尺を保持する', async () => {
  const { context, snapshot, fields, source } = fixture();
  const before = structuredClone(context.editDocument);
  assert.deepEqual(await fields['gain-db'].write(snapshot, '-12'), { ok: true });
  assert.equal(source().gain_db, -12);
  before.tracks[0].items[0].source.gain_db = -12;
  assert.deepEqual(context.editDocument, before);
  assert.deepEqual(context.labels, ['埋め込み音声の音量を変更']);
});

test('gain-db は範囲外・非数値を拒否し v2 を変更しない', async () => {
  const { context, snapshot, fields } = fixture({ gain_db: -6 });
  const before = structuredClone(context.editDocument);
  for (const value of ['-61', '13', 'bad', 'NaN', 'Infinity']) {
    assert.equal((await fields['gain-db'].write(snapshot, value)).ok, false);
    assert.deepEqual(context.editDocument, before);
  }
  for (const value of [-61, 13, NaN, Infinity]) {
    assert.equal((await context.handleInspectorWriteV2({ kind: 'cut-audio-gain', index: 0, value })).ok, false);
    assert.deepEqual(context.editDocument, before);
  }
  assert.deepEqual(context.labels, []);
});

test('boolean-select の文字列 true / false は mute の設定 / キー削除を行う', async () => {
  const { context, snapshot, fields, source } = fixture();
  assert.deepEqual(await fields.mute.write(snapshot, 'true'), { ok: true });
  assert.equal(source().mute, true);
  assert.deepEqual(await fields.mute.write(snapshot, 'false'), { ok: true });
  assert.equal(Object.hasOwn(source(), 'mute'), false);
  assert.deepEqual(context.labels, ['埋め込み音声をミュート', '埋め込み音声のミュートを解除']);
});

test('gain-db reset は null mutation でキーを削除し mute と尺を保持する', async () => {
  const { context, fields, source } = fixture({ gain_db: -12, mute: true });
  assert.deepEqual(await fields['gain-db'].reset(), { ok: true });
  assert.equal(Object.hasOwn(source(), 'gain_db'), false);
  assert.equal(source().mute, true);
  assert.equal(context.rawV2Item().duration, 150);
});
