import test from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY_DETAIL_GROUPS, LIBRARY_GROUPS, LIBRARY_PRIMARY_TILES, resolveOpenableLibraryCategory, searchLibraryHome } from '../lib/common/library-home-view.js';

test('最上段はモックどおり 3×3 の 9 タイルで、作る/選ぶを分ける', () => {
    assert.deepEqual(LIBRARY_PRIMARY_TILES.map(tile => tile.key), [
        'text', 'shapes', 'stamps', 'image', 'broll', 'bgm', 'sfx', 'overlay', 'scene3d'
    ]);
    assert.deepEqual(LIBRARY_PRIMARY_TILES.map(tile => tile.kind), [
        'make', 'make', 'make', 'pick', 'pick', 'pick', 'pick', 'pick', 'pick'
    ]);
    assert.deepEqual(LIBRARY_PRIMARY_TILES.map(tile => tile.status), [
        'live', 'soon', 'soon', 'live', 'live', 'live', 'live', 'live', 'live'
    ]);
    assert.equal(LIBRARY_PRIMARY_TILES[0].hint, '押すかドラッグで置く');
});

test('詳細は残りの 12 カテゴリだけで、全カテゴリの外部解決を保つ', () => {
    assert.deepEqual(LIBRARY_DETAIL_GROUPS.map(group => group.label), ['文字の見た目', '仕上げ', 'まとめて', 'マイ']);
    const detailKeys = LIBRARY_DETAIL_GROUPS.flatMap(group => group.categories.map(category => category.key));
    assert.deepEqual(detailKeys, [
        'textstyle', 'textanim', 'font', 'lut', 'transition', 'fx', 'motion',
        'pack', 'template', 'fav', 'brandkit', 'mypresets'
    ]);
    const primaryCategoryKeys = LIBRARY_PRIMARY_TILES.filter(tile => tile.key !== 'text').map(tile => tile.key);
    assert.equal(detailKeys.some(key => primaryCategoryKeys.includes(key)), false);
    assert.deepEqual(new Set([...detailKeys, ...primaryCategoryKeys]),
        new Set(LIBRARY_GROUPS.flatMap(group => group.categories.map(category => category.key))));
    assert.equal(resolveOpenableLibraryCategory('bgm'), 'bgm');
    assert.equal(resolveOpenableLibraryCategory('textstyle'), 'textstyle');
    assert.equal(resolveOpenableLibraryCategory('text'), undefined);
    assert.equal(resolveOpenableLibraryCategory('shapes'), undefined);
});

test('LIBRARY_GROUPS: 5 グループとカテゴリ語彙を宣言順で保持する', () => {
    assert.deepEqual(LIBRARY_GROUPS.map(group => group.label), [
        'マイ', '音・映像・画像', '文字・飾り', '仕上げ', '雛形'
    ]);
    assert.deepEqual(LIBRARY_GROUPS.map(group => group.categories.map(category => category.key)), [
        ['fav', 'brandkit', 'mypresets'],
        ['bgm', 'sfx', 'broll', 'image', 'overlay', 'scene3d', 'pack'],
        ['textstyle', 'textanim', 'font', 'shapes', 'stamps'],
        ['lut', 'transition', 'fx', 'motion'],
        ['template']
    ]);
});

test('LIBRARY_GROUPS: ラベル・soon・chipKey 対応を固定する', () => {
    const categories = Object.fromEntries(LIBRARY_GROUPS.flatMap(group => group.categories.map(category => [category.key, category])));
    assert.deepEqual(
        ['fav', 'brandkit', 'mypresets', 'shapes', 'stamps', 'fx', 'motion', 'template']
            .filter(key => categories[key].status === 'soon'),
        ['fav', 'brandkit', 'mypresets', 'shapes', 'stamps', 'fx', 'motion', 'template']
    );
    assert.deepEqual(
        Object.fromEntries(['bgm', 'sfx', 'broll', 'image', 'overlay', 'scene3d', 'textstyle', 'textanim', 'font', 'lut']
            .map(key => [key, categories[key].chipKey])),
        {
            bgm: 'audio:bgm', sfx: 'audio:sfx', broll: 'broll', image: 'still', overlay: 'overlay', scene3d: 'scene3d',
            textstyle: 'preset:textstyle', textanim: 'preset:textanim', font: 'font', lut: 'preset:lut'
        }
    );
    assert.equal(categories.fav.label, 'お気に入り');
    assert.equal(categories.brandkit.icon, '◈');
    assert.equal(categories.mypresets.icon, '✎');
});

test('LIBRARY_GROUPS: 操作導線の文言を固定する', () => {
    const categories = Object.fromEntries(LIBRARY_GROUPS.flatMap(group => group.categories.map(category => [category.key, category])));
    for (const key of ['bgm', 'sfx', 'broll', 'image']) {
        assert.equal(categories[key].hint, 'タイムラインへドラッグ、右クリックでプレイヘッド位置に置く');
    }
    for (const key of ['overlay', 'scene3d']) {
        assert.equal(categories[key].hint, '右クリックの「取り込む」でプロジェクトに追加');
    }
    assert.equal(categories.textstyle.hint, '選んだ文字に当てる・新しい文字として置く');
    assert.equal(categories.textanim.hint, '選んだ文字に当てる・ホバーで見本を再生');
    assert.equal(categories.font.hint, '選んだ文字に書体を当てる');
    assert.equal(categories.transition.hint, 'タイムラインのカット境界へドラッグして適用');
    assert.equal(categories.lut.hint, '選択中のカットに適用（強さはインスペクター）');
});

const SEARCH_SOURCES = {
    catalogItems: [{ id: 'spark-se', category: 'audio', title: 'Spark 決定音', tags: ['sfx'] }],
    presetShowcase: {
        lut: [],
        textanim: [{ kind: 'textanim', id: 'spark-in', name: 'Spark 登場', tags: ['in'] }],
        textstyle: []
    },
    transitions: [{ id: 'spark-wipe', labelJa: 'Spark ワイプ', category: 'ワイプ' }]
};

test('searchLibraryHome: カタログ・プリセット・トランジションを横断する', () => {
    assert.deepEqual(searchLibraryHome('SPARK', SEARCH_SOURCES), [
        { categoryKey: 'sfx', label: 'Spark 決定音', kind: 'catalog' },
        { categoryKey: 'textanim', label: 'Spark 登場', kind: 'preset' },
        { categoryKey: 'transition', label: 'Spark ワイプ', kind: 'transition' }
    ]);
    assert.deepEqual(searchLibraryHome(' ', SEARCH_SOURCES), []);
});
