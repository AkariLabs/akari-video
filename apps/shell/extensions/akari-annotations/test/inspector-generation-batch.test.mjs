import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGenerationBatch, executeGenerationBatch } from '../lib/browser/inspector/generation-batch.js';
import { generationDraftFromMeta } from '../lib/browser/inspector/generation-fields.js';

const planned = (id, start = 0, estimate = .3) => {
  const meta = { version: 1, kind: 'still', status: 'done', next: {
    kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: { prompt: 'A garden.', first_frame: { path: `${id}.png` } },
    output: { duration_s: 5, resolution: '768P' }
  } };
  return { itemId: id, name: id, duration: 5, start, visual: true, meta,
    state: 'none', draft: generationDraftFromMeta(meta),
    validation: { ok: true, cost: { estimate_usd: estimate, as_of: '2026-09-12' } } };
};
const inputs = () => [planned('second', 5, .36),
  { ...planned('still', 10), meta: { version: 1, kind: 'still', status: 'done' } },
  planned('first', 0),
  { ...planned('empty', 15), meta: { version: 1, kind: 'still', status: 'planned' } },
  { ...planned('done', 20), state: 'done' }];

test('動画予定2 + 画像のまま + 空の枠 + 生成済み: 合計・順番・札', () => {
  const data = inputs();
  const original = structuredClone(data);
  const batch = buildGenerationBatch(data);
  assert.equal(batch.count, 2);
  assert.equal(batch.total, .3 + .36);
  assert.equal(batch.summary, '動画にするもの: 2 本 · 合計 $0.66');
  assert.equal(batch.asOf, '2026-09-12');
  assert.deepEqual(batch.rows.map(row => [row.itemId, row.badge]), [
    ['first', '動画にする · $0.30'], ['second', '動画にする · $0.36'],
    ['still', '画像のまま（対象外）'], ['empty', '空の枠（prompt なし）'], ['done', '生成済み']
  ]);
  assert.deepEqual(data, original);
});

for (const [name, patch, eligible, badge] of [
  ['入力エラー', { validation: { ok: false, messages: [{ level: 'error', text: '最後の絵は使えません\n別のモデルを選択' }] } }, false, '入力エラー（最後の絵は使えません 別のモデルを選択）'],
  ['生成中', { state: 'generating' }, false, '生成中'],
  ['応答なし', { state: 'stale' }, false, '応答なし（対象外）'],
  ['失敗で next が残る', { state: 'failed' }, true, 'もう一度 · $0.30'],
  ['字幕・音声', { visual: false }, false, '対象外'],
  ['未検証', { validation: undefined }, false, '見積を確認中'],
  ['next なし', { meta: undefined }, false, '画像のまま（対象外）'],
  ['素材不一致', { state: 'orphan' }, false, '入力エラー（素材が一致しません）'],
]) test(`対象判定: ${name}`, () => {
  const row = buildGenerationBatch([{ ...planned('a'), ...patch }]).rows[0];
  assert.equal(row.eligible, eligible);
  assert.equal(row.badge, badge);
});

test('文字カードの空 prompt は next があっても空の枠', () => {
  const item = planned('a');
  item.meta.status = 'planned';
  item.meta.next.inputs.prompt = '  ';
  assert.equal(buildGenerationBatch([item]).rows[0].badge, '空の枠（prompt なし）');
  assert.equal(buildGenerationBatch([item]).count, 0);
});

for (const estimate of [null, undefined, NaN, Infinity, -1]) test(`見積不可 ${estimate} は既知額と区別する`, () => {
  const b = planned('b', 1);
  b.validation.cost.estimate_usd = estimate;
  const batch = buildGenerationBatch([planned('a'), b]);
  assert.equal(batch.count, 2);
  assert.equal(batch.total, .3);
  assert.equal(batch.unknown, true);
  assert.match(batch.summary, /一部見積不可/);
  assert.match(batch.rows[1].badge, /見積不可/);
});

test('0円は見積可能・as_of は複数日を保持', () => {
  const b = planned('b', 1, 0); b.validation.cost.as_of = '2026-09-13';
  const batch = buildGenerationBatch([planned('a', 0, 0), b]);
  assert.equal(batch.unknown, false);
  assert.equal(batch.total, 0);
  assert.equal(batch.asOf, '2026-09-12 / 2026-09-13');
});

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('承認1回・対象N本・タイムライン順・終了待ちの間は同時2本なし', async () => {
  const calls = [], progress = [], pending = [];
  let active = 0, peak = 0;
  const rows = buildGenerationBatch(inputs()).rows;
  const run = executeGenerationBatch({ rows, projectRootUri: 'file:///project', approved: true,
    start: request => {
      calls.push(request); active++; peak = Math.max(peak, active);
      const completion = deferred(); pending.push(completion); return completion;
    },
    wait: async handle => { const result = await handle.promise; active--; return result; },
    stopped: () => false, progress: (id, state) => progress.push([id, state])
  });
  await tick();
  assert.deepEqual(calls.map(c => c.itemId), ['first']);
  // User replaces the selected rows while the approved first job is in flight.
  rows.splice(0, rows.length);
  pending[0].resolve({ ok: true });
  await tick();
  assert.deepEqual(calls.map(c => c.itemId), ['first', 'second']);
  pending[1].resolve({ ok: true });
  await run;
  assert.equal(peak, 1);
  assert.equal(active, 0);
  assert.ok(calls.every(c => c.approved === true && c.projectRootUri === 'file:///project'));
  assert.deepEqual(progress, [['first', '待ち'], ['second', '待ち'], ['first', '生成中'], ['first', '完了'], ['second', '生成中'], ['second', '完了']]);
});

