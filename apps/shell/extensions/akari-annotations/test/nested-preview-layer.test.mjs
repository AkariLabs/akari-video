import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { writeNestedPreviewLayer } from '../lib/browser/inspector/nested-preview-layer.js';
import { applyTimelineCollapsedRows } from '../lib/browser/timeline/timeline-tree-model.js';

const edit = () => ({ version: 2, output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: 'image', path: 'assets/image.png' }],
    tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'canvas', at: 0, duration: 150,
        source: { kind: 'group' }, transform: { x: 80, y: 0, scale: .5, rotate: 0 },
        items: [{ id: 'photo', at: 0, duration: 150,
            source: { kind: 'media', src: 'image', in: 0, out: 5 },
            transform: { x: 20, y: 0, scale: 1, rotate: 0 } }] }] }] });

test('canvas photo world move and edge stretch write the local child once', () => {
    const before = edit();
    const after = writeNestedPreviewLayer(before, { kind: 'layer', itemId: 'photo',
        patch: { transform: { x: 110, y: 0, scale: .5, scaleX: 1, scaleY: .5, rotate: 0 } },
        playheadSeconds: 1 });
    const child = after.tracks[0].items[0].items[0];
    assert.equal(child.transform.x, 60);
    assert.equal(child.transform.scale, 1);
    assert.equal(child.transform.scaleX, 2);
    assert.equal(child.transform.scaleY, 1);
    assert.equal(before.tracks[0].items[0].items[0].transform.x, 20);
    assert.equal(writeNestedPreviewLayer(before, { kind: 'layer', itemId: 'missing', patch: {} }), undefined);
});

test('canvas photo crop is written to its child', () => {
    const crop = { x: .1, y: .1, w: .8, h: .8 };
    const after = writeNestedPreviewLayer(edit(), { kind: 'layer', itemId: 'photo', patch: { crop } });
    assert.deepEqual(after.tracks[0].items[0].items[0].crop, crop);
});

test('preview selection opens a closed canvas and selects its photo row', () => {
    const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
    const method = name => {
        const start = source.indexOf(`    ${name}(`);
        const end = source.indexOf('\n    }', start) + 6;
        assert.ok(start >= 0 && end > start, name);
        return source.slice(start, end);
    };
    const Handler = new Function(`return class {
        ${method('previewSelectionAncestorIds')}
        ${method('handleOverlaySelection')}
        ${method('handleLayerSelection')}
    }`)();
    const canvas = { id: 'canvas-1', sourceKind: 'group', itemKind: 'group', trackId: 'v',
        depth: 0, hasChildren: true, collapsed: true, at: 0, duration: 5, ticks: [] };
    const photo = { id: 'photo-in-canvas', sourceKind: 'media', itemKind: 'media',
        parentId: 'canvas-1', trackId: 'v', depth: 1, hasChildren: false,
        collapsed: false, at: 0, duration: 5, ticks: [] };
    const changes = [], selected = [];
    const collapsed = new Set(['canvas-1']);
    const widget = Object.assign(new Handler(), {
        canHandlePlaybackTick: () => true, layers: [{ id: 'photo-in-canvas' }], overlays: [],
        expandedTimelineTreeRows: [canvas, photo],
        timelineTreeRows: applyTimelineCollapsedRows([canvas, photo], collapsed),
        timelineCollapsedIds: collapsed,
        timelineCollapsedState: { set: (...args) => changes.push(args) },
        focusScope: { rootId: null },
        refreshTimelineTreeRows() {
            this.timelineTreeRows = applyTimelineCollapsedRows(this.expandedTimelineTreeRows, collapsed);
        },
        applySelection: value => selected.push(value),
        revealPreviewSelection() {}
    });
    assert.deepEqual(widget.timelineTreeRows.map(row => row.id), ['canvas-1']);
    widget.handleLayerSelection('/edit.json', 'photo-in-canvas');
    assert.deepEqual(changes, [['canvas-1', true]]);
    assert.deepEqual(widget.timelineTreeRows.map(row => row.id), ['canvas-1', 'photo-in-canvas']);
    assert.deepEqual(selected, [{ kind: 'item', id: 'photo-in-canvas', itemKind: 'media',
        parentId: 'canvas-1', trackId: 'v' }]);
});

test('selected canvas child supplies the photo fields to the inspector', () => {
    const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
    const start = source.indexOf('    treeItemSnapshot(');
    const end = source.indexOf('\n    }', start) + 6;
    assert.ok(start >= 0 && end > start);
    const Handler = new Function('mask_fields_1', 'adjust_fields_1',
        `return class { ${source.slice(start, end)} }`)(
        { maskSourceOptionsForSources: () => [] },
        { readInspectorAdjustSnapshot: () => ({}) }
    );
    const widget = Object.assign(new Handler(), {
        expandedTimelineTreeRows: [{ id: 'photo-in-canvas', at: 0, duration: 5 }],
        sourceMap: new Map([['pc', { path: 'assets/photo.png' }]]), fps: 30,
        rawKeyframeItem: () => ({ source: { kind: 'group' } }),
        trackDisplayNameForItem: () => '映像'
    });
    const snapshot = widget.treeItemSnapshot({ kind: 'item', id: 'photo-in-canvas',
        itemKind: 'media', parentId: 'canvas-1', trackId: 'v' },
    { id: 'photo-in-canvas', at: 0, duration: 150, source: { kind: 'media', src: 'pc' } });
    assert.equal(snapshot.id, 'photo-in-canvas');
    assert.equal(snapshot.parentId, 'canvas-1');
    assert.equal(snapshot.photo, true);
    assert.equal(snapshot.sourceKind, 'media');
});
