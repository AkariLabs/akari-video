import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { appendAiStillPanel, stillAspects, stillCroppedNotice, stillRouteAvailability } from '../lib/browser/inspector/ai-still-panel.js';
import { frameDimensions } from '../lib/browser/inspector/frame-geometry.js';
import { stillAspectText, stillCropPlan, StillGenerationManager } from '../lib/node/still-generation.js';
import { validateGenerationMeta } from '../../../../../packages/generate/src/cli/meta-validate.mjs';
import { doneStillMeta } from '../../../../../packages/generate/src/cli/meta-still.mjs';

const repo = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const bins = fileURLToPath(new URL('./fixtures/ai-still-routes-bin/', import.meta.url));
const findAsset = async path => join(repo, path);
const canonicalValidator = join(repo, 'packages/schemas/bin/validate-generation-meta.mjs');
const assertCanonicalMeta = path => assert.match(
  execFileSync(process.execPath, [canonicalValidator, path], { encoding: 'utf8' }), /^OK:/u);
const png = (width, height) => {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
};
async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'akari-still-ref-'));
  await mkdir(join(dir, 'assets/generated'), { recursive: true });
  await writeFile(join(dir, 'assets/generated/old.png'), png(160, 90));
  await writeFile(join(dir, 'assets/generated/ref.png'), png(32, 32));
  await writeFile(join(dir, 'assets/generated/note.txt'), 'text');
  await writeFile(join(dir, 'edit.json'), JSON.stringify({ version: 2, output: { fps: 30 },
    sources: [{ id: 'old', path: 'assets/generated/old.png' }],
    tracks: [{ items: [{ id: 'clip-1', duration: 90, source: { kind: 'media', src: 'old' } }] }] }));
  return dir;
}
function manager(overrides = {}) {
  const { env: extraEnv, ...options } = overrides;
  return new StillGenerationManager(findAsset, { env: { ...process.env,
    AKARI_CODEX_BIN: join(bins, 'codex'), AKARI_GROK_BIN: join(bins, 'grok'), AKARI_AGY_BIN: join(bins, 'agy'),
    ...extraEnv }, ...options });
}
const request = { projectRootUri: 'unused', itemId: 'clip-1', prompt: 'garden', aspect: '16:9' };

test('参照 0・1・2 枚と 3 手段の可否はカタログの上限に従う', () => {
  for (const count of [0, 1, 2]) {
    for (const route of ['codex', 'grok', 'antigravity']) {
      const actual = stillRouteAvailability(route, count);
      assert.equal(actual.disabled, route === 'antigravity' ? count > 0 : route === 'grok' ? count > 1 : false);
      assert.equal(actual.note, route === 'grok' && count > 0 ? '参照は縮めて送られます' : undefined);
    }
  }
  assert.equal(stillRouteAvailability('antigravity', 1).reason, 'この手段は画像を受け取れません');
  assert.equal(stillRouteAvailability('grok', 2).reason, 'Grok は 1 枚まで');
  assert.equal(stillRouteAvailability('grok', 1).note, '参照は縮めて送られます');
});

