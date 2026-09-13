import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SlotInputError, validateInputs } from '../src/index.mjs';

function loadModel(filename) {
  return JSON.parse(readFileSync(new URL(`fixtures/models/${filename}`, import.meta.url), 'utf8'));
}

const MODELS = {
  h3: loadModel('h3-i2v.json'),
  kling: loadModel('kling-v3-pro-i2v.json'),
  seedance: loadModel('seedance-2.0-reference.json'),
  veo: loadModel('veo-3.1-first-last.json'),
  grok: loadModel('grok-imagine-i2v.json'),
};

const ref = (path, range_s) => range_s ? { path, range_s } : { path };
const many = (count, prefix, range_s) => Array.from(
  { length: count },
  (_, index) => ref(`${prefix}-${index}`, range_s),
);
const veoInputs = { first_frame: ref('first.png'), last_frame: ref('last.png') };
const klingInputs = { first_frame: ref('first.png') };
const grokInputs = { first_frame: ref('first.png') };

const CASES = [
  {
    name: 'Veo の 7.2 秒を近い 8 秒へ丸め差も示す', model: MODELS.veo, inputs: veoInputs,
    output: { duration_s: 7.2, resolution: '1080p' },
    expect: { ok: true, codes: ['duration.rounded'], rounded: { duration_s: { from: 7.2, to: 8, reason: 'enum' } }, texts: { 'duration.rounded': '尺 7.2 秒 → 8 秒に丸めました（Veo 3.1 first-last は 4 / 6 / 8 秒のみ）。差 0.8 秒' } },
  },
  {
    name: 'Veo の 6.2 秒を 6 秒へ丸め差の句は出さない', model: MODELS.veo, inputs: veoInputs,
    output: { duration_s: 6.2, resolution: '1080p' },
    expect: { ok: true, codes: ['duration.rounded'], rounded: { duration_s: { from: 6.2, to: 6, reason: 'enum' } }, texts: { 'duration.rounded': '尺 6.2 秒 → 6 秒に丸めました（Veo 3.1 first-last は 4 / 6 / 8 秒のみ）' } },
  },
  {
    name: 'Veo の同距離 5 秒は短い 4 秒へ丸める', model: MODELS.veo, inputs: veoInputs,
    output: { duration_s: 5, resolution: '720p' },
    expect: { ok: true, codes: ['duration.rounded'], rounded: { duration_s: { from: 5, to: 4, reason: 'enum' } } },
  },
  {
    name: 'H3 の上限外 20 秒を 15 秒へ clamp する', model: MODELS.h3, inputs: {},
    output: { duration_s: 20, resolution: '768P' },
    expect: { ok: true, codes: ['duration.rounded'], rounded: { duration_s: { from: 20, to: 15, reason: 'clamp' } }, texts: { 'duration.rounded': '尺 20 秒 → 15 秒に丸めました（MiniMax H3 は 5〜15 秒）。差 5 秒' } },
  },
  {
    name: 'Kling の下限外 2.4 秒を 3 秒へ clamp する', model: MODELS.kling, inputs: klingInputs,
    output: { duration_s: 2.4 },
    expect: { ok: true, codes: ['duration.rounded'], rounded: { duration_s: { from: 2.4, to: 3, reason: 'clamp' } }, texts: { 'duration.rounded': '尺 2.4 秒 → 3 秒に丸めました（Kling v3 pro は 3〜15 秒）。差 0.6 秒' } },
  },
  {
    name: 'H3 の 6.592 秒を step で 7 秒へ丸める', model: MODELS.h3, inputs: {},
    output: { duration_s: 6.592, resolution: '768P' },
    expect: { ok: true, codes: ['duration.rounded'], rounded: { duration_s: { from: 6.592, to: 7, reason: 'step' } }, texts: { 'duration.rounded': '尺 6.592 秒 → 7 秒に丸めました（MiniMax H3 は 5〜15 秒）' } },
  },
  {
    name: 'H3 の許容値 6 秒は丸めない', model: MODELS.h3, inputs: {},
    output: { duration_s: 6, resolution: '768P' },
    expect: { ok: true, codes: [], rounded: null },
  },
  {
    name: 'Seedance の参照画像 10 枚は上限 9 枚を超える', model: MODELS.seedance,
    inputs: { reference_images: many(10, 'image.png') }, output: { resolution: '720p' },
    expect: { ok: false, codes: ['reference_images.max'], texts: { 'reference_images.max': '参照画像は 9 枚までです（10 枚）' } },
  },
  {
    name: 'Seedance の参照動画 4 本は上限 3 本を超える', model: MODELS.seedance,
    inputs: { reference_videos: many(4, 'video.mp4', [0, 1]) }, output: { resolution: '720p' },
    expect: { ok: false, codes: ['reference_videos.max'], texts: { 'reference_videos.max': '参照動画は 3 本までです（4 本）' } },
  },
  {
    name: 'Seedance の参照音声 4 本は上限 3 本を超える', model: MODELS.seedance,
    inputs: { reference_audios: many(4, 'audio.wav', [0, 1]) }, output: { resolution: '720p' },
    expect: { ok: false, codes: ['reference_audios.max'], texts: { 'reference_audios.max': '参照音声は 3 本までです（4 本）' } },
  },
  {
    name: 'Seedance の参照動画 20 秒は単体と合計の両上限を超える', model: MODELS.seedance,
    inputs: { reference_videos: [ref('video.mp4', [0, 20])] }, output: { resolution: '720p' },
    expect: { ok: false, codes: ['reference_videos.max_seconds_each', 'reference_videos.max_seconds_total'], texts: { 'reference_videos.max_seconds_each': '参照動画は 1 本あたり 15 秒までです（20 秒）', 'reference_videos.max_seconds_total': '参照動画は合計 15 秒までです（20 秒）' } },
  },
  {
    name: 'Seedance の参照動画 10 秒二本は合計だけ上限を超える', model: MODELS.seedance,
    inputs: { reference_videos: many(2, 'video.mp4', [0, 10]) }, output: { resolution: '720p' },
    expect: { ok: false, codes: ['reference_videos.max_seconds_total'] },
  },
  {
    name: 'Seedance の参照音声は合計 20 秒だけを検査する', model: MODELS.seedance,
    inputs: { reference_audios: many(2, 'audio.wav', [0, 10]) }, output: { resolution: '720p' },
    expect: { ok: false, codes: ['reference_audios.max_seconds_total'] },
  },
  {
    name: 'Kling の未知上限は多数の参照画像を拒否しない', model: MODELS.kling,
    inputs: { ...klingInputs, reference_images: many(20, 'image.png') }, output: {},
    expect: { ok: true, codes: [] },
  },
  {
    name: 'Seedance はフレームと参照画像の併用を拒否する', model: MODELS.seedance,
    inputs: { first_frame: ref('first.png'), reference_images: [ref('reference.png')] }, output: { resolution: '720p' },
    expect: { ok: false, codes: ['frames_refs.exclusive'], texts: { 'frames_refs.exclusive': 'このモデルはフレーム指定と参照を同時に使えません。どちらかにしてください' } },
  },
  {
    name: 'Seedance は参照画像だけなら受け入れる', model: MODELS.seedance,
    inputs: { reference_images: [ref('reference.png')] }, output: { resolution: '720p' },
    expect: { ok: true, codes: [] },
  },
  {
    name: 'Seedance はフレームだけなら受け入れる', model: MODELS.seedance,
    inputs: { first_frame: ref('first.png') }, output: { resolution: '720p' },
    expect: { ok: true, codes: [] },
  },
  {
    name: 'Grok の価格不明は確認要求を返すが ok を落とさない', model: MODELS.grok,
    inputs: grokInputs, output: { duration_s: 6, resolution: '720p' },
    expect: { ok: true, codes: ['price.unknown'], cost: { estimate_usd: null, needs_explicit_confirm: true } },
  },
  {
    name: 'Seedance 480p の未記録価格は確認要求を返すが ok を落とさない', model: MODELS.seedance,
    inputs: {}, output: { duration_s: 5, resolution: '480p' },
    expect: { ok: true, codes: ['price.unknown'], cost: { estimate_usd: null, needs_explicit_confirm: true } },
  },
  {
    name: 'H3 は許可された extra を保持する', model: MODELS.h3,
    inputs: { extra: { prompt_expansion_mode: 'fast' } }, output: { resolution: '768P' },
    expect: { ok: true, codes: [], extra: { prompt_expansion_mode: 'fast' } },
  },
  {
    name: 'H3 は許可外 extra を拒否して正規化結果から落とす', model: MODELS.h3,
    inputs: { extra: { foo: 1 } }, output: { resolution: '768P' },
    expect: { ok: false, codes: ['extra.not_allowed'], texts: { 'extra.not_allowed': 'このモデルは extra.foo を受けません' }, extra: {} },
  },
  {
    name: 'Grok は任意の extra を拒否する', model: MODELS.grok,
    inputs: { ...grokInputs, extra: { style: 'film' } }, output: { resolution: '720p' },
    expect: { ok: false, codes: ['extra.not_allowed', 'price.unknown'], extra: {} },
  },
  {
    name: 'Veo は最初のフレーム必須を検査する', model: MODELS.veo,
    inputs: { last_frame: ref('last.png') }, output: { resolution: '720p' },
    expect: { ok: false, codes: ['first_frame.required'] },
  },
  {
    name: 'Veo は最後のフレーム必須を検査する', model: MODELS.veo,
    inputs: { first_frame: ref('first.png') }, output: { resolution: '720p' },
    expect: { ok: false, codes: ['last_frame.required'] },
  },
  {
    name: 'Grok は最後のフレームを拒否する', model: MODELS.grok,
    inputs: { ...grokInputs, last_frame: ref('last.png') }, output: { resolution: '720p' },
    expect: { ok: false, codes: ['last_frame.unsupported', 'price.unknown'] },
  },
  {
    name: 'Grok はネガティブプロンプトを拒否する', model: MODELS.grok,
    inputs: { ...grokInputs, negative_prompt: 'blur' }, output: { resolution: '720p' },
    expect: { ok: false, codes: ['negative_prompt.unsupported', 'price.unknown'] },
  },
  {
    name: 'Kling はネガティブプロンプトを受け入れる', model: MODELS.kling,
    inputs: { ...klingInputs, negative_prompt: 'blur' }, output: {},
    expect: { ok: true, codes: [] },
  },
  {
    name: 'H3 は trajectory カメラ記法を prose に落とす', model: MODELS.h3,
    inputs: { camera: { notation: 'trajectory', value: [[0, 0, 0]] } }, output: { resolution: '768P' },
    expect: { ok: true, codes: ['camera.notation_fallback'], cameraNotation: 'prose' },
  },
  {
    name: 'Grok は bracket カメラ記法を prose に落とす', model: MODELS.grok,
    inputs: { ...grokInputs, camera: { notation: 'bracket', value: '[pan left]' } }, output: { resolution: '720p' },
    expect: { ok: true, codes: ['camera.notation_fallback', 'price.unknown'], cameraNotation: 'prose' },
  },
  {
    name: 'H3 は一致する bracket カメラ記法を保つ', model: MODELS.h3,
    inputs: { camera: { notation: 'bracket', value: '[pan left]' } }, output: { resolution: '768P' },
    expect: { ok: true, codes: [], cameraNotation: 'bracket' },
  },
  {
    name: 'H3 は prose カメラ記法をそのまま通す', model: MODELS.h3,
    inputs: { camera: { notation: 'prose', value: 'ゆっくり寄る' } }, output: { resolution: '768P' },
    expect: { ok: true, codes: [], cameraNotation: 'prose' },
  },
  {
    name: 'H3 は参照画像を受けない（上限 0 枚）', model: MODELS.h3,
    inputs: { reference_images: [ref('reference.png')] }, output: { resolution: '768P' },
    expect: { ok: false, codes: ['reference_images.max'], texts: { 'reference_images.max': '参照画像は 0 枚までです（1 枚）' } },
  },
  {
    name: 'Kling は非対応 seed を通知して落とす', model: MODELS.kling,
    inputs: { ...klingInputs, seed: 42 }, output: {},
    expect: { ok: true, codes: ['seed.unsupported'], seed: null },
  },
  {
    name: 'H3 は対応する seed を保持する', model: MODELS.h3,
    inputs: { seed: 42 }, output: { resolution: '768P' },
    expect: { ok: true, codes: [], seed: 42 },
  },
  {
    name: 'H3 は列挙外の解像度を拒否して候補を示す', model: MODELS.h3,
    inputs: {}, output: { resolution: '1080p' },
    expect: { ok: false, codes: ['resolution.invalid', 'price.unknown'], texts: { 'resolution.invalid': '解像度 1080p はこのモデルにありません（480P / 768P / 2K / 4K）' } },
  },
  {
    name: 'Kling は選択不能な解像度指定を拒否する', model: MODELS.kling,
    inputs: klingInputs, output: { resolution: '720p' },
    expect: { ok: false, codes: ['resolution.invalid', 'price.unknown'], texts: { 'resolution.invalid': '解像度 720p はこのモデルにありません（このモデルは解像度を選べません）' } },
  },
  {
    name: 'Veo は列挙外のアスペクト比を拒否する', model: MODELS.veo,
    inputs: veoInputs, output: { resolution: '1080p', aspect: '1:1' },
    expect: { ok: false, codes: ['aspect.invalid'] },
  },
  {
    name: 'Veo は 16:9 のアスペクト比を受け入れる', model: MODELS.veo,
    inputs: veoInputs, output: { resolution: '1080p', aspect: '16:9' },
    expect: { ok: true, codes: [] },
  },
  {
    name: 'H3 768P 6 秒の費用は 0.36 ドルになる', model: MODELS.h3,
    inputs: {}, output: { duration_s: 6, resolution: '768P' },
    expect: { ok: true, codes: [], cost: { estimate_usd: 0.36, as_of: '2026-09-12', source: 'estimate' } },
  },
  {
    name: 'Veo 1080p 8 秒音声ありの費用は 3.2 ドルになる', model: MODELS.veo,
    inputs: veoInputs, output: { duration_s: 8, resolution: '1080p', audio_out: true },
    expect: { ok: true, codes: [], cost: { estimate_usd: 3.2, as_of: '2026-09-12', source: 'estimate' } },
  },
  {
    name: 'Kling 6 秒音声ありの費用は 1.008 ドルになる', model: MODELS.kling,
    inputs: klingInputs, output: { duration_s: 6, audio_out: true },
    expect: { ok: true, codes: [], cost: { estimate_usd: 1.008, as_of: '2026-09-12', source: 'estimate' } },
  },
  {
    name: 'H3 は audio_out 指定なしでも必ず true にする', model: MODELS.h3,
    inputs: {}, output: { resolution: '768P' },
    expect: { ok: true, codes: [], audioOut: true },
  },
  {
    name: 'Veo は尺未指定時に既定 8 秒を丸めず費用計算する', model: MODELS.veo,
    inputs: veoInputs, output: { resolution: '1080p' },
    expect: { ok: true, codes: [], rounded: null, duration: 8, cost: { estimate_usd: 3.2, as_of: '2026-09-12', source: 'estimate' } },
  },
  {
    name: 'エラーがある結果では ok が false になる', model: MODELS.veo,
    inputs: {}, output: { resolution: '720p' },
    expect: { ok: false, codes: ['first_frame.required', 'last_frame.required'], hasError: true },
  },
];

