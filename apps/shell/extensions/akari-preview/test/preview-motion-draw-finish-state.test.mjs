import assert from 'node:assert/strict';
import test from 'node:test';
import { motionDrawFinishTransition } from '../lib/common/preview-motion-draw-finish.js';

const active = { pointerId: 7, claimed: false };

test('every release signal claims a stroke once', () => {
    for (const event of [
        { type: 'pointerup', pointerId: 7 },
        { type: 'lostpointercapture', pointerId: 7 },
        { type: 'pointermove', pointerId: 7, buttons: 0 },
        { type: 'mousemove', buttons: 0 },
        { type: 'mouseup', button: 0, buttons: 0 },
        { type: 'mouseup', button: 0 }
    ]) {
        const first = motionDrawFinishTransition(active, event);
        assert.equal(first.finish, true, event.type);
        assert.deepEqual(first.state, { pointerId: 7, claimed: true });
        assert.equal(motionDrawFinishTransition(first.state, event).finish, false, event.type);
    }
    assert.deepEqual(active, { pointerId: 7, claimed: false });
});

test('pressed moves, another pointer, and a non-left mouseup do not finish', () => {
    for (const event of [
        { type: 'pointermove', pointerId: 7, buttons: 1 },
        { type: 'pointermove', pointerId: 7 },
        { type: 'pointermove', pointerId: 8, buttons: 0 },
        { type: 'pointerup', pointerId: 8 },
        { type: 'lostpointercapture', pointerId: 8 },
        { type: 'mousemove', buttons: 1 },
        { type: 'mouseup', button: 2, buttons: 1 }
    ]) {
        const result = motionDrawFinishTransition(active, event);
        assert.equal(result.finish, false, event.type);
        assert.equal(result.state, active);
    }
    assert.equal(motionDrawFinishTransition({ pointerId: null, claimed: false },
        { type: 'mouseup', button: 0, buttons: 0 }).finish, false);
});
