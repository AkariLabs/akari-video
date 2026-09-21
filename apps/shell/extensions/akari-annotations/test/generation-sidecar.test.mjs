import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  describeGenerationChip, resolveGenerationState, sidecarPathFor
} from '../lib/common/generation-sidecar.js';

const startedAt = Date.parse('2026-09-13T00:00:00.000Z');
const cases = [
  ['none', undefined, startedAt, 'none', '静止画'],
  ['empty', { kind: 'still', status: 'planned' }, startedAt, 'planned', '空の枠'],
  ['planned', { kind: 'still', status: 'planned', inputs: { prompt: '朝の海' } }, startedAt, 'planned', '予定'],
  ['generating', { kind: 'still', status: 'generating', progress: 62,
    job: { started_at: '2026-09-13T00:00:00.000Z', stale_after_s: 900 } }, startedAt + 1000,
  'generating', '生成中 62%'],
  ['stale', { kind: 'still', status: 'generating',
    job: { started_at: '2026-09-13T00:00:00.000Z', stale_after_s: 900 } }, startedAt + 901000,
  'stale', '応答なし・再取得'],
  ['done', { kind: 'video', status: 'done' }, startedAt, 'done', '生成'],
  ['failed', { kind: 'still', status: 'failed' }, startedAt, 'failed', '失敗']
];

test('6 状態を契約語彙と表示文言へ写像する', () => {
  for (const [name, meta, now, expectedState, badge] of cases) {
    const state = resolveGenerationState(meta, now);
    assert.equal(state, expectedState, name);
    assert.equal(describeGenerationChip(state, meta).badge, badge, name);
  }
  assert.equal(sidecarPathFor('assets/generated/a.mp4'), 'assets/generated/a.mp4.meta.json');
});

test('stale は stale_after_s を超えたときだけ成立する', () => {
  const meta = { status: 'generating', job: {
    started_at: '2026-09-13T00:00:00.000Z', stale_after_s: 900
  } };
  assert.equal(resolveGenerationState(meta, startedAt + 899000), 'generating', '境界 -1 秒');
  assert.equal(resolveGenerationState(meta, startedAt + 900000), 'generating', '境界ちょうど');
  assert.equal(resolveGenerationState(meta, startedAt + 901000), 'stale', '境界 +1 秒');
});

test('progress が無い generating は不定バー用に undefined を返す', () => {
  const description = describeGenerationChip('generating', { status: 'generating' });
  assert.equal(description.badge, '生成中');
  assert.equal(description.progress, undefined);
});

test('planned は空白だけ・欠落・不正型の prompt でも空の枠、文字があれば予定', () => {
  for (const prompt of [undefined, null, '', ' \n\t　', 42, {}, ' 朝の海 ']) {
    const meta = { kind: 'still', status: 'planned', inputs: { prompt } };
    assert.equal(describeGenerationChip('planned', meta).badge, prompt === ' 朝の海 ' ? '予定' : '空の枠');
  }
});

test('stale_after_s 未指定では helper の既定 900 秒を使う', () => {
  const meta = { version: 1, kind: 'still', status: 'generating', job: {
    started_at: '2026-09-13T00:00:00.000Z'
  } };
  for (const [seconds, expected] of [[899, 'generating'], [900, 'generating'], [901, 'stale']]) {
    assert.equal(resolveGenerationState(meta, startedAt + seconds * 1000), expected, `${seconds} 秒`);
  }
});

test('orphan は v1 タイムラインでは none に潰す', () => {
  assert.equal(resolveGenerationState({
    version: 1, kind: 'still', status: 'orphan'
  }, startedAt), 'none');
});

test('binding 不一致は orphan、binding 一致と省略は素の状態になる', () => {
  const meta = { version: 1, kind: 'video', status: 'done' };
  assert.equal(resolveGenerationState(meta, startedAt, {
    expected: 'a', actual: 'b', matches: false, source: 'result'
  }), 'orphan');
  assert.equal(resolveGenerationState(meta, startedAt, {
    expected: 'a', actual: 'a', matches: true, source: 'result'
  }), 'done');
  assert.equal(resolveGenerationState(meta, startedAt), 'done');
});

test('orphan は専用の見た目になり none とは異なる', () => {
  const description = describeGenerationChip('orphan');
  assert.deepEqual(description, {
    badge: '孤児',
    className: 'akari-generation-orphan',
    title: '素材が変わりました（meta の sha256 と一致しません）'
  });
  assert.notDeepEqual(description, describeGenerationChip('none'));
});

for (const [name, variety] of [['next-first-last', '最初→最後'], ['next-first', '画像から'], ['next-prompt', 'プロンプトだけ'], ['next-narrow', '画像から']]) {
  test(`${name}: 動画予定の class / badge / title`, async () => {
    const meta = JSON.parse(await readFile(new URL(`./fixtures/generation-states/assets/generated/${name}.png.meta.json`, import.meta.url)));
    const state = resolveGenerationState(meta, startedAt);
    assert.equal(state, 'planned-video');
    assert.deepEqual(describeGenerationChip(state, meta), {
      className: 'akari-generation-planned-video', badge: '▶ 動画予定', title: `動画予定（${variety}）`
    });
  });
}

test('next なしの静止画は完成品、title に仮枠を付けない', () => {
  for (const meta of [undefined, { version: 1, kind: 'still', status: 'done' }]) {
    const description = describeGenerationChip(resolveGenerationState(meta, startedAt), meta);
    assert.equal(description.badge, '静止画');
    assert.equal(description.title, '静止画');
  }
});
