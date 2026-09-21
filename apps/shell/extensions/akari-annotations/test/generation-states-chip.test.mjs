import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { describeGenerationChip, resolveGenerationState } from '../lib/common/generation-sidecar.js';
import { selectGenerationSidecarForSource } from '../../../../../packages/edit-store/lib/generation-meta.js';

const fixture = new URL('./fixtures/generation-states/', import.meta.url);
const widgetSource = await readFile(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');

function widgetMethod(name, dependencies) {
  const ast = ts.createSourceFile('widget.ts', widgetSource, ts.ScriptTarget.Latest, true);
  const widget = ast.statements.find(statement => ts.isClassDeclaration(statement)
    && statement.name?.text === 'AkariAnnotationsWidget');
  const method = widget.members.find(member => member.name?.getText(ast) === name);
  assert.ok(method, name);
  const code = ts.transpileModule(`class Widget { ${method.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
  }).outputText;
  return new Function(...Object.keys(dependencies), `${code}\nreturn Widget.prototype.${name};`)(...Object.values(dependencies));
}

class DummyElement {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.parent = undefined;
    this.classList = {
      add: (...values) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        values.forEach(value => names.add(value));
        this.className = [...names].join(' ');
      },
      remove: (...values) => {
        const removed = new Set(values);
        this.className = this.className.split(/\s+/).filter(value => value && !removed.has(value)).join(' ');
      }
    };
  }
  appendChild(child) { child.parent = this; this.children.push(child); }
  setAttribute(name, value) { this[name] = value; }
  getBoundingClientRect() { return { width: this.width ?? 180, height: this.height ?? 48 }; }
  querySelector(selector) {
    const frame = selector.match(/data-akari-generation-frame="(.*?)"/);
    if (frame) return this.children.find(child => child.dataset.akariGenerationFrame === frame[1]);
    const cls = selector.match(/\.([a-z-]+)/);
    if (cls) return this.children.find(child => child.className.split(' ').includes(cls[1]));
    const key = selector.includes('generation-badge') ? 'akariGenerationBadge'
      : selector.includes('generation-progress') ? 'akariGenerationProgress' : undefined;
    return key ? this.children.find(child => Object.hasOwn(child.dataset, key)) : undefined;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = undefined;
  }
}

globalThis.document = { createElement: () => new DummyElement() };
const applyGenerationChip = widgetMethod('applyGenerationChip', { describeGenerationChip });
const generationForPath = widgetMethod('generationForPath', {
  resolveGenerationState, selectGenerationSidecarForSource
});
const uri = path => pathToFileURL(path).toString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (predicate()) return performance.now() - started;
    await sleep(10);
  }
  throw new Error(`${timeoutMs}ms 以内に DOM が更新されませんでした`);
}

test('node reader は generated を再帰走査し既存 6 状態と next 3 種を fail soft で返す', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-generation-reader-'));
  await cp(fixture, root, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'assets/generated/broken.mp4.meta.json'), '{broken');
  const paths = ['none.png', 'planned.png', 'generating.png', 'stale.png', 'done.mp4', 'failed.png']
    .map(name => `assets/generated/${name}`);
  const result = await new AkariAnnotationsServiceImpl().readGenerationSidecars({
    projectRootUri: uri(root), sourcePaths: [...paths, 'assets/generated/missing.mp4']
  });
  const entries = new Map(result.entries.map(entry => [entry.sourcePath, entry.meta]));
  assert.equal(entries.size, 10);
  const nowByName = new Map([
    ['generating.png', Date.parse('2026-09-13T00:00:01.000Z')],
    ['stale.png', Date.parse('2026-09-13T00:15:01.000Z')]
  ]);
  assert.deepEqual(paths.map(path => resolveGenerationState(
    entries.get(path), nowByName.get(path.split('/').at(-1)) ?? Date.parse('2026-09-13T00:00:00.000Z')
  )), ['none', 'planned', 'generating', 'stale', 'done', 'failed']);
  assert.equal(entries.get('assets/generated/done.mp4').result.path, 'assets/generated/done.mp4');
  assert.equal(entries.get('assets/generated/done.mp4').inputs.first_frame.path, 'assets/generated/generating.png');
});

test('生成中 mp4 が未存在でも first frame の sha binding で png チップを生成中にする', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-generation-in-flight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fixture, root, { recursive: true });
  const sourcePath = 'assets/generated/planned.png';
  const source = await readFile(join(root, sourcePath));
  const sha256 = createHash('sha256').update(source).digest('hex');
  await writeFile(join(root, 'assets/generated/in-flight.mp4.meta.json'), JSON.stringify({
    version: 1, kind: 'video', status: 'generating', progress: 45,
    inputs: { first_frame: { path: sourcePath, sha256 } },
    job: { started_at: new Date().toISOString(), stale_after_s: 30 }
  }));
  const result = await new AkariAnnotationsServiceImpl().readGenerationSidecars({
    projectRootUri: uri(root), sourcePaths: [sourcePath]
  });
  const inFlight = result.entries.find(entry => entry.sourcePath === 'assets/generated/in-flight.mp4');
  assert.equal(inFlight.binding.matches, true);
  const sidecars = new Map(result.entries.map(entry => [entry.sourcePath, {
    meta: entry.meta, binding: entry.binding
  }]));
  const generation = generationForPath.call({ generationSidecars: sidecars }, sourcePath);
  const element = new DummyElement();
  applyGenerationChip.call({}, element, generation);
  assert.equal(element.dataset.akariGenerationState, 'generating');
  assert.match(element.className, /akari-generation-generating/);
  assert.equal(element.children.find(child => Object.hasOwn(child.dataset, 'akariGenerationBadge'))?.textContent,
    '生成中 45%');
});

test('meta watcher は 1 秒以内に className / badge を差分更新し edit/captions を書かない', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-generation-states-'));
  await cp(fixture, root, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const editPath = join(root, 'edit.json');
  const captionsPath = join(root, 'captions.json');
  const sidecarPath = join(root, 'assets/generated/planned.png.meta.json');
  const before = { edit: (await stat(editPath)).mtimeMs, captions: (await stat(captionsPath)).mtimeMs };
  const service = new AkariAnnotationsServiceImpl();
  let current;
  const render = async () => {
    const result = await service.readGenerationSidecars({
      projectRootUri: uri(root), sourcePaths: ['assets/generated/planned.png']
    });
    const meta = result.entries.find(entry => entry.sourcePath === 'assets/generated/planned.png')?.meta;
    const state = resolveGenerationState(meta, Date.now());
    const element = new DummyElement();
    applyGenerationChip.call({}, element, { state, meta });
    current = element;
  };
  await render();
  assert.match(current.className, /akari-generation-planned/);
  assert.equal(current.children[0].textContent, 'planned');

  let renderTail = Promise.resolve();
  let sidecarMtime = (await stat(sidecarPath)).mtimeMs;
  const watcher = setInterval(() => {
    renderTail = renderTail.then(async () => {
      const nextMtime = await stat(sidecarPath).then(value => value.mtimeMs).catch(() => sidecarMtime);
      if (nextMtime !== sidecarMtime) {
        sidecarMtime = nextMtime;
        await render();
      }
    });
  }, 10);
  const changedAt = performance.now();
  let elapsedMs;
  try {
    await writeFile(sidecarPath, `${JSON.stringify({
      version: 1, kind: 'still', status: 'generating', progress: 62,
      job: { started_at: new Date().toISOString(), stale_after_s: 900 }
    }, null, 2)}\n`);
    elapsedMs = await waitFor(() => current?.className.includes('akari-generation-generating')
      && current.children.some(child => child.textContent === '生成中 62%'), 1000);
  } finally {
    clearInterval(watcher);
    await renderTail;
  }
  assert.ok(performance.now() - changedAt < 1000);
  assert.ok(elapsedMs < 1000);

  const after = { edit: (await stat(editPath)).mtimeMs, captions: (await stat(captionsPath)).mtimeMs };
  assert.deepEqual(after, before);
  assert.match(widgetSource, /event\.changes\.some\(change => change\.resource\.path\.toString\(\)\.endsWith\('\.meta\.json'\)\)/);
  assert.match(widgetSource, /JSON\.stringify\(\{ row, label, generation \}\)/);
  assert.match(widgetSource, /dataSet|dataset\.akariGenerationState/iu);
});

test('generation chip 更新は再描画で class を復元し、2 回適用しても badge / progress を重複させない', () => {
  const element = new DummyElement();
  const generating = { state: 'generating', meta: { status: 'generating', progress: 62 } };
  applyGenerationChip.call({}, element, generating);
  applyGenerationChip.call({}, element, generating);
  assert.equal(element.children.filter(child => Object.hasOwn(child.dataset, 'akariGenerationBadge')).length, 1);
  assert.equal(element.children.filter(child => Object.hasOwn(child.dataset, 'akariGenerationProgress')).length, 1);

  element.className = 'akari-annotations-strip-clip akari-annotations-strip-hit-target';
  applyGenerationChip.call({}, element, generating);
  assert.match(element.className, /akari-generation-generating/);
  assert.equal(element.children.filter(child => Object.hasOwn(child.dataset, 'akariGenerationBadge')).length, 1);

  applyGenerationChip.call({}, element, undefined);
  assert.equal(element.dataset.akariGenerationState, 'none');
  assert.equal(element.children.filter(child => Object.hasOwn(child.dataset, 'akariGenerationBadge')).length, 0);
  assert.equal(element.children.filter(child => Object.hasOwn(child.dataset, 'akariGenerationProgress')).length, 0);

  const renderStrip = widgetSource.slice(widgetSource.indexOf('protected renderStrip(): void'),
    widgetSource.indexOf('protected renderRuler()', widgetSource.indexOf('protected renderStrip(): void')));
  assert.equal(renderStrip.match(/this\.applyGenerationChip\(/g)?.length, 2, 'tree と cut で各 1 回');
  assert.match(renderStrip, /element\.style\.pointerEvents = 'auto';\s*this\.applyGenerationChip\(element, generation\);\s*if \(created\)/);
  assert.match(renderStrip, /}\s*this\.applyGenerationChip\(element, cutGeneration\);\s*if \(created && unsupportedDeclaredTransitions/);
});

test('orphan の generation chip は孤児クラスとバッジを表示する', () => {
  const element = new DummyElement();
  applyGenerationChip.call({}, element, {
    state: 'orphan',
    meta: { version: 1, kind: 'video', status: 'done' },
    binding: { expected: 'a', actual: 'b', matches: false, source: 'result' }
  });
  assert.match(element.className, /akari-generation-orphan/);
  assert.equal(element.children.find(child => Object.hasOwn(child.dataset, 'akariGenerationBadge'))?.textContent, '孤児');
});

const renderPlannedVideoMedia = widgetMethod('renderPlannedVideoMedia', {});
const plannedVideoConnects = widgetMethod('plannedVideoConnects', {});
const plannedFixture = async name => JSON.parse(await readFile(new URL(
  `./fixtures/generation-states/assets/generated/${name}.png.meta.json`, import.meta.url)));

function plannedContext(meta) {
  const segment = { index: 0, track: 0, tlStart: 0, tlEnd: 1 };
  const calls = [];
  return {
    segments: [segment, { index: 1, track: 0, tlStart: 1, tlEnd: 2 }],
    cuts: [{ src: 'current' }, { src: 'next' }],
    sourceMap: new Map([['next', { path: 'assets/generated/next-first.png' }]]),
    generationSidecars: new Map(),
    thumbnailCache: new Map(),
    location: { editUri: 'file:///fixture/edit.json' },
    resolveEditMediaUri: path => `file:///fixture/${path}`,
    clipLocalGeometry: () => undefined,
    rawV2Item: () => undefined, cutItemId: index => String(index),
    fetchThumbnail: (...args) => calls.push(args), calls,
    renderPlannedVideoMedia, plannedVideoConnects
  };
}

for (const [name, count, link] of [['next-first-last', 2, true], ['next-first', 1, false], ['next-prompt', 0, false]]) {
  test(`${name}: 両端のセル数・鎖・再適用・狭幅`, async () => {
    const meta = await plannedFixture(name);
    const context = plannedContext(meta);
    const element = new DummyElement();
    element.dataset = { akariItemKind: 'cut', akariItemId: '0' };
    const generation = { state: resolveGenerationState(meta, Date.now()), meta };
    applyGenerationChip.call(context, element, generation);
    applyGenerationChip.call(context, element, generation);
    const wrapper = element.querySelector('.akari-generation-frames');
    assert.equal(wrapper.children.filter(c => c.dataset.akariGenerationFrame).length, count);
    assert.equal(Boolean(element.querySelector('.akari-generation-link')), link);
    assert.equal(element.dataset.akariGenerationState, 'planned-video');
    assert.equal(element.querySelector('[data-akari-generation-badge]').textContent, '▶ 動画予定');
    assert.ok(!element.querySelector('.akari-annotations-strip-clip-filmstrip'));
    if (!count) assert.equal(wrapper.querySelector('.akari-generation-prompt').textContent, meta.next.inputs.prompt);
    element.width = 50;
    applyGenerationChip.call(context, element, generation);
    assert.equal(wrapper.children.filter(c => c.dataset.akariGenerationFrame).length, Math.min(1, count));
    assert.equal(element.querySelector('[data-akari-generation-badge]').textContent, '▶');
    element.width = 180;
    applyGenerationChip.call(context, element, generation);
    assert.equal(wrapper.children.filter(c => c.dataset.akariGenerationFrame).length, count);
  });
}

test('再生・ポインタ操作・ドラッグ中は未取得の next サムネを要求しない', async () => {
  const meta = await plannedFixture('next-first-last');
  for (const guard of ['visualPlaying', 'visualPointerDown', 'dragState']) {
    const context = plannedContext(meta);
    context[guard] = true;
    const element = new DummyElement();
    element.dataset.akariItemId = '0';
    renderPlannedVideoMedia.call(context, element, meta);
    assert.equal(context.calls.length, 0, guard);
    context[guard] = false;
    renderPlannedVideoMedia.call(context, element, meta);
    assert.equal(context.calls.length, 2, `${guard} 解除後`);
  }
});

test('鎖は sha を優先し、なければ正規化 path、隙間と別トラックには出さない', async () => {
  const meta = await plannedFixture('next-first-last');
  const context = plannedContext(meta);
  const segment = context.segments[0];
  const last = meta.next.inputs.last_frame;
  last.path = './assets\\generated/../generated/next-first.png';
  assert.equal(plannedVideoConnects.call(context, segment, meta), true);
  context.generationSidecars.set('assets/generated/next-first.png', { meta: { result: { sha256: 'different' } } });
  assert.equal(plannedVideoConnects.call(context, segment, meta), false);
  context.generationSidecars.get('assets/generated/next-first.png').meta.result.sha256 = last.sha256;
  last.path = 'different-path.png';
  assert.equal(plannedVideoConnects.call(context, segment, meta), true);
  context.segments[1].track = 1;
  assert.equal(plannedVideoConnects.call(context, segment, meta), false);
  context.segments[1].track = 0;
  context.segments[1].tlStart = 1.5;
  assert.equal(plannedVideoConnects.call(context, segment, meta), false);
});

test('placeholder の generating / stale / failed は first_frame が別でも next より優先', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-generation-placeholder-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fixture, root, { recursive: true });
  const path = 'assets/generated/next-prompt.png';
  const sha256 = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
  const service = new AkariAnnotationsServiceImpl();
  for (const state of ['generating', 'stale', 'failed', 'done']) {
    await writeFile(join(root, 'assets/generated/placeholder-job.mp4.meta.json'), JSON.stringify({
      version: 1, kind: 'video', status: state === 'stale' ? 'generating' : state,
      placeholder: { path, sha256, item_id: 'clip-next-prompt' },
      inputs: { first_frame: { path: 'assets/generated/none.png' } },
      job: { started_at: new Date(Date.now() - (state === 'stale' ? 1000000 : 0)).toISOString(), stale_after_s: 900 }
    }));
    const result = await service.readGenerationSidecars({ projectRootUri: uri(root), sourcePaths: [path] });
    const context = { generationSidecars: new Map(result.entries.map(e => [e.sourcePath, e])) };
    const generation = generationForPath.call(context, path);
    assert.equal(generation.state, state === 'done' ? 'planned-video' : state);
    if (state !== 'done') assert.equal(generation.binding.source, 'placeholder');
  }
});

