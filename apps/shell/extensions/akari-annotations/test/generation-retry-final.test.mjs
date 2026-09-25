import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { selectGenerationSidecarForSource } from '@akari-video/edit-store';
import * as fields from '../lib/browser/inspector/generation-fields.js';
import { describeGenerationChip } from '../lib/common/generation-sidecar.js';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { validateInputs } from '../../../../../packages/generate/src/validate-inputs.mjs';
import { runVideoCommand } from '../../../../../packages/generate/src/cli/video.mjs';
const catalog = JSON.parse(readFileSync(new URL('../../../../../packages/schemas/gen-models.json', import.meta.url))).models.filter(row => row.kind === 'video');
const h3 = catalog.find(row => row.id === 'fal:h3-i2v');
const actions = Object.fromEntries(['update', 'generate', 'resume', 'retry', 'copyAdjacent', 'finalQuality'].map(key => [key, async () => ({ ok: true })]));
const draftFor = row => ({ modelId: row.id, inputs: { prompt: 'A garden.', first_frame: null, last_frame: null, seed: null }, output: { duration_s: 6, resolution: Object.entries(row.price?.by_resolution ?? {}).sort((a,b) => b[1]-a[1])[0]?.[0] || row.resolutions?.at(-1) || null, audio_out: false } });
const options = (row, draft, defaults = {}, overrides = {}) => ({ snapshot: {}, catalogRow: row, draft, defaults: { catalog, ...defaults }, actions: { ...actions, ...overrides }, validation: validateInputs({ model: row, ...draft }) });
for (const row of catalog) test(`実カタログ ${row.id}: 下書き能力・最安解像度・単価・ON/OFF・見積・元の解像度`, async () => {
  const prices = Object.entries(row.price?.by_resolution ?? {});
  const supported = new Set(prices.map(([, price]) => price)).size > 1;
  const quality = fields.generationDraftQuality(row);
  assert.equal(!!quality, supported);
  let draft = draftFor(row);
  const original = structuredClone(draft.output);
  const before = validateInputs({ model: row, ...draft }).cost.estimate_usd;
  const updates = [];
  let defs = fields.generationFields(options(row, draft, {}, { update: async (...args) => { updates.push(args); return { ok: true }; } }));
  const checkbox = defs.find(field => field.generationCheckbox);
  assert.equal(!!checkbox, supported);
  if (!supported) return;
  assert.equal(quality.unitPrice, Math.min(...prices.map(([, price]) => price)));
  assert.equal(row.price.by_resolution[quality.resolution], quality.unitPrice);
  await checkbox.write({}, 'true'); assert.deepEqual(updates, [['cheapDraft', true]]);
  const on = fields.generationToggleDraft(row, draft.output, true);
  draft.output = on.output;
  assert.equal(draft.output.resolution, quality.resolution);
  const after = validateInputs({ model: row, ...draft }).cost.estimate_usd;
  assert.ok(after < before, `${before} -> ${after}`);
  defs = fields.generationFields(options(row, draft, { cheapDraft: true }));
  assert.equal(defs.find(field => field.name === 'generation-resolution').disabled, true);
  assert.equal(defs.find(field => field.generationCheckbox).getValue({}), 'true');
  assert.match(defs.find(field => field.name === 'generation-estimate').getValue({}), new RegExp(after.toFixed(2).replace('.', '\\.')));
  draft.output = fields.generationToggleDraft(row, draft.output, false, on.previousResolution).output;
  assert.deepEqual(draft.output, original);
  assert.equal(validateInputs({ model: row, ...draft }).cost.estimate_usd, before);
  assert.equal(fields.generationToggleDraft(row, {}, false).output.resolution, row.resolutions[0]);
  const meta = { kind: 'video', status: 'done', model: { id: row.id }, output: on.output };
  assert.equal(fields.generationIsDraftMeta(meta, row), true);
  assert.equal(fields.generationIsDraftMeta({ ...meta, output: original }, row), false);
});
test('単一価格・同額・price null は下書き非対応', () => {
  for (const price of [null, { by_resolution: { '': .1 } }, { by_resolution: { a: .1, b: .1 } }]) assert.equal(fields.generationDraftQuality({ ...h3, price }), undefined);
});
const originalMeta = { kind: 'still', status: 'done', next: { kind: 'video', status: 'planned', model: { id: h3.id }, inputs: { prompt: 'A garden.', first_frame: null, seed: null }, output: { resolution: '480P', duration_s: 6 } } };
const doneMeta = { kind: 'video', status: 'done', model: { id: h3.id }, output: { resolution: '480P' }, inputs: { seed: 42 }, placeholder: { path: 'still.png', item_id: 'clip' } };
for (const next of [originalMeta.next, undefined]) test(`still + done + next ${next ? 'あり' : 'なし'} はモデル select・指示文・枠の通常フォーム`, () => {
  const defs = fields.generationFields(options(h3, draftFor(h3), { state: 'done', doneMeta: { kind: 'still', status: 'done', next } }));
  assert.equal(defs.find(field => field.name === 'generation-model')?.inputKind, 'select');
  assert.ok(defs.some(field => field.name === 'prompt'));
  assert.ok(defs.some(field => field.generationFrame));
  assert.ok(!defs.some(field => field.name === 'generation-done'));
});
test('video + done の通常画質は生成済みだけを表示する', () => {
  const defs = fields.generationFields(options(h3, draftFor(h3), {
    state: 'done', doneMeta: { ...doneMeta, output: { resolution: '768P' } }, originalNext: originalMeta
  }));
  assert.deepEqual(defs.map(field => [field.name, field.getValue({})]), [['generation-done', '生成済み']]);
});
test('下書き done + 元静止画 next だけに本番の画質にする…と説明を出す', async () => {
  for (const [meta, original, visible] of [[doneMeta, originalMeta, true], [doneMeta, undefined, false], [{ ...doneMeta, output: { resolution: '768P' } }, originalMeta, false], [{ ...doneMeta, status: 'failed' }, originalMeta, false]]) {
    let called = 0;
    const defs = fields.generationFields(options(h3, draftFor(h3), { state: 'done', doneMeta: meta, originalNext: original }, { finalQuality: async () => { called++; return { ok: true }; } }));
    const button = defs.flatMap(field => field.actions ?? []).find(action => action.name === 'final-quality');
    assert.equal(!!button, visible);
    if (visible) { assert.equal(button.label, '本番の画質にする…'); await button.action({}); assert.equal(called, 1); assert.match(defs.map(field => field.getValue({})).join(''), /絵は変わることがあります/); }
  }
});
function harness(file, className, names, dependencies = {}) {
  const source = readFileSync(new URL(`../src/browser/${file}`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
  const methods = names.map(name => { const node = cls.members.find(node => node.name?.getText(ast) === name); assert.ok(node, name); return node.getText(ast); });
  const code = ts.transpileModule(`class Widget { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return Widget;`)(...Object.values(dependencies));
}
class Element {
  children = []; listeners = {}; style = {}; dataset = {}; attributes = {}; width = 300;
  appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = undefined; }
  className = '';
  classList = {
    add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
    remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); }
  };
  prepend(child) { child.remove(); child.parentElement = this; this.children.unshift(child); }
  set textContent(value) { this._text = value; for (const child of this.children) child.parentElement = undefined; this.children = []; }
  get textContent() { return (this._text ?? '') + this.children.map(child => child.textContent).join(''); }
  querySelector(selector) {
    const match = child => selector.includes('data-akari-generation-badge') ? Object.hasOwn(child.dataset, 'akariGenerationBadge')
      : selector.includes('data-akari-generation-progress') ? Object.hasOwn(child.dataset, 'akariGenerationProgress')
      : child.className.split(' ').includes(selector.match(/\.([a-z-]+)/)?.[1]);
    return this.children.find(match) ?? (selector.startsWith(':scope') ? undefined : this.children.map(child => child.querySelector(selector)).find(Boolean));
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  getBoundingClientRect() { return { width: this.width, height: 14 }; }
}
const retryFrames = [];
const Timeline = harness('akari-annotations-widget.ts', 'AkariAnnotationsWidget', ['applyGenerationChip', 'appendGenerationRetry', 'openGenerationRetry'], { describeGenerationChip, window: { setTimeout, clearTimeout, requestAnimationFrame: callback => retryFrames.push(callback) }, document: { createElement: () => new Element() }, OPEN_AKARI_INSPECTOR_ID: 'akari.inspector.open' });
test('失敗チップ「もう一度」・狭い幅では出ない・pointerdown はドラッグへ伝播しない', () => {
  assert.match(describeGenerationChip('failed').title, /もう一度/); assert.doesNotMatch(describeGenerationChip('stale').title, /もう一度/);
  for (const width of [60, 127, 199, 300]) {
    const w = new Timeline(), chip = new Element(), header = new Element(), badge = new Element(), time = new Element();
    chip.width = width; chip.dataset.akariItemId = 'clip'; chip.dataset.akariGenerationState = 'failed'; badge.width = 32; time.width = 40; time.textContent = '6.00s';
    w.selectionModel = { snapshot: { kind: 'cut', itemId: 'clip' } };
    const calls = []; w.resolveFocusSelection = id => ({ kind: 'cut', index: 2, id }); w.applySelection = selection => calls.push(['select', selection]); w.commands = { executeCommand: (...args) => calls.push(args) };
    w.appendGenerationRetry(chip, header, badge, time); assert.equal(header.children.length, width >= 200 ? 1 : 0);
    if (width < 200) continue;
    const button = header.children[0]; assert.equal(button.textContent, 'もう一度'); assert.ok(button.style.border && button.style.background);
    let stopped = 0; button.listeners.pointerdown({ stopPropagation: () => stopped++ }); assert.equal(stopped, 1); assert.equal(calls.length, 0);
    button.listeners.click({ detail: 0, stopPropagation() {}, preventDefault() {} }); assert.equal(calls[0][0], 'select');
    assert.deepEqual(calls[1], ['akari.inspector.open', { tabId: 'generation', sectionId: 'generation', fieldName: 'akari-generation-retry' }]);
  }
});
function retryFixture(width, styleWidth = '53.4759%') {
  retryFrames.length = 0;
  const widget = new Timeline(), chip = new Element(), header = new Element(), badge = new Element(), time = new Element();
  chip.isConnected = true; chip.width = width; chip.style.width = styleWidth;
  chip.dataset = { akariItemId: 'clip', akariGenerationState: 'failed' };
  chip.title = describeGenerationChip('failed').title;
  header.className = 'akari-annotations-strip-clip-header';
  badge.className = 'akari-generation-badge'; badge.dataset.akariGenerationBadge = '';
  time.className = 'akari-annotations-strip-clip-header-duration';
  chip.appendChild(header); header.appendChild(badge); header.appendChild(time);
  badge.width = 32; time.width = 40; time.textContent = '6.00s';
  return { widget, chip, header, badge, time,
    update: () => widget.applyGenerationChip(chip, { state: 'failed' }),
    button: () => header.querySelector('.akari-generation-action'),
    frame: () => { for (const callback of retryFrames.splice(0)) callback(); }
  };
}

