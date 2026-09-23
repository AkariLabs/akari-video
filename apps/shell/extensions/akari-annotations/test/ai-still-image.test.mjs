import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiActionCatalog, describeAiTiles } from '../lib/common/ai-action-catalog.js';
import { StillGenerationManager } from '../lib/node/still-generation.js';
import { imageRouteBadgeText, imageRouteNextText, nearestStillAspect, replaceStillInEdit, stillDimensionMismatch, stillMismatchNotice } from '../lib/browser/inspector/ai-still-panel.js';
import { validateGenerationMeta } from '../../../../../packages/generate/src/cli/meta-validate.mjs';

const repo = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const fixture = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
const findAsset = async path => join(repo, path);
const models = [{ id: 'fal:h3-i2v', kind: 'video', provider: 'fal', price: { usd: 1 } }];

test('カタログの順序と対象ごとの押下可否', () => {
  const catalog = aiActionCatalog(models);
  assert.deepEqual(catalog.map(row => row.id), ['still', 'video', 'transcribe']);
  assert.deepEqual(catalog[0].routes, [{ id: 'codex', label: 'Codex', kind: 'cli', cost: 'free' }]);
  for (const target of ['empty-frame', 'still']) {
    assert.equal(describeAiTiles(catalog, target)[0].tiles[0].enabled, true);
  }
  for (const target of ['video', 'generated-video']) {
    assert.deepEqual(describeAiTiles(catalog, target)[0].tiles[0], {
      id: 'still', label: '静止画', image: 'still', enabled: false, reason: '空の枠か静止画で使えます'
    });
  }
});

test('画角選択と寸法違いの案内', () => {
  assert.equal(nearestStillAspect(1920, 1080), '16:9');
  assert.equal(nearestStillAspect(1080, 1920), '9:16');
  assert.equal(nearestStillAspect(1000, 1000), '1:1');
  assert.equal(stillDimensionMismatch('16:9', { ok: true, width: 1024, height: 1024 }), '頼んだ 16:9 と違う 1024×1024 でできました');
  assert.equal(stillDimensionMismatch('16:9', { ok: true, width: 160, height: 90 }), undefined);
});

test('寸法違いは同じ枠の一覧だけに出て、別の枠を選ぶと消える', () => {
  const a = { prompt: '', aspect: '16:9', probing: false, running: false,
    mismatch: '頼んだ 16:9 と違う 1024×1024 でできました' };
  const states = new Map([['clip-a', a]]);
  assert.equal(stillMismatchNotice(states, 'clip-a', 'key-a', 'key-a'), a.mismatch);
  assert.equal(stillMismatchNotice(states, 'clip-b', 'key-a', 'key-b'), undefined);
  assert.equal(a.mismatch, undefined);
  assert.equal(stillMismatchNotice(states, 'clip-a', 'key-b', 'key-a'), undefined);
});

test('確認の打ち切りは未確認の札と案内を出し、未導入と呼ばない', () => {
  const route = { id: 'codex', state: 'missing', detail: '確かめられませんでした（5 秒で打ち切り）' };
  assert.equal(imageRouteBadgeText(route, false), '確かめられませんでした');
  assert.equal(imageRouteNextText(route), route.detail);
});

test('状態確認は ready / signed-out / missing / 5 秒打ち切りで秘密を伏せる', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-still-probe-'));
  try {
    const stateFile = join(dir, 'state');
    const manager = new StillGenerationManager(findAsset, { env: { ...process.env, AKARI_CODEX_BIN: fixture, FAKE_CODEX_STATE_FILE: stateFile } });
    assert.equal((await manager.probeImageRoutes())[0].state, 'ready');
    assert.doesNotMatch((await manager.probeImageRoutes())[0].detail, /person@example.com/u);
    await writeFile(stateFile, 'signed-out');
    const signedOut = (await manager.probeImageRoutes())[0];
    assert.equal(signedOut.state, 'signed-out');
    assert.doesNotMatch(signedOut.detail, /person@example.com/u);
    const missing = new StillGenerationManager(findAsset, { env: { ...process.env, AKARI_CODEX_BIN: join(dir, 'missing') } });
    assert.equal((await missing.probeImageRoutes())[0].state, 'missing');
    await writeFile(stateFile, 'sleep');
    const started = Date.now();
    const timed = (await manager.probeImageRoutes())[0];
    assert.equal(timed.state, 'missing');
    assert.match(timed.detail, /確かめられませんでした/u);
    assert.ok(Date.now() - started >= 4900);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'akari-still-project-'));
  await mkdir(join(dir, 'assets', 'generated'), { recursive: true });
  const edit = { version: 2, output: { fps: 30, width: 1920, height: 1080 },
    sources: [{ id: 'old', path: 'assets/generated/old.png' }], tracks: [{ lane: 'visual', items: [
      { id: 'clip-1', at: 42, duration: 90, source: { kind: 'media', src: 'old', in: 0, out: 3 }, transform: { x: 2 }, color: { brightness: 1.2 } }
    ] }] };
  await writeFile(join(dir, 'edit.json'), JSON.stringify(edit));
  const oldMeta = { next: { kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: { prompt: 'move gently', first_frame: { path: 'assets/generated/old.png' }, last_frame: null,
      reference_images: [], reference_videos: [], reference_audios: [], source_video: null, negative_prompt: null,
      camera: null, seed: null, extra: {}, frames_or_refs: 'frames' },
    output: { duration_s: 3, resolution: null, aspect: null, audio_out: null }, updated_at: new Date().toISOString() } };
  await writeFile(join(dir, 'assets/generated/old.png.meta.json'), JSON.stringify(oldMeta));
  return { dir, edit };
}
const request = { projectRootUri: 'unused', itemId: 'clip-1', prompt: 'A bright garden', aspect: '16:9' };

