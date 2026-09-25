import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchPhotoAnalysis } from '../lib/common/photo-analysis-dispatch.js';

test('missing timeline listener returns unavailable without scheduling a timeout', async () => {
    let scheduled = false;
    const result = await dispatchPhotoAnalysis({ id: 'photo', kind: 'saliency' },
        () => {}, () => { scheduled = true; });
    assert.deepEqual(result, { available: false });
    assert.equal(scheduled, false);
});

test('an accepted request waits for the result and ignores a later timeout', async () => {
    let detail, timeout;
    const result = dispatchPhotoAnalysis({ id: 'photo', kind: 'horizon' },
        value => { detail = value; value.accept(); }, callback => { timeout = callback; });
    detail.resolve({ available: true, degrees: 5 });
    timeout();
    assert.deepEqual(await result, { available: true, degrees: 5 });
});
