import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionMaterialDragSession } from '../lib/common/material-range-messages.js';

const idle = { active: false, pointerArmed: false };
const ended = { active: false, pointerArmed: false };

test('each drag completion signal ends an active session once', () => {
    for (const signal of ['webview-end', 'drop', 'host-dragend', 'escape', 'blur', 'dispose']) {
        const started = transitionMaterialDragSession(idle, 'start');
        assert.deepEqual(started, { state: { active: true, pointerArmed: false }, ended: false });
        assert.deepEqual(transitionMaterialDragSession(started.state, signal), { state: ended, ended: true }, signal);
        assert.deepEqual(transitionMaterialDragSession(ended, signal), { state: ended, ended: false }, signal);
    }
});

test('signals before drag start and pointer input during the grace period are ignored', () => {
    for (const signal of ['pointer', 'drop', 'host-dragend', 'webview-end', 'escape', 'blur', 'dispose']) {
        assert.deepEqual(transitionMaterialDragSession(idle, signal), { state: idle, ended: false });
    }
    const started = transitionMaterialDragSession(idle, 'start').state;
    assert.deepEqual(transitionMaterialDragSession(started, 'pointer'), { state: started, ended: false });
    const armed = transitionMaterialDragSession(started, 'arm-pointer').state;
    assert.deepEqual(transitionMaterialDragSession(armed, 'pointer'), { state: ended, ended: true });
});

test('replacement drag ends the old session and both drags can complete once', () => {
    let state = transitionMaterialDragSession(idle, 'start').state;
    const replacement = transitionMaterialDragSession(state, 'start');
    assert.equal(replacement.ended, true);
    assert.deepEqual(replacement.state, { active: true, pointerArmed: false });
    state = replacement.state;
    const finished = transitionMaterialDragSession(state, 'drop');
    assert.equal(finished.ended, true);
    assert.deepEqual(transitionMaterialDragSession(finished.state, 'host-dragend'),
        { state: ended, ended: false });
});