test('next の変更は署名に含まれ、絵・prompt・鎖が更新される', async () => {
  const meta = await plannedFixture('next-first-last');
  const context = plannedContext(meta);
  const element = new DummyElement();
  element.dataset = { akariItemKind: 'cut', akariItemId: '0' };
  applyGenerationChip.call(context, element, { state: 'planned-video', meta });
  assert.ok(element.querySelector('.akari-generation-link'));
  meta.next.inputs = { prompt: '変更した指示文' };
  applyGenerationChip.call(context, element, { state: 'planned-video', meta });
  const wrapper = element.querySelector('.akari-generation-frames');
  assert.equal(wrapper.children.filter(c => c.dataset.akariGenerationFrame).length, 0);
  assert.equal(wrapper.querySelector('.akari-generation-prompt').textContent, '変更した指示文');
  assert.ok(!element.querySelector('.akari-generation-link'));
  const signature = widgetSource.slice(widgetSource.indexOf('const cutSignature ='), widgetSource.indexOf('const { element, created } = this.keyedStripSegment(', widgetSource.indexOf('const cutSignature =')));
  assert.match(signature, /cutGeneration/);
  assert.match(signature, /first_frame\?\.sha256/);
  assert.match(signature, /last_frame\?\.sha256/);
  assert.match(signature, /plannedVideoConnects/);
});


