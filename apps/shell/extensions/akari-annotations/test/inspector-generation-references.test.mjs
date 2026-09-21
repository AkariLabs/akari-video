import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import * as generation from '../lib/browser/inspector/generation-fields.js';
import * as mirror from '../lib/common/generation-pick-mirror.js';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { GenerationCliManager } from '../lib/node/generation-cli.js';
import { validateInputs } from '../../../../../packages/generate/src/validate-inputs.mjs';
import { getAdapter } from '../../../../../packages/generate/src/adapters/index.mjs';

const catalog = JSON.parse(await readFile(new URL('../../../../../packages/schemas/gen-models.json', import.meta.url), 'utf8')).models.filter(row => row.kind === 'video');
const { generationFields } = generation;
const kinds = ['reference_images', 'reference_videos', 'reference_audios'];
const labels = ['画像', '動画', '音声'];
const bothInputs = () => ({ prompt: 'Move @画像1 beside @画像2.', first_frame: { path: 'first.png' }, last_frame: { path: 'last.png' },
  reference_images: [{ path: 'one.png' }, { path: 'two.png' }], reference_videos: [{ path: 'motion.mp4', range_s: [0, 7] }], reference_audios: [{ path: 'voice.wav', range_s: [0, 4] }] });
const draftFor = model => ({ modelId: model.id, inputs: { ...bothInputs(), ...(generationFields.modelSide(model) ? { frames_or_refs: generationFields.modelSide(model) } : {}) },
  output: { duration_s: 6, resolution: model.resolutions?.[0] ?? null } });
const defaultsFor = current => ({ catalogRow: catalog.find(row => row.id === current.modelId), draft: current, snapshot: {}, defaults: { catalog }, actions: {
  update: async () => ({ ok: true }), copyAdjacent: async () => ({ ok: true }), generate: async () => ({ ok: true })
} });

