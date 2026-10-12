import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { reviewAttachDestination } = require('../lib/common/review-attach-destination.js');

test('添付先はチャットの設定と現在の相手に従う', () => {
    assert.equal(reviewAttachDestination(undefined, false), 'clipboard');
    assert.equal(reviewAttachDestination('chat', false), 'clipboard');
    assert.equal(reviewAttachDestination('terminal', false), 'terminal');
    assert.equal(reviewAttachDestination('web', false), 'clipboard');
    assert.equal(reviewAttachDestination(undefined, true), 'chat');
    assert.equal(reviewAttachDestination('chat', true), 'chat');
});
