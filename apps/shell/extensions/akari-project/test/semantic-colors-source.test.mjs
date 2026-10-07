import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../src/browser/${name}`, import.meta.url), 'utf8');

test('リント結果とライブラリの色は役割色を使い、代用色を使わない', () => {
    const lintDialog = source('lint-results-dialog.tsx');
    const lintPane = source('akari-lint-pane.tsx');
    const librarySheet = source('library-import-sheet.tsx');
    for (const content of [lintDialog, lintPane, librarySheet]) {
        assert.doesNotMatch(content, /--theia-(?:errorForeground|editorWarning-foreground)|hsl\(from|--akari-plan-gold/);
    }
    assert.match(lintDialog, /finding\.severity === 'error' \? 'var\(--akari-danger\)'/);
    assert.match(lintDialog, /finding\.severity === 'warning' \? 'var\(--akari-warning\)'/);
    assert.match(lintPane, /hasErrors \? 'var\(--akari-danger\)'/);
    assert.match(librarySheet, /\.akari-import-ok\s*\{[^}]*color:var\(--akari-success\)/);
    assert.match(librarySheet, /^\.akari-import-free .*color:var\(--akari-success\)/m);
    assert.match(librarySheet, /^\.akari-import-level\.warning .*color:var\(--akari-warning\)/m);
});