test('参照欄の選択・撮影・削除と手段の理由、画角と切りそろえの data 属性', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.style = {}; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
  }
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true,
    value: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
  try {
    const state = { prompt: 'garden', aspect: '9:16', routeId: 'codex', probing: false, running: false,
      references: [{ path: 'assets/ref.png', thumbnail: 'data:image/png;base64,a' }], cropToAspect: true,
      choosingReference: true, availableReferences: ['assets/other.png'], croppedNotice: 'done',
      routes: ['codex', 'grok', 'antigravity'].map(id => ({ id, state: 'ready', detail: '' })) };
    const calls = [];
    const root = new Node('root');
    appendAiStillPanel(root, state, { change() { calls.push('change'); }, probe() {}, generate() {}, cancel() {},
      addReference(path) { calls.push(path); }, chooseReference() { calls.push('pick'); }, captureReference() { calls.push('capture'); } });
    const walk = node => [node, ...node.children.flatMap(walk)];
    const nodes = walk(root);
    const by = name => nodes.find(node => node.attributes.has(name));
    assert.ok(by('data-akari-inspector-ai-references'));
    const drop = by('data-akari-inspector-ai-reference-drop');
    assert.ok(drop);
    for (const type of ['dragenter', 'dragover']) {
      for (const [types, accepted] of [[['application/x-akari-material'], true], [['Files'], false]]) {
        const transfer = { types, dropEffect: 'none' };
        let prevented = 0, stopped = 0;
        drop.listeners.get(type)({ dataTransfer: transfer,
          preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
        assert.equal(prevented, Number(accepted), `${type}: ${types}`);
        assert.equal(stopped, Number(accepted), `${type}: ${types}`);
        assert.equal(transfer.dropEffect, accepted ? 'copy' : 'none', `${type}: ${types}`);
      }
    }
    assert.ok(by('data-akari-inspector-ai-reference-thumbnail'));
    assert.ok(by('data-akari-inspector-ai-reference-remove'));
    assert.ok(by('data-akari-inspector-ai-reference-list'));
    assert.ok(by('data-akari-inspector-ai-route-reason'));
    assert.ok(by('data-akari-inspector-ai-route-note'));
    assert.equal(nodes.filter(node => node.attributes.has('data-akari-inspector-ai-aspect')).length, 8);
    assert.ok(by('data-akari-inspector-ai-crop'));
    assert.ok(by('data-akari-inspector-ai-cropped'));
    by('data-akari-inspector-ai-reference-pick').listeners.get('click')();
    by('data-akari-inspector-ai-reference-capture').listeners.get('click')();
    by('data-akari-inspector-ai-reference-option').listeners.get('click')();
    by('data-akari-inspector-ai-reference-remove').listeners.get('click')();
    assert.deepEqual(calls, ['pick', 'capture', 'assets/other.png', 'change']);
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete globalThis.document;
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete globalThis.localStorage;
  }
});

