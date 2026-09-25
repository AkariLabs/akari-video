import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatYen, isPlaceableLibraryCategory, libraryAssetInfoCard, libraryCardMenuEntries, libraryPresetInfoCard, premiumPromptText
} from '../lib/common/library-card-menu.js';

const asset = (extra = {}) => ({ origin: 'resolver', key: 'still/photo', id: 'photo', category: 'still', title: '夕暮れの海岸',
    tags: ['風景', '夕方', '海', '空', '旅行', '夏'], sourceKind: 'own', state: 'cached', price: 0, ...extra });
const ids = entries => entries.map(entry => entry.id);

test('置ける素材: プレイヘッドに置く / 取り込むだけ / ★ / 情報を見る / Finder / ライブラリから消す', () => {
    const entries = libraryCardMenuEntries({ kind: 'asset', item: asset({ libraryDir: '/library/still/photo' }) }, false);
    assert.deepEqual(ids(entries), ['place', 'import', 'favorite', 'info', 'reveal', 'remove-library']);
    assert.equal(entries.find(entry => entry.id === 'import').label, '取り込むだけ（置かない）');
    assert.equal(entries.find(entry => entry.id === 'remove-library').danger, true);
    assert.equal(entries.find(entry => entry.id === 'favorite').separator, true);
    assert.equal(entries.find(entry => entry.id === 'reveal').separator, true);
    // 置き場を持たない（Lab のカタログ）素材には Finder・消すを出さない。
    assert.deepEqual(ids(libraryCardMenuEntries({ kind: 'asset', item: asset({ sourceKind: 'lab', state: 'available' }) }, false)),
        ['place', 'import', 'favorite', 'info']);
    for (const category of ['audio', 'broll', 'still']) assert.equal(isPlaceableLibraryCategory({ origin: 'resolver', category }), true);
});

test('★ の文言は状態で入れ替わる', () => {
    assert.equal(libraryCardMenuEntries({ kind: 'asset', item: asset() }, false).find(entry => entry.id === 'favorite').label, 'お気に入りに入れる');
    const on = libraryCardMenuEntries({ kind: 'asset', item: asset() }, true).find(entry => entry.id === 'favorite');
    assert.equal(on.label, 'お気に入りから外す');
    assert.equal(on.icon, 'star-full');
});

test('オーバーレイは置ける、3D は取り込みのみ', () => {
    for (const category of ['overlay', 'scene3d']) {
        const entries = libraryCardMenuEntries({ kind: 'asset', item: asset({ category, key: `${category}/x`, sourceKind: 'lab', state: 'available' }) }, false);
        assert.deepEqual(ids(entries), category === 'overlay'
            ? ['place', 'import', 'favorite', 'info'] : ['import', 'favorite', 'info']);
    }
});

test('フォントは選択中の文字へ当てる', () => {
    const entries = libraryCardMenuEntries({ kind: 'asset', item: asset({ category: 'font', key: 'font/noto-sans-jp' }) }, false);
    assert.deepEqual(ids(entries), ['apply', 'favorite', 'info']);
    assert.equal(entries[0].label, '選択中に当てる');
});

test('プレミアム未購入: Lab で見る（¥価格）/ プレイヘッドに置く（押すと促しのシート）/ ★ / 情報を見る', () => {
    const premium = asset({ sourceKind: 'lab', state: 'locked', price: 2980 });
    const entries = libraryCardMenuEntries({ kind: 'asset', item: premium }, false);
    assert.deepEqual(ids(entries), ['lab', 'place', 'favorite', 'info']);
    assert.equal(entries[0].label, 'Lab で見る（¥2,980）');
    // 置けない種類のプレミアムには「置く」を出さない。
    assert.deepEqual(ids(libraryCardMenuEntries({ kind: 'asset', item: { ...premium, category: 'overlay' } }, false)), ['lab', 'place', 'favorite', 'info']);
});

test('ローカル索引の素材: 取り込む（未取得のみ）/ 頼む / ★ / 情報を見る', () => {
    const local = { origin: 'local', key: 'audio/pack', id: 'pack', category: 'audio', title: 'パック', tags: [], installed: false };
    assert.deepEqual(ids(libraryCardMenuEntries({ kind: 'asset', item: local }, false)), ['agent-import', 'ask', 'favorite', 'info']);
    assert.deepEqual(ids(libraryCardMenuEntries({ kind: 'asset', item: { ...local, installed: true } }, false)), ['ask', 'favorite', 'info']);
});

test('文字の見た目をかけるメニューとマイスタイル', () => {
    assert.deepEqual(ids(libraryCardMenuEntries({ kind: 'textstyle', key: 'textstyle/news' }, false)), ['apply', 'place-text', 'favorite', 'info']);
    assert.deepEqual(ids(libraryCardMenuEntries({ kind: 'textanim', key: 'textanim/fade' }, false)), ['apply', 'favorite', 'info']);
    for (const kind of ['lut', 'transition']) {
        assert.deepEqual(ids(libraryCardMenuEntries({ kind, key: `${kind}/x` }, false)), ['favorite', 'info']);
    }
    const mine = libraryCardMenuEntries({ kind: 'mystyle', key: 'mystyle/orange' }, false);
    assert.deepEqual(ids(mine), ['apply', 'place-text', 'favorite', 'info', 'rename', 'delete']);
    assert.equal(mine.find(entry => entry.id === 'delete').danger, true);
});