test('再試行: style.width が 53.4759% でも実幅 226px なら表示し、狭い実幅では出さない', () => {
  for (const width of [226, 127]) {
    const f = retryFixture(width); f.update();
    assert.equal(!!f.button(), width === 226);
    f.frame(); assert.equal(!!f.button(), width === 226);
    assert.match(f.chip.title, /もう一度/);
  }
  const f = retryFixture(127, '226px'); f.update(); f.frame();
  assert.equal(f.button(), undefined, 'style の px も実描画幅の代用にしない');
});

test('再試行: 初回 rect 0 でも描画後 rAF で実幅を再測定する', () => {
  const f = retryFixture(0); f.chip.isConnected = false; f.update();
  assert.equal(f.button(), undefined); assert.equal(retryFrames.length, 1);
  f.chip.isConnected = true; f.chip.width = 226; f.frame();
  assert.equal(f.button().textContent, 'もう一度');
});

test('再試行: ズーム・リサイズ・パンの再描画と描画後の幅変化に表示が追従し重複しない', () => {
  const f = retryFixture(226); f.update(); f.frame(); assert.ok(f.button());
  f.chip.width = 127; f.update(); f.frame(); assert.equal(f.button(), undefined);
  f.chip.width = 226; f.update(); f.frame(); assert.ok(f.button());
  // Geometry can change after the synchronous render (e.g. a splitter layout).
  f.update(); f.chip.width = 127; f.frame(); assert.equal(f.button(), undefined);
  f.update(); f.chip.width = 226; f.frame(); assert.ok(f.button());
  f.update(); f.update(); f.frame();
  assert.equal(f.header.children.filter(child => child.className === 'akari-generation-action').length, 1);
  // Long timestamps must still reserve their full width before showing retry.
  f.time.width = 140; f.update(); f.frame(); assert.equal(f.button(), undefined);
});

