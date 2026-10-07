import test from 'node:test';
import assert from 'node:assert/strict';
import { memberText, readSourceFile } from './helpers/role-buckets-source.mjs';

test('toolbar owns filter and sort controls; materials pane uses shared visibility rules', () => {
    const toolbar = memberText('renderMaterialsViewButtons');
    const pane = memberText('renderMaterialsTab', { in: 'materials' });
    assert.match(toolbar, /aria-label='絞り込み'/u);
    assert.match(toolbar, /aria-label='並び替え'/u);
    assert.match(toolbar, /aria-label='表示を切り替え'/u);
    assert.match(pane, /visibleMaterials\(this\.materials/u);
    assert.match(pane, /visibleMaterials\(this\.unorganizedMaterials/u);
    assert.match(pane, /data-akari-material-search-empty/u);
    assert.doesNotMatch(pane, /className='akari-seg'/u);
    assert.match(readSourceFile('materials').text, /readUiState\(root\.toString\(\)\)/u);
});
