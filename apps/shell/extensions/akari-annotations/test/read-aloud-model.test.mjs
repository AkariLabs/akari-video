import test from 'node:test';
import assert from 'node:assert/strict';
import { narrationEstimate, batchNarrationEstimate, compareNarrationDuration, defaultOverflowAction, readAloudPreviewPlan, selectReadAloudEngine, selectReadAloudVoice, selectReadAloudRows, staleNarrations } from '../lib/common/read-aloud-model.js';

const available = { state: 'available', label: '使用可' };
const engines = [
    { id: 'voicevox', label: 'VOICEVOX', place: 'local', price: { usd_per_1000_chars: 0, verified: true }, availability: available },
    { id: 'gemini-tts', label: 'Gemini', place: 'cloud', price: { usd_per_1000_chars: .05, verified: false }, availability: available }
];

test('ローカル見積はゼロ、クラウド見積は文字数と暫定価格に従う', () => {
    assert.equal(narrationEstimate(engines[0], '読み').label, '費用 ¥0');
    const quote = narrationEstimate(engines[1], 'あ'.repeat(100));
    assert.equal(quote.chars, 100);
    assert.ok(Math.abs(quote.usd - .005) < 1e-9);
    assert.equal(quote.provisional, true);
    assert.match(quote.label, /\$0\.005.*≈ ¥1/);
});

test('枠内、置いた文字の超過、話した言葉の超過を分ける', () => {
    assert.equal(compareNarrationDuration(3, 2, 'output', true).overflow, 0);
    const output = compareNarrationDuration(2, 3, 'output', true);
    assert.deepEqual([output.extendEnabled, output.retryEnabled, output.overflow], [true, true, 1]);
    const source = compareNarrationDuration(2, 3, 'source', false);
    assert.deepEqual([source.extendEnabled, source.retryEnabled, source.overflow], [false, false, 1]);
});

test('推奨速度は 0.05 刻みに切り上げ 2 倍を上限とする', () => {
    assert.equal(compareNarrationDuration(2, 2.81, 'output', true).recommendedSpeed, 1.45);
    assert.equal(compareNarrationDuration(1, 3, 'output', true).recommendedSpeed, 2);
});

test('エンジンと声は preference、default、最初の available の順', () => {
    assert.equal(selectReadAloudEngine(engines, 'gemini-tts')?.id, 'gemini-tts');
    assert.equal(selectReadAloudEngine(engines)?.id, 'voicevox');
    assert.equal(selectReadAloudEngine([engines[1]])?.id, 'gemini-tts');
    assert.equal(selectReadAloudEngine([{ ...engines[0], availability: { state: 'needs', label: '自動起動' } }])?.id, 'voicevox');
    assert.equal(selectReadAloudEngine([{ ...engines[0], availability: { state: 'unconfigured', label: '未設定' } }]), undefined);
    const voices = [{ id: 'a', label: 'A' }, { id: 'Leda', label: 'Leda', default: true }];
    assert.equal(selectReadAloudVoice(voices, 'a')?.id, 'a');
    assert.equal(selectReadAloudVoice(voices)?.id, 'Leda');
    assert.equal(selectReadAloudVoice([voices[0]])?.id, 'a');
});

test('Gemini を available に差し替えた試聴計画は Leda・見積・費用承認を示す', () => {
    const gemini = {
        id: 'gemini-tts', label: 'Gemini 2.5 Flash TTS', place: 'cloud', provider: 'fal',
        price: { usd_per_1000_chars: 0.05, verified: false, as_of: '2026-09-22' },
        default_voice: 'Leda', supports: { speed: false, style: true }, availability: available
    };
    const voices = [{ id: 'Leda', label: 'Leda（Youthful）', default: true }, { id: 'Aoede', label: 'Aoede' }];
    assert.equal(selectReadAloudEngine([gemini])?.id, 'gemini-tts');
    assert.equal(selectReadAloudVoice(voices)?.id, gemini.default_voice);
    const plan = readAloudPreviewPlan(gemini, 'あ'.repeat(100));
    assert.equal(plan.buttonLabel, '費用を見て試聴…');
    assert.equal(plan.needsApproval, true);
    assert.equal(plan.confirm?.title, '費用承認');
    assert.equal(plan.confirm?.ok, '費用承認する');
    assert.equal(plan.confirm?.cancel, 'キャンセル');
    assert.match(plan.confirm.msg, /\$0\.005/);
    assert.match(plan.confirm.msg, /as_of 2026-09-22/);
    assert.match(plan.confirm.msg, /読み原稿 100 字/);
});

test('VOICEVOX の試聴計画は費用承認を要求しない', () => {
    const plan = readAloudPreviewPlan(engines[0], 'こんにちは');
    assert.equal(plan.buttonLabel, '▶ 試聴');
    assert.equal(plan.needsApproval, false);
    assert.equal(plan.confirm, undefined);
});

test('対象行は空文字とカット済みを除き、出力時間の順に並べる', () => {
    const row = (id, text, outputStart) => ({ id, text, start: 0, end: 1, timeDomain: 'source', outputStart });
    const rows = [row('c-2', '後', 4), row('c-cut', 'カット', undefined), row('c-blank', '  ', 2), row('c-1', '先', 1)];
    assert.deepEqual(selectReadAloudRows(rows).map(item => item.id), ['c-1', 'c-2']);
    assert.deepEqual(selectReadAloudRows(rows, ['c-2', 'c-cut']).map(item => item.id), ['c-2']);
    assert.deepEqual(selectReadAloudRows([...rows, { ...row('c-output', '置いた文字', 3), timeDomain: 'output' }])
        .map(item => item.id), ['c-1', 'c-output', 'c-2']);
});

test('まとめた費用見積は各行の読み原稿の合計で、承認は 1 回', () => {
    const quote = batchNarrationEstimate(engines[1], ['あ'.repeat(40), 'い'.repeat(60)]);
    assert.equal(quote.chars, 100);
    assert.ok(Math.abs(quote.usd - 0.005) < 1e-9);
    assert.match(quote.label, /承認 1 回/);
});

test('枠超過の既定は出力字幕を次の字幕で止め、source は local のみ再生成', () => {
    const base = { frameSeconds: 2, durationSeconds: 3, speedSupported: true, start: 1 };
    assert.deepEqual(defaultOverflowAction({ ...base, timeDomain: 'output', enginePlace: 'local', nextStart: 3.5 }),
        { choice: 'extend', extendEnd: 3.5, remainder: .5, recommendedSpeed: 1.5 });
    assert.equal(defaultOverflowAction({ ...base, timeDomain: 'output', enginePlace: 'local', nextStart: 2 }).extendEnd, 3);
    assert.equal(defaultOverflowAction({ ...base, timeDomain: 'source', enginePlace: 'local' }).choice, 'retry');
    assert.equal(defaultOverflowAction({ ...base, timeDomain: 'source', enginePlace: 'cloud' }).choice, 'keep');
});

test('字幕が存在し script と異なる narration だけ古い', () => {
    const old = staleNarrations([
        { id: 'n-1', caption_ref: 'c-1', script: '元' },
        { id: 'n-2', caption_ref: 'c-2', script: '同じ' },
        { id: 'n-3', caption_ref: 'c-missing', script: '元' },
        { id: 'n-4', script: '元' }
    ], [{ id: 'c-1', text: '新' }, { id: 'c-2', text: '同じ' }]);
    assert.deepEqual([...old], ['n-1']);
});