test('参照パスは実在・画像拡張子・プロジェクト境界を検査する', async () => {
  const dir = await project();
  try {
    for (const references of [['../outside.png'], ['missing.png'], ['assets/generated/note.txt'], [join(tmpdir(), 'outside.png')]]) {
      const result = await manager().startGenerateStill(dir, { ...request, references });
      assert.equal(result.ok, false, references[0]);
    }
    const rejected = await manager().startGenerateStill(dir, { ...request, route: 'antigravity', references: ['assets/generated/ref.png'] });
    assert.equal(rejected.ok, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Codex の turn/start へ localImage、Grok の指示へ image_edit と絶対パスを渡し meta に記録', async () => {
  const dir = await project();
  try {
    const turns = [];
    const spawnProcess = (command, args, options) => {
      const child = spawn(command, args, options);
      if (args[0] === 'app-server') {
        const write = child.stdin.write.bind(child.stdin);
        child.stdin.write = (chunk, ...rest) => {
          const message = JSON.parse(String(chunk));
          if (message.method === 'turn/start') turns.push(message.params);
          return write(chunk, ...rest);
        };
      }
      return child;
    };
    const references = ['assets/generated/ref.png'];
    const codex = await manager({ spawnProcess }).startGenerateStill(dir, { ...request, references });
    assert.equal(codex.ok, true, codex.reason);
    assert.deepEqual(turns[0].input[1], { type: 'localImage', path: await realpath(join(dir, references[0])) });
    assert.match(turns[0].input[0].text, /参照画像の人物・物・色を保って/u);
    const meta = JSON.parse(await readFile(join(dir, `${codex.relativePath}.meta.json`), 'utf8'));
    assert.deepEqual(meta.inputs.reference_images, [{ path: references[0],
      sha256: createHash('sha256').update(await readFile(join(dir, references[0]))).digest('hex') }]);
    assert.deepEqual(validateGenerationMeta(meta), { ok: true, errors: [] });
    assertCanonicalMeta(join(dir, `${codex.relativePath}.meta.json`));

    const log = join(dir, 'calls.jsonl');
    const grok = await manager({ env: { FAKE_IMAGE_LOG: log } }).startGenerateStill(dir, { ...request, route: 'grok', references });
    assert.equal(grok.ok, true, grok.reason);
    const call = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse).find(row => row.args[0] === '-p');
    assert.match(call.args[1], /image_edit/u);
    assert.match(call.args[1], /aspect_ratio に 16:9/u);
    assert.ok(call.args[1].includes(await realpath(join(dir, references[0]))));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8 画角の寸法と切りそろえ閾値', () => {
  assert.deepEqual(stillAspects, ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '3:2', '21:9']);
  for (const aspect of stillAspects) {
    const [w, h] = aspect.split(':').map(Number);
    const size = frameDimensions(aspect, { width: 1920, height: 1080 });
    assert.ok(Math.abs(size.width / size.height / (w / h) - 1) < .003, aspect);
    assert.ok(stillAspectText[aspect].includes(aspect));
  }
  assert.deepEqual(stillCropPlan(1254, 1254, '9:16'), { width: 705, height: 1254, filter: 'crop=705:1254:274:0' });
  assert.equal(stillCroppedNotice('9:16', '1254x1254'), '9:16 を頼んで 正方形 → 切りそろえました');
  assert.equal(stillCropPlan(1376, 768, '16:9'), undefined);
});

test('Grok の aspect_ratio には 8 種とも選択値を渡す', async () => {
  const dir = await project();
  try {
    const log = join(dir, 'calls.jsonl');
    for (const aspect of stillAspects) {
      const result = await manager({ env: { FAKE_IMAGE_LOG: log } }).startGenerateStill(dir,
        { ...request, route: 'grok', aspect, cropToAspect: false });
      assert.equal(result.ok, true, `${aspect}: ${result.reason}`);
    }
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(call => stillAspects.find(aspect => call.args[1]?.includes(`aspect_ratio に ${aspect}`))), stillAspects);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('切りそろえオンはフィルタと cropped_from を記録し、オフは元寸法のまま', async () => {
  const dir = await project();
  try {
    const filters = [];
    const cropPng = async (_input, output, filter) => {
      filters.push(filter);
      const [, width, height] = /^crop=(\d+):(\d+):/u.exec(filter);
      await writeFile(output, png(Number(width), Number(height)));
    };
    const on = await manager({ cropPng }).startGenerateStill(dir, { ...request, aspect: '9:16' });
    assert.equal(on.ok, true, on.reason);
    assert.equal(on.croppedFrom, '160x90');
    assert.deepEqual([on.width, on.height], [51, 90]);
    assert.deepEqual(filters, ['crop=51:90:54:0']);
    const meta = JSON.parse(await readFile(join(dir, `${on.relativePath}.meta.json`), 'utf8'));
    assert.equal('cropped_from' in meta.output, false);
    assert.match(meta.history.find(entry => entry.status === 'done').reason, /cropped_from=160x90 → 51x90（9:16）/u);
    assert.deepEqual(validateGenerationMeta(meta), { ok: true, errors: [] });
    assertCanonicalMeta(join(dir, `${on.relativePath}.meta.json`));
    const off = await manager({ cropPng }).startGenerateStill(dir, { ...request, aspect: '9:16', cropToAspect: false });
    assert.equal(off.ok, true, off.reason);
    assert.deepEqual([off.width, off.height], [160, 90]);
    assert.equal(off.croppedFrom, undefined);
    const offMeta = JSON.parse(await readFile(join(dir, `${off.relativePath}.meta.json`), 'utf8'));
    assert.equal(offMeta.history.find(entry => entry.status === 'done').reason, null);
    assert.equal('cropped_from' in offMeta.output, false);
    assertCanonicalMeta(join(dir, `${off.relativePath}.meta.json`));
    assert.equal(filters.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('1254x1254 の切りそろえ理由は正典スキーマ内に記録される', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-cropped-meta-'));
  try {
    const at = new Date().toISOString();
    const meta = doneStillMeta({ prompt: 'garden', duration_s: 3, at, asOf: at.slice(0, 10),
      path: 'assets/generated/still.png', image: { width: 705, height: 1254, bytes: 24, sha256: 'a'.repeat(64) },
      croppedFrom: '1254x1254', aspect: '9:16' });
    assert.match(meta.history.find(entry => entry.status === 'done').reason,
      /cropped_from=1254x1254 → 705x1254（9:16）/u);
    assert.equal('cropped_from' in meta.output, false);
    const path = join(dir, 'still.png.meta.json');
    await writeFile(path, JSON.stringify(meta));
    assertCanonicalMeta(path);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
