import test from 'node:test';
import assert from 'node:assert/strict';
import { narrationEstimate, compareNarrationDuration, readAloudPreviewPlan, selectReadAloudEngine, selectReadAloudVoice } from '../lib/common/read-aloud-model.js';

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