for (const c of CASES) {
  test(c.name, () => {
    const result = validateInputs({ inputs: c.inputs, output: c.output, model: c.model });
    assert.equal(result.ok, c.expect.ok);
    assert.deepEqual(result.messages.map(({ code }) => code), c.expect.codes);
    if ('rounded' in c.expect) assert.deepEqual(result.rounded, c.expect.rounded);
    if (c.expect.cost) assert.deepEqual(result.cost, c.expect.cost);
    if (c.expect.texts) {
      for (const [code, text] of Object.entries(c.expect.texts)) {
        assert.equal(result.messages.find((message) => message.code === code)?.text, text);
      }
    }
    if ('extra' in c.expect) assert.deepEqual(result.normalized.inputs.extra, c.expect.extra);
    if ('cameraNotation' in c.expect) assert.equal(result.normalized.inputs.camera.notation, c.expect.cameraNotation);
    if ('seed' in c.expect) assert.equal(result.normalized.inputs.seed, c.expect.seed);
    if ('audioOut' in c.expect) assert.equal(result.normalized.output.audio_out, c.expect.audioOut);
    if ('duration' in c.expect) assert.equal(result.normalized.output.duration_s, c.expect.duration);
    if (c.expect.hasError) assert.ok(result.messages.some(({ level }) => level === 'error'));
  });
}

test('model がなければ fail closed の専用エラーになる', () => {
  assert.throws(
    () => validateInputs({ inputs: {}, output: {}, model: null }),
    (error) => error instanceof SlotInputError && error.code === 'model.required',
  );
});