test('probe と生成の spawn に Codex の場所を先頭にした PATH を渡す', async () => {
  const { dir } = await project();
  const paths = [];
  try {
    const manager = new StillGenerationManager(findAsset, { env: { ...process.env, PATH: '/usr/bin', AKARI_CODEX_BIN: fixture },
      spawnProcess: (command, args, options) => {
        paths.push(options.env.PATH);
        return spawn(process.execPath, [command, ...args], options);
      } });
    assert.equal((await manager.probeImageRoutes())[0].state, 'ready');
    assert.equal((await manager.startGenerateStill(dir, request)).ok, true);
    assert.equal(paths.length, 2);
    for (const value of paths) {
      const entries = value.split(delimiter);
      assert.equal(entries[0], dirname(fixture));
      assert.ok(entries.includes('/usr/bin'));
      assert.ok(entries.includes('/opt/homebrew/bin'));
      assert.ok(entries.includes('/usr/local/bin'));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('偽 app-server の PNG と検証済み meta を書き、next を引き継ぐ', async () => {
  const { dir, edit } = await project();
  try {
    const manager = new StillGenerationManager(findAsset, { env: { ...process.env, AKARI_CODEX_BIN: fixture } });
    const result = await manager.startGenerateStill(dir, request);
    assert.equal(result.ok, true, result.reason);
    assert.deepEqual([result.width, result.height], [160, 90]);
    const png = await readFile(join(dir, result.relativePath));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    const meta = JSON.parse(await readFile(join(dir, `${result.relativePath}.meta.json`), 'utf8'));
    assert.deepEqual(validateGenerationMeta(meta), { ok: true, errors: [] });
    assert.equal(meta.next.inputs.prompt, 'move gently');
    assert.equal(meta.next.inputs.first_frame.path, result.relativePath);
    assert.equal(meta.inputs.prompt.includes('横長 16:9'), true);
    const before = structuredClone(edit);
    const changed = replaceStillInEdit(edit, 'clip-1', result.relativePath);
    assert.equal(changed.tracks[0].items[0].id, 'clip-1');
    assert.equal(changed.tracks[0].items[0].at, 42);
    assert.equal(changed.tracks[0].items[0].duration, 90);
    assert.deepEqual(changed.tracks[0].items[0].transform, { x: 2 });
    assert.deepEqual(changed.tracks[0].items[0].color, { brightness: 1.2 });
    assert.equal(changed.sources.length, 2);
    // The timeline's one history entry records the complete document before this mutation.
    assert.deepEqual(before.tracks[0].items[0].source, { kind: 'media', src: 'old', in: 0, out: 3 });
    assert.equal(before.sources.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('失敗は理由を返して PNG・meta を公開しない', async () => {
  const { dir } = await project();
  try {
    const manager = new StillGenerationManager(findAsset, { env: { ...process.env, AKARI_CODEX_BIN: fixture, FAKE_CODEX_MODE: 'fail' } });
    const result = await manager.startGenerateStill(dir, request);
    assert.equal(result.ok, false);
    assert.match(result.reason, /画像を作れません/u);
    assert.doesNotMatch(result.reason, /person@example.com/u);
    assert.deepEqual((await readdir(join(dir, 'assets/generated'))).filter(name => name.startsWith('still-')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('キャンセルは app-server を止めて PNG・meta を公開しない', async () => {
  const { dir } = await project();
  try {
    const manager = new StillGenerationManager(findAsset, { env: { ...process.env, AKARI_CODEX_BIN: fixture, FAKE_CODEX_DELAY_MS: '3000' } });
    const pending = manager.startGenerateStill(dir, request);
    await new Promise(resolve => setTimeout(resolve, 400));
    manager.cancelGenerateStill('clip-1');
    const result = await pending;
    assert.equal(result.ok, false);
    assert.deepEqual((await readdir(join(dir, 'assets/generated'))).filter(name => name.startsWith('still-')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
