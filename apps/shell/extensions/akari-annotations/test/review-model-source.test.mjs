import assert from 'node:assert/strict';
import test from 'node:test';
import { URI } from '@theia/core/lib/common/uri.js';

import { ReviewModel } from '../lib/browser/review-model.js';

function modelWithRequestCapture() {
    const requests = [];
    const model = new ReviewModel();
    model.annotationsService = {
        createAnnotation: async request => {
            requests.push(request);
            return { annotation: { id: `a-${requests.length}` }, committed: false };
        }
    };
    model.location = {
        root: new URI('file:///tmp/akari-project'),
        editUri: new URI('file:///tmp/akari-project/edit.json'),
        reviewUri: new URI('file:///tmp/akari-project/review.json')
    };
    return { model, requests };
}

test('raw source の瞬間注釈は src と raw preview の source 秒を渡す', async () => {
    const { model, requests } = modelWithRequestCapture();
    await model.addAnnotation('現在位置', 4.25, 'final-render');
    assert.equal(requests[0].src, 'final-render');
    assert.equal(requests[0].sourceT, 4.25);
    assert.equal(requests[0].timelineT, null);
});

test('音を含む source 区間は新 prefix なしで src + sourceRange へ着地する', async () => {
    const { model, requests } = modelWithRequestCapture();
    await model.addSourceRangeAnnotation('この音の区間', 'voice-take', [1.5, 3.25]);
    assert.deepEqual(requests[0], {
        reviewUri: 'file:///tmp/akari-project/review.json',
        projectRootUri: 'file:///tmp/akari-project',
        src: 'voice-take',
        sourceT: 1.5,
        sourceRange: [1.5, 3.25],
        timelineT: null,
        target: null,
        targetKind: 'range',
        text: 'この音の区間'
    });
});

test('BGM overlay の UI 注釈は既存 ui:timeline:overlay:<id> をそのまま使う', async () => {
    const { model, requests } = modelWithRequestCapture();
    await model.addUiAnnotation('BGM を下げる', 2, 'timeline:overlay:bgm-main');
    assert.equal(requests[0].target, 'ui:timeline:overlay:bgm-main');
});
