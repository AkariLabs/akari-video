import assert from 'node:assert/strict';
import test from 'node:test';

import {
    resolveReviewPreviewEditUri,
    transitionRawPreviewFocus
} from '../lib/common/review-preview-state.js';

test('録音セッションは output の editUri と raw の relatedEditUri に同じキーで再適用される', () => {
    const editUri = 'file:///project/edit.json';
    assert.equal(resolveReviewPreviewEditUri({ editUri }), editUri);
    assert.equal(resolveReviewPreviewEditUri({ relatedEditUri: editUri }), editUri);
    assert.equal(resolveReviewPreviewEditUri({}), undefined);
});

test('raw→output→raw の activate/deactivate は各境界で activation を進める', () => {
    const initial = { activation: 0, activeWidgetId: undefined };
    const rawActive = transitionRawPreviewFocus(initial, 'raw-a');
    assert.deepEqual(rawActive, { activation: 1, activeWidgetId: 'raw-a', changed: true });

    const rawStable = transitionRawPreviewFocus(rawActive, 'raw-a');
    assert.deepEqual(rawStable, { activation: 1, activeWidgetId: 'raw-a', changed: false });

    const outputActive = transitionRawPreviewFocus(rawStable, undefined);
    assert.deepEqual(outputActive, { activation: 2, activeWidgetId: undefined, changed: true });

    const rawRestored = transitionRawPreviewFocus(outputActive, 'raw-a');
    assert.deepEqual(rawRestored, { activation: 3, activeWidgetId: 'raw-a', changed: true });
});
