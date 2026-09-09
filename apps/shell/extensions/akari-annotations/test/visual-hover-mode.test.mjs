import assert from 'node:assert/strict';
import test from 'node:test';
import { visualHoverMode } from '../lib/common/visual-hover-mode.js';

test('enabled thumbnails retain both band and hover previews', () => {
    assert.equal(visualHoverMode(true), 'band+hover');
});

test('disabled thumbnails retain only the on-demand hover preview', () => {
    assert.equal(visualHoverMode(false), 'hover-only');
});
