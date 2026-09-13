import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SLOT_KEYS,
  SlotInputError,
  normalizeInputs,
  normalizeOutput,
  normalizeReference,
  referenceSeconds,
} from '../src/index.mjs';

test('スロットキーは契約順で公開される', () => {
  assert.deepEqual(SLOT_KEYS, [
    'prompt', 'negative_prompt', 'first_frame', 'last_frame', 'reference_images',
    'reference_videos', 'reference_audios', 'source_video', 'camera', 'seed', 'extra',
  ]);
});

test('欠けた入力スロットを null と空配列で埋める', () => {
  assert.deepEqual(normalizeInputs(), {
    prompt: null,
    negative_prompt: null,
    first_frame: null,
    last_frame: null,
    reference_images: [],
    reference_videos: [],
    reference_audios: [],
    source_video: null,
    mode: null,
    camera: null,
    seed: null,
    extra: {},
  });
});

test('参照要素の省略可能項目を null で埋める', () => {
  assert.deepEqual(normalizeReference({ path: 'frame.png' }, 'first_frame'), {
    path: 'frame.png',
    sha256: null,
    source_id: null,
    name: null,
    role: null,
    range_s: null,
  });
});

test('参照要素がオブジェクトでなければ専用エラーになる', () => {
  assert.throws(
    () => normalizeReference('frame.png', 'first_frame'),
    (error) => error instanceof SlotInputError && error.code === 'reference.invalid',
  );
});

test('参照要素に path がなければ専用エラーになる', () => {
  assert.throws(
    () => normalizeReference({}, 'first_frame'),
    (error) => error instanceof SlotInputError && error.code === 'reference.path_required',
  );
});

test('range_s が長さ2の配列でなければ専用エラーになる', () => {
  assert.throws(
    () => normalizeReference({ path: 'clip.mp4', range_s: [0] }, 'reference_videos[0]'),
    (error) => error instanceof SlotInputError && error.code === 'reference.range_invalid',
  );
});

test('range_s の開始が終了以上なら専用エラーになる', () => {
  assert.throws(
    () => normalizeReference({ path: 'clip.mp4', range_s: [3, 3] }, 'reference_videos[0]'),
    (error) => error instanceof SlotInputError && error.code === 'reference.range_invalid',
  );
});

test('参照一覧が配列でなければ専用エラーになる', () => {
  assert.throws(
    () => normalizeInputs({ reference_images: {} }),
    (error) => error instanceof SlotInputError && error.code === 'reference.invalid',
  );
});

test('参照一覧に明示的な null を渡しても専用エラーになる', () => {
  assert.throws(
    () => normalizeInputs({ reference_videos: null }),
    (error) => error instanceof SlotInputError && error.code === 'reference.invalid',
  );
});

test('camera の notation は prose を既定にする', () => {
  assert.deepEqual(normalizeInputs({ camera: { value: 'pan left' } }).camera, {
    notation: 'prose',
    value: 'pan left',
    from_annotation: null,
  });
});

test('extra は浅く複製して入力元の後続変更から分離する', () => {
  const extra = { cfg: 1 };
  const normalized = normalizeInputs({ extra });
  extra.cfg = 2;
  assert.deepEqual(normalized.extra, { cfg: 1 });
});

test('extra がオブジェクトでなければ専用エラーになる', () => {
  assert.throws(
    () => normalizeInputs({ extra: 'invalid' }),
    (error) => error instanceof SlotInputError && error.code === 'extra.invalid',
  );
});

test('seed が整数でなければ専用エラーになる', () => {
  assert.throws(
    () => normalizeInputs({ seed: 1.5 }),
    (error) => error instanceof SlotInputError && error.code === 'seed.invalid',
  );
});

test('出力ノブの既定値を null で埋める', () => {
  assert.deepEqual(normalizeOutput(), {
    duration_s: null,
    resolution: null,
    aspect: null,
    audio_out: null,
  });
});

test('有限数でない尺を null にする', () => {
  assert.equal(normalizeOutput({ duration_s: Number.POSITIVE_INFINITY }).duration_s, null);
});

test('参照区間の秒数を返し、区間なしは null を返す', () => {
  assert.equal(referenceSeconds({ range_s: [1.25, 4.5] }), 3.25);
  assert.equal(referenceSeconds({ range_s: null }), null);
});
