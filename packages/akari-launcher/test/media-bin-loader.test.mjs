import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { preloadMediaBin, resolveMediaCommand } from '../src/media-bin-loader.mjs';
import { checkVoiceRecording } from '../src/voice-command.mjs';

test('ffmpeg と ffprobe を media-bin で解決し、env を渡す', () => {
  const env = { PATH: '/fixture' };
  assert.equal(resolveMediaCommand('ffmpeg', { env, mediaBin: {
    resolveFfmpeg: ({ env: received }) => {
      assert.equal(received, env);
      return '/x/ffmpeg';
    },
  } }), '/x/ffmpeg');
  assert.equal(resolveMediaCommand('ffprobe', { env, mediaBin: {
    resolveFfprobe: ({ env: received }) => {
      assert.equal(received, env);
      return '/x/ffprobe';
    },
  } }), '/x/ffprobe');
});

test('media-bin の解決が失敗したら裸のコマンド名へ戻す', () => {
  assert.equal(resolveMediaCommand('ffmpeg', { mediaBin: {
    resolveFfmpeg: () => { throw new Error('fixture'); },
  } }), 'ffmpeg');
  assert.equal(resolveMediaCommand('ffmpeg', { mediaBin: null }), 'ffmpeg');
  assert.equal(resolveMediaCommand('ffprobe', { mediaBin: { resolveFfprobe: null } }), 'ffprobe');
});

test('media-bin の先読み失敗は保持され、起動を妨げない', async () => {
  assert.equal(await preloadMediaBin(async () => { throw new Error('fixture'); }), null);
  assert.equal(resolveMediaCommand('ffmpeg'), 'ffmpeg');
  await preloadMediaBin();
});

test('PATH に ffmpeg がなくても voice check は media-bin の明示指定で実行する', async t => {
  if (process.platform === 'win32') { t.skip('POSIX シェルスクリプトを使う'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-media-bin-loader-'));
  const originalPath = process.env.PATH;
  const originalFfmpeg = process.env.AKARI_FFMPEG_BIN;
  t.after(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalFfmpeg === undefined) delete process.env.AKARI_FFMPEG_BIN;
    else process.env.AKARI_FFMPEG_BIN = originalFfmpeg;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const ffmpeg = path.join(root, 'ffmpeg');
  const pcm = Buffer.alloc(16000 * 20 * 2);
  for (let offset = 0; offset < pcm.length; offset += 2) pcm.writeInt16LE(1000, offset);
  fs.writeFileSync(`${ffmpeg}.pcm`, pcm);
  fs.writeFileSync(ffmpeg, '#!/bin/sh\nexec /bin/cat "$0.pcm"\n', { mode: 0o755 });
  fs.chmodSync(ffmpeg, 0o755);
  const emptyPath = path.join(root, 'empty-path');
  fs.mkdirSync(emptyPath);
  process.env.PATH = emptyPath;
  process.env.AKARI_FFMPEG_BIN = ffmpeg;
  await preloadMediaBin();

  const result = await checkVoiceRecording({ audio: 'dummy.wav', script: 'quick-v1' },
    { verifyScript: () => ({ status: 'unavailable' }) });
  assert.equal(result.checks.duration.value_s, 20);
});

test('media-bin が無い配布形態でも voice scripts が JSON を返す', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-media-bin-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = fileURLToPath(new URL('../', import.meta.url));
  const copy = path.join(root, 'packages', 'akari-launcher');
  fs.mkdirSync(copy, { recursive: true });
  for (const name of ['bin', 'src', 'package.json']) {
    fs.cpSync(path.join(source, name), path.join(copy, name), { recursive: true });
  }

  const result = spawnSync(process.execPath, [path.join(copy, 'bin', 'akari.mjs'), 'voice', 'scripts'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.scripts.map(script => script.id), ['quick-v1', 'extended-v1', 'consent-gemini']);
  assert.ok(output.scripts.every(script => typeof script.text === 'string' && script.text.length > 0));
});