test('未接続の新規 keyed ノードでも描画幅を使い 2 セルと完全な badge を表示する', async () => {
  const meta = await plannedFixture('next-first-last');
  const context = plannedContext(meta);
  context.stripLayoutWidthPx = 1000;
  context.layoutPercent = time => time * 10;
  const element = new DummyElement();
  element.width = 0;
  element.dataset = { akariItemKind: 'cut', akariItemId: '0' };
  applyGenerationChip.call(context, element, { state: 'planned-video', meta });
  assert.equal(element.querySelector('.akari-generation-frames').children.filter(c => c.dataset.akariGenerationFrame).length, 2);
  assert.equal(element.querySelector('[data-akari-generation-badge]').textContent, '▶ 動画予定');
  applyGenerationChip.call(context, element, { state: 'none' });
  assert.ok(!element.querySelector('.akari-generation-frames'));
  assert.ok(!element.querySelector('.akari-generation-link'));
});


test('セル幅は穴の内側の高さ×16/9 とクリップ幅40%の小さい方。名前を中央へ、札と穴は重複しない', async () => {
  const meta = await plannedFixture('next-first-last');
  const context = plannedContext(meta);
  context.rawV2Item = () => ({ name: '窓の外を見る' });
  const element = new DummyElement();
  element.dataset = { akariItemKind: 'cut', akariItemId: '0' };
  for (const [width, height] of [[400, 48], [100, 80], [63, 48], [64, 48], [300, 120]]) {
    element.width = width;
    // Detached keyed nodes already have this height; their rect may be empty.
    element.style.height = `${height}px`;
    applyGenerationChip.call(context, element, { state: 'planned-video', meta });
    applyGenerationChip.call(context, element, { state: 'planned-video', meta });
    const wrapper = element.querySelector('.akari-generation-frames');
    const cells = wrapper.children.filter(c => c.dataset.akariGenerationFrame);
    const expectedWidth = Math.min((height - 12) * 16 / 9, width * .4);
    assert.equal(cells.length, width < 64 ? 1 : 2);
    for (const cell of cells) {
      assert.equal(parseFloat(cell.style.width), expectedWidth);
      assert.equal(cell.style.top, '5px');
      assert.equal(cell.style.bottom, '5px');
      assert.equal(cell.style.backgroundSize, 'cover');
      const label = cell.querySelector('.akari-generation-frame-label');
      assert.equal(label.textContent, cell.dataset.akariGenerationFrame === 'first' ? '最初' : '最後');
      assert.equal(label.style.display, width >= 64 && expectedWidth >= 44 ? '' : 'none');
    }
    const prompt = wrapper.querySelector('.akari-generation-prompt');
    assert.equal(prompt.textContent, '窓の外を見る');
    assert.equal(parseFloat(prompt.style.left), expectedWidth + 4);
    assert.equal(parseFloat(prompt.style.right), width < 64 ? 18 : expectedWidth + 4);
    assert.equal(element.children.filter(c => Object.hasOwn(c.dataset, 'akariGenerationBadge')).length, 1);
    assert.equal(element.querySelector('[data-akari-generation-badge]').textContent, width < 64 ? '▶' : '▶ 動画予定');
    assert.equal(element.children.filter(c => c.className.includes('akari-generation-perforations ')).length, 2);
  }
  context.rawV2Item = () => ({ name: '' });
  applyGenerationChip.call(context, element, { state: 'planned-video', meta });
  assert.equal(element.querySelector('.akari-generation-frames').querySelector('.akari-generation-prompt').textContent, meta.next.inputs.prompt);
  applyGenerationChip.call(context, element, { state: 'none' });
  assert.ok(!element.querySelector('.akari-generation-perforations-top'));
  assert.ok(!element.querySelector('.akari-generation-perforations-bottom'));
});

