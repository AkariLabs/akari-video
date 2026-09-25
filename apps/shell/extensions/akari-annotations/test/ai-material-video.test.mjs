import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { appendAiMaterialView } from '../lib/browser/inspector/ai-material-view.js';
import { aiActionCatalog, aiActionPlacement } from '../lib/common/ai-action-catalog.js';
import { GenerationCliManager } from '../lib/node/generation-cli.js';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { doneStillMeta, inspectPng, withNextVideoDraft } from '../../../../../packages/generate/src/cli/meta-still.mjs';
import { makeReference } from '../../../../../packages/generate/src/cli/media-ref.mjs';

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = new Map(); this.attrs = new Map(); this.textContent = ''; this.className = ''; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  setAttribute(key, value) { this.attrs.set(key, value); }
  addEventListener(key, fn) { this.listeners.set(key, fn); }
  click() { this.listeners.get('click')?.(); }
}
const find = (node, match) => match(node) ? node : node.children.map(child => find(child, match)).find(Boolean);
const removeFixture = async (root, originalError) => {
  try { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  catch (error) { if (!originalError) throw error; }
};
const selection = { kind: 'material', projectRoot: 'file:///fixture', relativePath: 'assets/still.png', name: 'still.png', mediaKind: 'image' };
const options = { selection, tab: 'generation', view: 'tiles', summary: { state: 'none', segments: [], total: 0 }, running: false,
  commands: { executeCommand: async () => {} }, onTab: () => {}, onView: () => {}, onDialogResult: () => {}, onVideoForm: () => {} };

test('画像の素材のタイルから同じフォームへ進み、新しい素材のパスを表示する', () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Node(tag) };
  try {
    let view;
    const tiles = new Node('div');
    appendAiMaterialView(tiles, { ...options, onView: value => { view = value; } });
    const tile = find(tiles, node => node.attrs.get('data-akari-inspector-ai-tile') === 'video');
    assert.equal(tile.attrs.get('aria-disabled'), 'false');
    tile.click(); assert.equal(view, 'video');
    let rendered = false;
    const form = new Node('div');
    appendAiMaterialView(form, { ...options, view, onVideoForm: () => { rendered = true; }, createdPath: 'assets/generated/still-video-123.mp4' });
    assert.equal(rendered, true);
    assert.ok(find(form, node => node.textContent.includes('新しい素材 still-video-123.mp4 を作りました')));
    const action = aiActionCatalog([{ id: 'fal:h3-i2v', kind: 'video' }]).find(item => item.id === 'video');
    assert.equal(aiActionPlacement(action, 'material-image'), 'new-material');
    assert.equal(aiActionPlacement(action, 'still'), 'replace');
  } finally { globalThis.document = previous; }
});

test('node は fromImage を渡し CLI の --item 経路を保つ', async () => {
  const calls = [];
  const spawnImpl = (_command, args) => {
    calls.push(args);
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.exitCode = null;
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };
  const manager = new GenerationCliManager({ spawnImpl, env: { AKARI_GENERATE_CLI: '/tmp/fake.mjs' } });
  assert.equal((await manager.startFromImage('/tmp/project', 'assets/still.png')).ok, true);
  assert.deepEqual(calls[0].slice(1), ['generate', 'video', '/tmp/project', '--from-image', 'assets/still.png', '--yes', '--json']);
  assert.equal((await manager.start('/tmp/project', 'clip-a')).ok, true);
  assert.deepEqual(calls[1].slice(1), ['generate', 'video', '/tmp/project', '--item', 'clip-a', '--yes', '--json']);
  await assert.rejects(manager.startFromImage('/tmp/project', '../escape.png'), /fromImage/);
  const service = new AkariAnnotationsServiceImpl();
  let sent;
  service.generationCli = { startFromImage: async (_root, rel) => { sent = rel; return { ok: true, stdout: '' }; } };
  await assert.rejects(service.startGenerateVideo({ projectRootUri: 'file:///tmp/project', itemId: 'material:assets/still.png', fromImage: 'assets/still.png' }), /費用承認/);
  assert.equal((await service.startGenerateVideo({ projectRootUri: 'file:///tmp/project', itemId: 'material:assets/still.png', fromImage: 'assets/still.png', approved: true })).ok, true);
  assert.equal(sent, 'assets/still.png');
});