test('再試行: 遅延描画は取り外し・状態変更・ヘッダー差し替え・widget破棄後にボタンを復活させない', () => {
  for (const invalidate of [
    f => { f.chip.isConnected = false; },
    f => { f.chip.dataset.akariGenerationState = 'stale'; },
    f => { f.chip.dataset.akariGenerationState = 'done'; },
    f => f.header.remove(),
    f => f.badge.remove(),
    f => { f.widget.isDisposed = true; }
  ]) {
    const f = retryFixture(0); f.update(); f.chip.width = 226; invalidate(f); f.frame();
    assert.equal(f.button(), undefined);
  }
});
const pointer = (overrides = {}) => ({ button: 0, pointerId: 7, isPrimary: true, detail: 1,
  stopPropagation() {}, preventDefault() {}, ...overrides });
function retryActivationFixture() {
  const f = retryFixture(226);
  f.chip.dataset.akariItemKind = 'cut'; f.chip.dataset.akariItemId = '0';
  f.widget.cutItemId = index => index === 0 ? 'clip-a' : 'clip-b';
  const listeners = new Set();
  f.widget.selectionModel = { snapshot: { kind: 'cut', itemId: 'clip-a' },
    onChanged: callback => { listeners.add(callback); return { dispose: () => listeners.delete(callback) }; } };
  f.publish = snapshot => { f.widget.selectionModel.snapshot = snapshot; for (const listener of [...listeners]) listener(); };
  f.subscriptions = listeners;
  f.calls = [];
  f.widget.resolveFocusSelection = id => { assert.equal(id, 'clip-a', 'cut index must become the real item ID'); return { kind:'cut', index:0 }; };
  f.widget.applySelection = selection => f.calls.push(['selection', selection]);
  f.widget.commands = { executeCommand: (...args) => { f.calls.push(args); return Promise.resolve(); } };
  f.widget.showNotice = message => assert.fail(message);
  f.update(); f.frame();
  return f;
}

