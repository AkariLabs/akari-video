import assert from 'node:assert/strict';
import test from 'node:test';
import { generationDraftFromDone, generationProvenance } from '../lib/browser/inspector/generation-provenance.js';

const video = {
  kind: 'video', status: 'done', model: { id: 'fal:h3-i2v', as_of: '2026-09-12' },
  inputs: { prompt: 'full\ntext', negative_prompt: 'blur', camera: { value: '[Pull out]' },
    first_frame: { path: 'frames/start.png' }, last_frame: { path: 'frames/end.png' },
    reference_images: [{ path: 'refs/example.png' }] },
  output: { duration_s: 6, resolution: '768P', audio_out: true },
  result: { duration_s_actual: 6.5, has_audio: true, elapsed_s: 24 },
  cost: { estimate_usd: 0.36 }, provenance: { created_at: '2026-09-28T00:00:00Z' }
};

test('動画の作り方は採用 meta の実入力だけを全行へ写し、next を読まない', () => {
  const details = generationProvenance({ ...video, next: { inputs: { prompt: 'future' } } }, () => 'H3（画像から）');
  const values = Object.fromEntries(details.rows.map(row => [row.key, row.value]));
  assert.equal(details.kind, 'video');
  assert.equal(values.model, 'H3（画像から）');
  assert.equal(values.prompt, 'full\ntext');
  assert.equal(values['negative-prompt'], 'blur');
  assert.equal(values.camera, '引く');
  assert.equal(values.first_frame, 'start.png');
  assert.equal(values.last_frame, 'end.png');
  assert.equal(values['reference_images-0'], 'example.png');
  assert.equal(values.duration, '6 秒');
  assert.equal(values['actual-duration'], '6.5 秒');
  assert.equal(values.resolution, '768P');
  assert.equal(values['audio-out'], 'あり');
  assert.equal(values.cost, '見積 $0.36 · as_of 2026-09-12');
  assert.equal(values.created, '2026-09-28T00:00:00Z');
  assert.equal(values.elapsed, '24 秒');
  assert.equal(generationDraftFromDone(video).inputs.prompt, 'full\ntext');
});

test('静止画とナレーションも記録のある行だけ出す', () => {
  const still = generationProvenance({ kind: 'still', status: 'done', model: { id: 'codex:image' },
    inputs: { prompt: 'garden', reference_images: [{ path: 'ref.png' }] }, output: { aspect: '16:9' } });
  assert.equal(still.kind, 'image');
  assert.deepEqual(still.rows.map(row => row.key), ['model', 'prompt', 'reference_images-0']);
  const audio = generationProvenance({ kind: 'audio', status: 'done', model: { id: 'voicevox:tts' },
    inputs: { prompt: 'hello' }, voice: 'speaker-3', job: { elapsed_s: 2 } });
  assert.equal(audio.kind, 'audio');
  assert.deepEqual(audio.rows.map(row => row.key), ['model', 'prompt', 'elapsed', 'voice']);
  assert.equal(audio.rows.find(row => row.key === 'prompt').label, '原稿');
});

test('meta が無い・完成していない item に作り方を作らない', () => {
  for (const meta of [undefined, {}, { ...video, status: 'planned' }, { ...video, kind: 'other' }]) {
    assert.equal(generationProvenance(meta), undefined);
  }
});
