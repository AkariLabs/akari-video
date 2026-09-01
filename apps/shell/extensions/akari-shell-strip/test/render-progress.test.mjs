import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRenderProgress, RENDER_PROGRESS_UNKNOWN_LABEL } from '../lib/common/render-progress.js';

// 実物（内部 dogfood-v2 実走の render.json）の verify/artifacts 形と、
// L1 で使う自作フィクスチャ（開始/50%/失敗/壊れたJSON/未知形）の両方を寛容リーダーで読めることを確認する。

test('parseRenderProgress: 壊れた入力（null/文字列/配列）は unknown フォールバック', () => {
    for (const raw of [null, undefined, 'not json shape', 42, []]) {
        const result = parseRenderProgress(raw);
        assert.equal(result.kind, 'unknown');
        assert.equal(result.label, RENDER_PROGRESS_UNKNOWN_LABEL);
    }
});

test('parseRenderProgress: 未知形（version/phase/plan のいずれも無い）は unknown フォールバック', () => {
    const result = parseRenderProgress({ someOtherTool: true, nested: { a: 1 } });
    assert.equal(result.kind, 'unknown');
    assert.equal(result.label, RENDER_PROGRESS_UNKNOWN_LABEL);
});

test('parseRenderProgress: 開始直後（phase のみ）は in-progress・phase を含むラベル', () => {
    const result = parseRenderProgress({ version: 1, phase: 'planning' });
    assert.equal(result.kind, 'in-progress');
    assert.equal(result.label, '書き出し中（planning）');
    assert.ok(result.percent > 0 && result.percent < 100);
});

test('parseRenderProgress: 途中（phase 不明値でも）は in-progress・例外なし', () => {
    const result = parseRenderProgress({ version: 1, phase: 'some-future-stage-name' });
    assert.equal(result.kind, 'in-progress');
    assert.equal(result.label, '書き出し中（some-future-stage-name）');
    assert.equal(typeof result.percent, 'number');
});

test('parseRenderProgress: verify.verdict=pass + artifacts[0].path → done + artifactPath', () => {
    const result = parseRenderProgress({
        version: 1,
        phase: 'verified',
        artifacts: [{ path: 'exports/final.mp4', sha256: 'abc' }],
        verify: { verdict: 'pass', findings: [] }
    });
    assert.equal(result.kind, 'done');
    assert.equal(result.percent, 100);
    assert.equal(result.artifactPath, 'exports/final.mp4');
});

test('parseRenderProgress: verify.verdict=fail → failed + エラー文言', () => {
    const result = parseRenderProgress({
        version: 1,
        phase: 'failed',
        verify: {
            verdict: 'fail',
            findings: [
                { severity: 'info', check: 'x', message: '無視される' },
                { severity: 'error', check: 'verify.duration', message: 'duration mismatch' }
            ]
        }
    });
    assert.equal(result.kind, 'failed');
    assert.equal(result.label, '書き出しに失敗しました: duration mismatch');
});

test('parseRenderProgress: verify.verdict=fail だが findings に error が無い → 汎用失敗文言', () => {
    const result = parseRenderProgress({ version: 1, verify: { verdict: 'fail', findings: [] } });
    assert.equal(result.kind, 'failed');
    assert.equal(result.label, '書き出しに失敗しました');
});

test('parseRenderProgress: verify.verdict=pass だが artifacts が空 → in-progress へフォールバック（例外なし）', () => {
    const result = parseRenderProgress({ version: 1, phase: 'verifying', verify: { verdict: 'pass' }, artifacts: [] });
    assert.equal(result.kind, 'in-progress');
});

test('parseRenderProgress: 実物（dogfood-v2 抜粋）と同形を done として読める', () => {
    const result = parseRenderProgress({
        version: 1,
        phase: 'verified',
        inputs: {},
        warnings: [],
        validation: { lint: { verdict: 'pass' } },
        plan: { output: 'final-v2.2.mp4' },
        provenance: {},
        artifacts: [{ path: 'final-v2.2.mp4', sha256: 'x', ffprobe: { duration_seconds: 157.23 } }],
        verify: {
            verdict: 'pass',
            findings: [{ severity: 'info', check: 'verify.duration', message: 'ok' }],
            measured: { duration_seconds: 157.23 }
        }
    });
    assert.equal(result.kind, 'done');
    assert.equal(result.artifactPath, 'final-v2.2.mp4');
});