// The real appendRow/update/validation/persistence bodies, without loading Electron.
const source = await readFile(new URL('../lib/browser/akari-inspector-widget.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let widget;
function visit(node) { if (ts.isClassExpression(node) && node.name?.text === 'AkariInspectorWidget') widget = node; ts.forEachChild(node, visit); }
visit(ast);
const methods = ['appendRow', 'generationIdentity', 'generationFramePickDisabled', 'paintGenerationFramePick', 'cancelGenerationFramePick', 'syncGenerationFramePick', 'updateGenerationDraft', 'validateGenerationDraft', 'persistGenerationDraft', 'confirmAndStartGeneration'];
const bodies = widget.members.filter(node => methods.includes(node.name?.getText(ast))).map(node => node.getText(ast));
assert.equal(bodies.length, methods.length);
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.value = ''; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  querySelector() { return undefined; }
  querySelectorAll() { return this.all().filter(child => child.attributes.has('data-akari-generation-pick-slot')); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
}
const Harness = new Function('generation_fields_1', 'generation_pick_mirror_1', 'document', 'dialogs_1', `return class { ${bodies.join('\n')} }`)(generation, mirror, { createElement: tag => new Element(tag) }, { ConfirmDialog: class { async open() { return true; } } });
const identity = { key: 'clip-a', itemId: 'clip-a', sourcePath: 'first.png', duration: 6 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitPick(w) {
  const deadline = Date.now() + 5000;
  while (w.generationFramePick && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(w.generationFramePick, undefined, 'picker did not settle');
}
function harness(modelId = 'fal:h3-i2v') {
  const w = new Harness(), service = new AkariAnnotationsServiceImpl();
  for (const key of ['generationDrafts', 'generationTabDrafts', 'generationValidations', 'generationStates', 'generationWrites', 'generationTabMeta']) w[key] = new Map();
  w.generationCatalog = catalog;
  w.generationDrafts.set(identity.key, draftFor(catalog.find(row => row.id === modelId)));
  w.model = { snapshot: { kind: 'cut', itemId: identity.itemId, sourcePath: identity.sourcePath, outputStart: 0, outputEnd: 6 } };
  w.currentTab = 'generation'; w.body = new Element('div'); w.render = () => w.syncGenerationFramePick();
  w.scheduleGenerationDraftWrite = () => {}; w.generationThumbnail = async () => undefined;
  w.calls = []; w.notices = []; w.showFieldNotice = text => w.notices.push(text);
  w.layerAudioService = { validateGenerationInputs: request => { w.calls.push(structuredClone(request)); return service.validateGenerationInputs(request); }, writeGenerationDraft: request => service.writeGenerationDraft(request) };
  return w;
}
function fieldsFor(w) {
  const current = w.generationDrafts.get(identity.key);
  return generationFields({ ...defaultsFor(current), validation: w.generationValidations.get(identity.key),
    defaults: { catalog, state: w.generationStates.get(identity.key) },
    actions: { ...defaultsFor(current).actions, update: (key, value) => w.updateGenerationDraft(identity, key, value) } });
}

for (const model of catalog) {
  test(`実カタログ ${model.id}: family 切替・参照種類・validator カウンタ・null 上限・警告`, async () => {
    const w = harness(model.id); await w.validateGenerationDraft(identity.key);
    const fields = fieldsFor(w), validation = w.generationValidations.get(identity.key);
    const pairFamilies = ['MiniMax H3', 'Seedance 2.0', 'Veo 3.1']; // actual family has flf + ref, independent of endpoint spelling
    const paired = pairFamilies.includes(model.family);
    assert.equal(fields.some(field => field.generationMode), paired);
    const showGrid = !paired || generationFields.modelSide(model) === 'references';
    const grid = fields.find(field => field.generationReferences)?.generationReferences;
    assert.equal(!!grid, showGrid);
    if (grid) {
      const accepted = kinds.filter(slot => model.inputs[slot].max !== 0);
      assert.deepEqual(grid.kinds.map(kind => kind.slot), accepted);
      assert.equal(grid.counter, accepted.map(slot => {
        const stats = validation.references[slot], label = labels[kinds.indexOf(slot)];
        return `${label} ${stats.count}${stats.max === null ? '' : ` / ${stats.max}`}`;
      }).join(' · '));
      assert.deepEqual(grid.entries.map(entry => entry.badge), ['@画像1', '@画像2', '@動画1', '@音声1']);
      for (const slot of kinds) {
        const label = labels[kinds.indexOf(slot)];
        assert.equal(grid.notes.includes(`${label}: 上限はモデル側に記載なし`), model.inputs[slot].max === null);
        assert.equal(grid.entries.filter(entry => entry.slot === slot).every(entry => entry.unsupported), model.inputs[slot].max === 0);
        assert.equal(grid.notes.some(note => note.includes(`このモデルは${label}の参照を使えません`)), model.inputs[slot].max === 0);
      }
    }
    if (paired) {
      const before = structuredClone(w.generationDrafts.get(identity.key).inputs);
      const other = generationFields.modelSide(model) === 'references' ? 'frames' : 'references';
      await fields.find(field => field.generationMode).write({}, other === 'references' ? '参照' : '最初 / 最後');
      const after = w.generationDrafts.get(identity.key);
      const target = catalog.find(row => row.family === model.family && generationFields.modelSide(row) === other);
      assert.equal(after.modelId, target.id); assert.equal(after.inputs.frames_or_refs, other);
      for (const slot of ['first_frame', 'last_frame', ...kinds]) assert.deepEqual(after.inputs[slot], before[slot]);
      const frames = fieldsFor(w).filter(field => field.generationFrame);
      assert.equal(frames.length, other === 'frames' ? 2 : 0);
    }
  });
}

test('実カタログ全 video 行: 参照の送り方の未実装注記は Veo reference だけに出る', () => {
  const note = 'このモデルの参照の送り方はまだ用意されていません。送ると止まります。';
  for (const model of catalog) {
    const current = draftFor(model);
    current.inputs.reference_videos = []; current.inputs.reference_audios = [];
    const validation = validateInputs({ ...current, model });
    const fields = generationFields({ ...defaultsFor(current), validation });
    const notes = fields.find(field => field.generationReferences)?.generationReferences.notes ?? [];
    assert.equal(notes.includes(note), model.id === 'fal:veo-3.1-ref', model.id);
    if (model.id === 'fal:veo-3.1-ref') {
      assert.equal(validation.ok, true);
      assert.equal(fields.find(field => field.name === 'generation-actions').actions.find(action => action.name === 'generate').disabled, false);
    }
  }
});

test('応答なしの送信は従来どおり有効、グリッド・切替はロックを維持する', () => {
  const current = draftFor(catalog.find(row => row.id === 'fal:h3-ref'));
  for (const state of ['planned', 'generating', 'stale']) for (const ok of [true, false]) {
    const fields = generationFields({ ...defaultsFor(current), validation: { ok }, defaults: { catalog, state } });
    const generate = fields.find(field => field.name === 'generation-actions').actions.find(action => action.name === 'generate');
    assert.equal(generate.disabled, state === 'generating' || !ok, `${state}: validation.ok=${ok}`);
    for (const field of fields.filter(field => field.generationReferences || field.generationMode)) {
      assert.equal(field.disabled, state === 'generating' || state === 'stale', `${state}: ${field.name}`);
    }
  }
});

test('相方の ID 命名に依存せず、モデル select 直選択で frames_or_refs を同期する', async () => {
  const w = harness(); const current = w.generationDrafts.get(identity.key);
  w.generationCatalog = catalog.map(row => ({ ...row, id: row.id === 'fal:h3-ref' ? 'custom:partner' : row.id }));
  const pair = generationFields.pairedModels(catalog[0], w.generationCatalog);
  assert.equal(pair.references.id, 'custom:partner');
  // Validation uses the real catalog, so test model selection with a valid real id afterwards.
  w.generationCatalog = catalog;
  const select = fieldsFor(w).find(field => field.name === 'generation-model');
  await select.write({}, generation.generationFactLabel(catalog.find(row => row.id === 'fal:h3-ref')));
  assert.equal(w.generationDrafts.get(identity.key).inputs.frames_or_refs, 'references');
  await fieldsFor(w).find(field => field.name === 'generation-model').write({}, generation.generationFactLabel(catalog[0]));
  assert.equal(w.generationDrafts.get(identity.key).inputs.frames_or_refs, 'frames');
  for (const slot of ['first_frame', 'last_frame', ...kinds]) assert.deepEqual(w.generationDrafts.get(identity.key).inputs[slot], current.inputs[slot]);
});

test('カウンタ・秒数は validator の返り値を表示し、UI で再集計しない', () => {
  const current = draftFor(catalog.find(row => row.id === 'fal:h3-ref'));
  const validation = validateInputs({ ...current, model: catalog.find(row => row.id === current.modelId) });
  validation.references.reference_images.count = 7;
  validation.references.reference_videos.seconds_total = 14;
  const grid = generationFields({ ...defaultsFor(current), validation }).find(field => field.generationReferences).generationReferences;
  assert.match(grid.counter, /画像 7 \/ 9/u); assert.ok(grid.notes.includes('動画 14 / 15 秒'));
});

test('受けない音声: Kling は validate error と送信 disabled、frames 側は send_side で除外', async () => {
  const w = harness('fal:kling-v3-standard-i2v'); await w.validateGenerationDraft(identity.key);
  const validation = w.generationValidations.get(identity.key), fields = fieldsFor(w);
  assert.equal(validation.ok, false); assert.ok(validation.messages.some(message => message.code === 'reference_audios.max'));
  assert.equal(fields.find(field => field.name === 'generation-message').getValue({}), validation.messages.find(message => message.level === 'error').text);
  assert.equal(fields.find(field => field.name === 'generation-actions').actions.find(action => action.name === 'generate').disabled, true);
  const mapped = getAdapter('fal:kling-v3-standard-i2v').map(validation.normalized.inputs, validation.normalized.output, { resolveMedia: () => 'data:image/png;base64,YQ==' });
  assert.equal(mapped.ok, false);
  await w.updateGenerationDraft(identity, 'modelId', 'fal:h3-i2v');
  const frames = w.generationValidations.get(identity.key);
  assert.equal(frames.send_side, 'frames'); assert.deepEqual(frames.normalized.inputs.reference_audios, []);
  assert.equal(w.generationDrafts.get(identity.key).inputs.reference_audios.length, 1);
});

async function renderPicker({ state, slot = 'reference_images' } = {}) {
  const w = harness('fal:h3-ref'); w.generationStates.set(identity.key, state);
  await w.validateGenerationDraft(identity.key);
  const pending = deferred(); w.pickCalls = [];
  w.commandRegistry = { getCommand: () => ({}), executeCommand: (...args) => { w.pickCalls.push(args); return pending.promise; } };
  const root = { toString: () => 'file:///project', resolve: value => ({ toString: () => `file:///project/${value}` }) };
  w.workspaceService = { tryGetRoots: () => [{ resource: root }] };
  w.durationCalls = [];
  w.layerAudioService.getAudioDuration = async request => { w.durationCalls.push(request); return { status: 'ready', durationSeconds: 8 }; };
  w.appendRow(w.body, fieldsFor(w).find(field => field.generationReferences), w.model.snapshot, 'cut');
  const all = w.body.all(), add = all.find(node => node.attributes.has('data-akari-generation-reference-add'));
  all.find(node => node.tag === 'select').value = slot;
  return { w, pending, add, all };
}

test('＋追加は既存選択と総上限を渡し、配列順・種類ごとの札・挿入順・× を保持する', async () => {
  const { w, pending, add } = await renderPicker(); add.listeners.get('click')();
  assert.deepEqual(w.pickCalls[0], [mirror.GENERATION_PICK_INTO_COMMAND_ID, {
    slot: 'reference_images', label: '参照画像', accepts: ['image'], multi: true, selected: ['one.png', 'two.png'], max: 9
  }]);
  pending.resolve({ status: 'picked', paths: ['one.png', 'two.png', 'three.png'] }); await waitPick(w);
  const gridField = fieldsFor(w).find(field => field.generationReferences);
  assert.deepEqual(gridField.generationReferences.entries.map(entry => entry.badge), ['@画像1', '@画像2', '@動画1', '@音声1', '@画像3']);
  await gridField.write({}, JSON.stringify({ slot: 'reference_images', index: 0 }));
  assert.deepEqual(w.generationDrafts.get(identity.key).inputs.reference_images.map(ref => ref.path), ['two.png', 'three.png']);
  assert.deepEqual(fieldsFor(w).find(field => field.generationReferences).generationReferences.entries.filter(entry => entry.slot === 'reference_images').map(entry => entry.badge), ['@画像1', '@画像2']);
});

for (const slot of ['reference_videos', 'reference_audios']) for (const duration of ['ready', 'unavailable', 'throws']) {
  test(`${slot}: 実尺 ${duration} の range_s`, async () => {
    const { w, pending, add } = await renderPicker({ slot });
    if (duration === 'unavailable') w.layerAudioService.getAudioDuration = async () => ({ status: 'unavailable' });
    if (duration === 'throws') w.layerAudioService.getAudioDuration = async () => { throw new Error('probe unavailable'); };
    add.listeners.get('click')();
    const media = slot === 'reference_videos' ? 'new.MOV' : 'new.FLAC';
    pending.resolve({ status: 'picked', paths: [media] }); await waitPick(w);
    const value = w.generationDrafts.get(identity.key).inputs[slot][0];
    assert.deepEqual(value, { path: media, ...(duration === 'ready' ? { range_s: [0, 8] } : {}) });
    assert.equal(w.generationValidations.get(identity.key).references[slot].seconds_total, duration === 'ready' ? 8 : 0);
  });
}

test('実尺で H3 1 本 / 合計 15 秒超のエラーを表示する', async () => {
  const { w, pending, add } = await renderPicker({ slot: 'reference_videos' });
  w.layerAudioService.getAudioDuration = async () => ({ status: 'ready', durationSeconds: 16 });
  add.listeners.get('click')(); pending.resolve({ status: 'picked', paths: ['long.mp4'] }); await waitPick(w);
  const result = w.generationValidations.get(identity.key);
  assert.equal(result.ok, false);
  for (const code of ['reference_videos.seconds_each', 'reference_videos.seconds_total']) assert.ok(result.messages.some(message => message.code === code));
  assert.match(fieldsFor(w).find(field => field.name === 'generation-message').getValue({}), /15 秒/);
});

for (const trigger of ['cancel', 'clip', 'tab', 'model', 'dispose', 'generating', 'newer draft']) {
  test(`参照選択 ${trigger} 後の遅延結果は保存しない`, async () => {
    const { w, pending, add } = await renderPicker(); add.listeners.get('click')();
    if (trigger === 'clip') { w.model.snapshot.itemId = 'other'; w.syncGenerationFramePick(); w.model.snapshot.itemId = 'clip-a'; }
    if (trigger === 'tab') { w.currentTab = 'info'; w.syncGenerationFramePick(); w.currentTab = 'generation'; }
    if (trigger === 'model') await w.updateGenerationDraft(identity, 'modelId', 'fal:h3-i2v');
    if (trigger === 'dispose') w.isDisposed = true;
    if (trigger === 'generating') w.generationStates.set(identity.key, 'generating');
    if (trigger === 'newer draft') await w.updateGenerationDraft(identity, 'inputs.reference_images', [{ path: 'newer.png' }]);
    const before = structuredClone(w.generationDrafts.get(identity.key));
    pending.resolve(trigger === 'cancel' ? { status: 'cancelled' } : { status: 'picked', paths: ['late.png'] }); await waitPick(w);
    assert.deepEqual(w.generationDrafts.get(identity.key), before);
  });
}
for (const state of ['generating', 'stale']) test(`${state}: グリッドは見え、＋追加・×・切替は disabled`, async () => {
  const { w, add, all } = await renderPicker({ state });
  assert.ok(all.some(node => node.className === 'akari-inspector-generation-reference-card'));
  assert.equal(add.disabled, true); add.listeners.get('click')();
  const removes = all.filter(node => node.attributes.has('data-akari-generation-reference-remove'));
  assert.equal(removes.length, 4); assert.ok(removes.every(node => node.disabled));
  const before = structuredClone(w.generationDrafts.get(identity.key));
  removes[0].listeners.get('click')(); await settle();
  assert.deepEqual(w.generationDrafts.get(identity.key), before); assert.equal(w.pickCalls.length, 0);
  assert.equal(fieldsFor(w).find(field => field.generationMode).disabled, true);
});

test('H3 first + 画像2枚 → 参照 → validateGenerationInputs → next → 偽 CLI の送信 body', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-references-cli-'));
  try {
    const w = harness(); const current = w.generationDrafts.get(identity.key);
    current.inputs.reference_videos = []; current.inputs.reference_audios = [];
    const uri = value => ({ toString: () => pathToFileURL(value).toString() });
    w.workspaceService = { ready: Promise.resolve(), tryGetRoots: () => [{ resource: uri(root) }] };
    await writeFile(path.join(root, 'edit.json'), JSON.stringify({ version: 2, output: { width: 1280, height: 720, fps: 30 },
      sources: [{ id: 's', path: 'first.png' }], tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'clip-a', at: 0, duration: 180, source: { kind: 'media', src: 's', in: 0, out: 6 } }] }], audio: { narration: [], sfx: [] } }));
    for (const name of ['first.png', 'last.png', 'one.png', 'two.png']) await copyFile(new URL('../../../../../packages/generate/test/fixtures/cli-video/assets/stills/start.png', import.meta.url), path.join(root, name));
    await writeFile(path.join(root, 'first.png.meta.json'), JSON.stringify({ version: 1, kind: 'still', status: 'done' }));
    await fieldsFor(w).find(field => field.generationMode).write({}, '参照');
    assert.equal(w.calls.at(-1).modelId, 'fal:h3-ref'); assert.equal(w.calls.at(-1).inputs.frames_or_refs, 'references');
    const validation = w.generationValidations.get(identity.key);
    assert.equal(validation.ok, true); assert.equal(validation.send_side, 'references');
    assert.equal(validation.normalized.inputs.first_frame, null); assert.equal(validation.normalized.inputs.last_frame, null);
    await w.persistGenerationDraft(identity);
    const next = JSON.parse(await readFile(path.join(root, 'first.png.meta.json'), 'utf8')).next;
    assert.equal(next.inputs.first_frame.path, 'first.png'); assert.equal(next.inputs.reference_images.length, 2);
    const fake = path.join(root, 'fake.mjs');
    await writeFile(fake, `import {readFile,writeFile} from 'node:fs/promises';
import {runVideoCommand} from ${JSON.stringify(new URL('../../../../../packages/generate/src/cli/video.mjs', import.meta.url).href)};
const args=process.argv.slice(2), lines=[];
const result=await runVideoCommand([...args.slice(2),'--dry-run'],{log:line=>lines.push(line),errorLog:line=>console.error(line)});
const next=JSON.parse(await readFile(${JSON.stringify(path.join(root, 'first.png.meta.json'))},'utf8')).next;
await writeFile(${JSON.stringify(path.join(root, 'invocation.json'))},JSON.stringify({args,next,lines,result}));
process.exitCode=result.exitCode;`);
    const cli = new GenerationCliManager({ env: { ...process.env, AKARI_GENERATE_CLI: fake, AKARI_HOME: path.join(root, 'home') } });
    const result = await cli.start(root, 'clip-a'); assert.equal(result.ok, true, result.stderr);
    const invocation = JSON.parse(await readFile(path.join(root, 'invocation.json'), 'utf8'));
    assert.equal(invocation.args.includes('--inputs'), false); assert.ok(invocation.args.includes('--yes'));
    assert.equal(invocation.next.inputs.frames_or_refs, 'references');
    const body = JSON.parse(invocation.lines.find(line => line.startsWith('{'))).body;
    assert.equal(body.reference_image_urls.length, 2); assert.equal(body.image_url, undefined); assert.equal(body.first_frame, undefined); assert.equal(body.last_image_url, undefined);
    assert.equal(body.prompt, 'Move Image 1 beside Image 2.');
    // Unimplemented Veo reference is refused by the real CLI; the existing widget
    // submission flow passes its reason to the right-panel notice.
    assert.equal(getAdapter('fal:veo-3.1-ref'), undefined);
    await w.updateGenerationDraft(identity, 'modelId', 'fal:veo-3.1-ref');
    assert.equal(w.generationValidations.get(identity.key).ok, true);
    w.generationLoads = new Set(); w.loadGeneration = async () => {};
    const finished = deferred();
    w.layerAudioService.startGenerateVideo = async request => {
      assert.equal(request.approved, true);
      const result = await cli.start(root, request.itemId); finished.resolve(result); return result;
    };
    await w.confirmAndStartGeneration(identity);
    const refused = await finished.promise; await settle();
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /アダプタがありません.*fal:veo-3.1-ref/u);
    assert.ok(w.notices.some(text => text === refused.reason));
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('保存後の meta 再読込でも種類をまたぐ挿入順を保つ', () => {
  const inputs = { reference_images: [{ path: 'a.png' }], reference_videos: [{ path: 'v.mp4' }] };
  generationFields.rememberReferences(inputs);
  inputs.reference_images.push({ path: 'b.png' });
  generationFields.rememberReferences(inputs);
  const restored = JSON.parse(JSON.stringify(inputs));
  generationFields.rememberReferences(restored, inputs);
  const current = { ...draftFor(catalog.find(row => row.id === 'fal:h3-ref')), inputs: restored };
  assert.deepEqual(generationFields(defaultsFor(current)).find(field => field.generationReferences).generationReferences.entries.map(entry => entry.badge), ['@画像1', '@動画1', '@画像2']);
});

test('素材パネルと同じ拡張子分類・不明な種類は選ばない', () => {
  for (const [extensions, slot] of [
    ['mp4 mov m4v webm mkv avi', 'reference_videos'], ['wav mp3 m4a aac flac ogg', 'reference_audios'],
    ['png jpg jpeg gif webp', 'reference_images']
  ]) for (const extension of extensions.split(' ')) assert.equal(generationFields.referenceSlot(`file.${extension.toUpperCase()}`), slot);
  for (const extension of ['html', 'json', 'bmp', 'tiff', 'png.txt']) assert.equal(generationFields.referenceSlot(`file.${extension}`), undefined);
});

test('受け側から違う種類が返ったら下書きを変更せずエラーを表示', async () => {
  const { w, pending, add } = await renderPicker(); const before = structuredClone(w.generationDrafts.get(identity.key));
  add.listeners.get('click')(); pending.resolve({ status: 'picked', paths: ['unexpected.mp4'] }); await waitPick(w);
  assert.deepEqual(w.generationDrafts.get(identity.key), before);
  assert.match(w.generationFramePickMessage.text, /選べない素材/);
});

test('duration RPC の処理中にモデルを切り替えても遅延結果を保存しない', async () => {
  const { w, pending, add } = await renderPicker({ slot: 'reference_audios' });
  const duration = deferred(), started = deferred();
  w.layerAudioService.getAudioDuration = () => { started.resolve(); return duration.promise; };
  add.listeners.get('click')(); pending.resolve({ status: 'picked', paths: ['new.wav'] }); await started.promise;
  await w.updateGenerationDraft(identity, 'modelId', 'fal:h3-i2v');
  const before = structuredClone(w.generationDrafts.get(identity.key));
  duration.resolve({ status: 'ready', durationSeconds: 8 }); await settle();
  assert.deepEqual(w.generationDrafts.get(identity.key), before);
});


test('種類横断の挿入順はローカル UI 状態から復元し、別 workspace/item と混同しない', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const saved = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value)
  } } });
  try {
    const inputs = { reference_images: [{ path: 'a.png' }], reference_videos: [{ path: 'v.mp4' }] };
    generationFields.rememberReferences(inputs, undefined, 'project#item');
    const next = { ...inputs, reference_images: [...inputs.reference_images, { path: 'b.png' }] };
    generationFields.rememberReferences(next, inputs);
    const restored = JSON.parse(JSON.stringify(next));
    generationFields.rememberReferences(restored, undefined, 'project#item');
    const order = inputs => generationFields(defaultsFor({ ...draftFor(catalog.find(row => row.id === 'fal:h3-ref')), inputs }))
      .find(field => field.generationReferences).generationReferences.entries.map(entry => entry.reference.path);
    assert.deepEqual(order(restored), ['a.png', 'v.mp4', 'b.png']);
    const other = JSON.parse(JSON.stringify(next)); generationFields.rememberReferences(other, undefined, 'other#item');
    assert.deepEqual(order(other), ['a.png', 'b.png', 'v.mp4']);
    assert.deepEqual(Object.keys(next).sort(), ['reference_images', 'reference_videos']);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else delete globalThis.window;
  }
});


test('同じパスを含む既存下書きでも × は指定した1枚だけ外す', async () => {
  const w = harness('fal:h3-ref');
  w.generationDrafts.get(identity.key).inputs.reference_images = [{ path: 'same.png', name: 'first' }, { path: 'same.png', name: 'second' }];
  await w.validateGenerationDraft(identity.key);
  const field = fieldsFor(w).find(field => field.generationReferences);
  await field.write({}, JSON.stringify({ slot: 'reference_images', index: 1 }));
  assert.deepEqual(w.generationDrafts.get(identity.key).inputs.reference_images, [{ path: 'same.png', name: 'first' }]);
});


test('保存監視による同じ下書きの再読込は素材選択の結果を捨てない', async () => {
  const { w, pending, add } = await renderPicker(); add.listeners.get('click')();
  w.generationDrafts.set(identity.key, structuredClone(w.generationDrafts.get(identity.key)));
  pending.resolve({ status: 'picked', paths: ['selected.png'] }); await waitPick(w);
  assert.deepEqual(w.generationDrafts.get(identity.key).inputs.reference_images, [{ path: 'selected.png' }]);
});
