import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isProjectVideoCandidatePath, videoCandidatePreviewTime } from '../lib/common/video-candidate-preview.js';

test('only project-local generated mp4 for the selected item is accepted', () => {
  const good = 'assets/generated/candidates/clip-frame/fal-h3-123.mp4';
  assert.equal(isProjectVideoCandidatePath('clip-frame', good), true);
  for (const path of [
    '../outside.mp4', '/tmp/outside.mp4', 'file:///tmp/outside.mp4',
    'assets/generated/candidates/other/fal-h3-123.mp4',
    'assets/generated/candidates/clip-frame/../outside.mp4',
    'assets/generated/candidates/clip-frame/..evil.mp4',
    'assets\\generated\\candidates\\clip-frame\\file.mp4',
    'assets/generated/candidates/clip-frame/file.png'
  ]) assert.equal(isProjectVideoCandidatePath('clip-frame', path), false, path);
});

test('candidate clock trims long video and holds the last frame of short video', () => {
  assert.equal(videoCandidatePreviewTime(2.5, 6, 4, 30), 2.5);
  assert.ok(Math.abs(videoCandidatePreviewTime(3.9, 2, 4, 30) - (2 - 1 / 30)) < 1e-9);
  assert.equal(videoCandidatePreviewTime(-1, 2, 4), 0);
});

test('host streams only a resolved project file and requests its FLAC sidecar', async () => {
  const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('host.ts', source, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(row => ts.isClassDeclaration(row) && row.name?.text === 'AkariPreviewOpenHandler');
  const methods = ['clearVideoCandidatePreview', 'showVideoCandidatePreview']
    .map(name => klass.members.find(row => row.name?.getText(ast) === name).getText(ast)).join('\n');
  const code = ts.transpileModule(`class Host { ${methods} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  class URI {
    constructor(value) { this.url = new URL(value); this.scheme = this.url.protocol.slice(0, -1);
      this.authority = this.url.host; this.path = { toString: () => this.url.pathname }; }
    normalizePath() { return this; }
    get parent() { return new URI(new URL('.', this.url).toString()); }
    toString() { return this.url.toString(); }
  }
  const Host = new Function('URI', `${code}; return Host;`)(URI);
  const host = new Host();
  const edit = new URI('file:///project/edit.json');
  const messages = [], disposed = [], requests = [];
  const widget = { akariPreviewEditUri: edit, isDisposed: false, sendMessage: message => messages.push(message) };
  host.openOutputPreviews = new Map([[edit.toString(), widget]]);
  host.videoCandidatePreviews = new Map();
  host.createVideoStream = async () => { requests.push('video'); return { id: 'video-1', url: 'http://localhost/video' }; };
  host.disposeVideoStreamId = async id => { disposed.push(id); };
  host.disposeAssetStreams = async ids => { disposed.push(...ids); };
  host.previewService = { resolveProjectAssetUri: async () => 'file:///outside/escaped.mp4',
    requestPreviewAudioSidecar: async request => { requests.push(request); return { state: 'ready',
      stream: { id: 'audio-1', url: 'http://localhost/audio.flac' } }; } };
  const detail = { itemId: 'clip-frame', relativePath: 'assets/generated/candidates/clip-frame/a.mp4',
    inSeconds: 0, outSeconds: 2 };
  await host.showVideoCandidatePreview(edit.toString(), detail);
  assert.deepEqual(requests, []);
  host.previewService.resolveProjectAssetUri = async () => `file:///project/${detail.relativePath}`;
  await host.showVideoCandidatePreview(edit.toString(), detail);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.find(row => row.type === 'akari-preview-video-candidate' && row.url)?.relativePath,
    detail.relativePath);
  assert.equal(requests.find(row => typeof row === 'object')?.format, 'flac');
  assert.equal(requests.find(row => typeof row === 'object')?.outSec, 2);
  assert.equal(messages.find(row => row.type === 'akari-preview-video-candidate-audio')?.url,
    'http://localhost/audio.flac');
  host.clearVideoCandidatePreview(edit.toString(), detail.itemId);
  assert.ok(disposed.includes('video-1'));
  assert.ok(disposed.includes('audio-1'));
});