test('parseRenderProgress: gpu を抽出して完了ラベルへ出す', () => {
    const result = parseRenderProgress({
        version: 1,
        phase: 'verified',
        provenance: { engine_requested: 'auto', engine: 'gpu' },
        artifacts: [{ path: 'exports/final.mp4' }],
        verify: { verdict: 'pass' }
    });
    assert.equal(result.label, '書き出し完了（GPU）');
    assert.deepEqual(result.engine, { name: 'gpu' });
});

test('parseRenderProgress: osr + fallback 理由を抽出する', () => {
    const result = parseRenderProgress({
        version: 1,
        phase: 'verified',
        provenance: {
            engine_requested: 'auto',
            engine: 'osr',
            engine_fallback: { from: 'gpu', reason: 'GPU Electron launcher unavailable' }
        },
        artifacts: [{ path: 'exports/final.mp4' }],
        verify: { verdict: 'pass' }
    });
    assert.equal(result.label, '書き出し完了（OSR — GPU 実行体なし: GPU Electron launcher unavailable）');
    assert.deepEqual(result.engine, { name: 'osr', fallbackReason: 'GPU Electron launcher unavailable' });
});

test('parseRenderProgress: osr + 不適格 1 件を id: reason で表示する', () => {
    const warning = 'GPU export is ineligible; using OSR: overlay:hero:embedded-context';
    const result = parseRenderProgress({
        version: 1,
        phase: 'verified',
        provenance: { engine_requested: 'auto', engine: 'osr' },
        warnings: [warning],
        artifacts: [{ path: 'exports/final.mp4' }],
        verify: { verdict: 'pass' }
    });
    assert.equal(result.label, '書き出し完了（OSR — GPU 不適格: hero: embedded-context）');
    assert.deepEqual(result.engine, { name: 'osr', ineligible: ['overlay:hero:embedded-context'] });
});

test('parseRenderProgress: osr + 不適格 3 件は先頭と残件数を表示する', () => {
    const warning = 'GPU export is ineligible; using OSR: overlay:hero:embedded-context; caption:cap-1:unsupported-css; layer:logo:dynamic-filter';
    const result = parseRenderProgress({
        version: 1,
        phase: 'verified',
        provenance: { engine_requested: 'auto', engine: 'osr' },
        warnings: [warning],
        artifacts: [{ path: 'exports/final.mp4' }],
        verify: { verdict: 'pass' }
    });
    assert.equal(result.label, '書き出し完了（OSR — GPU 不適格: hero: embedded-context、他 2 件）');
    assert.equal(result.engine.ineligible.length, 3);
});

test('parseRenderProgress: legacy receipt も互換表示する', () => {
    const result = parseRenderProgress({
        version: 1,
        phase: 'verified',
        provenance: { engine_requested: 'auto', engine: 'legacy' },
        artifacts: [{ path: 'exports/final.mp4' }],
        verify: { verdict: 'pass' }
    });
    assert.equal(result.label, '書き出し完了（legacy）');
    assert.deepEqual(result.engine, { name: 'legacy' });
});

test('parseRenderProgress: provenance 無しは engine undefined の後方互換', () => {
    const result = parseRenderProgress({
        version: 1,
        phase: 'verified',
        artifacts: [{ path: 'exports/final.mp4' }],
        verify: { verdict: 'pass' }
    });
    assert.equal(result.label, '書き出し完了');
    assert.equal(result.engine, undefined);
});

test('parseRenderProgress: 計画中から gpu の書き出し中表示を出す', () => {
    const result = parseRenderProgress({
        version: 1,
        phase: 'planning',
        provenance: { engine_requested: 'auto', engine: 'gpu' }
    });
    assert.equal(result.label, '書き出し中（planning）（GPU で書き出し中）');
    assert.deepEqual(result.engine, { name: 'gpu' });
});
