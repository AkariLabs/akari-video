import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assetStateBadgeText,
    mergeAssetCatalogViews,
    selectResolverAudioFileRef,
    toResolverAssetCatalogViewItem
} from '../lib/common/asset-catalog-view.js';

// カタログ面「1 ビュー」の純関数群（マージ・resolver 生アイテムの正規化・状態バッジ文言）。
// backend の getAssetCatalogView() / loadResolverCatalogItems() が使う本体をここで単体テストする。

test('toResolverAssetCatalogViewItem: 必須フィールドの正規化（tags 既定 []・price 既定 0）', () => {
    const item = toResolverAssetCatalogViewItem(
        { id: 'br-typing-laptop', category: 'still', title: 'ノートPCをタイピングする手元', state: 'available' },
        undefined
    );
    assert.deepEqual(item, {
        origin: 'resolver',
        key: 'still/br-typing-laptop',
        id: 'br-typing-laptop',
        category: 'still',
        title: 'ノートPCをタイピングする手元',
        tags: [],
        licenseSpdx: undefined,
        price: 0,
        state: 'available',
        previewUrl: undefined,
        mediaUrl: undefined,
        prompt: undefined
    });
});

test('toResolverAssetCatalogViewItem: license.spdx / provenance.prompt / previewUrl を引き継ぐ', () => {
    const item = toResolverAssetCatalogViewItem(
        {
            id: 'bg-asteroid-belt',
            category: 'still',
            title: '小惑星帯背景',
            tags: ['background', 'space'],
            license: { spdx: 'CC0-1.0' },
            price: 0,
            state: 'cached',
            provenance: { prompt: 'A field of scattered asteroids...' }
        },
        'https://akari-oss.app/assets/still/bg-asteroid-belt/v1/preview.png'
    );
    assert.equal(item.licenseSpdx, 'CC0-1.0');
    assert.equal(item.prompt, 'A field of scattered asteroids...');
    assert.equal(item.previewUrl, 'https://akari-oss.app/assets/still/bg-asteroid-belt/v1/preview.png');
    assert.equal(item.mediaUrl, undefined);
    assert.deepEqual(item.tags, ['background', 'space']);
});

test('toResolverAssetCatalogViewItem: mediaUrl（audio カテゴリの試聴 URL）を引き継ぐ', () => {
    const item = toResolverAssetCatalogViewItem(
        { id: 'bgm-beatslide-124-001', category: 'audio', title: 'Boots On Concrete', price: 0, state: 'available' },
        'https://raw.githubusercontent.com/AkariLabs/akari-sounds/v0/previews/bgm-beatslide-124-001.jpeg',
        'https://github.com/AkariLabs/akari-sounds/releases/download/v0/bgm-beatslide-124-001.mp3'
    );
    assert.equal(item.mediaUrl, 'https://github.com/AkariLabs/akari-sounds/releases/download/v0/bgm-beatslide-124-001.mp3');
    // previewUrl（サムネ）と mediaUrl（試聴実体）は別フィールドのまま混ざらない。
    assert.notEqual(item.mediaUrl, item.previewUrl);
});

test('toResolverAssetCatalogViewItem: locked 項目は price をそのまま持つ', () => {
    const item = toResolverAssetCatalogViewItem(
        { id: 'phone-pro-titanium', category: 'scene3d', title: 'スマートフォン 3D モデル', price: 1200, state: 'locked' },
        undefined
    );
    assert.equal(item.price, 1200);
    assert.equal(item.state, 'locked');
});

test('mergeAssetCatalogViews: ローカルのみ・resolver のみをどちらも含む', () => {
    const local = [{ origin: 'local', key: 'audio/maoudamashii-se-system-category', id: 'maoudamashii-se-system-category', category: 'audio', title: '魔王魂 システム', tags: [] }];
    const resolver = [{ origin: 'resolver', key: 'still/br-coffee-pour', id: 'br-coffee-pour', category: 'still', title: 'コーヒーを注ぐ', tags: [], price: 0, state: 'available' }];
    const merged = mergeAssetCatalogViews(local, resolver);
    assert.equal(merged.length, 2);
    assert.ok(merged.some(item => item.key === 'audio/maoudamashii-se-system-category' && item.origin === 'local'));
    assert.ok(merged.some(item => item.key === 'still/br-coffee-pour' && item.origin === 'resolver'));
});

