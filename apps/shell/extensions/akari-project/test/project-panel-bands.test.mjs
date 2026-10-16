import test from 'node:test';
import assert from 'node:assert/strict';
import {
    clampExportBandHeight, dragExportBandHeight, EXPORT_BAND_DEFAULT_HEIGHT, EXPORT_BAND_MIN_HEIGHT,
    formatExportTimestamp, materialRows, materialChipCounts, parseExportBandHeight, projectPanelBands,
    recordGroupWindow, serializeExportBandHeight, visibleMaterialRows
} from '../lib/common/project-panel-bands.js';

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

test('all exports stay in the export band in newest-first order; records contain no exports', () => {
    const entries = [
        ...Array.from({ length: 5 }, (_, mtime) => ({ kind: 'export', mtime, name: `v${mtime}.mp4` })),
        { kind: 'plan', mtime: 8, name: 'plan.md' },
        { kind: 'data', mtime: 7, name: 'edit.json' },
        { kind: 'report', mtime: 6, name: 'review.html' }
    ];
    const bands = projectPanelBands(entries);
    assert.deepEqual(bands.exportAll.map(entry => entry.name), ['v4.mp4', 'v3.mp4', 'v2.mp4', 'v1.mp4', 'v0.mp4']);
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

test('default height does not depend on export count', () => {
    const heights = [0, 2, 30].map(count => {
        const exports = projectPanelBands(Array.from({ length: count }, (_, mtime) => ({ kind: 'export', mtime }))).exportAll;
        assert.equal(exports.length, count);
        return clampExportBandHeight(EXPORT_BAND_DEFAULT_HEIGHT, 500);
    });
    assert.deepEqual(heights, [EXPORT_BAND_DEFAULT_HEIGHT, EXPORT_BAND_DEFAULT_HEIGHT, EXPORT_BAND_DEFAULT_HEIGHT]);
});

test('upward drag changes height and produces a restorable saved value', () => {
    const dragged = dragExportBandHeight(EXPORT_BAND_DEFAULT_HEIGHT, 200, 120, 500);
    assert.equal(dragged, EXPORT_BAND_DEFAULT_HEIGHT + 80);
    assert.equal(clampExportBandHeight(parseExportBandHeight(serializeExportBandHeight(dragged)), 500), dragged);
});

test('height clamps to one row minimum and 70 percent of the panel maximum', () => {
    assert.equal(clampExportBandHeight(0, 500), EXPORT_BAND_MIN_HEIGHT);
    assert.equal(clampExportBandHeight(1000, 500), 350);
    assert.equal(dragExportBandHeight(EXPORT_BAND_DEFAULT_HEIGHT, 100, 1000, 500), EXPORT_BAND_MIN_HEIGHT);
    assert.equal(dragExportBandHeight(EXPORT_BAND_DEFAULT_HEIGHT, 1000, 0, 500), 350);
    assert.equal(parseExportBandHeight('12px'), undefined);
    assert.equal(parseExportBandHeight('-1'), undefined);
    assert.equal(parseExportBandHeight(null), undefined);
});

test('reset uses the fixed default and clears the saved override', () => {
    const saved = serializeExportBandHeight(dragExportBandHeight(EXPORT_BAND_DEFAULT_HEIGHT, 200, 120, 500));
    assert.notEqual(parseExportBandHeight(saved), EXPORT_BAND_DEFAULT_HEIGHT);
    assert.equal(clampExportBandHeight(parseExportBandHeight(null) ?? EXPORT_BAND_DEFAULT_HEIGHT, 500), EXPORT_BAND_DEFAULT_HEIGHT);
});

test('export timestamps show time today and month/day on other dates', () => {
    const now = new Date(2026, 9, 16, 12, 0).getTime();
    assert.equal(formatExportTimestamp(new Date(2026, 9, 16, 9, 4).getTime(), now), '09:04');
    assert.equal(formatExportTimestamp(new Date(2026, 9, 15, 23, 59).getTime(), now), '10/15');
});
