import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const widget = fs.readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8');
const commands = fs.readFileSync(new URL('../src/browser/akari-catalog-command-contribution.ts', import.meta.url), 'utf8');

test('素材・ライブラリの 5 コマンドが公開の委譲口へ登録される', () => {
    const pairs = [
        ['akari.catalog.setMaterialFilter', 'setMaterialViewFromCommand'],
        ['akari.catalog.setMaterialSort', 'setMaterialViewFromCommand'],
        ['akari.catalog.setMaterialQuery', 'setMaterialQueryFromCommand'],
        ['akari.library.setFilter', 'setLibraryFilterFromCommand'],
        ['akari.catalog.clearFilters', 'clearFiltersFromCommand']
    ];
    for (const [id, method] of pairs) {
        const start = commands.indexOf(`registerCommand({ id: '${id}'`);
        assert.ok(start >= 0, id);
        assert.match(commands.slice(start, commands.indexOf('});', start) + 3), new RegExp(`widget\\.${method}\\(`));
    }
});

test('種類・並べ替え・検索語は別々の更新経路を使い、必要時だけ素材面を選ぶ', () => {
    const method = name => {
        const start = widget.indexOf(`public ${name}(`);
        assert.ok(start >= 0, name);
        return widget.slice(start, widget.indexOf('\n    public ', start + 1));
    };
    const view = method('setMaterialViewFromCommand');
    assert.match(view, /selectTopView\('materials'\)/);
    assert.match(view, /materialsPane\.setVoiceMaterialView\(patch\)/);
    assert.doesNotMatch(view, /setMaterialQuery\(/);
    const query = method('setMaterialQueryFromCommand');
    assert.match(query, /selectTopView\('materials'\)/);
    assert.match(query, /setMaterialQuery\(query\)/);
    assert.doesNotMatch(query, /setMaterialView\(/);
    const library = method('setLibraryFilterFromCommand');
    assert.match(library, /selectTopView\('catalog'\)/);
    assert.match(library, /applyLibraryFilterPatch/);
    assert.doesNotMatch(library, /setMaterialQuery|setCatalogQuery/);
});
