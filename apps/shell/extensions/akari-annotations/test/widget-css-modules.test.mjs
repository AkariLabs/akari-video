import assert from 'node:assert/strict';
import test from 'node:test';
import { INSPECTOR_WIDGET_CSS } from '../lib/browser/style/inspector-widget-style.js';

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
