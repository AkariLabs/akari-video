import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

test('validateGenerationInputs は packages/generate の結果をそのまま返す', async () => {
  const service = new AkariAnnotationsServiceImpl();
  const request = {
    modelId: 'fal:h3-i2v',
    inputs: { prompt: 'move', first_frame: { path: 'still.png' }, reference_images: [], reference_videos: [], reference_audios: [], extra: {} },
    output: { duration_s: 6, resolution: '768P', audio_out: true }
  };
  const actual = await service.validateGenerationInputs(request);
  const catalog = await service.readGenerationCatalog();
  const direct = await import('../../../../../packages/generate/src/validate-inputs.mjs');
  assert.deepEqual(actual, direct.validateInputs({ ...request, model: catalog.models.find(row => row.id === request.modelId) }));
});

test('startGenerateVideo は approved true 以外では spawn 前に拒否する', async () => {
  const service = new AkariAnnotationsServiceImpl();
  let starts = 0;
  service.generationCli = { start: async () => { starts += 1; return { ok: true, stdout: '' }; } };
  await assert.rejects(() => service.startGenerateVideo({ projectRootUri: 'file:///tmp/project', itemId: 'clip' }), /費用承認/);
  assert.equal(starts, 0);
  assert.equal((await service.startGenerateVideo({ projectRootUri: 'file:///tmp/project', itemId: 'clip', approved: true })).ok, true);
  assert.equal(starts, 1);
});

const requestFor = root => ({ projectRootUri: pathToFileURL(root).toString(), itemId: 'clip-a', modelId: 'fal:h3-i2v', inputs: { prompt: 'move', first_frame: null }, output: { duration_s: 6 } });
async function fixture(root) {
  await writeFile(path.join(root, 'edit.json'), JSON.stringify({ sources: [{ id: 'still', path: 'still.png' }], tracks: [{ items: [{ id: 'clip-a', source: { kind: 'media', src: 'still' } }] }] }));
  await writeFile(path.join(root, 'still.png'), 'fixture');
}

