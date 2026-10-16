import test from 'node:test';
import assert from 'node:assert/strict';
import { materialRows, materialChipCounts, visibleMaterialRows, projectPanelBands, recordGroupWindow } from '../lib/common/project-panel-bands.js';

test('empty asset folder with three plan canvases has a placeholder chip count of three', () => {
    const edit = { tracks: [{ items: [
        { id: 'p1', source: { kind: 'group', canvas: { origin: 'plan', intent: 'Opening' } } },
        { id: 'p2', source: { kind: 'group', canvas: { origin: 'plan', intent: 'Middle' } } },
        { id: 'p3', source: { kind: 'group', canvas: { origin: 'plan', intent: 'Ending' } } }
    ] }] };
    const rows = materialRows([], edit);
    assert.equal(materialChipCounts(rows).placeholder, 3);
    assert.deepEqual(visibleMaterialRows(rows, 'placeholder').map(row => row.placeholder.intent), ['Opening', 'Middle', 'Ending']);
});

test('material chips classify files, recipes, and provenance-backed bakes', () => {
    const rows = materialRows([
        { relativePath: 'assets/a.mp4', kind: 'video' },
        { relativePath: 'assets/b.png', kind: 'image' },
        { relativePath: 'assets/c.wav', kind: 'audio' },
        { relativePath: 'assets/scene3d/x', kind: 'other', recipe: true },
        { relativePath: 'assets/scene3d/x/bakes/x.mp4', kind: 'video', baked: true }
    ], {});
    const counts = materialChipCounts(rows);
    assert.deepEqual([counts.video, counts.image, counts.audio, counts.recipe, counts.baked], [1, 1, 1, 1, 1]);
});

test('five exports produce three preview rows and All (5); records contain no exports', () => {
    const entries = [
        ...Array.from({ length: 5 }, (_, mtime) => ({ kind: 'export', mtime, name: `v${mtime}.mp4` })),
        { kind: 'plan', mtime: 8, name: 'plan.md' },
        { kind: 'data', mtime: 7, name: 'edit.json' },
        { kind: 'report', mtime: 6, name: 'review.html' }
    ];
    const bands = projectPanelBands(entries);
    assert.deepEqual(bands.exportPreview.map(entry => entry.name), ['v4.mp4', 'v3.mp4', 'v2.mp4']);
    assert.equal(bands.exportAll.length, 5);
    assert.equal(bands.showAllExports, true);
    assert.equal(Object.values(bands.records).flat().some(entry => entry.kind === 'export'), false);
});

test('record groups keep newest first within planning, edit data, and reports', () => {
    const entries = [
        { kind: 'report', mtime: 2, name: 'old-report' },
        { kind: 'data', mtime: 1, name: 'old-edit' },
        { kind: 'plan', mtime: 3, name: 'old-plan' },
        { kind: 'plan', mtime: 9, name: 'new-plan' },
        { kind: 'report', mtime: 8, name: 'new-report' },
        { kind: 'data', mtime: 7, name: 'new-edit' }
    ];
    const { records } = projectPanelBands(entries);
    assert.deepEqual(records.plan.map(row => row.name), ['new-plan', 'old-plan']);
    assert.deepEqual(records.data.map(row => row.name), ['new-edit', 'old-edit']);
    assert.deepEqual(records.report.map(row => row.name), ['new-report', 'old-report']);
});

test('record groups show five rows and a remaining count only above five', () => {
    const seven = Array.from({ length: 7 }, (_, index) => index);
    assert.deepEqual(recordGroupWindow(seven), { rows: [0, 1, 2, 3, 4], remaining: 2 });
    assert.deepEqual(recordGroupWindow(seven, true), { rows: seven, remaining: 0 });
    assert.deepEqual(recordGroupWindow(seven.slice(0, 5)), { rows: [0, 1, 2, 3, 4], remaining: 0 });
});

test('zero exports need an empty band; three exports do not need All', () => {
    const empty = projectPanelBands([{ kind: 'plan', mtime: 1 }]);
    assert.equal(empty.exportPreview.length, 0);
    assert.equal(empty.exportAll.length, 0);
    assert.equal(empty.showAllExports, false);
    const three = projectPanelBands(Array.from({ length: 3 }, (_, mtime) => ({ kind: 'export', mtime })));
    assert.equal(three.exportPreview.length, 3);
    assert.equal(three.showAllExports, false);
});
