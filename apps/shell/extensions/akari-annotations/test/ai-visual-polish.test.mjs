import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { describeGenerationChip } from '../lib/common/generation-sidecar.js';
import { appendAiMaterialView } from '../lib/browser/inspector/ai-material-view.js';

class Node {
  constructor(tag) {
    this.tag = tag; this.children = []; this.parentElement = null; this.dataset = {};
    this.attributes = new Map(); this.listeners = new Map(); this.className = ''; this.ownText = '';
    this.title = ''; this.style = {};
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/u).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/u).filter(name => name && !names.includes(name)).join(' '); },
      contains: name => this.className.split(/\s+/u).includes(name)
    };
  }
  set textContent(value) { this.ownText = value ?? ''; this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  prepend(child) { child.remove(); child.parentElement = this; this.children.unshift(child); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  click() { this.listeners.get('click')?.(); }
  querySelector(selector) {
    const direct = selector.startsWith(':scope > ');
    const token = direct ? selector.slice(9) : selector;
    const matches = node => token.startsWith('.') ? node.classList.contains(token.slice(1))
      : token === '[data-akari-generation-badge]' ? Object.hasOwn(node.dataset, 'akariGenerationBadge')
      : token === '[data-akari-generation-progress]' ? Object.hasOwn(node.dataset, 'akariGenerationProgress') : false;
    const search = children => { for (const child of children) { if (matches(child)) return child; if (!direct) { const found = search(child.children); if (found) return found; } } return null; };
    return search(this.children);
  }
}

const widgetSource = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const widgetAst = ts.createSourceFile('widget.ts', widgetSource, ts.ScriptTarget.Latest, true);
const widget = widgetAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const member = name => widget.members.find(node => node.name?.getText(widgetAst) === name)?.getText(widgetAst);
const harnessCode = ts.transpileModule(`class Harness {
  ${member('audioFrameLabels')}
  ${member('applyGenerationChip')}
  ${member('applyAudioGenerationChip')}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Harness = new Function('describeGenerationChip', `${harnessCode}; return Harness;`)(describeGenerationChip);

function audioHarness() {
  const instance = new Harness();
  const element = new Node('div');
  const label = new Node('span');
  label.className = 'akari-annotations-segment-label';
  label.textContent = 'frame-1 frame-audio-secret.wav';
  element.appendChild(label);
  element.title = label.textContent;
  let generation;
  instance.generationForPath = () => generation;
  return { instance, element, setGeneration: value => { generation = value; } };
}
async function withDom(run) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try { await run(); } finally { if (prior) Object.defineProperty(globalThis, 'document', prior); else delete globalThis.document; }
}

test('音の空の枠は DOM と title から名前を消し、チップだけを残す', () => withDom(() => {
  const { instance, element, setGeneration } = audioHarness();
  setGeneration({ state: 'planned', meta: { version: 1, kind: 'audio', status: 'planned' } });
  instance.applyAudioGenerationChip(element, 'assets/generated/frame-audio-secret.wav');
  assert.doesNotMatch(element.textContent, /frame-1|frame-audio-secret/u);
  assert.doesNotMatch(element.title, /frame-1|frame-audio-secret/u);
  assert.match(element.textContent, /空の枠（音）/u);
  assert.equal(element.querySelector('.akari-annotations-segment-label'), null);
  assert.equal(element.classList.contains('akari-generation-planned-audio'), true);
}));

test('ふつうの音声クリップは名前を維持する', () => withDom(() => {
  const { instance, element } = audioHarness();
  instance.applyAudioGenerationChip(element, 'assets/ordinary.wav');
  assert.match(element.textContent, /frame-audio-secret.wav/u);
  assert.match(element.title, /frame-audio-secret.wav/u);
}));

test('空の枠から通常状態へ変わると再利用要素の名前が戻る', () => withDom(() => {
  const { instance, element, setGeneration } = audioHarness();
  setGeneration({ state: 'planned', meta: { version: 1, kind: 'audio', status: 'planned' } });
  instance.applyAudioGenerationChip(element, 'assets/generated/frame-audio-secret.wav');
  setGeneration(undefined);
  instance.applyAudioGenerationChip(element, 'assets/generated/frame-audio-secret.wav');
  assert.match(element.textContent, /frame-1 frame-audio-secret.wav/u);
  assert.match(element.title, /frame-1 frame-audio-secret.wav/u);
}));

test('素材タブはクリップの appendTabStrip と同じクラスを使う', () => withDom(() => {
  const root = new Node('div');
  const options = { selection: { name: 'clip.wav', relativePath: 'assets/clip.wav', mediaKind: 'audio', projectRoot: 'file:///fixture' },
    tab: 'generation', view: 'tiles', summary: { state: 'none', segments: [], total: 0 }, running: false,
    commands: { executeCommand: async () => undefined }, onTab: () => {}, onView: () => {}, onDialogResult: () => {} };
  appendAiMaterialView(root, options);
  const strip = root.children.find(child => child.attributes.get('role') === 'tablist');
  assert.equal(strip.className, 'akari-inspector-tab-strip');
  assert.deepEqual(strip.children.map(child => child.className), ['akari-inspector-tab is-active', 'akari-inspector-tab']);
  assert.deepEqual(strip.children.map(child => child.attributes.get('aria-selected')), ['true', 'false']);
  assert.deepEqual(strip.children.map(child => child.attributes.get('data-akari-inspector-ai-tab')), ['generation', 'info']);
  const clipTabs = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
  assert.match(clipTabs, /protected appendTabStrip\([\s\S]*strip\.className = 'akari-inspector-tab-strip'[\s\S]*button\.className = 'akari-inspector-tab'[\s\S]*classList\.add\('is-active'\)/u);
  assert.doesNotMatch(root.children.map(child => child.className + child.children.map(item => item.className).join('')).join(''), /akari-inspector-ai-material-tab/u);
  assert.doesNotMatch(clipTabs, /\.akari-inspector-ai-material-tabs|button\.akari-inspector-ai-material-tab/u);
}));
