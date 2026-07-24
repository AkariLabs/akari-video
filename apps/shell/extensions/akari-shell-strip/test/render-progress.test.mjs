import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRenderProgress, RENDER_PROGRESS_UNKNOWN_LABEL } from '../lib/common/render-progress.js';

// 実物（internal tasks/2026-07-22-dogfood-v2/out/.akari/render.json）の verify/artifacts 形と、
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
