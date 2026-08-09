import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assetDistributionBadgeText,
    assetStateBadgeText,
    catalogItemPackIds,
    deriveAssetDistribution,
    deriveCatalogEmptyStateKind,
    formatCatalogPackBreakdown,
    groupCatalogItemsByPack,
    mergeAssetCatalogViews,
    selectResolverAudioFileRef,
    summarizeCatalogPackDistribution,
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

// --- deriveAssetDistribution / assetDistributionBadgeText（分類バッジ 4 分類、task.md §2） ------
// 優先順位（installed > paid-license-required > remote）の実データ確認: catalog/font/
// 851-chikara-dzuyoku（free）・vdl-v7-mincho（paid）・ab-kirigirisu（subscription）。

test('deriveAssetDistribution: installed は他条件に関わらず bundled が最優先', () => {
    const distribution = deriveAssetDistribution({
        installed: true,
        licenseScope: 'paid-license-required',
        remote: true,
        tags: ['subscription']
    });
    assert.equal(distribution, 'bundled');
});

test('deriveAssetDistribution: paid-license-required かつ subscription タグ無し — paid', () => {
    const distribution = deriveAssetDistribution({
        installed: false,
        licenseScope: 'paid-license-required',
        remote: true,
        tags: ['font', 'paid']
    });
    assert.equal(distribution, 'paid');
});

test('deriveAssetDistribution: paid-license-required かつ subscription タグあり — subscription', () => {
    const distribution = deriveAssetDistribution({
        installed: false,
        licenseScope: 'paid-license-required',
        remote: true,
        tags: ['font', 'subscription', 'byo-font']
    });
    assert.equal(distribution, 'subscription');
});

test('deriveAssetDistribution: paid-license-required でなく remote:true — free', () => {
    const distribution = deriveAssetDistribution({
        installed: false,
        licenseScope: 'commercial-ok',
        remote: true,
        tags: ['font']
    });
    assert.equal(distribution, 'free');
});

test('deriveAssetDistribution: installed でも remote でも paid-license でもない — undefined（バッジ無し）', () => {
    assert.equal(deriveAssetDistribution({ installed: false, licenseScope: 'commercial-ok', remote: false }), undefined);
    assert.equal(deriveAssetDistribution({ installed: false }), undefined);
});

test('deriveAssetDistribution: tags 未指定でも例外にならない（paid 側の subscription 判定）', () => {
    assert.equal(deriveAssetDistribution({ installed: false, licenseScope: 'paid-license-required' }), 'paid');
});

test('assetDistributionBadgeText: bundled は「✓ 同梱済み」', () => {
    assert.equal(assetDistributionBadgeText('bundled'), '✓ 同梱済み');
});

test('assetDistributionBadgeText: subscription は「サブスク」', () => {
    assert.equal(assetDistributionBadgeText('subscription'), 'サブスク');
});

test('assetDistributionBadgeText: paid は「¥ 各自入手」', () => {
    assert.equal(assetDistributionBadgeText('paid'), '¥ 各自入手');
});

test('assetDistributionBadgeText: free かつ acquisition 未指定/direct は「☁ 無料 DL」', () => {
    assert.equal(assetDistributionBadgeText('free'), '☁ 無料 DL');
    assert.equal(assetDistributionBadgeText('free', 'direct'), '☁ 無料 DL');
});

test('assetDistributionBadgeText: free かつ acquisition="login" は「☁ 無料 DL（要登録）」', () => {
    assert.equal(assetDistributionBadgeText('free', 'login'), '☁ 無料 DL（要登録）');
});

test('assetDistributionBadgeText: distribution 未指定は undefined（バッジを出さない）', () => {
    assert.equal(assetDistributionBadgeText(undefined), undefined);
});

// --- パック棚: catalogItemPackIds / groupCatalogItemsByPack / summarizeCatalogPackDistribution /
// formatCatalogPackBreakdown（task.md §3） ------------------------------------------------------

test('catalogItemPackIds: pack: プレフィックスのタグから id を抽出する', () => {
    assert.deepEqual(catalogItemPackIds({ tags: ['font', 'pack:font25-2026-08', 'handwriting'] }), ['font25-2026-08']);
});

test('catalogItemPackIds: pack: タグが無ければ空配列', () => {
    assert.deepEqual(catalogItemPackIds({ tags: ['font', 'handwriting'] }), []);
    assert.deepEqual(catalogItemPackIds({}), []);
});

test('catalogItemPackIds: 複数の pack: タグを全件抽出する', () => {
    assert.deepEqual(catalogItemPackIds({ tags: ['pack:a', 'pack:b'] }), ['a', 'b']);
});

const PACKS = [{ id: 'font25-2026-08', category: 'font', title: 'テロップ向け必須フォント 25 選', summary: '棚卸し済み 25 書体' }];

