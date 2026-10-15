import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isReviewStrokeStartRequest, isReviewStrokeEndRequest } from '../lib/browser/preview-host-message-guards.js';

const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const script = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const recorder = readFileSync(new URL('../src/browser/review-session-recorder.ts', import.meta.url), 'utf8');

test('first-row pen and recording mode shortcuts have no UI entry', () => {
    assert.doesNotMatch(handler, /id="pen-toggle"/);
    assert.doesNotMatch(script, /getElementById\('pen-toggle'\)|penToggle\./);
    assert.doesNotMatch(recorder, /installKeydownListener|handleKeydown|keydownListener/);
});

test('host still accepts second-row stroke start and end messages', () => {
    assert.equal(isReviewStrokeStartRequest({
        type: 'akari-preview-review-stroke-start',
        frame: { timelineT: 3, sourceT: 13, cutIndex: null }
    }), true);
    assert.equal(isReviewStrokeEndRequest({
        type: 'akari-preview-review-stroke-end', points: [[0.1, 0.2], [0.8, 0.9]]
    }), true);
    assert.match(handler, /forwardReviewStrokeStart\(widget, message\)/);
    assert.match(handler, /forwardReviewStrokeEnd\(widget, message\)/);
});