test('素材の下書きは edit.json が無くても画像の sidecar の next に入る', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-material-draft-'));
  let failure;
  try {
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'assets/still.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
    const service = new AkariAnnotationsServiceImpl();
    const result = await service.writeGenerationDraft({ projectRootUri: pathToFileURL(root).href, itemId: 'material:assets/still.png', fromImage: 'assets/still.png', modelId: 'fal:h3-i2v',
      inputs: { prompt: 'A moving garden.', first_frame: { path: 'assets/still.png' }, last_frame: null, reference_images: [], reference_videos: [], reference_audios: [], source_video: null, camera: null, seed: null, extra: {} }, output: { duration_s: 5, resolution: '768P' } });
    assert.equal(result.path, 'assets/still.png.meta.json');
    const meta = JSON.parse(await readFile(path.join(root, result.path), 'utf8'));
    assert.equal(meta.next.inputs.prompt, 'A moving garden.');
    assert.equal(meta.next.status, 'planned');
  } catch (error) { failure = error; throw error; }
  finally { await removeFixture(root, failure); }
});

const widgetSource = await readFile(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.ts', widgetSource, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const method = widget.members.find(node => node.name?.getText(ast) === 'confirmAndStartGeneration').getText(ast);
const code = ts.transpileModule(`class Harness { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Harness = new Function('ConfirmDialog', 'generationFields', `${code};return Harness;`)(class { async open() { return true; } }, {},);

test('素材フォームの承認後 startGenerateVideo に fromImage を渡す', async () => {
  const harness = new Harness();
  const identity = { key: 'material:assets/still.png', itemId: 'material:assets/still.png', sourcePath: 'assets/still.png', duration: 5 };
  harness.generationDrafts = new Map([[identity.key, { modelId: 'fal:h3-i2v', inputs: { prompt: 'move' }, output: { duration_s: 5 } }]]);
  harness.generationValidations = new Map([[identity.key, { ok: true, cost: { estimate_usd: 0.3, as_of: '2026-09-24' } }]]);
  harness.generationCatalog = [{ id: 'fal:h3-i2v', as_of: '2026-09-24' }];
  harness.generationFinal = new Set(); harness.generationStates = new Map(); harness.generationLoads = new Set(); harness.materialCreated = new Map();
  harness.persistGenerationDraft = async () => {}; harness.render = () => {}; harness.showFieldNotice = () => {};
  harness.workspaceService = { ready: Promise.resolve(), tryGetRoots: () => [{ resource: { toString: () => 'file:///tmp/project' } }] };
  let request;
  harness.layerAudioService = { startGenerateVideo: async value => { request = value; return { ok: true, stdout: '{"mp4":"assets/generated/still-video-1.mp4"}' }; } };
  await harness.confirmAndStartGeneration(identity);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(request.fromImage, 'assets/still.png');
  assert.equal(request.approved, true);
  assert.equal(harness.materialCreated.get('assets/still.png'), 'assets/generated/still-video-1.mp4');
  let notice;
  harness.showFieldNotice = text => { notice = text; };
  harness.layerAudioService.startGenerateVideo = async () => ({ ok: false, reason: 'fake failure', stdout: '' });
  await harness.confirmAndStartGeneration(identity);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.generationStates.get(identity.key), 'failed');
  assert.equal(notice, 'fake failure');
});

test('実 widget: L1 fixture の画像を選び動画タイルを押すとフォームの DOM が出る', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-material-widget-'));
  const project = path.join(root, 'project');
  await cp(fileURLToPath(new URL('../../../../../templates/project-default/', import.meta.url)), project, { recursive: true });
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await cp(fileURLToPath(new URL('./fixtures/generation-states/assets/generated/planned.png', import.meta.url)),
    path.join(project, 'assets/still.png'));
  await cp(fileURLToPath(new URL('./fixtures/generation-states/assets/generated/done.mp4', import.meta.url)),
    path.join(project, 'assets/ordinary.mp4'));
  const at = new Date().toISOString();
  const still = doneStillMeta({ prompt: '', duration_s: 5, at, asOf: at.slice(0, 10), path: 'assets/still.png',
    image: await inspectPng(path.join(project, 'assets/still.png')) });
  const planned = withNextVideoDraft(still, { firstFrame: makeReference(project, 'assets/still.png'),
    prompt: 'A slow camera move through a violet garden.', at });
  planned.next.output.resolution = '768P';
  await writeFile(path.join(project, 'assets/still.png.meta.json'), JSON.stringify(planned, null, 2) + '\n');
  const edit = JSON.parse(await readFile(new URL('./fixtures/inspector-generation/edit.json', import.meta.url), 'utf8'));
  edit.sources = [{ id: 'video', path: 'assets/ordinary.mp4' }];
  edit.tracks[0].items = [{ id: 'video-clip', at: 0, duration: 180,
    source: { kind: 'media', src: 'video', in: 0, out: 6 } }];
  edit.audio = { narration: [], sfx: [] };
  await writeFile(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  const previous = new Map(['document', 'window', 'Element', 'HTMLElement', 'Node', 'Event', 'DragEvent', 'MouseEvent', 'KeyboardEvent']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const require = createRequire(import.meta.url);
  const cssLoader = require.extensions['.css'];
  const widgets = [];
  const pendingLoads = [];
  let failure;
  const waitFor = async condition => {
    const deadline = Date.now() + 30_000;
    while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  };
  class DomNode {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = new Map(); this.attrs = new Map(); this.style = {}; this.className = ''; this.textContent = ''; this.nodeType = 1; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attrs.set(key, String(value)); }
    getAttribute(key) { return this.attrs.get(key) ?? null; }
    addEventListener(key, fn) { this.listeners.set(key, fn); }
    click() { this.listeners.get('click')?.(); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) {
      const attribute = selector.match(/^\[([^=]+)="([^"]+)"\]$/u);
      const match = node => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1))
        : attribute ? node.attrs.get(attribute[1]) === attribute[2] : false;
      return this.children.flatMap(child => [ ...(match(child) ? [child] : []), ...child.querySelectorAll(selector) ]);
    }
    get classList() { return { add: name => { this.className += ` ${name}`; }, contains: name => this.className.split(' ').includes(name) }; }
  }
  try {
    require.extensions['.css'] = () => {};
    for (const key of ['Element', 'HTMLElement', 'Node', 'Event', 'DragEvent', 'MouseEvent', 'KeyboardEvent']) globalThis[key] = DomNode;
    globalThis.document = { documentElement: { style: {} }, queryCommandSupported: () => false,
      createElement: tag => new DomNode(tag), createElementNS: (_ns, tag) => new DomNode(tag),
      createTextNode: text => { const node = new DomNode('#text'); node.textContent = text; return node; } };
    globalThis.window = { navigator: {}, localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {} };
    require('@theia/core/lib/browser/frontend-application-config-provider').FrontendApplicationConfigProvider.set({});
    const { AkariInspectorWidget } = require('../lib/browser/akari-inspector-widget.js');
    const widget = new AkariInspectorWidget();
    const service = new AkariAnnotationsServiceImpl();
    const uri = value => ({ toString: () => pathToFileURL(value).href, resolve: child => uri(path.join(value, child)), value });
    const wire = (target, layerAudioService) => {
      widgets.push(target);
      const loadGeneration = target.loadGeneration.bind(target);
      target.loadGeneration = (...args) => {
        const pending = loadGeneration(...args);
        pendingLoads.push(pending);
        return pending;
      };
      target.workspaceService = { ready: Promise.resolve(), tryGetRoots: () => [{ resource: uri(project) }] };
      target.fileService = { read: async resource => ({ value: await readFile(resource.value, 'utf8') }) };
      target.layerAudioService = layerAudioService;
      target.commandRegistry = { executeCommand: async () => {} };
      target.model = { snapshot: undefined };
      target.dispatchCaptionZoneEvent = () => {};
      target.syncAdjustCompare = () => {};
      target.hideFieldNotice = () => {};
      target.showFieldNotice = () => {};
    };
    wire(widget, service);
    widget.selectMaterial({ ...selection, projectRoot: pathToFileURL(project).href });
    const tile = widget.body.querySelector('[data-akari-inspector-ai-tile="video"]');
    assert.ok(tile, '動画タイルが出る');
    tile.click();
    assert.equal(widget.body.querySelector('.akari-inspector-ai-material-status')?.textContent, '読み込み中');
    await waitFor(() => !!widget.body.querySelector('[data-akari-field="generation-model"]'));
    assert.ok(widget.body.querySelector('[data-akari-field="generation-model"]'), 'モデル欄が DOM に出る');
    const currentImage = widget.body.querySelector('[data-akari-generation-action="first-frame-current"]');
    assert.equal(currentImage?.textContent, 'この素材の絵');
    assert.notEqual(currentImage?.textContent, 'このクリップの絵');
    await writeFile(path.join(project, '.akari/connections.json'), JSON.stringify({ providers: [], defaults: {}, policy: {}, memory: [] }));
    const broken = new AkariInspectorWidget();
    wire(broken, new AkariAnnotationsServiceImpl());
    broken.selectMaterial({ ...selection, projectRoot: pathToFileURL(project).href });
    broken.body.querySelector('[data-akari-inspector-ai-tile="video"]').click();
    await waitFor(() => broken.body.querySelector('.akari-inspector-ai-material-status')?.textContent !== '読み込み中');
    assert.match(broken.body.querySelector('.akari-inspector-ai-material-status')?.textContent ?? '', /policy\.currency/u);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await Promise.allSettled(pendingLoads);
    await Promise.allSettled(widgets.flatMap(target => [...target.generationWrites.values()]));
    if (cssLoader) require.extensions['.css'] = cssLoader; else delete require.extensions['.css'];
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    await removeFixture(root, failure);
  }
});
