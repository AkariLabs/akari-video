import test from 'node:test';
import assert from 'node:assert/strict';
import { computeExportChipState } from '../lib/common/export-chip-state.js';

function snapshot(phase, options = {}) {
    return {
        status: { phase, ...options.status },
        outputName: options.outputName ?? 'final.mp4',
        setupRequested: options.setupRequested
    };
}

test('dialogVisible ならすべての phase を hidden にする', () => {
    for (const phase of ['idle', 'linting', 'lint-failed', 'rendering', 'done', 'cancelled', 'failed']) {
        assert.deepEqual(computeExportChipState(snapshot(phase), true, false), { kind: 'hidden' });
    }
});

test('rendering の工程・進捗率・残り時間を running に写す', () => {
    assert.deepEqual(computeExportChipState(snapshot('rendering', {
        status: { progressStage: 'render', progressPercent: 41.6, progressRemainingMs: 23_000 }
    }), false, false), {
        kind: 'running',
        stageLabel: '映像を描いて圧縮する',
        percent: 42,
        remainingMs: 23_000,
        outputName: 'final.mp4'
    });
});

test('running は進捗率を 0〜100 にクランプし、工程未確定時は phase の文言を使う', () => {
    assert.equal(computeExportChipState(snapshot('linting', {
        status: { progressPercent: -10 }
    }), false, false).stageLabel, 'lint 確認中');
    assert.equal(computeExportChipState(snapshot('linting', {
        status: { progressPercent: -10 }
    }), false, false).percent, 0);
    assert.equal(computeExportChipState(snapshot('rendering', {
        status: { progressPercent: 120 }
    }), false, false).percent, 100);
});

test('done は出力名を含む finished にする', () => {
    assert.deepEqual(computeExportChipState(snapshot('done'), false, false), {
        kind: 'finished',
        outcome: 'done',
        line: '書き出し完了 · final.mp4',
        outputName: 'final.mp4'
    });
});

test('cancelled と idle は hidden にする', () => {
    assert.deepEqual(computeExportChipState(snapshot('cancelled'), false, false), { kind: 'hidden' });
    assert.deepEqual(computeExportChipState(snapshot('idle'), false, false), { kind: 'hidden' });
});

test('dismissed は finished を隠すが running には影響しない', () => {
    assert.deepEqual(computeExportChipState(snapshot('done'), false, true), { kind: 'hidden' });
    assert.equal(computeExportChipState(snapshot('rendering'), false, true).kind, 'running');
});

test('failed と lint-failed は定められた日本語文言にする', () => {
    assert.equal(computeExportChipState(snapshot('failed'), false, false).line, '書き出しに失敗しました');
    assert.equal(computeExportChipState(snapshot('lint-failed'), false, false).line, 'lint NG で止まりました');
});

test('setupRequested の終端状態は hidden にする', () => {
    for (const phase of ['done', 'failed', 'lint-failed']) {
        assert.deepEqual(computeExportChipState(snapshot(phase, { setupRequested: true }), false, false), { kind: 'hidden' });
    }
});
