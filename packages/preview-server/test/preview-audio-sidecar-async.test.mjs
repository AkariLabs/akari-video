import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Summary は既知の状態だけを返し、生成・probe・掃除の完了を待たない。
// 背景の生成処理は引き続き spawn + 同時実行制限を使う。
const root = path.resolve(import.meta.dirname, '..');
const [serverSource, sidecarSource] = await Promise.all([
  readFile(path.join(root, 'src/server.mjs'), 'utf8'),
  readFile(path.join(root, '../media-bin/src/preview-audio-sidecar.mjs'), 'utf8'),
]);

test('/api/summary は生成・probe・掃除を呼ばず、背景完了を WebSocket で通知する', () => {
  const body = serverSource.split('async function readFrameEnginePreviewEdit(')[1]
    .split('function respondPreviewReadError(')[0];
  assert.match(body, /prepareFrameEngineAudioSummary\(/u);
  assert.doesNotMatch(body, /ensurePreviewAudioSidecar\(|probePreviewAudioSourceAsync\(|sweepPreviewAudioSidecars\(/u);
  assert.doesNotMatch(serverSource, /\bensurePreviewAudioSidecar\b|\bprobePreviewAudioSourceAsync\b|probePreviewAudioSource\(/u);
  assert.match(serverSource, /subscribePreviewAudioSidecarEvents\(/u);
  assert.match(serverSource, /type: 'preview-audio'/u);
  assert.match(serverSource, /GET \/api\/preview-audio\/status/u);
  assert.match(serverSource, /minAgeMs: 60 \* 60 \* 1000/u);
});

test('media-bin のサイドカー生成は非同期 spawn で、ffmpeg 2 本・ffprobe 4 本に制限される', () => {
  assert.match(sidecarSource, /export const PREVIEW_AUDIO_CONCURRENCY = Object\.freeze\(\{ ffmpeg: 2, ffprobe: 4 \}\)/u);
  assert.match(sidecarSource, /ffmpegSlots\.run\(settings\.concurrency\.ffmpeg, \(\) => runProcess\(ffmpeg,/u);
  assert.match(sidecarSource, /ffprobeSlots\.run\(settings\.concurrency\.ffprobe, \(\) => runProcess\(/u);
  assert.match(sidecarSource, /export async function probePreviewAudioSourceAsync\(/u);
  // spawnSync は同期 probe（スクリプト向けに残す probePreviewAudioSource）の 1 箇所だけ。
  assert.equal([...sidecarSource.matchAll(/spawnSync\(/gu)].length, 1);
  assert.doesNotMatch(sidecarSource, /Atomics\.wait/u, 'ロック待ちもイベントループを止めない');
});