test('再試行: applyGenerationChip の再描画で failed ボタンは同一ノードを保持する', () => {
  const f = retryActivationFixture(); const button = f.button();
  f.update(); f.frame(); f.update(); f.frame();
  assert.equal(f.button(), button);
  f.widget.applyGenerationChip(f.chip, { state:'stale' }); f.frame(); assert.equal(f.button(), undefined);
  f.update(); f.frame(); assert.notEqual(f.button(), button);
  f.chip.width = 127; f.update(); f.frame(); assert.equal(f.button(), undefined);
});

test('再試行: pointerdown→再描画→pointerup は実 item を選択して1回起動し click と二重起動しない', async () => {
  const f = retryActivationFixture(); const button = f.button();
  button.listeners.pointerdown(pointer()); f.update(); f.frame();
  assert.equal(f.button(), button); assert.equal(f.calls.length, 0);
  button.listeners.pointerup(pointer());
  button.listeners.click(pointer()); await tick();
  button.listeners.click(pointer()); button.listeners.pointerup(pointer());
  assert.deepEqual(f.calls, [['selection', { kind:'cut', index:0 }],
    ['akari.inspector.open', { tabId:'generation', sectionId:'generation', fieldName:'akari-generation-retry' }]]);
});

test('再試行: Enter/Space 相当の detail 0 click は各1回、右ボタン・取消・異なる item は起動しない', async () => {
  const f = retryActivationFixture(); const button = f.button();
  for (const key of ['Enter', 'Space']) { button.listeners.click(pointer({detail:0,key})); await tick(); }
  assert.equal(f.calls.filter(call => call[0] === 'akari.inspector.open').length, 2);
  const before = f.calls.length;
  button.listeners.pointerdown(pointer({button:2})); button.listeners.pointerup(pointer({button:2}));
  button.listeners.pointerdown(pointer()); button.listeners.pointercancel(); button.listeners.pointerup(pointer());
  button.listeners.pointerdown(pointer()); button.listeners.pointerup(pointer({pointerId:8}));
  button.listeners.pointerdown(pointer()); f.chip.dataset.akariItemId = '1'; button.listeners.pointerup(pointer());
  assert.equal(f.calls.length, before);
});

