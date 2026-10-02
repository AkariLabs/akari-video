import assert from 'node:assert/strict';
import test from 'node:test';
import { INSPECTOR_WIDGET_CSS } from '../lib/browser/style/inspector-widget-style.js';
import { ANNOTATIONS_WIDGET_CSS } from '../lib/browser/style/annotations-widget-style.js';

test('inspector widget CSS module exports a complete static stylesheet', () => {
    assert.equal(typeof INSPECTOR_WIDGET_CSS, 'string');
    assert.ok(INSPECTOR_WIDGET_CSS.length > 0);
    assert.ok(INSPECTOR_WIDGET_CSS.startsWith('\n'));
    assert.ok(INSPECTOR_WIDGET_CSS.endsWith('\n'));
    for (const fragment of ['${', 'undefined', 'NaN', '[object']) {
        assert.ok(!INSPECTOR_WIDGET_CSS.includes(fragment), fragment);
    }
    assert.equal((INSPECTOR_WIDGET_CSS.match(/\{/g) ?? []).length,
        (INSPECTOR_WIDGET_CSS.match(/\}/g) ?? []).length);
});

test('annotations widget CSS module exports an interpolated complete stylesheet', () => {
    assert.equal(typeof ANNOTATIONS_WIDGET_CSS, 'string');
    assert.ok(ANNOTATIONS_WIDGET_CSS.length > 0);
    assert.ok(ANNOTATIONS_WIDGET_CSS.startsWith('\n'));
    assert.ok(ANNOTATIONS_WIDGET_CSS.endsWith('\n'));
    for (const fragment of ['${', 'undefined', 'NaN', '[object']) {
        assert.ok(!ANNOTATIONS_WIDGET_CSS.includes(fragment), fragment);
    }
    assert.equal((ANNOTATIONS_WIDGET_CSS.match(/\{/g) ?? []).length,
        (ANNOTATIONS_WIDGET_CSS.match(/\}/g) ?? []).length);
    assert.ok(ANNOTATIONS_WIDGET_CSS.includes('height: 14px;'));
    assert.ok(ANNOTATIONS_WIDGET_CSS.includes('height: 22px;'));
    assert.ok(ANNOTATIONS_WIDGET_CSS.includes('border-color: #06b6d4 !important;'));
});
