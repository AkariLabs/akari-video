import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { generationFactLabel, generationFields } from '../lib/browser/inspector/generation-fields.js';
import { validateInputs } from '../../../../../packages/generate/src/validate-inputs.mjs';

const actualCatalog = JSON.parse(readFileSync(
  new URL('../../../../../packages/schemas/gen-models.json', import.meta.url), 'utf8'
));
const actualVideoModels = actualCatalog.models.filter(model => model.kind === 'video');

const base = {
  kind: 'video', inputs: { first_frame: 'required', last_frame: 'optional', reference_images: { max: 0 }, reference_audios: { max: 0 }, negative_prompt: false },
  duration: { kind: 'range', min: 5, max: 15 }, resolutions: ['720p'], audio_out: true, as_of: '2026-09-12'
};
const models = [
  { ...base, id: 'fal:h3-i2v', family: 'MiniMax H3', inputs: { ...base.inputs, first_frame: 'optional' }, audio_out: 'always', price: { by_resolution: { '720p': 0.06 } } },
  { ...base, id: 'fal:kling-v3-standard-i2v', family: 'Kling Standard', inputs: { ...base.inputs, negative_prompt: true, reference_images: { max: null } }, resolutions: null, price: null },
  { ...base, id: 'fal:veo-3.1-flf', family: 'Veo', inputs: { ...base.inputs, last_frame: 'required', negative_prompt: true }, duration: { kind: 'enum', values: [4, 6, 8] }, price: { by_resolution: { '720p': 0.2 } } },
  { ...base, id: 'fal:grok-imagine-i2v', family: 'Grok', inputs: { ...base.inputs, last_frame: 'none' }, audio_out: false, price: null }
];

const actions = Object.fromEntries(['update', 'copyAdjacent', 'generate', 'resume', 'retry'].map(name => [name, async () => ({ ok: true })]));
const draft = modelId => ({ modelId, inputs: { prompt: '', first_frame: { path: 'still.png' }, last_frame: null, reference_images: [] }, output: { duration_s: 6, resolution: '720p', audio_out: true } });
const names = fields => fields.flatMap(field => [field.name, ...(field.generationReferences?.kinds.map(kind => kind.slot) ?? [])]);

test('generationFields はモデル能力・見積・エラーを表駆動で欄へ反映する', () => {
  const cases = [
    { model: models[0], has: ['first-frame', 'generation-audio-always'], lacks: ['negative-prompt', 'reference_images'], estimate: '$0.36' },
    { model: models[1], has: ['negative-prompt', 'reference_images'], lacks: ['generation-audio-always'], estimate: '見積不可' },
    { model: models[2], has: ['negative-prompt', 'last_frame'], lacks: ['reference_images'], estimate: '$1.20', rounded: true },
    { model: models[3], has: ['generation-message'], lacks: ['last_frame', 'negative-prompt'], estimate: '見積不可', error: true }
  ];
  for (const row of cases) {
    const validation = {
      ok: !row.error,
      rounded: row.rounded ? { duration_s: { from: 6, to: 8 } } : null,
      messages: row.error ? [{ level: 'error', text: '最後のフレームを使えません' }] : [],
      cost: { estimate_usd: row.estimate.startsWith('$') ? Number(row.estimate.slice(1)) : null, as_of: '2026-09-12' }
    };
    const fields = generationFields({ snapshot: {}, catalogRow: row.model, draft: draft(row.model.id), validation, defaults: { catalog: models }, actions });
    for (const name of row.has) assert.ok(names(fields).includes(name), `${row.model.id}: ${name}`);
    for (const name of row.lacks) assert.ok(!names(fields).includes(name), `${row.model.id}: ${name}`);
    assert.match(fields.find(field => field.name === 'generation-estimate').getValue({}), new RegExp(row.estimate.replace('$', '\\$')));
    if (row.rounded) assert.equal(fields.find(field => field.name === 'generation-duration').getValue({}), '6 秒 → 8 秒');
    if (row.model.id.includes('kling')) assert.ok(fields.find(field => field.generationReferences).generationReferences.kinds.some(kind => kind.slot === 'reference_images' && kind.max === null));
  }
});