test('再試行: 遅れた選択 snapshot を待ってから open コマンドを1回発行する', async () => {
  const f = retryActivationFixture(); f.widget.selectionModel.snapshot = { kind:'cut', itemId:'previous' };
  const button = f.button(); button.listeners.pointerdown(pointer()); button.listeners.pointerup(pointer());
  button.listeners.click(pointer()); await tick();
  assert.equal(f.calls.length, 1); assert.equal(f.subscriptions.size, 1);
  f.publish({kind:'cut',itemId:'clip-a'}); await tick();
  assert.equal(f.calls.filter(call => call[0] === 'akari.inspector.open').length, 1);
  assert.equal(f.subscriptions.size, 0);
});

let approval, dialogCount = 0;
const Inspector = harness('akari-inspector-widget.ts', 'AkariInspectorWidget', ['focusField', 'retryGenerationFromTimeline', 'confirmAndStartGeneration', 'updateGenerationDraft', 'prepareGenerationFinal', 'readGenerationOriginalNext'], {
  generationFields: fields.generationFields, window: { setTimeout, clearTimeout },
  ConfirmDialog: class { constructor(options) { assert.equal(options.title, '費用承認'); dialogCount++; } open() { return approval; } }
});
const identity = { key: 'clip', itemId: 'clip', sourcePath: 'still.png', duration: 6 };
function inspector() {
  const w = new Inspector();
  for (const name of ['generationDrafts', 'generationTabDrafts', 'generationTabMeta', 'generationStates', 'generationQuality', 'generationValidations', 'generationDone']) w[name] = new Map();
  w.generationFinal = new Set(); w.generationLoads = new Set(); w.generationCatalog = catalog; w.model = { snapshot: { kind: 'cut' } }; w.generationIdentity = () => identity;
  w.generationDrafts.set('clip', draftFor(h3)); w.generationValidations.set('clip', { ok: true, cost: { estimate_usd: .36 } }); w.loadGeneration = async () => { w.generationStates.set('clip', 'failed'); };
  w.tabState = { setActiveTab: (_kind, tab) => { w.currentTab = tab; } }; w.sectionState = { setCollapsed() {} }; w.body = { querySelector: () => ({}) }; w.render = () => {}; w.pulse = () => {};
  w.persistGenerationDraft = async () => {}; w.scheduleGenerationDraftWrite = () => {}; w.validateGenerationDraft = async key => w.generationValidations.set(key, validateInputs({ model: h3, ...w.generationDrafts.get(key) }));
  w.workspaceService = { ready: Promise.resolve(), tryGetRoots: () => [{ resource: { toString: () => 'file:///project', resolve: path => path } }] };
  w.starts = []; w.layerAudioService = { startGenerateVideo: request => { w.starts.push(request); return new Promise(() => {}); } }; w.showFieldNotice = () => {}; return w;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('retry 合図で生成タブを開く・承認保留/取消は startGenerateVideo 0 回・承認後だけ1回', async () => {
  const w = inspector(); let approve; approval = new Promise(resolve => { approve = resolve; }); dialogCount = 0;
  w.focusField({ tabId: 'generation', sectionId: 'generation', fieldName: 'akari-generation-retry' });
  await tick(); assert.equal(w.currentTab, 'edit'); assert.equal(dialogCount, 1); assert.equal(w.starts.length, 0);
  approve(false); await tick(); assert.equal(w.starts.length, 0); approval = Promise.resolve(true); await w.retryGenerationFromTimeline(); assert.equal(w.starts.length, 1); assert.equal(w.starts[0].approved, true);
});
test('再試行: inspector への選択到着と loadGeneration 完了を待ち、重複合図でも承認ダイアログは1回', async () => {
  const w = inspector(); w.model.snapshot = undefined;
  w.generationIdentity = snapshot => snapshot ? identity : undefined;
  let loaded; w.loadGeneration = async () => { await new Promise(resolve => { loaded = resolve; }); w.generationStates.set('clip','failed'); };
  let approve; approval = new Promise(resolve => { approve = resolve; }); dialogCount = 0;
  const request = {tabId:'generation',sectionId:'generation',fieldName:'akari-generation-retry'};
  w.focusField(request); w.focusField(request); await tick();
  assert.equal(dialogCount,0); assert.equal(w.starts.length,0);
  w.model.snapshot = {kind:'cut'};
  await new Promise(resolve => setTimeout(resolve,30));
  assert.equal(typeof loaded,'function'); assert.equal(dialogCount,0);
  loaded(); await tick(); assert.equal(w.currentTab,'edit'); assert.equal(dialogCount,1);
  w.focusField(request); assert.equal(dialogCount,1); assert.equal(w.starts.length,0);
  approve(true); await tick(); assert.equal(w.starts.length,1);
});

test('widget の下書き ON/OFF は解像度・見積を変え直前の 2K に戻す', async () => {
  const w = inspector(); w.generationDrafts.get('clip').output.resolution = '2K';
  await w.updateGenerationDraft(identity, 'cheapDraft', true); assert.equal(w.generationDrafts.get('clip').output.resolution, '480P'); assert.equal(w.generationValidations.get('clip').cost.estimate_usd, .3);
  await w.updateGenerationDraft(identity, 'cheapDraft', false); assert.equal(w.generationDrafts.get('clip').output.resolution, '2K'); assert.equal(w.generationValidations.get('clip').cost.estimate_usd, .78);
});
test('本番画質の準備は元 next 入力と対応 seed を保持・既定は価格順位で選ばない', async () => {
  for (const previous of [undefined, '2K']) {
    const w = inspector(); w.generationDone.set('clip', { meta: doneMeta, originalMeta }); if (previous) w.generationQuality.set('clip', { modelId: h3.id, previousResolution: previous, enabled: true });
    assert.equal((await w.prepareGenerationFinal(identity)).ok, true); assert.deepEqual(w.generationDrafts.get('clip').inputs, { ...originalMeta.next.inputs, seed: 42 }); assert.equal(w.generationDrafts.get('clip').output.resolution, previous ?? h3.resolutions[0]); assert.equal(w.starts.length, 0);
    assert.equal((await w.updateGenerationDraft(identity, 'inputs.prompt', 'changed')).ok, false);
    if (!previous) { assert.equal((await w.confirmAndStartGeneration(identity)).ok, false); assert.equal(w.starts.length, 0); }
  }
});
test('本番画質は元 next に残る選択解像度を復元し、開いている間の選択を優先する', async () => {
  for (const [saved, previous, expected] of [['768P', undefined, '768P'], ['4K', undefined, '4K'], ['768P', '2K', '2K'], ['unknown', undefined, h3.resolutions[0]]]) {
    const w = inspector();
    const original = { ...originalMeta, next: { ...originalMeta.next, output: { ...originalMeta.next.output, resolution: saved } } };
    w.generationDone.set('clip', { meta: doneMeta, originalMeta: original });
    if (previous) w.generationQuality.set('clip', { modelId: h3.id, previousResolution: previous });
    assert.equal((await w.prepareGenerationFinal(identity)).ok, true);
    assert.equal(w.generationDrafts.get('clip').output.resolution, expected);
    assert.equal(original.next.output.resolution, saved);
    assert.equal(w.starts.length, 0);
  }
});
test('placeholder 逆引きは元静止画の存在と next を要求し first_frame に頼らない', async () => {
  const w = inspector(); const reads = []; w.fileService = { exists: async path => path === 'still.png' };
  w.layerAudioService.readGenerationSidecars = async request => { reads.push(request.sourcePaths); return { entries: [{ sourcePath: 'still.png', meta: originalMeta }] }; };
  assert.deepEqual(await w.readGenerationOriginalNext({ ...doneMeta, inputs: { first_frame: { path: 'unrelated.png' } } }, 'clip'), originalMeta); assert.deepEqual(reads, [['still.png']]);
  w.fileService.exists = async () => false; assert.equal(await w.readGenerationOriginalNext(doneMeta, 'clip'), undefined);
  assert.equal(await w.readGenerationOriginalNext({ ...doneMeta, placeholder: { path: '../escape', item_id: 'clip' } }, 'clip'), undefined);
});
test('既存 RPC と CLI は done mp4 の next で同一 item を再生成し映像/色を保つ（通信は注入 fake のみ）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'akari-final-cli-'));
  try {
    mkdirSync(join(root, 'assets')); writeFileSync(join(root, 'assets/done.mp4'), 'fake video'); writeFileSync(join(root, 'assets/done.mp4.meta.json'), JSON.stringify(doneMeta)); writeFileSync(join(root, 'still.png.meta.json'), JSON.stringify(originalMeta));
    const item = { id: 'clip', at: 7, transform: { scale: 1.3 }, color: { brightness: .2 }, source: { kind: 'media', src: 'done', in: 0, out: 6 } };
    const edit = { sources: [{ id: 'done', path: 'assets/done.mp4' }], tracks: [{ id: 'v1', items: [item] }] }; writeFileSync(join(root, 'edit.json'), JSON.stringify(edit));
    const input = { ...originalMeta.next.inputs, seed: 42 }; const service = new AkariAnnotationsServiceImpl();
    await service.writeGenerationDraft({ projectRootUri: pathToFileURL(root).href, itemId: 'clip', modelId: h3.id, inputs: input, output: { duration_s: 6, resolution: '768P' } });
    const before = readFileSync(join(root, 'still.png.meta.json'), 'utf8'); const requests = []; let snapshots = 0, saves = 0;
    const result = await runVideoCommand([root, '--item', 'clip', '--yes', '--json'], {
      openProjectImpl: async () => ({ edit, save: async () => saves++ }), snapshotImpl: async () => snapshots++, resolveFalKeyImpl: () => ({ key: 'fake', key_source: 'env:FAKE' }), pollIntervalMs: 0,
      probeImpl: () => ({ duration_s_actual: 6, width: 1280, height: 768, fps: '24/1', has_audio: false }), log() {}, errorLog(message) { requests.push({ error: message }); },
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, body: init.body && JSON.parse(init.body) });
        if (init.method === 'POST') return new Response(JSON.stringify({ request_id: 'fake', status_url: 'https://fake/status', response_url: 'https://fake/result' }), { status: 200 });
        if (String(url).startsWith('https://fake/status')) return new Response(JSON.stringify({ status: 'COMPLETED' }));
        if (url === 'https://fake/result') return new Response(JSON.stringify({ video: { url: 'https://fake/video' } }));
        if (url === 'https://fake/video') return new Response('fake mp4');
        throw new Error(`Unexpected fake URL ${url}`);
      }
    });
    assert.equal(result.exitCode, 0, JSON.stringify(requests)); assert.equal(requests.filter(request => request.body).length, 1);
    const sent = requests.find(request => request.body).body; assert.equal(sent.prompt, input.prompt); assert.equal(sent.seed, 42); assert.equal(sent.resolution, '768P');
    assert.equal(snapshots, 1); assert.equal(saves, 1); assert.equal(item.id, 'clip'); assert.equal(item.at, 7); assert.deepEqual(item.transform, { scale: 1.3 }); assert.deepEqual(item.color, { brightness: .2 });
    assert.equal(edit.sources.find(source => source.id === item.source.src).path, 'assets/generated/clip.mp4'); assert.equal(readFileSync(join(root, 'still.png.meta.json'), 'utf8'), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const Loader = harness('akari-inspector-widget.ts', 'AkariInspectorWidget',
  ['loadGeneration', 'readGenerationOriginalNext', 'generationIdentity', 'generationSectionFields'],
  { generationFields: fields.generationFields, selectGenerationSidecarForSource });
test('done item の実 loader → placeholder 読込 → 生成タブの本番画質ボタン（next なし・通常画質は非表示）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'akari-final-loader-'));
  try {
    writeFileSync(join(root, 'still.png'), 'fixture');
    writeFileSync(join(root, 'done.mp4'), 'fixture');
    for (const [next, resolution, visible] of [[originalMeta, '480P', true], [{ kind:'still', status:'done' }, '480P', false], [originalMeta, '768P', false]]) {
      writeFileSync(join(root, 'still.png.meta.json'), JSON.stringify(next));
      writeFileSync(join(root, 'done.mp4.meta.json'), JSON.stringify({ ...doneMeta, output:{ resolution } }));
      const w = new Loader();
      for (const key of ['generationDone','generationQuality','generationTabMeta','generationTabDrafts','generationDrafts','generationValidations','generationStates','generationNeighbors']) w[key] = new Map();
      for (const key of ['generationFinal','generationLoads','generationTabLoads']) w[key] = new Set();
      w.generationCatalog = catalog; w.generationDefaultModel = h3.id;
      w.model = { snapshot: { kind:'cut', itemId:'clip', sourcePath:'done.mp4', outputStart:0, outputEnd:6 } };
      w.workspaceService = { ready:Promise.resolve(), tryGetRoots:()=>[{resource:{toString:()=>pathToFileURL(root).href,resolve:file=>join(root,file)}}] };
      w.fileService = { exists:async()=>true }; w.layerAudioService = new AkariAnnotationsServiceImpl();
      w.loadGenerationNeighbors = async()=>{}; w.render=()=>{}; w.showFieldNotice=message=>assert.fail(message);
      w.validateGenerationDraft=async key=>w.generationValidations.set(key,validateInputs({model:h3,...w.generationDrafts.get(key)}));
      assert.equal(w.generationIdentity(w.model.snapshot),undefined);
      await w.loadGeneration({key:'clip',itemId:'clip',sourcePath:'done.mp4',duration:6});
      assert.equal(w.generationIdentity(w.model.snapshot).sourcePath,'done.mp4');
      const definitions=w.generationSectionFields(w.model.snapshot)??[];
      assert.equal(definitions.flatMap(field=>field.actions??[]).some(action=>action.name==='final-quality'),visible);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('本番画質失敗後の loader は mp4 に保存済みの next（解像度・seed）を優先する', async () => {
  const w = new Loader();
  for (const key of ['generationDone','generationQuality','generationTabMeta','generationTabDrafts','generationDrafts','generationValidations','generationStates','generationNeighbors']) w[key]=new Map();
  for (const key of ['generationFinal','generationLoads','generationTabLoads']) w[key]=new Set();
  w.generationCatalog=catalog;
  w.model={snapshot:{kind:'cut',itemId:'clip',sourcePath:'done.mp4',outputStart:0,outputEnd:6}};
  const next={...originalMeta.next,inputs:{...originalMeta.next.inputs,seed:42},output:{duration_s:6,resolution:'2K'}};
  const meta={...doneMeta,next};
  const root={toString:()=> 'file:///project',resolve:path=>path};
  w.workspaceService={ready:Promise.resolve(),tryGetRoots:()=>[{resource:root}]};
  w.layerAudioService={readGenerationSidecars:async()=>({entries:[{sourcePath:'done.mp4',meta}]})};
  w.readGenerationOriginalNext=async()=>originalMeta; w.loadGenerationNeighbors=async()=>{};
  w.validateGenerationDraft=async()=>{}; w.render=()=>{}; w.showFieldNotice=message=>assert.fail(message);
  await w.loadGeneration({key:'clip',itemId:'clip',sourcePath:'done.mp4',duration:6});
  assert.equal(w.generationDrafts.get('clip').output.resolution,'2K');
  assert.equal(w.generationDrafts.get('clip').inputs.seed,42);
});
