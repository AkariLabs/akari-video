import './support/i18n-ja.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { memberText, readSourceFile } from './helpers/role-buckets-source.mjs';

test('toolbar owns filter and sort controls; materials pane uses shared visibility rules', () => {
    const toolbar = memberText('renderMaterialsViewButtons');
    const pane = memberText('renderMaterialsTab', { in: 'materials' });
    assert.match(toolbar, /aria-label=\{t\('project\.library\.card\.filter'\)\}/u);
    assert.match(toolbar, /aria-label=\{t\('project\.library\.shelf\.sortLabel'\)\}/u);
    assert.match(toolbar, /aria-label=\{t\('project\.library\.shelf\.changeViewAction'\)\}/u);
    assert.equal(globalThis.t('project.library.card.filter'), '絞り込み');
    assert.equal(globalThis.t('project.library.shelf.sortLabel'), '並び替え');
    assert.equal(globalThis.t('project.library.shelf.changeViewAction'), '表示を切り替え');
    assert.match(pane, /visibleMaterials\(entries, this\.filter/u);
    assert.match(pane, /visible\(this\.materials\)/u);
    assert.match(pane, /visible\(this\.unorganizedMaterials\)/u);
    assert.match(pane, /visibleMaterialRows\(allRows, this\.filter\)/u);
    assert.match(pane, /data-akari-material-search-empty/u);
    assert.doesNotMatch(pane, /akari-material-chips/u);
    assert.match(toolbar, /MATERIAL_CHIPS\.map\(kind/u);
    assert.match(toolbar, /data-akari-material-filter-count=\{counts\[kind\]\}/u);
    assert.match(readSourceFile('materials').text, /readUiState\(root\.toString\(\)\)/u);
});
