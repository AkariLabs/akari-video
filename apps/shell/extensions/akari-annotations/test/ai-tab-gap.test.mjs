import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { aiActionCatalog, describeAiTiles } from '../lib/common/ai-action-catalog.js';
import { appendAiTiles, appendAiBack, aiTabAvailabilityFor, aiTabViewFor, aiTargetKindFor } from '../lib/browser/inspector/ai-tiles.js';
import { tabsForKind, initialTabFor, assignSectionToTab } from '../lib/browser/inspector/tab-model.js';
import { isInspectorStillImage } from '../lib/browser/inspector/edit-target.js';

const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
test('gap button CSS excludes AI tiles from every matching rule', () => {
  const start = source.indexOf('.akari-inspector-generation-gap {');
  const end = source.indexOf('.akari-generation-batch {', start);
  assert.ok(start >= 0 && end > start);
  const gapCss = source.slice(start, end);
  const buttonSelectors = [...gapCss.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap(([, selectors]) => selectors.split(',').map(selector => selector.trim()))
    .filter(selector => selector.includes('.akari-inspector-generation-gap') && /\bbutton\b/.test(selector));
  assert.ok(buttonSelectors.length > 0);
  for (const selector of buttonSelectors) {
    assert.match(selector, /button:not\(\.akari-inspector-ai-tile\)/, selector);
  }
});
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const method = name => widget.members.find(node => node.name?.getText(ast) === name).getText(ast);
const code = ts.transpileModule(`class Harness { ${['renderGapSelection', 'matchesGapAiFrame', 'render'].map(method).join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const deps = { appendAiTiles, appendAiBack, describeAiTiles, aiActionCatalog, aiTabAvailabilityFor, aiTabViewFor,
  aiTargetKindFor, tabsForKind, initialTabFor, assignSectionToTab, isInspectorStillImage, CAPTION_ZONE_HOVER_EVENT: '',
  createSelectionHeader: () => new FakeNode('header'), layerAudioControls: new WeakMap(),
  CUT_SECTIONS: (_snapshot, _write, fields) => fields ? [{ id: 'generation', label: '生成', fields }] : [],
  LAYER_SECTIONS: (_snapshot, _write, _controls, fields) => fields ? [{ id: 'generation', label: '生成', fields }] : [],
  stillMismatchNotice: () => undefined, appendAiStillNotice: () => undefined };
deps.ADJUST_SECTIONS = () => [];
deps.PHOTO_PANEL_FIELDS = () => [];
const Harness = new Function(...Object.keys(deps), `${code}; return Harness;`)(...Object.values(deps));

class FakeNode {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.textContent = ''; this.className = ''; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  classList = { add: name => { this.className += ` ${name}`; } };
  setAttribute(key, value) { this.attributes.set(key, value); }
  addEventListener(key, callback) { this.listeners.set(key, callback); }
  click() { this.listeners.get('click')?.(); }
}
function find(root, id) {
  if (root.attributes?.get('data-akari-inspector-ai-tile') === id) return root;
  for (const child of root.children ?? []) { const found = find(child, id); if (found) return found; }
}
function fixture(view) {
  const instance = new Harness();
  instance.body = new FakeNode();
  instance.workspaceService = { tryGetRoots: () => [] };
  instance.aiCatalogLoaded = true;
  instance.generationCatalog = [{ id: 'fal:h3-i2v', kind: 'video', provider: 'fal' }];
  const gap = { kind: 'gap', trackId: 'visual', startSeconds: 3, endSeconds: 7,
    previous: { label: '動画A' }, next: { label: '動画B' }, createFrame: view };
  instance.model = { snapshot: gap };
  instance.renderGapSelection(gap);
  return { instance, gap };
}

test('gap catalog has exactly two enabled make tiles', () => {
  const groups = describeAiTiles(aiActionCatalog([{ id: 'fal:h3-i2v', kind: 'video' }]), 'gap');
  assert.deepEqual(groups.map(group => [group.group, group.tiles.map(tile => [tile.id, tile.enabled])]),
    [['make', [['still', true], ['video', true]]]]);
});

test('gap item selection matches its generated source ID, range and track', () => {
  const instance = new Harness();
  const gap = { trackId: 'visual', startSeconds: 3, endSeconds: 7 };
  const item = { kind: 'item', id: 'gap-3', src: 'gap-src-3', sourceKind: 'media',
    trackId: 'visual', outputStart: 3, duration: 4 };
  assert.equal(instance.matchesGapAiFrame(item, gap), true);
  assert.equal(instance.matchesGapAiFrame({ ...item, trackId: 'other' }, gap), false);
  assert.equal(instance.matchesGapAiFrame({ ...item, src: 'other-source' }, gap), false);
});

for (const [kind, view] of [['cut', 'still'], ['cut', 'video'], ['layer', 'video']]) test(`gap ${view} tile opens its panel on the inserted ${kind} frame`, async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: tag => new FakeNode(tag) };
  try {
    let calls = 0;
    const { instance, gap } = fixture(async () => {
      calls++;
      instance.model.snapshot = kind === 'cut'
        ? { kind: 'cut', index: 1, itemId: 'gap-1', outputStart: 3, outputEnd: 7,
          sourcePath: 'assets/generated/frame-1.png', src: 'gap-src-1', sourceIn: 0, sourceOut: 4 }
        : { kind: 'layer', id: 'gap-1', layerKind: 'baked', sourceKind: 'media', outputStart: 3, duration: 4,
          src: 'assets/generated/frame-1.png' };
      instance.render();
    });
    Object.assign(instance, {
      dispatchCaptionZoneEvent() {}, hideFieldNotice() {}, syncAdjustCompare() {}, appendSoloBanner() {}, refreshAdjustLuts() {},
      tabSourceHint: snapshot => snapshot.sourcePath ?? snapshot.src,
      generationIdentity: snapshot => snapshot?.kind === 'cut' || snapshot?.kind === 'layer'
        ? { key: snapshot.itemId ?? snapshot.id, itemId: snapshot.itemId ?? snapshot.id,
          sourcePath: snapshot.sourcePath ?? snapshot.src, duration: 4 } : undefined,
      generationSectionFields: () => [{ name: 'model' }], appendTabStrip() {},
      appendStillPanel() { this.body.appendChild(new FakeNode('still-panel')); },
      appendSection() { this.body.appendChild(new FakeNode('video-panel')); },
      loadAiTranscribeTarget: async () => {}, generationThumbnail: () => undefined,
      generationStates: new Map([['gap-1', 'planned']]), generationDone: new Set(),
      generationLoads: new Set(['gap-1']), generationTabMeta: new Map(), generationTabLoads: new Set(),
      generationDrafts: new Map(), generationTabDrafts: new Map(), aiStillStates: new Map(),
      transcribeSummary: { state: 'none' }, narrationStates: new Map(),
      tabState: { activeTab: () => 'video', setActiveTab() {} }
    });
    find(instance.body, view).click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(instance.currentTab, 'edit');
    assert.equal(instance.aiView, view);
    assert.equal(instance.gapAiOpening, undefined);
    assert.ok(instance.body.children.some(node => node.tag === `${view}-panel`));
    instance.explicitTabId = 'generation';
    instance.render();
    assert.equal(instance.aiView, view, 'timeline openInspectorPanel rerender keeps the chosen panel');
    assert.ok(instance.body.children.some(node => node.tag === `${view}-panel`));
    assert.notEqual(instance.model.snapshot, gap);
  } finally { globalThis.document = oldDocument; }
});

for (const view of ['still', 'video']) test(`gap ${view} tile calls createFrame once and holds chosen panel`, async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: tag => new FakeNode(tag) };
  try {
    let calls = 0, finish;
    const { instance, gap } = fixture(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
    const tile = find(instance.body, view);
    assert.ok(tile);
    assert.equal(tile.attributes.get('aria-disabled'), 'false');
    tile.click(); tile.click();
    assert.equal(calls, 1);
    assert.equal(instance.gapAiOpening.view, view);
    assert.equal(instance.gapAiOpening.gap, gap);
    finish();
    await new Promise(resolve => setTimeout(resolve, 5100));
    assert.equal(instance.gapAiOpening, undefined, 'no inserted selection drops pending panel');
  } finally { globalThis.document = oldDocument; }
});