for (const approved of [false, undefined]) test(`未承認 ${approved} は起動も待機も0回`, async () => {
  await executeGenerationBatch({ rows: buildGenerationBatch(inputs()).rows, projectRootUri: 'p', approved,
    start: () => assert.fail('未承認起動'), wait: () => assert.fail('未承認待機'),
    stopped: () => false, progress: () => assert.fail('未承認進行') });
});

test('対象外だけなら承認しても0回', async () => {
  await executeGenerationBatch({ rows: buildGenerationBatch(inputs()).rows.filter(row => !row.eligible),
    projectRootUri: 'p', approved: true, start: () => assert.fail('対象外起動'),
    wait: () => assert.fail('対象外待機'), stopped: () => false, progress: () => assert.fail('対象外進行') });
});

for (const failure of ['start throws', 'wait rejects', 'ok false']) test(`失敗しても次へ: ${failure}`, async () => {
  const calls = [], progress = [];
  await executeGenerationBatch({ rows: buildGenerationBatch(inputs()).rows, projectRootUri: 'p', approved: true,
    start: request => { calls.push(request.itemId); if (calls.length === 1 && failure === 'start throws') throw Error('start'); return request.itemId; },
    wait: async id => { if (id === 'first' && failure === 'wait rejects') throw Error('wait'); return { ok: id !== 'first' }; },
    stopped: () => false, progress: (id, state) => progress.push([id, state]) });
  assert.deepEqual(calls, ['first', 'second']);
  assert.ok(progress.some(([id, state]) => id === 'first' && state === '失敗'));
  assert.deepEqual(progress.at(-1), ['second', '完了']);
});

test('残りをやめる: 実行中1本は終了まで待ち、以降0回', async () => {
  const finish = deferred(), calls = [], progress = [];
  let stopped = false, ended = false;
  const run = executeGenerationBatch({ rows: buildGenerationBatch(inputs()).rows, projectRootUri: 'p', approved: true,
    start: request => { calls.push(request.itemId); return finish; }, wait: handle => handle.promise,
    stopped: () => stopped, progress: (id, state) => progress.push([id, state]) }).then(() => { ended = true; });
  await tick(); stopped = true; await tick();
  assert.equal(ended, false);
  finish.resolve({ ok: true }); await run;
  assert.deepEqual(calls, ['first']);
  assert.deepEqual(progress.slice(-2), [['first', '完了'], ['second', '中止']]);
});

// Exercise the compiled approval method without loading Theia's browser runtime.
// The rest of this file imports the compiled pure module, like generation-fields tests.
const { readFileSync } = await import('node:fs');
const widgetCode = readFileSync(new URL('../lib/browser/akari-inspector-widget.js', import.meta.url), 'utf8');
const approvalStart = widgetCode.indexOf('    async confirmGenerationBatch(');
const approvalEnd = widgetCode.indexOf('\n    generationIdentity(', approvalStart);
assert.ok(approvalStart >= 0 && approvalEnd > approvalStart);

for (const approved of [false, true]) test(`パネル費用承認 ${approved}: 1回の確認・承認時だけ見積済みの尺を保存して起動`, async () => {
  const first = planned('first'), second = planned('second', 5);
  // A cut was shortened after next was authored: the loader's draft uses cuts.
  first.meta.next.output.duration_s = 30;
  const batch = buildGenerationBatch([first, second]);
  const dialogs = [], writes = [], calls = [], errors = [], sequence = [];
  class Dialog {
    constructor(options) { dialogs.push(options); }
    async open() {
      // Simulate a later selection/load replacing mutable caches while approval is open.
      first.draft.output.duration_s = 99;
      return approved;
    }
  }
  const Harness = new Function('generation_batch_1', 'dialogs_1',
    `return class {${widgetCode.slice(approvalStart, approvalEnd)}}`)({ executeGenerationBatch }, { ConfirmDialog: Dialog });
  const widget = Object.assign(new Harness(), {
    generationStates: new Map(), generationLoads: new Set(), render() {},
    showFieldNotice(error) { errors.push(error); },
    layerAudioService: {
      async writeGenerationDraft(request) { writes.push(request); sequence.push(`write:${request.itemId}`); },
      async startGenerateVideo(request) { calls.push(request); sequence.push(`start:${request.itemId}`); await tick(); sequence.push(`end:${request.itemId}`); return { ok: true }; }
    }
  });
  await widget.confirmGenerationBatch(batch, 'file:///approved-project');
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].title, '費用承認');
  assert.equal(dialogs[0].msg, '2 本を合計 $0.60（as_of 2026-09-12）で送ります。費用承認しますか');
  assert.deepEqual(errors, []);
  assert.equal(writes.length, approved ? 2 : 0);
  assert.equal(calls.length, approved ? 2 : 0);
  if (approved) {
    assert.equal(writes[0].output.duration_s, 5);
    assert.deepEqual(sequence, ['write:first', 'start:first', 'end:first', 'write:second', 'start:second', 'end:second']);
    assert.ok(calls.every(call => call.projectRootUri === 'file:///approved-project' && call.approved));
    assert.equal(widget.batchRun.active, false);
  }
});
