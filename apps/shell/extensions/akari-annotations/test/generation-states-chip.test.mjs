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
  querySelector(selector) {
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

test('node reader は generated を再帰走査し fixture 6 状態を fail soft で返す', async t => {
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
  assert.equal(entries.size, 6);
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
