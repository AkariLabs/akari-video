import assert from 'node:assert/strict';
import test from 'node:test';
import { captionEditFocusWithinMarkedWidget } from '../lib/common/caption-edit-focus.js';

test('a stale editor mark does not block shortcuts after focus leaves its widget', () => {
    const iframe = {};
    const timeline = {};
    const markedWidget = { contains: node => node === iframe };
    assert.equal(captionEditFocusWithinMarkedWidget(iframe, [markedWidget]), true);
    assert.equal(captionEditFocusWithinMarkedWidget(timeline, [markedWidget]), false);
    assert.equal(captionEditFocusWithinMarkedWidget(null, [markedWidget]), false);
    assert.equal(captionEditFocusWithinMarkedWidget(iframe, []), false);
});