test('mergeAssetCatalogViews: id 重複（同じ category/id）は resolver 側が勝つ', () => {
    const local = [{ origin: 'local', key: 'still/br-typing-laptop', id: 'br-typing-laptop', category: 'still', title: 'ローカル版タイトル', tags: [] }];
    const resolver = [{ origin: 'resolver', key: 'still/br-typing-laptop', id: 'br-typing-laptop', category: 'still', title: 'resolver 版タイトル', tags: [], price: 0, state: 'cached' }];
    const merged = mergeAssetCatalogViews(local, resolver);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].origin, 'resolver');
    assert.equal(merged[0].title, 'resolver 版タイトル');
});

test('mergeAssetCatalogViews: タイトルの五十音順にソートされる', () => {
    const resolver = [
        { origin: 'resolver', key: 'still/b', id: 'b', category: 'still', title: 'わかめ', tags: [], price: 0, state: 'available' },
        { origin: 'resolver', key: 'still/a', id: 'a', category: 'still', title: 'あさひ', tags: [], price: 0, state: 'available' }
    ];
    const merged = mergeAssetCatalogViews([], resolver);
    assert.deepEqual(merged.map(item => item.id), ['a', 'b']);
});

test('mergeAssetCatalogViews: 両方空なら空配列（例外なし）', () => {
    assert.deepEqual(mergeAssetCatalogViews([], []), []);
});

test('assetStateBadgeText: cached は ✓', () => {
    assert.equal(assetStateBadgeText({ state: 'cached' }), '✓');
});

test('assetStateBadgeText: available は ☁', () => {
    assert.equal(assetStateBadgeText({ state: 'available' }), '☁');
});

test('assetStateBadgeText: locked は円マーク + 3 桁区切りの価格', () => {
    assert.equal(assetStateBadgeText({ state: 'locked', price: 1200 }), '¥1,200');
});

test('assetStateBadgeText: locked かつ price 未指定は ¥0', () => {
    assert.equal(assetStateBadgeText({ state: 'locked' }), '¥0');
});

test('assetStateBadgeText: state 未指定（origin=local）は undefined', () => {
    assert.equal(assetStateBadgeText({}), undefined);
});

test('selectResolverAudioFileRef: audio カテゴリで url 型の音声ファイルを選ぶ', () => {
    const ref = selectResolverAudioFileRef({
        category: 'audio',
        files: [{ name: 'bgm-beatslide-124-001.mp3', url: 'https://github.com/AkariLabs/akari-sounds/releases/download/v0/bgm-beatslide-124-001.mp3' }]
    });
    assert.equal(ref, 'https://github.com/AkariLabs/akari-sounds/releases/download/v0/bgm-beatslide-124-001.mp3');
});

test('selectResolverAudioFileRef: audio カテゴリで key 型の音声ファイルを選ぶ（base 相対キーのまま返す）', () => {
    const ref = selectResolverAudioFileRef({
        category: 'audio',
        files: [{ name: 'se-click.wav', key: 'audio/se-click/v1/se-click.wav' }]
    });
    assert.equal(ref, 'audio/se-click/v1/se-click.wav');
});

test('selectResolverAudioFileRef: 複数ファイルのうち音声拡張子に一致する先頭の 1 件を選ぶ', () => {
    const ref = selectResolverAudioFileRef({
        category: 'audio',
        files: [
            { name: 'cover.jpeg', url: 'https://example.com/cover.jpeg' },
            { name: 'bgm-a.m4a', url: 'https://example.com/bgm-a.m4a' },
            { name: 'bgm-b.ogg', url: 'https://example.com/bgm-b.ogg' }
        ]
    });
    assert.equal(ref, 'https://example.com/bgm-a.m4a');
});

test('selectResolverAudioFileRef: audio カテゴリ以外は files[] があっても常に undefined（still の preview 混同防止）', () => {
    const ref = selectResolverAudioFileRef({
        category: 'still',
        files: [{ name: 'photo.mp3', url: 'https://example.com/photo.mp3' }]
    });
    assert.equal(ref, undefined);
});

test('selectResolverAudioFileRef: files[] が無い / 空 / 音声拡張子に一致しない場合は undefined', () => {
    assert.equal(selectResolverAudioFileRef({ category: 'audio' }), undefined);
    assert.equal(selectResolverAudioFileRef({ category: 'audio', files: [] }), undefined);
    assert.equal(selectResolverAudioFileRef({ category: 'audio', files: [{ name: 'not-audio.txt', url: 'https://example.com/not-audio.txt' }] }), undefined);
});
