import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ARTIFACT_OPEN_GATE_TIMEOUT_MS,
    RENDER_STATE_RELATIVE_PATH,
    normalizeArtifactPath,
    parseRenderStateFacts,
    shouldHoldArtifactOpen
} from '../lib/common/artifact-open-gate.js';

const hold = (renderState, artifactRelativePath = 'exports/final-4.mp4', waitedMs = 0) =>
    shouldHoldArtifactOpen({ renderState, artifactRelativePath, waitedMs });

test('RENDER_STATE_RELATIVE_PATH: render-cut が書く状態ファイルを指す', () => {
    assert.equal(RENDER_STATE_RELATIVE_PATH, '.akari/render.json');
});

test('parseRenderStateFacts: phase と plan.output だけを取り出す', () => {
    const facts = parseRenderStateFacts(JSON.stringify({
        version: 1,
        phase: 'planned',
        plan: { output: 'exports/final-4.mp4', preset: { fps: 30 } }
    }));
    assert.deepEqual(facts, { phase: 'planned', output: 'exports/final-4.mp4' });
});

test('parseRenderStateFacts: 読めない入力は undefined（門を開ける側に倒す）', () => {
    assert.equal(parseRenderStateFacts(undefined), undefined);
    assert.equal(parseRenderStateFacts(''), undefined);
    assert.equal(parseRenderStateFacts('   '), undefined);
    assert.equal(parseRenderStateFacts('{ 途中で切れた'), undefined);
    assert.equal(parseRenderStateFacts('[]'), undefined);
    assert.equal(parseRenderStateFacts('null'), undefined);
    // 形は JSON でも中身が欠けていれば各項目は undefined（= 完了扱い）。
    assert.deepEqual(parseRenderStateFacts('{}'), { phase: undefined, output: undefined });
    assert.deepEqual(parseRenderStateFacts('{"phase":1,"plan":{"output":2}}'), { phase: undefined, output: undefined });
});

test('normalizeArtifactPath: 区切りと先頭 ./ の揺れを吸収する', () => {
    assert.equal(normalizeArtifactPath('exports/final-4.mp4'), 'exports/final-4.mp4');
    assert.equal(normalizeArtifactPath('./exports/final-4.mp4'), 'exports/final-4.mp4');
    assert.equal(normalizeArtifactPath('exports\\final-4.mp4'), 'exports/final-4.mp4');
    assert.equal(normalizeArtifactPath('exports/frames/'), 'exports/frames');
    assert.equal(normalizeArtifactPath(undefined), undefined);
    assert.equal(normalizeArtifactPath(''), undefined);
});

test('shouldHoldArtifactOpen: 同じ成果物を作っているレンダーが走行中なら待たせる', () => {
    // render-cut は実行開始時に phase:"planned" + plan.output を書き、rename はその後に来る。
    assert.equal(hold({ phase: 'planned', output: 'exports/final-4.mp4' }), true);
    assert.equal(hold({ phase: 'rendered', output: 'exports/final-4.mp4' }), true);
    assert.equal(hold({ phase: 'filter_report', output: 'exports/final-4.mp4' }), true);
});

test('shouldHoldArtifactOpen: 完走・失敗で門が開く', () => {
    assert.equal(hold({ phase: 'verified', output: 'exports/final-4.mp4' }), false);
    assert.equal(hold({ phase: 'error', output: 'exports/final-4.mp4' }), false);
});

test('shouldHoldArtifactOpen: 判定できないときは待たせない（fail-open）', () => {
    // render.json が無い / 壊れている
    assert.equal(hold(undefined), false);
    // 未知の phase・phase 欠落
    assert.equal(hold({ phase: 'unknown-future-phase', output: 'exports/final-4.mp4' }), false);
    assert.equal(hold({ output: 'exports/final-4.mp4' }), false);
    // plan.output が無い
    assert.equal(hold({ phase: 'planned' }), false);
});

test('shouldHoldArtifactOpen: 別の成果物を作っているレンダーでは待たせない', () => {
    // 直前の書き出しの render.json が残っているだけ、という状況で手で置いた mp4 を止めない。
    assert.equal(hold({ phase: 'planned', output: 'exports/final-3.mp4' }), false);
    assert.equal(hold({ phase: 'planned', output: 'exports/final-4.mp4' }, 'exports/hand-drop.mp4'), false);
});

test('shouldHoldArtifactOpen: パス表記が揺れても同じ成果物と見なす', () => {
    assert.equal(hold({ phase: 'planned', output: './exports/final-4.mp4' }), true);
    assert.equal(hold({ phase: 'planned', output: 'exports\\final-4.mp4' }), true);
});

test('shouldHoldArtifactOpen: 上限を過ぎたら開く（rename 後に落ちた実行の保険）', () => {
    const running = { phase: 'planned', output: 'exports/final-4.mp4' };
    assert.equal(hold(running, 'exports/final-4.mp4', ARTIFACT_OPEN_GATE_TIMEOUT_MS - 1), true);
    assert.equal(hold(running, 'exports/final-4.mp4', ARTIFACT_OPEN_GATE_TIMEOUT_MS), false);
    assert.equal(hold(running, 'exports/final-4.mp4', ARTIFACT_OPEN_GATE_TIMEOUT_MS + 1), false);
});
