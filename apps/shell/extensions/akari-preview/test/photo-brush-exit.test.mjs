import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('main window Escape ends a brush once and clears the inspector state', () => {
    const body = source.match(/const onMainEscape = \(event: KeyboardEvent\): void => \{([\s\S]*?)\n        \};/u)?.[1];
    assert.ok(body);
    const messages = [], events = [];
    const widget = { akariPreviewEditUri: { toString: () => '/edit.json' }, sendMessage: value => messages.push(value) };
    const window = { dispatchEvent: event => events.push(event) };
    class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
    const onEscape = new Function('widget', 'window', 'CustomEvent', `let activeBrushItemId = 'photo';
        return event => { ${body} };`)(widget, window, CustomEvent);
    onEscape({ key: 'Escape' });
    onEscape({ key: 'Escape' });
    assert.deepEqual(messages, [{ type: 'akari-preview-photo-brush', itemId: 'photo', settings: null }]);
    assert.equal(events[0].type, 'akari.photo.brush-end');
    assert.deepEqual(events[0].detail, { editUri: '/edit.json' });
});
