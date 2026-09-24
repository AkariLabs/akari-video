import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { aiActionCatalog, describeAiTiles } from '../lib/common/ai-action-catalog.js';
import { aiTargetKindFor, appendAiTiles } from '../lib/browser/inspector/ai-tiles.js';
import { initialTabFor, tabsForKind } from '../lib/browser/inspector/tab-model.js';
import { appendAiTranscribePanel, resolveAiTranscribeTarget } from '../lib/browser/inspector/ai-transcribe-panel.js';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

const catalog = aiActionCatalog([]);
const transcribe = catalog.find(row => row.id === 'transcribe');
test('文字起こしは直す・字幕への行で音声と動画だけ押せる', () => {
  assert.deepEqual([transcribe.group, transcribe.output, transcribe.placement, transcribe.image],
    ['refine', 'captions', 'captions', 'transcribe']);
  assert.deepEqual(transcribe.routes, [{ id: 'transcript', label: '台本パネルのエンジン', kind: 'local', cost: 'free' }]);
  for (const target of ['audio', 'video']) {
    const group = describeAiTiles(catalog, target).find(row => row.group === 'refine');
    assert.equal(group.tiles[0].enabled, true);
  }
  for (const target of ['still', 'empty-frame', 'empty-audio-frame', 'generated-video']) {
    const tile = describeAiTiles(catalog, target).find(row => row.group === 'refine').tiles[0];
    assert.equal(tile.enabled, false);
    assert.equal(tile.reason, '声の入った音声か動画で使えます');
  }
  assert.equal(aiTargetKindFor({ hasIdentity: false, audio: true, audioPlanned: true }), 'empty-audio-frame');
});

test('静止画クリップの AI タブは作るに静止画・動画にする、直すに理由付きの文字起こしを並べる', () => {
  const target = aiTargetKindFor({ hasIdentity: true });
  const groups = describeAiTiles(aiActionCatalog([{ id: 'fal:h3-i2v', kind: 'video' }]), target);
  assert.deepEqual(groups.map(group => [group.group, group.tiles.map(tile => tile.label)]), [
    ['make', ['静止画', '動画にする']],
    ['refine', ['文字起こし']]
  ]);
  assert.deepEqual(groups[0].tiles.map(tile => tile.enabled), [true, true]);
  assert.deepEqual(groups[1].tiles[0], {
    id: 'transcribe', label: '文字起こし', image: 'transcribe', enabled: false,
    reason: '声の入った音声か動画で使えます'
  });
});

test('音声のタブは音声・AI・情報、既定は音声', () => {
  const tabs = tabsForKind('audio');
  assert.deepEqual(tabs.map(tab => [tab.id, tab.label]), [['audio', '音声'], ['generation', 'AI'], ['info', '情報']]);
  assert.equal(initialTabFor({ kind: 'audio', tabs, generationTodo: false }), 'audio');
  assert.equal(initialTabFor({ kind: 'audio', tabs, generationTodo: false, persisted: 'audio' }), 'audio');
});

test('readTranscriptSummary: 無し・空・7件・壊れたJSON・パス逸脱', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-transcript-summary-'));
  const directory = path.join(root, '.akari/sidecars/assets/interview.wav.analysis');
  const file = path.join(directory, 'analysis.json');
  const request = { projectRootUri: pathToFileURL(root).toString(), relativePath: 'assets/interview.wav' };
  const service = new AkariAnnotationsServiceImpl();
  const none = { state: 'none', segments: [], total: 0 };
  try {
    assert.deepEqual(await service.readTranscriptSummary(request), none);
    await mkdir(directory, { recursive: true });
    await writeFile(file, '{"transcript":[]}');
    assert.deepEqual(await service.readTranscriptSummary(request), none);
    const transcript = Array.from({ length: 7 }, (_, index) => ({ start: index, end: index + 0.5, text: `行 ${index}` }));
    await writeFile(file, JSON.stringify({ transcript }));
    assert.deepEqual(await service.readTranscriptSummary(request), { state: 'done', segments: transcript.slice(0, 5), total: 7 });
    assert.deepEqual(await service.readTranscriptSummary({ ...request, relativePath: '../outside.wav' }), none);
    await writeFile(file, '{broken');
    assert.deepEqual(await service.readTranscriptSummary(request), none);
  } finally { await rm(root, { recursive: true, force: true }); }
});

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.className = ''; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  click() { this.listeners.get('click')?.(); }
}
const find = (node, match) => match(node) ? node : node.children.map(child => find(child, match)).find(Boolean);
const byText = text => node => node.textContent === text;
async function withDom(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try { await run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('タイルには済みの札が付き、タイトルと別の要素になる', () => withDom(async () => {
  const parent = new Node('div');
  appendAiTiles(parent, describeAiTiles(catalog, 'audio'), () => {}, true);
  const tile = find(parent, node => node.attributes.get('data-akari-inspector-ai-tile') === 'transcribe');
  assert.equal(find(tile, byText('済み')).className, 'akari-inspector-ai-done-badge');
  assert.equal(find(tile, byText('文字起こし')).className, 'akari-inspector-ai-title');
}));

test('専用パネル: 対象解決・まだの openDialog 引数・running・済みの台本時刻', () => withDom(async () => {
  const snapshot = { kind: 'audio', id: 'a-1', audioKind: 'sfx', outputStart: 12.5, duration: 8 };
  const target = resolveAiTranscribeTarget(snapshot, { audio: { sfx: [{ id: 'a-1', path: 'assets/interview.wav' }] } });
  assert.deepEqual(target, { relativePath: 'assets/interview.wav', name: 'interview.wav', duration: 8, atSeconds: 12.5 });
  const calls = [];
  let result;
  const commands = { executeCommand: async (...args) => { calls.push(args); return 'running'; } };
  const base = { projectRoot: 'file:///project', target, commands, onDialogResult: value => { result = value; },
    engines: [{ id: 'auto', label: 'おまかせ（ローカル優先）', place: 'ローカル優先', price: '無料', hourlyUsd: 0,
      availability: { state: 'available', label: '使える' }, default: true }] };
  const parent = new Node('div');
  appendAiTranscribePanel(parent, { ...base, summary: { state: 'none', segments: [], total: 0 }, running: false });
  find(parent, byText('文字起こしする')).click();
  await tick();
  assert.deepEqual(calls[0], ['akari.transcribe.openDialog', { projectRoot: 'file:///project', relativePath: 'assets/interview.wav', backend: 'auto', autoStart: true }]);
  assert.equal(result, 'running');
  const running = new Node('div');
  appendAiTranscribePanel(running, { ...base, summary: { state: 'none', segments: [], total: 0 }, running: true });
  assert.ok(find(running, byText('文字起こし中です')));
  const done = new Node('div');
  appendAiTranscribePanel(done, { ...base, summary: { state: 'done', segments: [{ start: 0, end: 1, text: 'こんにちは' }], total: 7 }, running: false });
  assert.ok(find(done, byText('文字起こし済み · 7 行')));
  assert.ok(find(done, byText('こんにちは')));
  find(done, byText('台本で開く')).click();
  await tick();
  assert.deepEqual(calls[1], ['akari.daihon.open', { atSeconds: 12.5 }]);
}));
