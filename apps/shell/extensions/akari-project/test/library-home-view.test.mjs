import test from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY_GROUPS, searchLibraryHome } from '../lib/common/library-home-view.js';

test('LIBRARY_GROUPS: 5 グループとカテゴリ語彙を宣言順で保持する', () => {
    assert.deepEqual(LIBRARY_GROUPS.map(group => group.label), [
        'マイ', '音・映像・画像', '文字・飾り', '仕上げ', '雛形'
    ]);
    assert.deepEqual(LIBRARY_GROUPS.map(group => group.categories.map(category => category.key)), [
        ['fav', 'brandkit', 'mypresets'],
        ['bgm', 'sfx', 'broll', 'image', 'overlay', 'scene3d', 'pack'],
        ['telop', 'textanim', 'font', 'shapes', 'stamps'],
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
        Object.fromEntries(['bgm', 'sfx', 'broll', 'image', 'overlay', 'scene3d', 'telop', 'textanim', 'font', 'lut']
            .map(key => [key, categories[key].chipKey])),
        {
            bgm: 'audio:bgm', sfx: 'audio:sfx', broll: 'broll', image: 'still', overlay: 'overlay', scene3d: 'scene3d',
            telop: 'preset:telop', textanim: 'preset:textanim', font: 'font', lut: 'preset:lut'
        }
    );
    assert.equal(categories.fav.label, 'お気に入り');
    assert.equal(categories.brandkit.icon, '◈');
    assert.equal(categories.mypresets.icon, '✎');
});

test('LIBRARY_GROUPS: 操作導線の文言を固定する', () => {
    const categories = Object.fromEntries(LIBRARY_GROUPS.flatMap(group => group.categories.map(category => [category.key, category])));
    for (const key of ['bgm', 'sfx', 'broll', 'image', 'overlay', 'scene3d']) {
        assert.equal(categories[key].hint, 'タイムラインへドラッグ、＋でプレイヘッド位置に追加');
    }
    assert.equal(categories.telop.hint, 'プレビューへドラッグ、＋でプレイヘッド位置に追加');
    assert.equal(categories.textanim.hint, '選択中のテロップに適用（次のラウンドで有効化）');
    assert.equal(categories.transition.hint, 'タイムラインのカット境界へドラッグして適用');
    assert.equal(categories.lut.hint, '選択中のカットに適用（強さはインスペクター）');
});

const SEARCH_SOURCES = {
    catalogItems: [{ id: 'spark-se', category: 'audio', title: 'Spark 決定音', tags: ['sfx'] }],
    presetShowcase: {
        telop: [],
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