test('メニューの言葉に「AI」「group」・絵文字の記号を使わない', () => {
    const all = [
        ...libraryCardMenuEntries({ kind: 'asset', item: asset({ libraryDir: '/x' }) }, true),
        ...libraryCardMenuEntries({ kind: 'asset', item: asset({ state: 'locked', price: 1 }) }, false),
        ...libraryCardMenuEntries({ kind: 'mystyle', key: 'mystyle/a' }, false)
    ];
    for (const entry of all) assert.doesNotMatch(entry.label, /AI|group|[★☆♛☁✓]/u, entry.label);
});

test('情報カード: 名前・作成元・料金・ライセンス名・キーワード・操作の入口', () => {
    const card = libraryAssetInfoCard(asset({ libraryDir: '/x' }), '画像', false);
    assert.equal(card.name, '夕暮れの海岸');
    assert.equal(card.creator, '自分の素材');
    assert.equal(card.creatorSource, 'own');
    assert.deepEqual(card.price, { kind: 'free', label: '無料' });
    assert.equal(card.keywords[0], '画像');
    assert.ok(card.keywords.length > 5, 'すべて表示が要る数');
    assert.deepEqual(card.actions.map(action => action.id), ['place', 'import', 'favorite']);
    assert.equal(card.actions[0].primary, true);
    assert.equal(card.actions.some(action => ['reveal', 'remove-library', 'info'].includes(action.id)), false);
    const site = libraryAssetInfoCard(asset({ sourceKind: 'site', author: undefined, machineTags: ['site:photo-free'] }), '画像', false);
    assert.equal(site.creator, 'photo-free');
    assert.ok(site.keywords.includes('photo-free'));
    const author = libraryAssetInfoCard(asset({ sourceKind: 'site', author: 'Music Lab', licenseSpdx: 'CC-BY-4.0' }), 'BGM', false);
    assert.equal(author.creator, 'Music Lab');
    assert.equal(author.license.kind, 'by');
    assert.deepEqual(libraryAssetInfoCard(asset({ tags: ['bgm', 'BGM', '明るい'] }), 'BGM', false).keywords, ['BGM', '明るい']);
});

test('情報カード: プレミアム未購入は王冠 · 価格と「Lab で見る」1 つ（+ ★）', () => {
    const card = libraryAssetInfoCard(asset({ sourceKind: 'lab', state: 'locked', price: 2980, author: 'AKARI Video Lab' }), '画像', false);
    assert.deepEqual(card.price, { kind: 'premium', label: 'プレミアム · ¥2,980' });
    assert.deepEqual(card.actions.map(action => action.id), ['lab', 'favorite']);
    assert.equal(card.actions[0].label, 'Lab で見る（¥2,980）');
    assert.equal(card.license.kind, 'premium');
    const bought = libraryAssetInfoCard(asset({ sourceKind: 'lab', state: 'available', price: 2980 }), '画像', false);
    assert.deepEqual(bought.price, { kind: 'purchased', label: '購入済み' });
    assert.equal(bought.creator, 'AKARI Video Lab');
});

test('情報カード: プリセット・マイスタイル', () => {
    const style = libraryPresetInfoCard({ key: 'textstyle/news', kind: 'textstyle', name: 'ニュース風', categoryLabel: 'テキストスタイル', tags: ['subtitle'] }, false);
    assert.equal(style.creator, 'AKARI Video（標準）');
    assert.equal(style.license.kind, 'builtin');
    assert.deepEqual(style.actions.map(action => action.id), ['apply', 'place-text', 'favorite']);
    assert.deepEqual(style.keywords, ['テキストスタイル', 'subtitle']);
    const mine = libraryPresetInfoCard({ key: 'mystyle/o', kind: 'mystyle', name: 'オレンジ', categoryLabel: 'マイスタイル', tags: ['強調'] }, true);
    assert.equal(mine.creator, '自分の素材');
    assert.equal(mine.creatorSource, 'own');
    assert.equal(mine.license.kind, 'own');
    assert.deepEqual(mine.actions.map(action => action.id), ['apply', 'place-text', 'favorite']);
    const lut = libraryPresetInfoCard({ key: 'lut/warm', kind: 'lut', name: '暖色', categoryLabel: 'LUT' }, false);
    assert.deepEqual(lut.actions.map(action => action.id), ['favorite']);
    assert.equal(lut.actions[0].primary, false);
});

test('促しのシートの文言は price から作り、置いていないことを伝える', () => {
    const text = premiumPromptText({ title: '金色の飾り枠', price: 2980 });
    assert.equal(text.title, '「金色の飾り枠」は Lab のプレミアムです');
    assert.match(text.body, /¥2,980/);
    assert.match(text.body, /まだ置いていません/);
    assert.equal(text.action, 'Lab で見る');
    assert.equal(formatYen(undefined), '¥0');
});
