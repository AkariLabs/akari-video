import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { IMAGE_PROBE_TIMEOUT_MS, StillGenerationManager } from '../lib/node/still-generation.js';
import { aiActionCatalog } from '../lib/common/ai-action-catalog.js';
import { appendAiStillPanel, replaceStillInEdit, stillRouteLabel } from '../lib/browser/inspector/ai-still-panel.js';
import { appendAiStillResultPanel } from '../lib/browser/inspector/ai-still-result-panel.js';
import { validateGenerationMeta } from '../../../../../packages/generate/src/cli/meta-validate.mjs';
import { requireFfmpeg } from './helpers/require-ffmpeg.mjs';

const repo = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const bin = fileURLToPath(new URL('./fixtures/ai-still-routes-bin/', import.meta.url));
const findAsset = async path => join(repo, path);
const request = { projectRootUri: 'unused', itemId: 'clip-1', prompt: 'A garden', aspect: '16:9' };
const secretEnv = { FAL_KEY: 'secret', GROQ_API_KEY: 'secret', OPENAI_API_KEY: 'secret', GEMINI_API_KEY: 'secret', GOOGLE_API_KEY: 'secret', XAI_API_KEY: 'secret' };

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
function manager(dir, overrides = {}, probeTimeoutMsByRoute) {
  return new StillGenerationManager(findAsset, { env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`,
    FAKE_IMAGE_STATE_FILE: join(dir, 'image-state'), FAKE_IMAGE_LOG: join(dir, 'calls.jsonl'),
    AKARI_CODEX_BIN: join(bin, 'codex'), AKARI_AGY_BIN: join(bin, 'agy'), AKARI_GROK_BIN: join(bin, 'grok'),
    ...overrides }, probeTimeoutMsByRoute });
}

async function waitForCalls(dir, predicate) {
  for (;;) {
    const content = await readFile(join(dir, 'calls.jsonl'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const calls = content.split('\n').slice(0, -1).filter(Boolean).map(JSON.parse);
    if (predicate(calls)) return calls;
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function waitForAttempt(dir, route, count) {
  const file = join(dir, `image-state.${route}.count`);
  for (;;) {
    const actual = await readFile(file, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '0';
      throw error;
    });
    if (Number(actual) >= count) return;
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('手段ごとの既定上限', () => {
  assert.deepEqual(IMAGE_PROBE_TIMEOUT_MS, { codex: 5000, antigravity: 20000, grok: 20000, fal: 5000 });
});

test('fal はキー状態を示し、費用承認を断ると送信処理へ進まない', async () => {
  const dir = await workspace();
  try {
    const noKey = manager(dir, { FAL_KEY: '', AKARI_CREDENTIALS_FILE: join(dir, 'missing-credentials.env') });
    assert.equal((await noKey.probeImageRoutes(['fal']))[0].state, 'missing');
    const withKey = manager(dir, { FAL_KEY: 'stub-key' });
    assert.equal((await withKey.probeImageRoutes(['fal']))[0].state, 'ready');
    assert.equal((await manager(dir, { FAL_KEY: '', AKARI_IMAGE_AI_FAL_KEY: 'stub-image-key' }).probeImageRoutes(['fal']))[0].state, 'ready');
    const credentialsFile = join(dir, 'credentials.env');
    await writeFile(credentialsFile, 'AKARI_IMAGE_AI_FAL_KEY=stub-image-file-key\n', { mode: 0o600 });
    assert.equal((await manager(dir, { FAL_KEY: '', AKARI_CREDENTIALS_FILE: credentialsFile }).probeImageRoutes(['fal']))[0].state, 'ready');
    assert.deepEqual(await withKey.startGenerateStill(dir, { ...request, route: 'fal', approved: false }),
      { ok: false, reason: '費用承認が必要です。' });
    assert.equal(await readFile(join(dir, 'calls.jsonl'), 'utf8').catch(() => ''), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('3 手段の ready / signed-out / missing と Grok の一回再確認', async t => {
  const dir = await workspace();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const states = await manager(dir).probeImageRoutes();
    assert.deepEqual(states.map(x => [x.id, x.state]), [['codex', 'ready'], ['antigravity', 'ready'], ['grok', 'ready']]);
    await writeFile(join(dir, 'image-state'), 'signed-out');
    const out = await manager(dir).probeImageRoutes();
    assert.deepEqual(out.map(x => x.state), ['ready', 'signed-out', 'signed-out']);
    assert.ok(out.every(x => !x.detail.includes('@')));
    const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter(x => x.route === 'grok' && x.args[0] === 'models').length, 3);
    await writeFile(join(dir, 'image-state'), 'transient');
    assert.equal((await manager(dir).probeImageRoutes())[2].state, 'ready');
    assert.deepEqual((await manager(dir).probeImageRoutes(['grok'])).map(x => x.id), ['grok']);
    const missing = await manager(dir, { AKARI_CODEX_BIN: join(dir, 'no-codex'), AKARI_AGY_BIN: join(dir, 'no-agy'), AKARI_GROK_BIN: join(dir, 'no-grok') }).probeImageRoutes();
    assert.ok(missing.every(x => x.state === 'missing'));
  } finally { t.mock.timers.reset(); await rm(dir, { recursive: true, force: true }); }
});

test('Antigravity / Grok は打ち切りを一回確かめ直して unknown にし、鍵を外す', async t => {
  const dir = await workspace();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await writeFile(join(dir, 'image-state'), 'sleep');
    const pending = manager(dir, { FAL_KEY: 'secret', GROQ_API_KEY: 'secret', OPENAI_API_KEY: 'secret',
      GEMINI_API_KEY: 'secret', GOOGLE_API_KEY: 'secret', XAI_API_KEY: 'secret' },
    { antigravity: 1500, grok: 1500 }).probeImageRoutes();
    const bothCalled = count => calls => ['agy', 'grok'].every(route =>
      calls.filter(x => x.route === route && x.args[0] === 'models').length >= count);
    await waitForCalls(dir, bothCalled(1));
    t.mock.timers.tick(1500);
    await waitForCalls(dir, bothCalled(2));
    t.mock.timers.tick(1500);
    const states = await pending;
    assert.equal(states[0].state, 'ready');
    assert.equal(states[1].state, 'unknown');
    assert.equal(states[2].state, 'unknown');
    assert.equal(states[1].detail, '確かめられませんでした（1.5 秒で打ち切り）');
    const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(calls.every(x => x.keys.length === 0));
    for (const route of ['agy', 'grok']) assert.equal(calls.filter(x => x.route === route && x.args[0] === 'models').length, 2);
  } finally { t.mock.timers.reset(); await rm(dir, { recursive: true, force: true }); }
});

test('各試行に独立した上限があり、一回目の打ち切り後に ready になれる', async t => {
  const dir = await workspace();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await writeFile(join(dir, 'image-state'), 'sleep-once');
    let settled = false;
    const pending = manager(dir, {}, { antigravity: 1500, grok: 1500 })
      .probeImageRoutes(['antigravity', 'grok']).finally(() => { settled = true; });
    await Promise.all(['agy', 'grok'].map(route => waitForAttempt(dir, route, 1)));
    t.mock.timers.tick(1499);
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    await Promise.all(['agy', 'grok'].map(route => waitForAttempt(dir, route, 2)));
    t.mock.timers.tick(1499);
    // 再試行はすぐ ready になり得る。独立した上限と結果は最終状態で確かめる。
    const states = await pending;
    assert.deepEqual(states.map(x => x.state), ['ready', 'ready']);
    const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    for (const route of ['agy', 'grok']) assert.equal(calls.filter(x => x.route === route && x.args[0] === 'models').length, 2);
  } finally { t.mock.timers.reset(); await rm(dir, { recursive: true, force: true }); }
});

test('Codex は 5 秒で打ち切って missing にし、確かめ直さない', async t => {
  const dir = await workspace();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await writeFile(join(dir, 'image-state'), 'sleep');
    let calls = 0;
    let spawned;
    const started = new Promise(resolve => { spawned = resolve; });
    const instance = new StillGenerationManager(findAsset, { env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`,
      AKARI_CODEX_BIN: join(bin, 'codex'), FAKE_CODEX_STATE_FILE: join(dir, 'image-state') },
      spawnProcess: (...args) => { calls++; const child = spawn(...args); child.once('spawn', spawned); return child; } });
    const pending = instance.probeImageRoutes(['codex']);
    await started;
    t.mock.timers.tick(5000);
    const [route] = await pending;
    assert.equal(route.state, 'missing');
    assert.equal(route.detail, '確かめられませんでした（5 秒で打ち切り）');
    assert.equal(calls, 1);
  } finally { t.mock.timers.reset(); await rm(dir, { recursive: true, force: true }); }
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