test('実カタログの全 video 行は事実帯ラベルが一意で、select write が同じ id へ往復する', async () => {
  const labels = actualVideoModels.map(generationFactLabel);
  assert.equal(new Set(labels).size, actualVideoModels.length);
  for (const model of actualVideoModels) {
    const updates = [];
    const actualActions = {
      ...actions,
      update: async (path, value) => { updates.push([path, value]); return { ok: true }; }
    };
    const fields = generationFields({
      snapshot: {}, catalogRow: model, draft: draft(model.id),
      validation: { ok: true, messages: [], cost: { estimate_usd: null } },
      defaults: { catalog: actualVideoModels }, actions: actualActions
    });
    const select = fields.find(field => field.name === 'generation-model');
    const label = generationFactLabel(model);
    assert.ok(select.options.includes(label), `${model.id} の option が無い`);
    await select.write({}, label);
    assert.deepEqual(updates, [['modelId', model.id]], `${model.id} の label→id 往復`);
  }
});

test('実カタログ 4 行で欄・見積・エラー・尺丸めを検証する', () => {
  const specs = [
    {
      id: 'fal:h3-i2v', resolution: '768P', duration: 6,
      has: ['first-frame', 'generation-audio-always'], lacks: ['negative-prompt', 'reference_images'],
      estimate: '$0.36'
    },
    {
      id: 'fal:kling-v3-standard-i2v', resolution: null, duration: 6,
      has: ['negative-prompt', 'reference_images'], lacks: ['generation-audio-always'], estimate: '見積不可',
      counterless: true
    },
    {
      id: 'fal:veo-3.1-flf', resolution: '720p', duration: '6',
      has: ['negative-prompt', 'last_frame', 'generation-message'], lacks: ['reference_images'],
      estimate: '$3.20', rounded: '6 秒 → 8 秒', error: true
    },
    {
      id: 'fal:grok-imagine-i2v', resolution: '720p', duration: 6,
      has: ['generation-message'], lacks: ['last_frame', 'negative-prompt'], estimate: '見積不可', error: true,
      unsupportedLast: true
    }
  ];
  for (const spec of specs) {
    const model = actualVideoModels.find(candidate => candidate.id === spec.id);
    assert.ok(model, spec.id);
    const current = draft(spec.id);
    current.output = { duration_s: spec.duration, resolution: spec.resolution, audio_out: true };
    if (spec.unsupportedLast) current.inputs.last_frame = { path: 'last.png' };
    const validation = validateInputs({ inputs: current.inputs, output: current.output, model });
    const fields = generationFields({
      snapshot: {}, catalogRow: model, draft: current, validation,
      defaults: { catalog: actualVideoModels }, actions
    });
    for (const name of spec.has) assert.ok(names(fields).includes(name), `${spec.id}: ${name}`);
    for (const name of spec.lacks) assert.ok(!names(fields).includes(name), `${spec.id}: ${name}`);
    assert.match(fields.find(field => field.name === 'generation-estimate').getValue({}),
      new RegExp(spec.estimate.replace('$', '\\$')));
    if (spec.rounded) assert.equal(fields.find(field => field.name === 'generation-duration').getValue({}), spec.rounded);
    if (spec.error) assert.ok(fields.some(field => field.className === 'akari-inspector-generation-error'));
    if (spec.counterless) assert.ok(fields.find(field => field.generationReferences).generationReferences.kinds.some(kind => kind.slot === 'reference_images' && kind.max === null));
  }
});

test('generating は「動画にする」を disabled、stale は「再取得」を表示する', () => {
  const validation = { ok: true, messages: [], cost: { estimate_usd: 0.36 } };
  const fieldsFor = state => generationFields({
    snapshot: {}, catalogRow: models[0], draft: draft(models[0].id), validation,
    defaults: { catalog: models, state }, actions
  });
  const generating = fieldsFor('generating').find(field => field.name === 'generation-actions').actions;
  assert.equal(generating.find(action => action.name === 'generate').disabled, true);
  assert.match(generating.find(action => action.name === 'generate').label, /生成中/u);
  const stale = fieldsFor('stale').find(field => field.name === 'generation-actions').actions;
  assert.equal(stale.find(action => action.name === 'resume').label, '再取得');
});

import { GENERATION_CAMERA_MOVES, generationCameraValue, generationVariety } from '../lib/browser/inspector/generation-fields.js';

