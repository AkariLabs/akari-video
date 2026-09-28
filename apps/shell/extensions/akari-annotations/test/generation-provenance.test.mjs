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
  const created = new Date(video.provenance.created_at);
  const pad = value => String(value).padStart(2, '0');
  assert.equal(values.created, `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())} ${pad(created.getHours())}:${pad(created.getMinutes())}`);
  assert.equal(values.elapsed, '24 秒');
  assert.equal(generationDraftFromDone(video).inputs.prompt, 'full\ntext');
});

test('作った日時は端末の現地時刻で分まで表示し、読めない値はそのまま残す', () => {
  const rows = meta => Object.fromEntries(generationProvenance(meta).rows.map(row => [row.key, row.value]));
  const started = '2026-09-28T00:13:10.717Z';
  const local = new Date(started);
  const pad = value => String(value).padStart(2, '0');
  assert.equal(rows({ ...video, provenance: {}, job: { started_at: started } }).created,
    `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`);
  assert.equal(rows({ ...video, provenance: { created_at: '不明な日時' } }).created, '不明な日時');
});

test('所要秒だけ整数に丸め、1 秒未満を区別する', () => {
  const value = meta => generationProvenance(meta).rows.find(row => row.key === 'elapsed').value;
  assert.equal(value({ ...video, result: { elapsed_s: 12.241 } }), '12 秒');
  assert.equal(value({ ...video, result: { elapsed_s: 0.7 } }), '1 秒未満');
  assert.equal(value({ ...video, result: {}, job: { elapsed_s: 1.8 } }), '2 秒');
});

test('声はナレーションパネルの声一覧から表示名を引き、未知の id は残す', () => {
  const voicesByEngine = { voicevox: [{ id: '3', label: 'ずんだもん（ノーマル）' }] };
  const voiceName = (id, engineId) => voicesByEngine[engineId]?.find(voice => voice.id === id)?.label;
  const value = (meta, lookup = voiceName) => generationProvenance(meta, undefined, lookup).rows.find(row => row.key === 'voice').value;
  const meta = { kind: 'audio', status: 'done', route: 'voicevox', voice: '3' };
  assert.equal(value(meta), 'ずんだもん（ノーマル）');
  assert.equal(value({ ...meta, voice: 'unknown' }), 'unknown');
  assert.equal(value({ ...meta, route: undefined, model: { id: 'voicevox:tts' } }), 'ずんだもん（ノーマル）');
  assert.equal(value(meta, () => undefined), '3');
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