test('JPEG を PNG に直し、鍵を渡さない', async t => {
  if (!requireFfmpeg(t)) return;
  const dir = await workspace();
  try {
    await writeFile(join(dir, 'image-state'), 'jpeg');
    const done = await manager(dir, secretEnv).startGenerateStill(dir, { ...request, route: 'grok' });
    assert.equal(done.ok, true, done.reason);
    assert.deepEqual([done.width, done.height], [320, 180]);
    assert.equal((await readFile(join(dir, done.relativePath))).subarray(1, 4).toString('ascii'), 'PNG');
    await writeFile(join(dir, 'image-state'), 'jpeg-sibling');
    const sibling = await manager(dir, secretEnv).startGenerateStill(dir, { ...request, route: 'antigravity' });
    assert.equal(sibling.ok, true, sibling.reason);
    assert.deepEqual([sibling.width, sibling.height], [320, 180]);
    assert.equal((await readFile(join(dir, sibling.relativePath))).subarray(1, 4).toString('ascii'), 'PNG');
    const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(calls.every(x => x.keys.length === 0));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('PNG 不在は理由つきで失敗し、鍵を渡さない', async () => {
  const dir = await workspace();
  try {
    await writeFile(join(dir, 'image-state'), 'missing-png');
    const failed = await manager(dir, secretEnv).startGenerateStill(dir, { ...request, route: 'antigravity' });
    assert.equal(failed.ok, false);
    assert.match(failed.reason, /PNG がありません/u);
    assert.match(failed.reason, /image_gen returned no image/u);
    const log = await readFile(join(dir, 'calls.jsonl'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    assert.ok(log.trim(), 'missing-png must record a fake CLI call');
    const calls = log.trim().split('\n').map(JSON.parse);
    assert.ok(calls.every(x => x.keys.length === 0));
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
    await waitForCalls(dir, calls => calls.some(x => x.route === 'grok' && x.args[0] !== 'models'));
    instance.cancelGenerateStill('clip-1');
    assert.equal((await pending).ok, false);
    assert.deepEqual((await readdir(join(dir, 'assets/generated'))).filter(x => x.startsWith('still-')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('パネルは手段ごとの確認中と unknown の案内・作成可否を表示する', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.value = ''; this.style = {}; }
    append(...nodes) { this.children.push(...nodes); }
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
    const state = { prompt: 'garden', aspect: '16:9', routeId: 'codex', selectedRoutes: new Set(['codex']), probing: false, running: false,
      routes: ['codex', 'antigravity', 'grok'].map((id, i) => ({ id, state: i === 0 ? 'ready' : 'signed-out', detail: '' })) };
    const parent = new Node('root');
    appendAiStillPanel(parent, state, { change() {}, probe() {}, generate() {}, cancel() {} });
    const walk = node => [node, ...node.children.flatMap(walk)];
    const nodes = walk(parent);
    const radios = nodes.filter(x => x.type === 'checkbox' && x.attributes.has('data-akari-inspector-ai-route-checkbox'));
    assert.equal(radios.length, 4);
    assert.equal(nodes.find(x => x.attributes.get('data-akari-inspector-ai-create') === 'true').disabled, false);
    radios[0].checked = false; radios[0].listeners.get('change')();
    radios[2].checked = true; radios[2].listeners.get('change')();
    assert.deepEqual([...state.selectedRoutes], ['grok']);
    const second = new Node('root');
    appendAiStillPanel(second, state, { change() {}, probe() {}, generate() {}, cancel() {} });
    assert.equal(walk(second).find(x => x.attributes.get('data-akari-inspector-ai-create') === 'true').disabled, true);
    state.routes[2] = { id: 'grok', state: 'missing', detail: '' };
    const missing = new Node('root');
    appendAiStillPanel(missing, state, { change() {}, probe() {}, generate() {}, cancel() {} });
    assert.equal(walk(missing).find(x => x.attributes.get('data-akari-inspector-ai-create') === 'true').disabled, true);
    state.routes[2] = { id: 'grok', state: 'unknown', detail: '確かめられませんでした（20 秒で打ち切り）' };
    state.error = '生成に失敗しました';
    const unknown = new Node('root');
    appendAiStillPanel(unknown, state, { change() {}, probe() {}, generate() {}, cancel() {} });
    assert.equal(walk(unknown).find(x => x.attributes.get('data-akari-inspector-ai-create') === 'true').disabled, false);
    assert.equal(walk(unknown).find(x => x.attributes.get('data-akari-inspector-ai-retry') === 'true').disabled, false);
    assert.ok(walk(unknown).some(x => x.className === 'akari-inspector-ai-still-next' && x.textContent === '状態を確かめ直すか、そのまま作ってみてください'));
    assert.ok(walk(unknown).some(x => x.className === 'akari-inspector-ai-still-badge' && x.textContent === '確かめられませんでした'));
    state.probing = true;
    state.probingRoutes = new Set(['antigravity']);
    const checking = new Node('root');
    appendAiStillPanel(checking, state, { change() {}, probe() {}, generate() {}, cancel() {} });
    const badges = walk(checking).filter(x => x.className === 'akari-inspector-ai-still-badge');
    assert.deepEqual(badges.map(x => x.textContent), ['使える', '確かめています…', '確かめられませんでした', '入っていない']);
    assert.deepEqual(badges.map(x => x.attributes.get('data-akari-inspector-ai-route-state')), ['ready', 'checking', 'unknown', 'checking']);
    assert.equal(walk(checking).find(x => x.attributes.get('data-akari-inspector-ai-refresh') === 'true').disabled, true);
    assert.equal(walk(checking).find(x => x.attributes.get('data-akari-inspector-ai-create') === 'true').disabled, false);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else delete globalThis.localStorage;
  }
});

test('既定チェックは G8 の静止画 id・無料のお気に入り・利用可否を守り、有料を外す', async () => {
  assert.deepEqual(aiActionCatalog([]).find(action => action.id === 'still').routes.map(({ id, modelId }) => [id, modelId]), [
    ['codex', 'codex:image'], ['antigravity', 'still:antigravity'],
    ['grok', 'still:grok'], ['fal', 'fal:gpt-image-2.5-flare']
  ]);
  const dir = await workspace();
  const home = join(dir, 'isolated-home');
  try {
    await mkdir(home);
    const instance = manager(dir, { AKARI_HOME: home, AKARI_CREDENTIALS_FILE: join(dir, 'none.env'),
      FAL_KEY: '', AKARI_IMAGE_AI_FAL_KEY: '' });
    assert.deepEqual(await instance.readStillPreferredRoutes(dir), ['codex', 'antigravity', 'grok']);
    await writeFile(join(home, 'ai-models.json'), JSON.stringify({ version: 1,
      favorites: { image: ['still:grok', 'codex:image', 'fal:gpt-image-2.5-flare'] }, defaults: {} }));
    await mkdir(join(dir, '.akari'));
    await writeFile(join(dir, '.akari/ai-models.json'), JSON.stringify({ version: 1,
      defaults: { image: 'fal:gpt-image-2.5-flare' } }));
    const favored = manager(dir, { AKARI_HOME: home, AKARI_CREDENTIALS_FILE: join(dir, 'none.env'),
      FAL_KEY: 'stub-key', AKARI_GROK_BIN: join(dir, 'missing-grok') });
    assert.deepEqual(await favored.readStillPreferredRoutes(dir), ['codex']);
    await writeFile(join(home, 'ai-models.json'), JSON.stringify({ version: 1,
      favorites: { image: ['still:antigravity'] }, defaults: {} }));
    assert.deepEqual(await favored.readStillPreferredRoutes(dir), ['antigravity']);
    await writeFile(join(home, 'ai-models.json'), JSON.stringify({ version: 1,
      favorites: { image: ['still:grok', 'fal:gpt-image-2.5-flare'] }, defaults: {} }));
    assert.deepEqual(await favored.readStillPreferredRoutes(dir), ['codex', 'antigravity']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('同じ枠の三手段を同時に候補化し、進捗と edit 不変、手段単位の二重起動を守る', async () => {
  const dir = await workspace();
  try {
    await writeFile(join(dir, 'image-state'), 'delay');
    const instance = manager(dir);
    const editBefore = await readFile(join(dir, 'edit.json'));
    const pending = instance.startGenerateStillBatch(dir, { ...request, routes: ['codex', 'antigravity', 'grok'] });
    await waitForCalls(dir, calls => ['agy', 'grok'].every(route => calls.some(row =>
      row.route === route && row.args[0] !== 'models')));
    const inProgress = await instance.readStillCandidates(dir, 'clip-1');
    assert.deepEqual(inProgress.routes, ['codex', 'antigravity', 'grok']);
    assert.equal(inProgress.running, true);
    assert.equal((await instance.startGenerateStill(dir, { ...request, route: 'codex' })).ok, false);
    const generating = JSON.parse(await readFile(join(dir, 'assets/generated/old.png.meta.json')));
    assert.equal(generating.status, 'generating');
    assert.deepEqual(generating.job.routes, ['codex', 'antigravity', 'grok']);
    const result = await pending;
    assert.equal(result.completed, 3);
    assert.equal(result.candidates.filter(row => row.ok).length, 3);
    assert.equal((await readFile(join(dir, 'edit.json'))).equals(editBefore), true);
    for (const candidate of result.candidates) {
      assert.match(candidate.relativePath, new RegExp(`^assets/generated/candidates/clip-1/${candidate.route}-.*\\.png$`));
      const meta = JSON.parse(await readFile(join(dir, `${candidate.relativePath}.meta.json`)));
      assert.equal(meta.candidate_of, 'clip-1');
      assert.equal(meta.status, 'done');
      assert.deepEqual(validateGenerationMeta(meta), { ok: true, errors: [] });
    }
    const restored = JSON.parse(await readFile(join(dir, 'assets/generated/old.png.meta.json')));
    assert.equal(restored.job.completed, 3);
    assert.equal(restored.job.candidates, 3);
    assert.equal((await instance.readStillCandidates(dir, 'clip-1')).candidates.length, 3);
    const original = JSON.parse(editBefore.toString());
    const history = [];
    let doc = structuredClone(original);
    const commit = mutation => { const previous = structuredClone(doc); doc = mutation(structuredClone(doc)); history.push(previous); };
    commit(value => replaceStillInEdit(value, 'clip-1', result.candidates[0].relativePath));
    assert.equal(history.length, 1);
    assert.equal(doc.sources.find(row => row.id === doc.tracks[0].items[0].source.src).path,
      result.candidates[0].relativePath);
    doc = history.pop();
    assert.deepEqual(doc, original);
    for (const candidate of result.candidates) assert.ok((await readFile(join(dir, candidate.relativePath))).length > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('一手段の失敗は他の候補と edit を壊さず、有料の拒否は実行しない', async () => {
  const dir = await workspace();
  try {
    const instance = manager(dir, { AKARI_GROK_BIN: join(dir, 'missing-grok') });
    const before = await readFile(join(dir, 'edit.json'));
    await assert.rejects(instance.startGenerateStillBatch(dir, { ...request, routes: ['codex', 'fal'], approved: false }), /費用承認/u);
    assert.equal(await readFile(join(dir, 'calls.jsonl'), 'utf8').catch(() => ''), '');
    const result = await instance.startGenerateStillBatch(dir, { ...request, routes: ['codex', 'antigravity', 'grok'] });
    assert.equal(result.candidates.filter(row => row.ok).length, 2);
    assert.equal(result.candidates.find(row => row.route === 'grok').ok, false);
    assert.equal((await readFile(join(dir, 'edit.json'))).equals(before), true);
    const reloaded = await instance.readStillCandidates(dir, 'clip-1');
    assert.equal(reloaded.candidates.filter(row => row.ok).length, 2);
    assert.equal(reloaded.candidates.find(row => row.route === 'grok').ok, false);
    const sourceMeta = JSON.parse(await readFile(join(dir, 'assets/generated/old.png.meta.json'), 'utf8'));
    assert.equal(sourceMeta.inputs.prompt, request.prompt);
    assert.deepEqual(sourceMeta.inputs.extra.still_batch.routes, ['codex', 'antigravity', 'grok']);
    const candidateMeta = JSON.parse(await readFile(join(dir,
      `${result.candidates.find(row => row.ok).relativePath}.meta.json`), 'utf8'));
    assert.deepEqual(validateGenerationMeta(candidateMeta), { ok: true, errors: [] });
    assert.equal(candidateMeta.inputs.prompt, request.prompt);
    assert.equal(candidateMeta.inputs.extra.still_batch.prompt, request.prompt);
    assert.equal(candidateMeta.inputs.extra.still_batch.aspect, request.aspect);
    assert.equal(candidateMeta.inputs.extra.still_batch.generation_prompt.includes('16:9'), true);
    assert.equal(candidateMeta.inputs.extra.still_batch.results.find(row => row.route === 'grok').ok, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('枠の source を候補に替えたあとも入力と失敗行を読み直せる', async () => {
  const dir = await workspace();
  try {
    const relativePath = 'assets/generated/candidates/clip-1/codex-1.png';
    const candidatePath = join(dir, relativePath);
    await mkdir(join(dir, 'assets/generated/candidates/clip-1'), { recursive: true });
    await writeFile(candidatePath, 'png fixture');
    await writeFile(`${candidatePath}.meta.json`, JSON.stringify({ kind: 'still', status: 'done',
      candidate_of: 'clip-1', route: 'codex', result: { width: 1024, height: 576, elapsed_s: 5 },
      inputs: { prompt: 'A garden', extra: { still_batch: {
        prompt: 'A garden', aspect: '16:9', routes: ['codex', 'grok'], references: [],
        results: [{ route: 'codex', ok: true, path: relativePath },
          { route: 'grok', ok: false, reason: 'failed' }], completed: 2 } } },
      job: { provider: 'codex' } }));
    const edit = JSON.parse(await readFile(join(dir, 'edit.json'), 'utf8'));
    edit.sources[0].path = relativePath;
    await writeFile(join(dir, 'edit.json'), JSON.stringify(edit));
    const batch = await manager(dir).readStillCandidates(dir, 'clip-1', false);
    assert.deepEqual(batch.routes, ['codex', 'grok']);
    assert.equal(batch.completed, 2);
    assert.equal(batch.results[0].relativePath, relativePath);
    assert.equal(batch.results[1].reason, 'failed');
    const sourceMeta = JSON.parse(await readFile(`${candidatePath}.meta.json`, 'utf8'));
    sourceMeta.job = { provider: 'compare', routes: ['grok'], completed: 1,
      results: [{ route: 'grok', ok: false, reason: 'latest failure' }] };
    await writeFile(`${candidatePath}.meta.json`, JSON.stringify(sourceMeta));
    const failedBatch = await manager(dir).readStillCandidates(dir, 'clip-1', false);
    assert.deepEqual(failedBatch.routes, ['grok']);
    assert.equal(failedBatch.completed, 1);
    assert.equal(failedBatch.results[0].reason, 'latest failure');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('同じ枠でも別手段のバッチは併走し、重なる手段だけ拒否する', async () => {
  const dir = await workspace();
  try {
    await writeFile(join(dir, 'image-state'), 'delay');
    const instance = manager(dir);
    const first = instance.startGenerateStillBatch(dir, { ...request, routes: ['codex'] });
    const second = instance.startGenerateStillBatch(dir, { ...request, routes: ['antigravity', 'grok'] });
    await assert.rejects(instance.startGenerateStillBatch(dir, { ...request, routes: ['grok'] }), /枠と手段/u);
    await waitForCalls(dir, calls => ['agy', 'grok'].every(route => calls.some(row =>
      row.route === route && row.args[0] !== 'models')));
    const running = await instance.readStillCandidates(dir, 'clip-1');
    assert.deepEqual(running.routes, ['codex', 'antigravity', 'grok']);
    assert.equal(running.completed, 0);
    assert.deepEqual(running.results, []);
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.candidates.filter(row => row.ok).length, 1);
    assert.equal(b.candidates.filter(row => row.ok).length, 2);
    const meta = JSON.parse(await readFile(join(dir, 'assets/generated/old.png.meta.json')));
    assert.deepEqual(meta.job.routes, ['codex', 'antigravity', 'grok']);
    assert.equal(meta.job.completed, 3);
    assert.equal(meta.job.candidates, 3);
    assert.equal(meta.job.results.length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('バッチ実行中の読み口は最初の完了を残りの実行中に返す', async () => {
  const dir = await workspace();
  try {
    await writeFile(join(dir, 'image-state'), 'delay');
    const instance = manager(dir, { FAKE_CODEX_DELAY_MS: '150' });
    const pending = instance.startGenerateStillBatch(dir, { ...request, routes: ['codex', 'antigravity', 'grok'] });
    let middle;
    const until = Date.now() + 5_000;
    while (Date.now() < until) {
      middle = await instance.readStillCandidates(dir, 'clip-1');
      if (middle.results?.some(row => row.route === 'codex' && row.ok)) break;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 40));
    }
    assert.equal(middle.running, true);
    assert.equal(middle.completed, 1);
    assert.deepEqual(middle.results.map(row => row.route), ['codex']);
    assert.equal(middle.candidates.length, 1);
    await pending;
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('次のバッチの進捗は前回結果を拾わず、候補一覧は重複なく新しい順', async () => {
  const dir = await workspace();
  try {
    const instance = manager(dir);
    await instance.startGenerateStillBatch(dir, { ...request, routes: ['codex', 'antigravity', 'grok'] });
    await writeFile(join(dir, 'image-state'), 'delay');
    const second = instance.startGenerateStillBatch(dir, { ...request, routes: ['codex', 'antigravity', 'grok'] });
    await waitForCalls(dir, calls => ['agy', 'grok'].every(route => calls.filter(row =>
      row.route === route && row.args[0] !== 'models').length >= 2));
    const running = await instance.readStillCandidates(dir, 'clip-1');
    assert.equal(running.running, true);
    assert.equal(running.completed, 0);
    assert.deepEqual(running.results, []);
    assert.equal(running.candidates.length, 3);
    await second;
    const done = await instance.readStillCandidates(dir, 'clip-1');
    assert.equal(done.candidates.length, 6);
    assert.equal(new Set(done.candidates.map(row => row.relativePath)).size, 6);
    assert.equal(done.results.length, 3);
    const times = done.candidates.map(row => Number(row.relativePath.split('/').pop().split('-')[1]));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('結果の案と失敗行は手段 id ではなく表示名を使う', () => {
  assert.equal(stillRouteLabel('codex'), 'ChatGPT（Codex）');
  assert.equal(stillRouteLabel('antigravity'), 'Antigravity');
  assert.equal(stillRouteLabel('grok'), 'Grok');
  assert.equal(stillRouteLabel('fal'), 'fal · GPT Image 2.5 Flare');
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.style = {}; this.textContent = ''; this.classList = { add() {} }; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); return node; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    addEventListener(key, value) { this.listeners.set(key, value); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try {
    const parent = new Node('root');
    appendAiStillResultPanel(parent, { prompt: 'garden', aspect: '16:9', running: false, batch: {
        routes: ['codex', 'antigravity'], completed: 2, running: false,
        results: [{ route: 'codex', ok: true, relativePath: 'assets/generated/candidates/x/codex-1.png' },
          { route: 'antigravity', ok: false, reason: 'error' }],
        candidates: [{ route: 'codex', ok: true, relativePath: 'assets/generated/candidates/x/codex-1.png', width: 320, height: 180 },
          { route: 'antigravity', ok: false, reason: 'error' }]
      }, actions: { home() {}, redo() {}, toVideo() {}, cancel() {}, select() {} } });
    const walk = node => [node, ...node.children.flatMap(walk)];
    const nodes = walk(parent);
    assert.match(nodes.find(row => row.attributes.get('data-akari-inspector-ai-result-candidate'))?.children[1].textContent, /ChatGPT（Codex）/u);
    assert.match(nodes.find(row => row.attributes.get('data-akari-inspector-ai-result-failed'))?.textContent, /Antigravity · 失敗/u);
  } finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
});
