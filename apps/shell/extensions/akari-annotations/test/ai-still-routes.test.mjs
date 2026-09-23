import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { StillGenerationManager } from '../lib/node/still-generation.js';
import { appendAiStillPanel, savedStillRoute } from '../lib/browser/inspector/ai-still-panel.js';
import { validateGenerationMeta } from '../../../../../packages/generate/src/cli/meta-validate.mjs';

const repo = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const bin = fileURLToPath(new URL('./fixtures/ai-still-routes-bin/', import.meta.url));
const findAsset = async path => join(repo, path);
const request = { projectRootUri: 'unused', itemId: 'clip-1', prompt: 'A garden', aspect: '16:9' };

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'akari-routes-'));
  await mkdir(join(dir, 'assets/generated'), { recursive: true });
  await writeFile(join(dir, 'edit.json'), JSON.stringify({ version: 2, output: { fps: 30 },
    sources: [{ id: 'old', path: 'assets/generated/old.png' }],
    tracks: [{ items: [{ id: 'clip-1', duration: 90, source: { kind: 'media', src: 'old' } }] }] }));
  await writeFile(join(dir, 'assets/generated/old.png.meta.json'), JSON.stringify({ next: {
    kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: { prompt: 'motion', negative_prompt: null, first_frame: { path: 'assets/generated/old.png' }, last_frame: null,
      reference_images: [], reference_videos: [], reference_audios: [], source_video: null, camera: null,
      seed: null, extra: {}, frames_or_refs: 'frames' },
    output: { duration_s: 3, resolution: null, aspect: null, audio_out: null }, updated_at: new Date().toISOString()
  } }));
  return dir;
}
function manager(dir, overrides = {}, probeTimeoutMs = 5000) {
  return new StillGenerationManager(findAsset, { env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`,
    FAKE_IMAGE_STATE_FILE: join(dir, 'image-state'), FAKE_IMAGE_LOG: join(dir, 'calls.jsonl'),
    AKARI_CODEX_BIN: join(bin, 'codex'), AKARI_AGY_BIN: join(bin, 'agy'), AKARI_GROK_BIN: join(bin, 'grok'),
    ...overrides }, probeTimeoutMs });
}

test('3 手段の ready / signed-out / missing と Grok の一回再確認', async () => {
  const dir = await workspace();
  try {
    const states = await manager(dir, {}, 60_000).probeImageRoutes();
    assert.deepEqual(states.map(x => [x.id, x.state]), [['codex', 'ready'], ['antigravity', 'ready'], ['grok', 'ready']]);
    await writeFile(join(dir, 'image-state'), 'signed-out');
    const out = await manager(dir, {}, 60_000).probeImageRoutes();
    assert.deepEqual(out.map(x => x.state), ['ready', 'signed-out', 'signed-out']);
    assert.ok(out.every(x => !x.detail.includes('@')));
    const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter(x => x.route === 'grok' && x.args[0] === 'models').length, 3);
    await writeFile(join(dir, 'image-state'), 'transient');
    assert.equal((await manager(dir, {}, 60_000).probeImageRoutes())[2].state, 'ready');
    const missing = await manager(dir, { AKARI_CODEX_BIN: join(dir, 'no-codex'), AKARI_AGY_BIN: join(dir, 'no-agy'), AKARI_GROK_BIN: join(dir, 'no-grok') }).probeImageRoutes();
    assert.ok(missing.every(x => x.state === 'missing'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('各手段の probe は 5 秒で打ち切り、鍵を外す', async () => {
  const dir = await workspace();
  try {
    await writeFile(join(dir, 'image-state'), 'sleep');
    const started = Date.now();
    const states = await manager(dir, { FAL_KEY: 'secret', GROQ_API_KEY: 'secret', OPENAI_API_KEY: 'secret',
      GEMINI_API_KEY: 'secret', GOOGLE_API_KEY: 'secret', XAI_API_KEY: 'secret' }).probeImageRoutes();
    assert.ok(Date.now() - started >= 4900 && Date.now() - started < 10000);
    assert.equal(states[1].state, 'missing');
    assert.equal(states[2].state, 'missing');
    const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(calls.every(x => x.keys.length === 0));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const route of ['codex', 'antigravity', 'grok']) test(`${route} は PNG と有効な meta と next を作る`, async () => {
  const dir = await workspace();
  try {
    const result = await manager(dir).startGenerateStill(dir, { ...request, route });
    assert.equal(result.ok, true, result.reason);
    assert.deepEqual([result.width, result.height], route === 'codex' ? [160, 90] : [320, 180]);
    assert.equal((await readFile(join(dir, result.relativePath))).subarray(1, 4).toString('ascii'), 'PNG');
    const meta = JSON.parse(await readFile(join(dir, `${result.relativePath}.meta.json`), 'utf8'));
    assert.deepEqual(validateGenerationMeta(meta), { ok: true, errors: [] });
    assert.equal(meta.next.inputs.prompt, 'motion');
    assert.equal(meta.next.inputs.first_frame.path, result.relativePath);
    assert.equal(meta.provenance.key_source, `login:${route === 'antigravity' ? 'agy' : route}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('JPEG を PNG に直し、PNG 不在は理由つきで失敗し、鍵を渡さない', async () => {
  const dir = await workspace();
  try {
    await writeFile(join(dir, 'image-state'), 'jpeg');
    const env = { FAL_KEY: 'secret', GROQ_API_KEY: 'secret', OPENAI_API_KEY: 'secret', GEMINI_API_KEY: 'secret', GOOGLE_API_KEY: 'secret', XAI_API_KEY: 'secret' };
    const done = await manager(dir, env).startGenerateStill(dir, { ...request, route: 'grok' });
    assert.equal(done.ok, true, done.reason);
    assert.deepEqual([done.width, done.height], [320, 180]);
    assert.equal((await readFile(join(dir, done.relativePath))).subarray(1, 4).toString('ascii'), 'PNG');
    await writeFile(join(dir, 'image-state'), 'jpeg-sibling');
    const sibling = await manager(dir, env).startGenerateStill(dir, { ...request, route: 'antigravity' });
    assert.equal(sibling.ok, true, sibling.reason);
    assert.deepEqual([sibling.width, sibling.height], [320, 180]);
    assert.equal((await readFile(join(dir, sibling.relativePath))).subarray(1, 4).toString('ascii'), 'PNG');
    const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(calls.every(x => x.keys.length === 0));
    await writeFile(join(dir, 'image-state'), 'missing-png');
    const failed = await manager(dir).startGenerateStill(dir, { ...request, route: 'antigravity' });
    assert.equal(failed.ok, false);
    assert.match(failed.reason, /PNG がありません/u);
    assert.match(failed.reason, /image_gen returned no image/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('偽 Codex / Antigravity / Grok の画像は目視で区別できる異なる色', async () => {
  const dir = await workspace();
  try {
    const codex = await manager(dir).startGenerateStill(dir, { ...request, route: 'codex' });
    const agy = await manager(dir).startGenerateStill(dir, { ...request, route: 'antigravity' });
    const grok = await manager(dir).startGenerateStill(dir, { ...request, route: 'grok' });
    assert.equal(codex.ok, true, codex.reason);
    assert.equal(agy.ok, true, agy.reason);
    assert.equal(grok.ok, true, grok.reason);
    const c = await readFile(join(dir, codex.relativePath));
    const a = await readFile(join(dir, agy.relativePath));
    const g = await readFile(join(dir, grok.relativePath));
    assert.equal(c.equals(a), false);
    assert.equal(c.equals(g), false);
    assert.equal(a.equals(g), false);
    const pixel = png => [...inflateSync(png.subarray(41, 41 + png.readUInt32BE(33))).subarray(1, 4)];
    assert.deepEqual(pixel(c), [40, 60, 180]);
    assert.deepEqual(pixel(a), [255, 211, 73]);
    assert.deepEqual(pixel(g), [175, 234, 92]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('キャンセルは公開ファイルを作らない', async () => {
  const dir = await workspace();
  try {
    await writeFile(join(dir, 'image-state'), 'delay');
    const instance = manager(dir);
    const pending = instance.startGenerateStill(dir, { ...request, route: 'grok' });
    await new Promise(resolve => setTimeout(resolve, 400));
    instance.cancelGenerateStill('clip-1');
    assert.equal((await pending).ok, false);
    assert.deepEqual((await readdir(join(dir, 'assets/generated'))).filter(x => x.startsWith('still-')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('パネルはラジオ 3 行、選択を保存し、未 ready では作れない', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.value = ''; }
    appendChild(node) { this.children.push(node); return node; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
  }
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const saved = new Map();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) } });
  try {
    const state = { prompt: 'garden', aspect: '16:9', routeId: 'codex', probing: false, running: false,
      routes: ['codex', 'antigravity', 'grok'].map((id, i) => ({ id, state: i === 0 ? 'ready' : 'signed-out', detail: '' })) };
    const parent = new Node('root');
    appendAiStillPanel(parent, state, { change() {}, probe() {}, generate() {}, cancel() {} });
    const walk = node => [node, ...node.children.flatMap(walk)];
    const nodes = walk(parent);
    const radios = nodes.filter(x => x.type === 'radio');
    assert.equal(radios.length, 3);
    assert.equal(nodes.find(x => x.attributes.get('data-akari-inspector-ai-create') === 'true').disabled, false);
    radios[2].checked = true; radios[2].listeners.get('change')();
    assert.equal(savedStillRoute(), 'grok');
    const second = new Node('root');
    appendAiStillPanel(second, state, { change() {}, probe() {}, generate() {}, cancel() {} });
    assert.equal(walk(second).find(x => x.attributes.get('data-akari-inspector-ai-create') === 'true').disabled, true);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else delete globalThis.localStorage;
  }
});