test('prompt-only はクリップ名より指示文を優先する', async () => {
  const meta = await plannedFixture('next-prompt');
  const context = plannedContext(meta);
  context.rawV2Item = () => ({ name: '表示しない素材名.png' });
  const element = new DummyElement();
  element.dataset.akariItemId = '0';
  renderPlannedVideoMedia.call(context, element, meta);
  assert.equal(element.querySelector('.akari-generation-frames').querySelector('.akari-generation-prompt').textContent, meta.next.inputs.prompt);
});

test('fixture は既存6本の尺を維持し、5秒の動画予定3本と1.4秒の狭幅1本を連続配置する', async () => {
  const edit = JSON.parse(await readFile(new URL('edit.json', fixture)));
  const items = edit.tracks[0].items;
  assert.deepEqual(items.slice(0, 6).map(c => [c.at, c.duration]), [[0,30],[30,30],[60,30],[90,30],[120,30],[150,30]]);
  assert.deepEqual(items.slice(6).map(c => [c.at, c.duration]), [[180,150],[330,150],[480,150],[630,42]]);
  assert.equal(items.at(-1).source.out, 1.4);
  assert.equal((await plannedFixture('next-narrow')).next.output.duration_s, 1.4);
  const generator = await readFile(new URL('../evidence/generation-states/scripts/gen-fixture.mjs', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('gen-fixture.mjs', generator, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.filter(ts.isVariableStatement).flatMap(s => s.declarationList.declarations)
    .find(d => d.name.getText(ast) === 'STATES');
  const states = new Function(`return ${declaration.initializer.getText(ast)}`)();
  assert.deepEqual(states.slice(6).map(s => s.frames), items.slice(6).map(c => c.duration));
});


test('40〜63px の狭幅クリップでも名前に正の表示幅を確保し、札は▶だけ', async () => {
  const meta = await plannedFixture('next-narrow');
  const context = plannedContext(meta);
  context.rawV2Item = () => ({ name: '窓の外を見る' });
  const element = new DummyElement();
  element.dataset = { akariItemKind: 'cut', akariItemId: '0' };
  for (const width of [40, 44, 58, 63]) {
    element.width = width;
    applyGenerationChip.call(context, element, { state: 'planned-video', meta });
    const prompt = element.querySelector('.akari-generation-frames').querySelector('.akari-generation-prompt');
    const available = width - 2 - parseFloat(prompt.style.left) - parseFloat(prompt.style.right);
    assert.ok(available > 0, `${width}px: name width ${available}`);
    assert.equal(prompt.textContent, '窓の外を見る');
    assert.equal(element.querySelector('[data-akari-generation-badge]').textContent, '▶');
  }
});

test('L1 は時刻の非表示・背面、名前の0px幅、headerのはみ出しを拒否する', async () => {
  const source = await readFile(new URL('../evidence/generation-states/scripts/l1-generation-states.mjs', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('l1.mjs', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'assertPlannedLayout');
  const check = new Function('assert', `return (${fn.getText(ast)});`)((condition, message) => assert.ok(condition, message));
  const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
  const clips = ['next-first-last.png', 'next-first.png', 'next-prompt.png', 'next-narrow.png'].map((label, i) => {
    const narrow = i === 3, x = i * 200, width = narrow ? 44 : 158.67;
    const text = (role, value, r) => ({ role, text: value, rect: r, visible: true, zIndex: '4', frontmost: true });
    return {
      label, rect: rect(x, 0, width, 48), header: rect(x + 1, 1, width - 2, 14), cells: [],
      kindBadge: { exists: true, display: 'none' },
      texts: [text('badge', narrow ? '▶' : '▶ 動画予定', rect(x + 3, 3, narrow ? 16 : 54, 14)),
        text('name-or-prompt', '窓の外を見る', rect(x + 8, 18, width - 16, 12)),
        ...(!narrow ? [{ ...text('duration', '00:05:00', rect(x + width - 57, 2, 53, 12)), color: 'rgb(229, 229, 229)' }] : [])],
      holes: ['top', 'bottom'].map(edge => ({ edge, rect: rect(x + 1, edge === 'top' ? 1 : 42, width - 2, 5),
        visible: true, opacity: '.75', background: 'radial-gradient(...)', zIndex: '3', paintedSamples: [{ x: x + 70, y: 3 }] }))
    };
  });
  check(clips);
  for (const index of [0, 3]) {
    for (const [edge, value] of [['left', clips[index].rect.left - 1],
      ['right', clips[index].rect.right + 5], ['top', clips[index].rect.top - 1]]) {
      const bad = structuredClone(clips);
      bad[index].header[edge] = value;
      assert.throws(() => check(bad), /header outside clip/, `${index}: ${edge}`);
    }
  }
  for (const mode of ['hidden', 'covered', 'absent']) {
    const bad = structuredClone(clips);
    const duration = bad[0].texts.find(t => t.role === 'duration');
    if (mode === 'hidden') duration.visible = false;
    if (mode === 'covered') duration.frontmost = false;
    if (mode === 'absent') bad[0].texts = bad[0].texts.filter(t => t.role !== 'duration');
    assert.throws(() => check(bad), /duration (missing|not in front)/, mode);
  }
  const badName = structuredClone(clips);
  badName[3].texts.find(t => t.role === 'name-or-prompt').rect.width = 0;
  assert.throws(() => check(badName), /name has no display width/);
  const tooNarrow = structuredClone(clips);
  tooNarrow[3].rect.width = 39;
  assert.throws(() => check(tooNarrow), /unexpected actual width/);
});
