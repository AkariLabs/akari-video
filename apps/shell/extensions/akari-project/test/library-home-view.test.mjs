import './support/i18n-ja.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { LIBRARY_DETAIL_GROUPS, LIBRARY_GROUPS, LIBRARY_PRIMARY_TILES, resolveOpenableLibraryCategory, searchLibraryHome, transitionDisplayName, transitionDisplayCategory } from '../lib/common/library-home-view.js';

const require = createRequire(import.meta.url);
const { TRANSITION_VOCABULARY } = require('@akari-video/edit-store');

// テンプレートは棚だけに、キットのまとめ取り込みは詳細に置く。
test('最上段は 14 タイルで、作る/選ぶを分け、段の切れ目を宣言する', () => {
    assert.deepEqual(LIBRARY_PRIMARY_TILES.map(tile => tile.key), [
        'text', 'shapes', 'stamps',
        'image', 'broll', 'bgm', 'sfx', 'overlay', 'scene3d',
        'lut', 'transition', 'fx', 'motion',
        'mypresets'
    ]);
    assert.deepEqual(LIBRARY_PRIMARY_TILES.map(tile => tile.kind), [
        'make', 'make', 'make',
        'pick', 'pick', 'pick', 'pick', 'pick', 'pick',
        'pick', 'pick', 'pick', 'pick',
        'pick'
    ]);
    assert.deepEqual(LIBRARY_PRIMARY_TILES.filter(tile => tile.status === 'soon').map(tile => tile.key),
        ['stamps', 'fx', 'motion', 'mypresets']);
    assert.equal(LIBRARY_PRIMARY_TILES[0].hint, '押すと一覧・ドラッグで置く');
    // 段の区切りは見出しではなく線 1 本。線を引く位置は startsGroup が持つ。
    assert.deepEqual(LIBRARY_PRIMARY_TILES.filter(tile => tile.startsGroup).map(tile => tile.key),
        ['image', 'lut', 'mypresets']);
    // 画面語と内部キーを切り離す。
    const label = key => LIBRARY_PRIMARY_TILES.find(tile => tile.key === key).label;
    assert.equal(label('broll'), '動画');
    assert.equal(label('mypresets'), '自分のスタイル');
    assert.equal(label('overlay'), '動く部品');
    // 2 枚重ねカードの絵と台座色は全タイルが持つ。
    assert.ok(LIBRARY_PRIMARY_TILES.every(tile => typeof tile.art === 'string' && tile.art.length > 0));
    assert.ok(LIBRARY_PRIMARY_TILES.every(tile => tile.plate.length === 2
        && tile.plate.every(color => /^#[0-9a-f]{6}$/.test(color))));
});

test('詳細に pack の導線を保ち、全カテゴリの外部解決を保つ', () => {
    assert.deepEqual(LIBRARY_DETAIL_GROUPS.map(group => group.label), ['マイ', '素材']);
    const detailKeys = LIBRARY_DETAIL_GROUPS.flatMap(group => group.categories.map(category => category.key));
    assert.deepEqual(detailKeys, ['fav', 'brandkit', 'pack']);
    assert.equal(LIBRARY_DETAIL_GROUPS[1].categories[0].label, 'キットからまとめて入れる');
    const primaryCategoryKeys = LIBRARY_PRIMARY_TILES.filter(tile => tile.key !== 'text').map(tile => tile.key);
    assert.equal(detailKeys.some(key => primaryCategoryKeys.includes(key)), false);
    assert.deepEqual(new Set([...detailKeys, ...primaryCategoryKeys, 'textstyle', 'textanim', 'font', 'template']),
        new Set(LIBRARY_GROUPS.flatMap(group => group.categories.map(category => category.key))));
    assert.equal(resolveOpenableLibraryCategory('bgm'), 'bgm');
    assert.equal(resolveOpenableLibraryCategory('textstyle'), 'textstyle');
    assert.equal(resolveOpenableLibraryCategory('text'), undefined);
    assert.equal(resolveOpenableLibraryCategory('shapes'), 'shapes');
});

test('LIBRARY_GROUPS: 5 グループとカテゴリ語彙を宣言順で保持する', () => {
    assert.deepEqual(LIBRARY_GROUPS.map(group => group.label), [
        'マイ', '音・映像・画像', '文字・飾り', '仕上げ', 'テンプレート'
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
        ['fav', 'brandkit', 'mypresets', 'stamps', 'fx', 'motion', 'template']
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

test('未取得 textstyle のカタログ項目は字幕スタイルの検索先へ導く', () => {
    const catalogItems = [{ id: 'telop-fixture-style', category: 'textstyle', title: '金色の字幕', tags: [] }];
    assert.deepEqual(searchLibraryHome('金色', { ...SEARCH_SOURCES, catalogItems }), [
        { categoryKey: 'textstyle', label: '金色の字幕', kind: 'catalog' }
    ]);
    const category = LIBRARY_GROUPS.flatMap(group => group.categories).find(row => row.key === 'textstyle');
    assert.equal(category.label, '字幕スタイル');
});

test('transition search includes Japanese and English names and displays UI language', () => {
    const transition = { id: 'dissolve', labelJa: 'ディゾルブ', category: 'フェード',
        name: 'ディゾルブ', i18n: { en: { name: 'Dissolve', category: 'Fade' } } };
    const sources = { ...SEARCH_SOURCES, transitions: [transition], catalogItems: [],
        presetShowcase: { lut: [], textanim: [], textstyle: [] } };
    assert.deepEqual(searchLibraryHome('ディゾルブ', sources, 'en'),
        [{ categoryKey: 'transition', label: 'Dissolve', kind: 'transition' }]);
    assert.deepEqual(searchLibraryHome('Dissolve', sources, 'ja'),
        [{ categoryKey: 'transition', label: 'ディゾルブ', kind: 'transition' }]);
});

test('all transition catalog rows resolve both display languages and missing rows use vocabulary labels', () => {
    const rows = readFileSync(new URL('../../../../../presets/transitions/index.jsonl', import.meta.url), 'utf8')
        .trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 29);
    assert.deepEqual(rows.map(row => row.id), TRANSITION_VOCABULARY.map(item => item.id));
    for (const row of rows) {
        const vocabulary = TRANSITION_VOCABULARY.find(item => item.id === row.id);
        const item = { ...row, labelJa: vocabulary.labelJa };
        assert.equal(transitionDisplayName(item, 'ja'), row.name);
        assert.equal(transitionDisplayName(item, 'en'), row.i18n.en.name);
        assert.equal(transitionDisplayCategory(item, 'ja'), row.category);
        assert.equal(transitionDisplayCategory(item, 'en'), row.i18n.en.category);
    }
    const missing = TRANSITION_VOCABULARY[0];
    assert.equal(transitionDisplayName(missing, 'en'), missing.labelJa);
    assert.equal(transitionDisplayCategory(missing, 'en'), missing.category);
});
