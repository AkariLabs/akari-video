import test from 'node:test';
import assert from 'node:assert/strict';
import { appendAiTranscribePanel } from '../lib/browser/inspector/ai-transcribe-panel.js';

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.textContent = ''; this.disabled = false; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  click() { if (!this.disabled) this.listeners.get('click')?.(); }
  change() { this.listeners.get('change')?.(); }
}
const find = (node, match) => match(node) ? node : node.children.map(child => find(child, match)).find(Boolean);
const byText = text => node => node.textContent === text;
const tick = () => new Promise(resolve => setImmediate(resolve));
const engines = [
  { id: 'auto', label: 'おまかせ（ローカル優先）', place: 'ローカル優先', price: '無料', hourlyUsd: 0,
    availability: { state: 'available', label: '使える' }, default: true },
  { id: 'speech-analyzer', label: 'SpeechAnalyzer', place: 'この Mac', price: '無料', hourlyUsd: 0,
    availability: { state: 'available', label: '使える' } },
  { id: 'cloud:scribe', label: 'Scribe', place: 'クラウド', price: '$0.40 / 時', hourlyUsd: .4,
    availability: { state: 'unavailable', label: '鍵が未登録' } },
  { id: 'cloud:groq', label: 'Groq', place: 'クラウド', price: '$0.04 / 時', hourlyUsd: .04,
    availability: { state: 'needs', label: '接続確認が必要' } }
];
const target = { relativePath: 'assets/interview.wav', name: 'interview.wav', duration: 180, atSeconds: 0 };
const none = { state: 'none', segments: [], total: 0 };
const done = { state: 'done', segments: [{ start: 0, end: 1, text: 'こんにちは' }], total: 1 };

async function withDom(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try { await run(); } finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
}
test('使えないエンジンは disabled、既定の選択と有料確認を扱う', () => withDom(async () => {
  const calls = [], confirmations = [];
  let selectedBackend;
  const options = { projectRoot: 'file:///project', target, summary: none, running: false, engines,
    commands: { executeCommand: async (...args) => { calls.push(args); return 'opened'; } },
    onDialogResult() {}, onSelectBackend: value => { selectedBackend = value; },
    confirm: async message => { confirmations.push(message); return false; } };
  const panel = new Node('div');
  appendAiTranscribePanel(panel, options);
  const unavailable = find(panel, node => node.attributes.get('data-akari-inspector-ai-transcribe-engine') === 'cloud:scribe');
  assert.equal(find(unavailable, node => node.tag === 'input').disabled, true);
  assert.equal(find(panel, node => node.tag === 'input' && node.value === 'auto').checked, true);
  find(unavailable, node => node.tag === 'input').change();
  assert.equal(selectedBackend, undefined);
  find(panel, node => node.tag === 'input' && node.value === 'speech-analyzer').change();
  assert.equal(selectedBackend, 'speech-analyzer');

  const paid = new Node('div');
  appendAiTranscribePanel(paid, { ...options, selectedBackend: 'cloud:groq', mediaDuration: 3600 });
  find(paid, byText('文字起こしする')).click(); await tick();
  assert.match(confirmations[0], /^Groq に音声を送ります。約 \$0\.0400（長さ 3600\.0 秒 × \$0\.04 \/ 時）$/);
  const short = new Node('div');
  appendAiTranscribePanel(short, { ...options, selectedBackend: 'cloud:groq', mediaDuration: 5 });
  find(short, byText('文字起こしする')).click(); await tick();
  assert.match(confirmations[1], /約 \$0\.0001（長さ 5\.0 秒 × \$0\.04 \/ 時）/);
  const scribe = new Node('div');
  appendAiTranscribePanel(scribe, { ...options, selectedBackend: 'cloud:scribe', mediaDuration: 5,
    engines: engines.map(engine => engine.id === 'cloud:scribe'
      ? { ...engine, availability: { state: 'available', label: '使える' } } : engine) });
  find(scribe, byText('文字起こしする')).click(); await tick();
  assert.match(confirmations[2], /約 \$0\.0006（長さ 5\.0 秒 × \$0\.40 \/ 時）/);
  const unknown = new Node('div');
  appendAiTranscribePanel(unknown, { ...options, target: { ...target, duration: 0 },
    selectedBackend: 'cloud:groq', mediaDuration: Number.NaN });
  find(unknown, byText('文字起こしする')).click(); await tick();
  assert.equal(confirmations[3], 'Groq に音声を送ります。約 $0.04 / 時（尺未取得）');
  assert.equal(calls.length, 0);
  const free = new Node('div');
  appendAiTranscribePanel(free, { ...options, selectedBackend: 'speech-analyzer' });
  find(free, byText('文字起こしする')).click(); await tick();
  assert.deepEqual(calls[0], ['akari.transcribe.openDialog', {
    projectRoot: 'file:///project', relativePath: 'assets/interview.wav', backend: 'speech-analyzer', autoStart: true
  }]);
}));

test('済みのやり直すでエンジン一覧へ移る', () => withDom(async () => {
  let redo = false;
  const options = { projectRoot: 'file:///project', target, summary: done, running: false, engines,
    commands: { executeCommand: async () => { throw new Error('dialog must not open'); } },
    onDialogResult() {}, onRedo: () => { redo = true; } };
  const panel = new Node('div');
  appendAiTranscribePanel(panel, options);
  assert.ok(find(panel, byText('こんにちは')));
  find(panel, byText('やり直す')).click();
  assert.equal(redo, true);
  const chooser = new Node('div');
  appendAiTranscribePanel(chooser, { ...options, redo });
  assert.ok(find(chooser, node => node.attributes.get('data-akari-inspector-ai-transcribe-engine') === 'auto'));
  assert.ok(find(chooser, byText('文字起こしする')));
}));