function fontItem(id, title, tags, extra) {
    return { origin: 'local', key: `font/${id}`, id, category: 'font', title, tags, ...extra };
}

test('groupCatalogItemsByPack: pack タグを持つ項目をグループ化し、無関係な項目は ungrouped に残す', () => {
    const items = [
        fontItem('a', 'A書体', ['pack:font25-2026-08']),
        fontItem('b', 'B書体', ['pack:font25-2026-08']),
        fontItem('c', 'C書体', ['font'])
    ];
    const { groups, ungrouped } = groupCatalogItemsByPack(items, PACKS);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].pack.id, 'font25-2026-08');
    assert.deepEqual(groups[0].items.map(item => item.id), ['a', 'b']);
    assert.deepEqual(ungrouped.map(item => item.id), ['c']);
});

test('groupCatalogItemsByPack: packs.json に無い pack id を指すタグは ungrouped 側に落ちる（壊れタグで落ちない）', () => {
    const items = [fontItem('x', 'X書体', ['pack:unknown-pack'])];
    const { groups, ungrouped } = groupCatalogItemsByPack(items, PACKS);
    assert.equal(groups.length, 0);
    assert.deepEqual(ungrouped.map(item => item.id), ['x']);
});

test('groupCatalogItemsByPack: 該当アイテムが 1 件も無い pack はセクション自体を作らない', () => {
    const { groups } = groupCatalogItemsByPack([], PACKS);
    assert.deepEqual(groups, []);
});

test('groupCatalogItemsByPack: 複数 pack タグを持つ項目は各セクションに重複して現れ、ungrouped には入らない', () => {
    const packs = [
        { id: 'p1', category: 'font', title: 'パック1' },
        { id: 'p2', category: 'font', title: 'パック2' }
    ];
    const items = [fontItem('shared', '共用書体', ['pack:p1', 'pack:p2'])];
    const { groups, ungrouped } = groupCatalogItemsByPack(items, packs);
    assert.equal(groups.length, 2);
    assert.ok(groups.every(group => group.items.some(item => item.id === 'shared')));
    assert.deepEqual(ungrouped, []);
});

test('groupCatalogItemsByPack: グループの並び順は packs.json の順序に従う', () => {
    const packs = [
        { id: 'p1', category: 'font', title: 'パック1' },
        { id: 'p2', category: 'font', title: 'パック2' }
    ];
    const items = [fontItem('b', 'B', ['pack:p2']), fontItem('a', 'A', ['pack:p1'])];
    const { groups } = groupCatalogItemsByPack(items, packs);
    assert.deepEqual(groups.map(group => group.pack.id), ['p1', 'p2']);
});

test('summarizeCatalogPackDistribution: distribution ごとの内訳 + total を集計する', () => {
    const items = [
        { distribution: 'bundled' },
        { distribution: 'bundled' },
        { distribution: 'free' },
        { distribution: 'paid' },
        { distribution: 'subscription' },
        { distribution: undefined }
    ];
    assert.deepEqual(summarizeCatalogPackDistribution(items), {
        total: 6, bundled: 2, free: 1, paid: 1, subscription: 1
    });
});

test('formatCatalogPackBreakdown: 0 件の分類は出さない（task.md 例の形に一致）', () => {
    const breakdown = { total: 23, bundled: 9, free: 14, paid: 0, subscription: 0 };
    assert.equal(formatCatalogPackBreakdown(breakdown), '23 件 — 同梱 9 / 無料 DL 14');
});

test('formatCatalogPackBreakdown: 全分類 0 件なら内訳を出さず件数だけ', () => {
    assert.equal(formatCatalogPackBreakdown({ total: 0, bundled: 0, free: 0, paid: 0, subscription: 0 }), '0 件');
});

// カタログ面の空状態分岐（catalog-account-first-ux task.md §1/§2）。
// resolver 失敗 / resolver 成功だが 0 件 / 件数ありの 3 パターンをここで単体テストする
// （L0 受け入れ条件「空状態分岐の単体テスト追加」の実体）。

test('deriveCatalogEmptyStateKind: 件数 > 0 は resolver の状態に関わらず items', () => {
    assert.equal(deriveCatalogEmptyStateKind(1, 'ok'), 'items');
    assert.equal(deriveCatalogEmptyStateKind(3, 'failed'), 'items');
});

test('deriveCatalogEmptyStateKind: 0 件 + resolver 失敗 → resolver-failed（オフライン初回等の正直表示）', () => {
    assert.equal(deriveCatalogEmptyStateKind(0, 'failed'), 'resolver-failed');
});

test('deriveCatalogEmptyStateKind: 0 件 + resolver 成功 → empty（通常起きない素直な空状態）', () => {
    assert.equal(deriveCatalogEmptyStateKind(0, 'ok'), 'empty');
});
