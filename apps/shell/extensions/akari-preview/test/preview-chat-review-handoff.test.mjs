import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/browser/preview-chat-review-host.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
} }).outputText;

function loadHost() {
  const exports = {};
  runInNewContext(compiled, { exports, crypto: { randomUUID: () => 'frame-1' },
    atob: value => Buffer.from(value, 'base64').toString('binary'), Uint8Array,
    require(id) {
      if (id === '@akari-video/i18n') return { t: (key, params) => `${key}:${params?.path ?? ''}` };
      if (id === '@theia/core/lib/common/buffer') return { BinaryBuffer: { wrap: value => value } };
      if (id === '../common/review-attach-destination') return {
        reviewAttachDestination: kind => kind === 'chat' ? 'chat' : 'terminal'
      };
      if (id === '../common/chat-review-attachments') return {};
      if (id.startsWith('@theia/')) return {};
      return require(id);
    }
  });
  return exports.attachReviewToPartner;
}

const root = { toString: () => 'file:///project', resolve: path => path };
const mark = { kind: 'review', label: 'Review', review: { tool: 'pen', source: 'edit.json',
  sourceLabel: 'Edit', time: 2, text: '', annotationId: 'annotation-1',
  thumbnail: 'data:image/jpeg;base64,YQ==' } };
const files = { async createFolder() {}, async createFile() {} };

test('handToPartner receives IDs and frame paths without blocking on its promise', async () => {
  const calls = [];
  const commands = { getCommand: () => ({}), executeCommand(id, request) {
    calls.push([id, request]);
    if (id === 'akari.annotations.handToPartner') return new Promise(() => {});
    throw Error(id);
  } };
  const result = await Promise.race([
    loadHost()(root, root.toString(), [mark], { kind: 'terminal', name: 'Partner' }, commands, files, { error() {} }),
    new Promise(resolve => setTimeout(() => resolve('blocked'), 100))
  ]);
  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'akari.annotations.handToPartner');
  assert.deepEqual(Array.from(calls[0][1].ids), ['annotation-1']);
  assert.match(calls[0][1].extraLines[0], /\.akari\/review\/attachments\/frame-1\.jpg/);
});

test('chat attachment uses each composePacket result and fails closed', async () => {
  const calls = [];
  const messages = [];
  const commands = { getCommand: () => ({}), async executeCommand(id, request) {
    calls.push([id, request]);
    if (id === 'akari.annotations.composePacket') return 'Prepared annotation packet';
  } };
  assert.equal(await loadHost()(root, root.toString(), [mark], { kind: 'chat', name: 'AKARI' }, commands,
    files, { error: text => messages.push(text) }), true);
  assert.equal(calls[0][0], 'akari.annotations.composePacket');
  assert.deepEqual(Array.from(calls[0][1].ids), ['annotation-1']);
  assert.equal(calls[1][0], 'akari.chat.attach');
  assert.equal(calls[1][1].attachments[0].review.packet, 'Prepared annotation packet');
  calls.length = 0;
  commands.executeCommand = async (id, request) => {
    calls.push([id, request]);
    throw Error('unavailable');
  };
  assert.equal(await loadHost()(root, root.toString(), [mark], { kind: 'chat', name: 'AKARI' }, commands,
    files, { error: text => messages.push(text) }), false);
  assert.deepEqual(calls.map(([id]) => id), ['akari.annotations.composePacket']);
  assert.equal(messages.length, 1);
});

test('nested project saves frames locally and hands workspace-relative paths to annotations', async () => {
  const workspaceRootUri = 'file:///workspace';
  const projectRoot = { toString: () => 'file:///workspace/projects/film',
    resolve: path => `file:///workspace/projects/film/${path}` };
  const saved = [];
  const projectFiles = { async createFolder(path) { saved.push(['folder', path]); },
    async createFile(path) { saved.push(['file', path]); } };
  const calls = [];
  const commands = { getCommand: () => ({}), executeCommand(id, request) {
    calls.push([id, request]);
    if (id === 'akari.annotations.handToPartner') return new Promise(() => {});
    throw Error(id);
  } };
  assert.equal(await loadHost()(projectRoot, workspaceRootUri, [mark],
    { kind: 'terminal', name: 'Partner' }, commands, projectFiles, { error() {} }), true);
  assert.deepEqual(saved, [
    ['folder', 'file:///workspace/projects/film/.akari/review/attachments'],
    ['file', 'file:///workspace/projects/film/.akari/review/attachments/frame-1.jpg']
  ]);
  assert.equal(calls[0][1].projectRootUri, workspaceRootUri);
  assert.match(calls[0][1].extraLines[0],
    /projects\/film\/\.akari\/review\/attachments\/frame-1\.jpg/);
  const chatCalls = [];
  const chatCommands = { getCommand: () => ({}), async executeCommand(id, request) {
    chatCalls.push([id, request]);
    if (id === 'akari.annotations.composePacket') return 'Prepared annotation packet';
  } };
  assert.equal(await loadHost()(projectRoot, workspaceRootUri, [mark],
    { kind: 'chat', name: 'AKARI' }, chatCommands, projectFiles, { error() {} }), true);
  assert.equal(chatCalls[0][0], 'akari.annotations.composePacket');
  assert.equal(chatCalls[0][1].projectRootUri, workspaceRootUri);
});
