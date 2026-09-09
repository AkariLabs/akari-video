import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const compiled = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
const rest = compiled.slice(compiled.indexOf('    publishPrimaryPreviewSelection('));
const method = rest.slice(0, rest.indexOf('\n    }') + 6);
function setup(cutItemIds = ['lower-cut']) {
    const events = [];
    const Widget = new Function('window', 'CustomEvent', 'timeline_selection_model_1',
        'TIMELINE_OVERLAY_SELECTED_EVENT', 'TIMELINE_LAYER_SELECTED_EVENT', `return class {${method}}`)(
        { dispatchEvent: event => events.push(event) },
        class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        { captionIdForTreeSelection: (_, id) => id }, 'overlay', 'layer');
    const widget = Object.assign(new Widget(), { cutItemIds, layers: [{ id: 'upper-v2-id' }],
        location: { editUri: { toString: () => '/edit.json' } }, rawKeyframeItem: () => ({ source: { kind: 'video' } }) });
    return { widget, events };
}

for (const selection of [{ kind: 'layer', id: 'upper-v2-id' }, { kind: 'item', id: 'upper-v2-id' }]) {
    test(`evacuated ${selection.kind} selection publishes layerId and clears the cut frame`, () => {
        const { widget, events } = setup();
        widget.publishPrimaryPreviewSelection(selection);
        assert.deepEqual(events.map(event => [event.type, event.detail]), [
            ['akari.timeline.primarySelected', { editUri: '/edit.json', selection: null }],
            ['overlay', { editUri: '/edit.json', overlayId: null }],
            ['layer', { editUri: '/edit.json', layerId: 'upper-v2-id' }]
        ]);
    });
}

test('layer projection remains authoritative even if a stale cut index includes the evacuated id', () => {
    for (const selection of [{ kind: 'cut', index: 1 }, { kind: 'item', id: 'upper-v2-id' }]) {
        const { widget, events } = setup(['lower-cut', 'upper-v2-id']);
        widget.publishPrimaryPreviewSelection(selection);
        assert.equal(events.find(e => e.type === 'akari.timeline.primarySelected').detail.selection, null);
        assert.equal(events.find(e => e.type === 'layer').detail.layerId, 'upper-v2-id');
    }
});

test('ordinary cut selection still publishes its stable cut identity', () => {
    const { widget, events } = setup();
    widget.publishPrimaryPreviewSelection({ kind: 'cut', index: 0 });
    assert.deepEqual(events[0].detail.selection, { kind: 'cut', id: 'lower-cut' });
    assert.equal(events.find(e => e.type === 'layer').detail.layerId, null);
});

test('cutItemIds construction only accepts the cuts projection, never evacuated layers', () => {
    const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
    const assignment = source.match(/if \(item\.legacy\.collection === 'cuts'\) \{\s*this\.cutItemIds\[item\.legacy\.index\] = item\.id;\s*\}/);
    assert.ok(assignment);
    const ids = [];
    const assign = new Function('item', assignment[0]);
    assign.call({ cutItemIds: ids }, { id: 'lower-cut', legacy: { collection: 'cuts', index: 0 } });
    assign.call({ cutItemIds: ids }, { id: 'upper-v2-id', legacy: { collection: 'layers', index: 0 } });
    assert.deepEqual(ids, ['lower-cut']);
});
