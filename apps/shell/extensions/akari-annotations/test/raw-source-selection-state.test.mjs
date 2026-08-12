import assert from 'node:assert/strict';
import test from 'node:test';

import {
    applyResolvedRawSourceSelection,
    suppressRawSourceSelection,
    transitionRawSourceSelection
} from '../lib/common/raw-source-selection-state.js';

const active = (activation, mediaUri, sourceT, reason = 'focus') => ({
    active: true, activation, mediaUri, sourceT, reason
});

test('raw A→output→raw B で古い選択を即時破棄し、陳腐化した解決を採用しない', () => {
    let state = transitionRawSourceSelection({}, active(1, 'file:///project/a.mp4', 1)).state;
    state = applyResolvedRawSourceSelection(state, active(1, 'file:///project/a.mp4', 1), 'a');
    assert.deepEqual(state.selection, {
        activation: 1, mediaUri: 'file:///project/a.mp4', sourceT: 1, src: 'a'
    });

    state = transitionRawSourceSelection(state, {
        active: false, activation: 2, reason: 'focus'
    }).state;
    assert.equal(state.selection, undefined);
    assert.equal(state.latest, undefined);

    const rawB = transitionRawSourceSelection(state, active(3, 'file:///project/b.mp4', 4));
    state = rawB.state;
    assert.equal(rawB.needsResolution, true);
    assert.equal(state.selection, undefined, 'B の解決中に A のチップを残さない');

    state = applyResolvedRawSourceSelection(state, active(1, 'file:///project/a.mp4', 1), 'a');
    assert.equal(state.selection, undefined, '遅れて完了した A の解決は B に適用しない');

    state = applyResolvedRawSourceSelection(state, active(3, 'file:///project/b.mp4', 4), 'b');
    assert.deepEqual(state.selection, {
        activation: 3, mediaUri: 'file:///project/b.mp4', sourceT: 4, src: 'b'
    });
});

test('同じ raw activation の playback は解決済み src を保ったまま sourceT だけ更新する', () => {
    let state = transitionRawSourceSelection({}, active(7, 'file:///project/render.mp4', 2)).state;
    state = applyResolvedRawSourceSelection(state, active(7, 'file:///project/render.mp4', 2), 'render');
    const playback = transitionRawSourceSelection(state, active(7, 'file:///project/render.mp4', 5, 'playback'));
    assert.equal(playback.needsResolution, false);
    assert.deepEqual(playback.state.selection, {
        activation: 7, mediaUri: 'file:///project/render.mp4', sourceT: 5, src: 'render'
    });
});

test('チップを明示解除した activation は playback 通知で復活しない', () => {
    let state = transitionRawSourceSelection({}, active(4, 'file:///project/render.mp4', 2)).state;
    state = applyResolvedRawSourceSelection(state, active(4, 'file:///project/render.mp4', 2), 'render');
    state = suppressRawSourceSelection(state);
    const playback = transitionRawSourceSelection(state, active(4, 'file:///project/render.mp4', 3, 'playback'));
    assert.equal(playback.needsResolution, false);
    assert.equal(playback.state.selection, undefined);
});
