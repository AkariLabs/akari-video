import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { orderDataEntries, dataFileIcon } = require('../lib/common/output-data-order.js');
const FILE_ORDER = ['edit.json', 'captions.json', 'review.json'];
const data = (name, mtime) => ({ kind: 'data', name, mtime });

test('file order mirrors the widget PROJECT_DATA_FILES definition', () => {
    const source = ts.createSourceFile('widget.tsx', readFileSync(
        new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'
    ), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = source.statements.filter(ts.isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations])
        .find(node => node.name.getText(source) === 'PROJECT_DATA_FILES');
    assert.ok(declaration?.initializer);
    const files = new Function(`return ${declaration.initializer.getText(source)};`)();
    assert.deepEqual(files.map(file => file.name), FILE_ORDER);
});

test('edit precedes captions and review even when their mtime is newer', () => {
    const entries = [data('edit.json', 1), data('captions.json', 2), data('review.json', 3)]
        .sort((left, right) => right.mtime - left.mtime);
    const snapshot = [...entries];
    const ordered = orderDataEntries(Object.freeze(entries), FILE_ORDER);
    assert.deepEqual(ordered.map(entry => entry.name), FILE_ORDER);
    assert.deepEqual(entries, snapshot);
    assert.strictEqual(ordered[0], entries[2]);
});

test('non-data entries retain their exact positions and mtime order', () => {
    const entries = [
        { kind: 'export', name: 'movie.mp4', mtime: 7 },
        data('review.json', 6),
        { kind: 'plan', name: 'README.md', mtime: 5 },
        data('captions.json', 4),
        { kind: 'report', name: 'report.html', mtime: 3 },
        data('edit.json', 2),
        { kind: 'export', name: 'edit.json', mtime: 1 }
    ];
    const ordered = orderDataEntries(entries, FILE_ORDER);
    for (const index of [0, 2, 4, 6]) {
        assert.strictEqual(ordered[index], entries[index]);
    }
    assert.deepEqual(ordered.filter(entry => entry.kind === 'data').map(entry => entry.name), FILE_ORDER);
});

test('unknown data names follow known files and keep their original relative order', () => {
    const entries = [data('z.json', 5), data('captions.json', 4), data('a.json', 3), data('edit.json', 2), data('review.json', 1)];
    assert.deepEqual(orderDataEntries(entries, FILE_ORDER).map(entry => entry.name), [...FILE_ORDER, 'z.json', 'a.json']);
});

test('equal data ranks preserve their input order', () => {
    const entries = [data('captions.json', 3), data('edit.json', 2), data('captions.json', 1)];
    assert.deepEqual(orderDataEntries(entries, FILE_ORDER), [entries[1], entries[0], entries[2]]);
});

test('empty entries and an empty file order are supported', () => {
    assert.deepEqual(orderDataEntries([], FILE_ORDER), []);
    const entries = [data('review.json', 2), data('edit.json', 1)];
    assert.deepEqual(orderDataEntries(entries, []), entries);
});

for (const [name, icon] of [
    ['edit.json', 'codicon-layers'],
    ['captions.json', 'codicon-symbol-string'],
    ['review.json', 'codicon-comment-discussion'],
    ['unknown.json', 'codicon-json']
]) {
    test(`dataFileIcon: ${name}`, () => {
        assert.equal(dataFileIcon(name), `codicon ${icon}`);
    });
}