test('実カタログ 5 モデル × 最初・最後・参照・カメラ・音声・入れたくないもの', () => {
  const columns = ['first-frame', 'last_frame', 'reference_images', 'reference_audios', 'camera', 'generation-audio', 'generation-audio-always', 'negative-prompt'];
  const rows = [
    ['fal:h3-i2v',                   [1, 1, 0, 0, 1, 0, 1, 0]],
    ['fal:h3-ref',             [0, 0, 1, 1, 1, 0, 1, 0]],
    ['fal:kling-v3-standard-i2v',     [1, 1, 1, 0, 1, 1, 0, 1]],
    ['fal:veo-3.1-flf',              [1, 1, 0, 0, 1, 1, 0, 1]],
    ['fal:seedance-2.0-i2v',         [1, 1, 0, 0, 1, 1, 0, 0]],
  ];
  for (const [id, expected] of rows) {
    const model = actualVideoModels.find(row => row.id === id);
    assert.ok(model, id);
    const fields = generationFields({ snapshot: {}, catalogRow: model, draft: draft(id), defaults: { catalog: actualVideoModels }, actions });
    assert.deepEqual(columns.map(name => Number(names(fields).includes(name))), expected, id);
    for (const field of fields.filter(row => ['seed', 'negative-prompt'].includes(row.name))) assert.equal(field.generationDetail, true, field.name);
    for (const field of fields.filter(row => row.generationReferences)) assert.notEqual(field.generationDetail, true, field.name);
  }
});

test('種類 1 行と外すは枠の実入力から決まる・近道は利用可能な画像だけ', async () => {
  const model = actualVideoModels.find(row => row.id === 'fal:h3-i2v');
  for (const [first, last, label] of [[null, null, 'プロンプトだけ'], [{ path: 'a.png' }, null, '画像から'], [{ path: 'a.png' }, { path: 'b.png' }, '最初→最後']]) {
    const current = draft(model.id); current.inputs.first_frame = first; current.inputs.last_frame = last;
    const updates = [];
    const fields = generationFields({ snapshot: {}, catalogRow: model, draft: current, defaults: { catalog: actualVideoModels, currentImage: 'self.png', nextImage: 'next.png' }, actions: { ...actions, update: async (...args) => { updates.push(args); return { ok: true }; } } });
    assert.equal(fields.find(row => row.name === 'generation-variety').getValue({}), label);
    for (const [name, value] of [['first-frame', first], ['last_frame', last]]) {
      const frame = fields.find(row => row.name === name);
      assert.equal(frame.disabled, undefined);
      assert.equal(frame.actions.some(action => action.name === 'remove'), !!value);
    }
    const firstActions = fields.find(row => row.name === 'first-frame').actions;
    assert.equal(firstActions.some(action => action.name === 'previous'), false);
    await firstActions.find(action => action.name === 'current').action({});
    assert.deepEqual(updates[0], ['inputs.first_frame', { path: 'self.png' }]);
    const lastActions = fields.find(row => row.name === 'last_frame').actions;
    await lastActions.find(action => action.name === 'next').action({});
    assert.deepEqual(updates[1], ['inputs.last_frame', { path: 'next.png' }]);
  }
  assert.equal(generationVariety({ ...draft(model.id), inputs: { frames_or_refs: 'references' } }), '参照から');
});

test('カメラ 6 ボタン × bracket/prose 対応表のスナップショット', () => {
  assert.deepEqual(GENERATION_CAMERA_MOVES, [
    { label: '寄る', bracket: '[Push in]', prose: 'The camera pushes in.' },
    { label: '引く', bracket: '[Pull out]', prose: 'The camera pulls out.' },
    { label: '左へ振る', bracket: '[Pan left]', prose: 'The camera pans left.' },
    { label: '右へ振る', bracket: '[Pan right]', prose: 'The camera pans right.' },
    { label: '追いかける', bracket: '[Tracking shot]', prose: 'The camera tracks the subject.' },
    { label: '固定', bracket: '[Static shot]', prose: 'The camera stays static.' },
  ]);
  for (const move of GENERATION_CAMERA_MOVES) for (const notation of ['bracket', 'prose']) {
    assert.deepEqual(generationCameraValue(move.label, notation), { notation, value: move[notation], from_annotation: null });
  }
  assert.equal(generationCameraValue('なし', 'bracket'), null);
  const model = { ...models[0], inputs: { ...models[0].inputs, camera: null } };
  assert.equal(names(generationFields({ snapshot: {}, catalogRow: model, draft: draft(model.id), defaults: { catalog: [model] }, actions })).includes('camera'), false);
});

test('失敗と応答なしの操作は同じ入力でもう一度', () => {
  for (const state of ['failed', 'stale']) {
    const fields = generationFields({ snapshot: {}, catalogRow: models[0], draft: draft(models[0].id), defaults: { catalog: models, state }, actions });
    assert.equal(fields.find(row => row.name === 'generation-actions').actions.find(action => action.name === 'retry').label, '同じ入力でもう一度');
  }
});
