import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// /api/summary は単一スレッドのサーバで await される。重い WAV の判定（ffprobe）と
// サイドカー生成（ffmpeg）が spawnSync だと、その間は素材配信も止まる。
// server.mjs が media-bin の非同期 probe を使い、media-bin 側が spawn + 同時実行制限で
// 生成することをソースで固定する（生成挙動そのものは media-bin のテストが担う）。
const root = path.resolve(import.meta.dirname, '..');
const [serverSource, sidecarSource] = await Promise.all([
  readFile(path.join(root, 'src/server.mjs'), 'utf8'),
  readFile(path.join(root, '../media-bin/src/preview-audio-sidecar.mjs'), 'utf8'),
]);

test('/api/summary の重い WAV 判定は非同期 probe を await し、同期 probe をホットパスに残さない', () => {
  assert.match(serverSource,
    /ensurePreviewAudioSidecar,\n\s*probePreviewAudioSourceAsync,\n\s*sweepPreviewAudioSidecars,\n\} from '\.\.\/\.\.\/media-bin\/src\/preview-audio-sidecar\.mjs'/u);
  assert.match(serverSource, /const probe = await probePreviewAudioSourceAsync\(sourcePath\);/u);
  assert.doesNotMatch(serverSource, /probePreviewAudioSource\(/u, '同期 probe は preview-server では使わない');
  assert.match(serverSource, /const result = await ensurePreviewAudioSidecar\(\{/u);
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