test('writeGenerationDraft は next のみ原子的に更新し他のキーのバイト列を保持する', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-generation-service-'));
  try {
    await fixture(root);
    const service = new AkariAnnotationsServiceImpl();
    const filename = path.join(root, 'still.png.meta.json');
    const prefix = '{\r\n  "version" : 1, "kind":"still", "status":"done", "numeric":1.00, "nested":{"next":["x}"]}, "next" : ';
    const suffix = ', "history" : [ {"note":"変更しない"} ]\r\n}\r\n';
    await writeFile(filename, prefix + '{"old":true}' + suffix);
    const before = await stat(path.join(root, 'edit.json'));
    for (const prompt of ['first', 'second']) {
      const result = await service.writeGenerationDraft({ ...requestFor(root), inputs: { prompt } });
      assert.equal(result.path, 'still.png.meta.json');
      const text = await readFile(filename, 'utf8');
      assert.ok(text.startsWith(prefix)); assert.ok(text.endsWith(suffix));
      const next = JSON.parse(text).next;
      assert.equal(next.kind, 'video'); assert.equal(next.status, 'planned'); assert.equal(next.inputs.prompt, prompt);
      assert.equal(next.model.id, 'fal:h3-i2v'); assert.ok(next.updated_at);
    }
    assert.equal((await stat(path.join(root, 'edit.json'))).mtimeMs, before.mtimeMs);
    assert.equal(await stat(path.join(root, '.akari/generation/clip-a.inputs.json')).then(() => true).catch(() => false), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('meta の無い png に meta を新設しない', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-generation-no-meta-'));
  try {
    await fixture(root);
    await assert.rejects(new AkariAnnotationsServiceImpl().writeGenerationDraft(requestFor(root)), /この画像には生成の記録がありません。.*akari generate still/u);
    assert.equal(await stat(path.join(root, 'still.png.meta.json')).then(() => true).catch(() => false), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import ts from 'typescript';
import { generationFields } from '../lib/browser/inspector/generation-fields.js';
import { selectGenerationSidecarForSource } from '@akari-video/edit-store';
const widgetSource = await readFile(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.ts', widgetSource, ts.ScriptTarget.Latest, true);
const widgetClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const methodNames = ['generationIdentity', 'loadGeneration', 'loadGenerationNeighbors', 'validateGenerationDraft', 'persistGenerationDraft', 'copyAdjacentGenerationDraft'];
const code = ts.transpileModule(`class Harness { ${widgetClass.members.filter(node => methodNames.includes(node.name?.getText(ast))).map(node => node.getText(ast)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Harness = new Function('generationFields', 'selectGenerationSidecarForSource', `${code}; return Harness;`)(generationFields, selectGenerationSidecarForSource);
const uri = value => ({ resolve: child => uri(path.join(value, child)), toString: () => pathToFileURL(value).toString(), value });
function harness(root, service) {
  const widget = new Harness();
  for (const name of ['generationDrafts', 'generationTabDrafts', 'generationTabMeta', 'generationStates', 'generationValidations', 'generationNeighbors', 'generationWrites']) widget[name] = new Map();
  widget.generationLoads = new Set(); widget.generationTabLoads = new Set(); widget.generationCatalog = [];
  widget.workspaceService = { ready: Promise.resolve(), tryGetRoots: () => [{ resource: uri(root) }] };
  widget.fileService = { read: async resource => ({ value: await readFile(resource.value, 'utf8') }) };
  widget.layerAudioService = {
    readGenerationCatalog: () => service.readGenerationCatalog(), readGenerationDefaults: async () => ({ video: 'fal:h3-i2v' }),
    validateGenerationInputs: request => service.validateGenerationInputs(request), writeGenerationDraft: request => service.writeGenerationDraft(request),
    readGenerationSidecars: async () => { widget.sidecarReads++; return { entries: [{ sourcePath: '.\\still.png', meta: JSON.parse(await readFile(path.join(root, 'still.png.meta.json'), 'utf8')) }] }; }
  };
  widget.sidecarReads = 0; widget.model = { snapshot: undefined }; widget.render = () => {};
  widget.showFieldNotice = message => { throw new Error(message); };
  return widget;
}

test('旧 inputs.json だけから復元 → 1 回保存で next へ移行・旧ファイルは不変・next 優先', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-generation-migration-'));
  try {
    await fixture(root);
    const original = '{ "version":1, "kind":"still", "status":"done", "history":[1.00] }\n';
    await writeFile(path.join(root, 'still.png.meta.json'), original);
    await mkdir(path.join(root, '.akari/generation'), { recursive: true });
    const legacyPath = path.join(root, '.akari/generation/clip-a.inputs.json');
    const legacy = JSON.stringify({ modelId: 'fal:h3-i2v', inputs: { prompt: 'Legacy garden', first_frame: null }, output: { duration_s: 5, resolution: '768P' } });
    await writeFile(legacyPath, legacy);
    const widget = harness(root, new AkariAnnotationsServiceImpl());
    const identity = { key: 'clip-a', itemId: 'clip-a', sourcePath: 'still.png', duration: 6 };
    await widget.loadGeneration(identity);
    assert.equal(widget.generationDrafts.get('clip-a').inputs.prompt, 'Legacy garden');
    assert.equal(widget.sidecarReads, 1);
    assert.equal(widget.generationTabDrafts.get('clip-a'), widget.generationDrafts.get('clip-a'));
    await widget.persistGenerationDraft(identity);
    const metaText = await readFile(path.join(root, 'still.png.meta.json'), 'utf8');
    assert.equal(metaText.slice(0, original.lastIndexOf('}')), original.slice(0, original.lastIndexOf('}')));
    assert.equal(JSON.parse(metaText).next.inputs.prompt, 'Legacy garden');
    assert.equal(await readFile(legacyPath, 'utf8'), legacy);
    const changed = JSON.parse(metaText); changed.next.inputs.prompt = 'Next wins';
    await writeFile(path.join(root, 'still.png.meta.json'), JSON.stringify(changed));
    await widget.loadGeneration(identity);
    assert.equal(widget.generationDrafts.get('clip-a').inputs.prompt, 'Next wins');
    assert.equal(widget.generationTabMeta.get('clip-a').next.status, 'planned');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('隣から取るは隣の next を優先し、動画の隣には静止画近道を出さない', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-generation-neighbor-'));
  try {
    await fixture(root);
    const request = requestFor(root);
    await writeFile(path.join(root, 'still.png.meta.json'), JSON.stringify({ version: 1, kind: 'still', status: 'done' }));
    await writeFile(path.join(root, 'edit.json'), JSON.stringify({ sources: [{ id: 'previous', path: 'previous.mp4' }, { id: 'still', path: 'still.png' }, { id: 'after', path: 'after.png' }], tracks: [{ items: [
      { id: 'clip-after', at: 12, source: { kind: 'media', src: 'after' } },
      { id: 'clip-a', at: 6, source: { kind: 'media', src: 'still' } },
      { id: 'clip-before', at: 0, source: { kind: 'media', src: 'previous' } }
    ] }] }));
    await writeFile(path.join(root, 'previous.mp4.meta.json'), JSON.stringify({ next: { kind: 'video', status: 'planned', model: { id: request.modelId }, inputs: { prompt: 'From next', first_frame: { path: 'other.png' } }, output: { duration_s: 12, resolution: '768P' } } }));
    const service = new AkariAnnotationsServiceImpl();
    const widget = harness(root, service);
    widget.generationDrafts.set('clip-a', { modelId: request.modelId, inputs: { first_frame: null }, output: { duration_s: 6 } });
    const identity = { key: 'clip-a', itemId: 'clip-a', sourcePath: 'still.png', duration: 6 };
    assert.equal((await widget.copyAdjacentGenerationDraft(identity)).ok, true);
    assert.equal(widget.generationDrafts.get('clip-a').inputs.prompt, 'From next');
    assert.equal(widget.generationDrafts.get('clip-a').inputs.first_frame, null);
    assert.equal(widget.generationDrafts.get('clip-a').output.duration_s, 6);
    assert.equal(widget.generationNeighbors.get('clip-a').previousImage, undefined);
    assert.equal(widget.generationNeighbors.get('clip-a').nextImage, 'after.png');
  } finally { await rm(root, { recursive: true, force: true }); }
});
