import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { validateGenerationMeta } from '../../../../../packages/generate/src/cli/meta-validate.mjs';
import { applyReplacement, planReplacement } from '../../../../../packages/generate/src/cli/edit-replace.mjs';
import { resolveGenerationState } from '../lib/common/generation-sidecar.js';

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
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function fixture(root, sourcePath = 'still.png') {
  await writeFile(path.join(root, 'edit.json'), JSON.stringify({ version: 2, output: { fps: 30 }, sources: [{ id: 'still', path: sourcePath }], tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'clip-a', at: 0, duration: 180, transform: { scale: 1.2 }, source: { kind: 'media', src: 'still', in: 0, out: 6 } }] }] }));
  await writeFile(path.join(root, sourcePath), png);
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

test('meta の無い静止画でない素材（mp4・音声・html）には meta を新設しない', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-generation-no-meta-'));
  try {
    for (const sourcePath of ['clip.mp4', 'audio.mp3', 'card.html']) {
      await fixture(root, sourcePath);
      await assert.rejects(new AkariAnnotationsServiceImpl().writeGenerationDraft(requestFor(root)), /この素材には生成の記録がありません/u);
      await assert.rejects(stat(path.join(root, `${sourcePath}.meta.json`)), { code: 'ENOENT' });
    }
    await writeFile(path.join(root, 'edit.json'), JSON.stringify({ tracks: [{ items: [{ id: 'clip-a', source: { kind: 'caption' } }] }] }));
    await assert.rejects(new AkariAnnotationsServiceImpl().writeGenerationDraft(requestFor(root)), /生成対象の素材/u);
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

for (const extension of ['png', 'jpg', 'JPEG', 'webp']) {
  test(`meta の無い ${extension}: 新設・schema・動画予定・再保存時の next 以外のバイト保持`, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'akari-imported-image-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const sourcePath = `still.${extension}`;
    await fixture(root, sourcePath);
    // A real JPEG / WebP fixture; dimensions may be omitted by the importer.
    if (extension !== 'png') await writeFile(path.join(root, sourcePath), extension === 'webp'
      ? Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
      : Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF/AAD/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAg//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AR//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AR//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ag//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IR//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8QH//Z', 'base64'));
    const service = new AkariAnnotationsServiceImpl();
    let imports = 0;
    const importImage = service.importedImageGenerationMeta.bind(service);
    service.importedImageGenerationMeta = (...args) => { imports++; return importImage(...args); };
    const request = requestFor(root);
    request.inputs.first_frame = { path: sourcePath }; // Same path-only reference as the UI.
    const editBefore = await readFile(path.join(root, 'edit.json'), 'utf8');
    const result = await service.writeGenerationDraft(request);
    assert.equal(result.path, `${sourcePath}.meta.json`);
    const filename = path.join(root, result.path);
    const before = await readFile(filename, 'utf8');
    const meta = JSON.parse(before);
    assert.deepEqual(validateGenerationMeta(meta), { ok: true, errors: [] });
    assert.equal(meta.kind, 'still'); assert.equal(meta.status, 'done');
    assert.equal(meta.model.id, 'none'); assert.equal(meta.inputs.prompt, '');
    assert.equal(meta.provenance.tool, 'akari shell (imported image)');
    const bytes = await readFile(path.join(root, sourcePath));
    assert.equal(meta.result.path, sourcePath);
    assert.equal(meta.result.bytes, bytes.length);
    assert.equal(meta.result.sha256, createHash('sha256').update(bytes).digest('hex'));
    if (extension === 'png') { assert.equal(meta.result.width, 1); assert.equal(meta.result.height, 1); }
    const { entries } = await service.readGenerationSidecars({ projectRootUri: request.projectRootUri, sourcePaths: [sourcePath] });
    const selected = selectGenerationSidecarForSource(sourcePath, entries, Date.now());
    assert.equal(selected.binding.matches, true);
    assert.equal(resolveGenerationState(selected.meta, Date.now(), selected.binding), 'planned-video');
    // The UI can send the original path-only draft again before a watcher reload.
    await service.writeGenerationDraft({ ...request, inputs: { ...request.inputs, prompt: 'second' } });
    const after = await readFile(filename, 'utf8');
    const afterMeta = JSON.parse(after);
    assert.equal(before.replace(JSON.stringify(meta.next), '<next>'), after.replace(JSON.stringify(afterMeta.next), '<next>'));
    assert.equal(afterMeta.next.inputs.prompt, 'second');
    assert.equal(imports, 1, '再保存で取り込み meta を作り直さない');
    assert.deepEqual(validateGenerationMeta(afterMeta), { ok: true, errors: [] });
    assert.equal(await readFile(path.join(root, 'edit.json'), 'utf8'), editBefore);
    assert.ok(!(await readdir(root)).some(name => name.endsWith('.tmp')));
  });
}

test('新設した still + done + next も placeholder で逆引きし、生成動画へ差し替えられる', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-imported-replace-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await fixture(root);
  const service = new AkariAnnotationsServiceImpl(), request = requestFor(root);
  await service.writeGenerationDraft(request);
  const stillMeta = await readFile(path.join(root, 'still.png.meta.json'), 'utf8');
  const placeholder = { path: 'still.png', sha256: JSON.parse(stillMeta).result.sha256, item_id: 'clip-a' };
  await mkdir(path.join(root, 'assets/generated'), { recursive: true });
  const outputPath = 'assets/generated/imported.mp4';
  const video = { version: 1, kind: 'video', status: 'generating', placeholder,
    inputs: { first_frame: null }, job: { started_at: new Date().toISOString(), stale_after_s: 900 } };
  await writeFile(path.join(root, `${outputPath}.meta.json`), JSON.stringify(video));
  const entries = (await service.readGenerationSidecars({ projectRootUri: request.projectRootUri, sourcePaths: ['still.png'] })).entries;
  const selected = selectGenerationSidecarForSource('still.png', entries, Date.now());
  assert.equal(selected.sourcePath, outputPath);
  assert.equal(selected.binding.source, 'placeholder'); assert.equal(selected.binding.matches, true);
  assert.equal(resolveGenerationState(selected.meta, Date.now(), selected.binding), 'generating');
  const project = { edit: JSON.parse(await readFile(path.join(root, 'edit.json'), 'utf8')) };
  const originalItem = structuredClone(project.edit.tracks[0].items[0]);
  const plan = planReplacement({ actualDurationS: 4, cutsDurationS: 6 });
  const replaced = applyReplacement(project, { itemId: placeholder.item_id, mp4RelativePath: outputPath, plan });
  assert.equal(project.edit.sources.find(source => source.id === replaced.sourceId).path, outputPath);
  assert.equal(replaced.item.id, originalItem.id); assert.equal(replaced.item.at, originalItem.at);
  assert.equal(replaced.item.duration, originalItem.duration); assert.deepEqual(replaced.item.transform, originalItem.transform);
  assert.deepEqual(replaced.item.source.freeze, { at_sec: 4, duration_sec: 2 });
  const movie = Buffer.from('fake generated video');
  await writeFile(path.join(root, outputPath), movie);
  await writeFile(path.join(root, `${outputPath}.meta.json`), JSON.stringify({ ...video, status: 'done',
    result: { path: outputPath, sha256: createHash('sha256').update(movie).digest('hex'), bytes: movie.length, duration_s_actual: 4 } }));
  const doneEntries = (await service.readGenerationSidecars({ projectRootUri: request.projectRootUri, sourcePaths: [outputPath] })).entries;
  const done = selectGenerationSidecarForSource(outputPath, doneEntries, Date.now());
  assert.equal(done.binding.source, 'result'); assert.equal(done.binding.matches, true);
  assert.equal(resolveGenerationState(done.meta, Date.now(), done.binding), 'done');
  assert.equal(await readFile(path.join(root, 'still.png.meta.json'), 'utf8'), stillMeta);
});

test('新設時もプロジェクト外の画像 symlink と壊れた PNG を拒否し meta/tmp を残さない', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-imported-boundary-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'akari-imported-outside-'));
  t.after(() => Promise.all([root, outside].map(dir => rm(dir, { recursive: true, force: true }))));
  await fixture(root);
  await writeFile(path.join(outside, 'outside.png'), png);
  await rm(path.join(root, 'still.png'));
  await symlink(path.join(outside, 'outside.png'), path.join(root, 'still.png'));
  const service = new AkariAnnotationsServiceImpl();
  await assert.rejects(service.writeGenerationDraft(requestFor(root)), /プロジェクト内/);
  await rm(path.join(root, 'still.png'));
  await writeFile(path.join(root, 'still.png'), 'broken');
  await assert.rejects(service.writeGenerationDraft(requestFor(root)), /PNG/);
  assert.deepEqual((await readdir(root)).sort(), ['edit.json', 'still.png']);
});
