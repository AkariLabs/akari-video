import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { finishPlaceholderGenerating, markPlaceholderGenerating } from '../lib/common/generation-sidecar.js';
import { plannedStillMeta } from '../../../../../packages/generate/src/cli/meta-still.mjs';
import { validateGenerationMeta } from '../../../../../packages/generate/src/cli/meta-validate.mjs';

const source = readFileSync(new URL('../src/node/akari-annotations-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsServiceImpl');
const methods = ['generateNarration', 'cancelNarration'].map(name => {
  const member = klass?.members.find(node => node.name?.getText(ast) === name);
  assert.ok(member, name);
  return member.getText(ast);
});
const compiled = ts.transpileModule(`class Service { ${methods.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const Service = new Function('fs', 'resolve', 'join', 'markPlaceholderGenerating',
  'finishPlaceholderGenerating', 'createHash', `${compiled}; return Service;`)(
    { readFile, writeFile }, resolve, join, markPlaceholderGenerating, finishPlaceholderGenerating, createHash);

const request = root => ({ projectRootUri: root, engine: 'voicevox', voice: 'test', script: 'こんにちは',
  reading: 'こんにちは', t: 1 });

test('ナレーションの枠 meta は開始中だけ generating、成功・失敗・中止・尺欠けで元に戻る', async () => {
  for (const mode of ['success', 'fail', 'cancel', 'invalid-duration']) {
    const root = await mkdtemp(join(tmpdir(), 'gen-progress-aurora-narration-'));
    try {
      await mkdir(join(root, 'assets/generated'), { recursive: true });
      await mkdir(join(root, 'out/narration'), { recursive: true });
      const sourcePath = 'assets/generated/frame-audio-test.wav';
      const oldPath = join(root, `${sourcePath}.meta.json`);
      const at = '2026-09-26T00:00:00.000Z';
      const original = plannedStillMeta({ prompt: '', duration_s: 2, at, asOf: '2026-09-26' });
      original.kind = 'audio';
      original.model.id = 'akari:empty-audio';
      original.output.resolution = null;
      original.cost.unit = 'usd_per_audio';
      await writeFile(oldPath, JSON.stringify(original));
      await writeFile(join(root, 'edit.json'), JSON.stringify({ version: 2, output: { fps: 30 },
        sources: [{ id: 'frame-source', path: sourcePath }],
        tracks: [{ lane: 'audio', items: [{ id: 'frame', at: 30, duration: 60,
          source: { kind: 'media', src: 'frame-source' } }] }] }));
      let settle;
      const service = Object.assign(new Service(), { fsPath: uri => uri,
        narrationCli: {
          generate: () => new Promise((resolveRun, rejectRun) => { settle = { resolveRun, rejectRun }; }),
          cancel: async () => settle.rejectRun(new Error('中止'))
        } });
      const pending = service.generateNarration(request(root));
      let generating;
      for (let i = 0; i < 100; i++) {
        generating = JSON.parse(await readFile(oldPath, 'utf8'));
        if (generating.status === 'generating') break;
        await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
      }
      assert.equal(generating.status, 'generating', mode);
      assert.equal(generating.job.provider, 'voicevox');
      assert.ok(Number.isFinite(Date.parse(generating.job.started_at)));
      assert.equal(generating.job.stale_after_s, 600);
      assert.equal(generating.history.at(-1).status, 'generating');
      assert.deepEqual(validateGenerationMeta(generating), { ok: true, errors: [] });
      if (mode === 'success' || mode === 'invalid-duration') {
        await writeFile(join(root, 'out/narration/n-0001.wav'), Buffer.from('RIFFstubWAVEaudio'));
        settle.resolveRun({ status: 'ok', path: 'out/narration/n-0001.wav',
          ...(mode === 'success' ? { duration_s: 1.5 } : {}) });
        const generated = await pending;
        assert.equal(generated.status, 'ok');
        const donePath = join(root, 'out/narration/n-0001.wav.meta.json');
        if (mode === 'success') {
          const done = JSON.parse(await readFile(donePath, 'utf8'));
          assert.equal(done.status, 'done');
          assert.equal(done.job.provider, 'voicevox');
          assert.equal(done.job.stale_after_s, 600);
          assert.equal(done.provenance.tool, 'akari narration generate --voicevox');
          assert.equal(done.history.at(-2).status, 'generating');
          assert.deepEqual(validateGenerationMeta(done), { ok: true, errors: [] });
        } else await assert.rejects(readFile(donePath), { code: 'ENOENT' });
      } else {
        if (mode === 'cancel') await service.cancelNarration(root);
        else settle.rejectRun(new Error('生成失敗'));
        await assert.rejects(pending, /中止|生成失敗/u);
      }
      const restored = JSON.parse(await readFile(oldPath, 'utf8'));
      if (mode === 'success') {
        assert.equal(restored.status, 'planned');
        assert.equal(restored.history.at(-2).status, 'generating');
        assert.equal(restored.history.at(-1).status, 'planned');
        assert.deepEqual({ ...restored, history: original.history }, original);
      } else assert.deepEqual(restored, original, mode);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('音の空の枠がない読み上げは尺欠けの応答をそのまま返す', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gen-progress-aurora-read-aloud-'));
  try {
    await writeFile(join(root, 'edit.json'), JSON.stringify({ version: 2, output: { fps: 30 },
      sources: [], tracks: [] }));
    const response = { status: 'ok', path: 'out/narration/n-0001.wav' };
    const service = Object.assign(new Service(), { fsPath: uri => uri,
      narrationCli: { generate: async () => response } });
    assert.equal(await service.generateNarration(request(root)), response);
  } finally { await rm(root, { recursive: true, force: true }); }
});
