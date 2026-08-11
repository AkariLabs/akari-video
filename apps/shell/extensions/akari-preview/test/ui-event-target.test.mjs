import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyUiEventType, resolveUiEventTarget } from '../lib/common/ui-event-target.js';

// docs/contract-2026-08-11-review-session-ui-events.md #2: opt-in registration + nearest-ancestor
// resolution. Plain objects stand in for DOM nodes (getAttribute + parentNode) so this runs
// without jsdom, matching the pure-function test style already used in this extension
// (cut-freeze-visual.test.mjs etc.).

function node(attributes, parent) {
    return {
        getAttribute: name => (Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null),
        parentNode: parent ?? null
    };
}

test('resolves a directly registered element', () => {
    const target = node({ 'data-akari-ui': 'panel:assets', 'data-akari-ui-label': '素材パネル' });
    assert.deepEqual(resolveUiEventTarget(target), { target: 'panel:assets', label: '素材パネル' });
});

test('rounds up to the nearest registered ancestor', () => {
    const panel = node({ 'data-akari-ui': 'panel:assets', 'data-akari-ui-label': '素材パネル' });
    const card = node({ 'data-akari-ui': 'asset:assets/broll/city.mp4', 'data-akari-ui-label': 'city.mp4' }, panel);
    const icon = node({}, card);
    assert.deepEqual(resolveUiEventTarget(icon), { target: 'asset:assets/broll/city.mp4', label: 'city.mp4' });
});

test('unregistered subtree (no registered ancestor at all) resolves to nothing', () => {
    const root = node({});
    const leaf = node({}, root);
    assert.equal(resolveUiEventTarget(leaf), undefined);
});

test('missing data-akari-ui-label falls back to the target id as the label', () => {
    const target = node({ 'data-akari-ui': 'timeline:overlay:o-0002' });
    assert.deepEqual(resolveUiEventTarget(target), { target: 'timeline:overlay:o-0002', label: 'timeline:overlay:o-0002' });
});

test('null/undefined start resolves to nothing', () => {
    assert.equal(resolveUiEventTarget(null), undefined);
    assert.equal(resolveUiEventTarget(undefined), undefined);
});

test('classifies panel:/tab: targets, defaults everything else to ui.click', () => {
    assert.equal(classifyUiEventType('panel:review'), 'ui.panel');
    assert.equal(classifyUiEventType('tab:inspector-cut-0'), 'ui.tab');
    assert.equal(classifyUiEventType('timeline:cut:3'), 'ui.click');
    assert.equal(classifyUiEventType('timeline:overlay:o-0002'), 'ui.click');
    assert.equal(classifyUiEventType('asset:assets/broll/city.mp4'), 'ui.click');
});
