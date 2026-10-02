import { readInspectorSource } from './helpers/inspector-source.mjs';
import './timeline-harness-dependencies.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { clearVideoPlayer, replaceVideoInEdit, shouldClearVideoCandidatePreview,
  videoCandidatePreviewDetail } from '../lib/browser/inspector/ai-video-candidates-panel.js';

const source = readInspectorSource();
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(row => ts.isClassDeclaration(row) && row.name?.text === 'AkariInspectorWidget');
const methods = ['clearVideoCandidatePreview', 'pickVideoCandidate', 'adoptVideoCandidate']
  .map(name => widget.members.find(row => row.name?.getText(ast) === name).getText(ast)).join('\n');
const code = ts.transpileModule(`class CandidateWidget { ${methods} }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const CandidateWidget = new Function('clearVideoPlayer', 'replaceVideoInEdit', 'videoCandidatePreviewDetail',
  `${code}; return CandidateWidget;`)(clearVideoPlayer, replaceVideoInEdit, videoCandidatePreviewDetail);

test('preview event uses replacement trim and freeze without touching edit or undo', async () => {
  const oldWindow = globalThis.window;
  const oldCustomEvent = globalThis.CustomEvent;
  const events = [];
  globalThis.window = { dispatchEvent: event => events.push(event) };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  try {
    const instance = new CandidateWidget();
    const root = { toString: () => 'file:///project', resolve: path => ({ toString: () => `file:///project/${path}` }) };
    const identity = { key: 'clip-frame', itemId: 'clip-frame' };
    const a = { ok: true, relativePath: 'assets/generated/candidates/clip-frame/a.mp4', durationSeconds: 6 };
    const b = { ok: true, relativePath: 'assets/generated/candidates/clip-frame/b.mp4', durationSeconds: 2 };
    const state = { picked: undefined, batch: { candidates: [a, b] }, running: false };
    instance.aiVideoStates = new Map([[identity.key, state]]);
    instance.workspaceService = { tryGetRoots: () => [{ resource: root }] };
    instance.fileService = { readFile: async () => ({ value: { buffer: new Uint8Array([0, 1]).buffer } }) };
    instance.model = { snapshot: {} };
    instance.generationIdentity = () => ({ ...identity, duration: 4 });
    instance.renderVideoCandidates = () => {};
    instance.generationDone = new Map(); instance.generationStates = new Map();
    let edit = { version: 2, sources: [{ id: 'still', path: 'start.png' }], tracks: [{ items: [
      { id: identity.itemId, source: { kind: 'media', src: 'still', in: 0, out: 4 } }
    ] }] };
    const original = structuredClone(edit), history = [];
    instance.stillWidgetManager = { getWidgets: () => [{ isDisposed: false, location: { root },
      commitEditMutation: async (_label, mutate) => { history.push(structuredClone(edit)); edit = mutate(structuredClone(edit)); }
    }] };
    await instance.pickVideoCandidate(identity, a);
    assert.deepEqual(events.at(-1).detail, { editUri: 'file:///project/edit.json', itemId: identity.itemId,
      relativePath: a.relativePath, inSeconds: 0, outSeconds: 4 });
    assert.deepEqual(edit, original); assert.equal(history.length, 0);
    await instance.pickVideoCandidate(identity, b);
    assert.equal(events.at(-2).detail.clear, true);
    assert.deepEqual(events.at(-1).detail.freeze, { atSeconds: 2, durationSeconds: 2 });
    await instance.pickVideoCandidate(identity, b);
    assert.equal(events.at(-1).detail.clear, true);
    assert.equal(state.picked, undefined);
    assert.equal(shouldClearVideoCandidatePreview(identity.itemId, undefined), true);
    assert.equal(shouldClearVideoCandidatePreview(identity.itemId, identity.itemId), false);
    await instance.pickVideoCandidate(identity, a);
    await instance.adoptVideoCandidate(identity);
    assert.equal(events.at(-1).detail.clear, true);
    assert.equal(history.length, 1);
    assert.equal(edit.sources.at(-1).path, a.relativePath);
    edit = history.pop();
    assert.deepEqual(edit, original);
  } finally {
    globalThis.window = oldWindow;
    globalThis.CustomEvent = oldCustomEvent;
  }
});
