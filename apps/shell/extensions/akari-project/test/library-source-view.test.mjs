import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { toResolverAssetCatalogViewItem, groupCatalogItemsByPack } from '../lib/common/asset-catalog-view.js';
import { filterLibraryCatalogItems, libraryItemSource, countLibraryCategory, recentLibraryEntries } from '../lib/common/library-source-view.js';
import { LIBRARY_GROUPS } from '../lib/common/library-home-view.js';
import { resolveResolverCatalogUrls } from '../lib/node/resolver-preview-url.js';
import { canPlaceLibraryAsset } from '../lib/common/library-asset-placement.js';

const raw = (id, extra = {}) => ({ id, category: 'audio', title: `素材 ${id}`, tags: [], sourceKind: 'own',
    state: 'cached', libraryDir: `/tmp/library/audio/${id}`, mediaFile: '音 #1.wav', addedAt: '2026-09-21T00:00:00Z', ...extra });
const view = (id, extra = {}) => toResolverAssetCatalogViewItem(raw(id, extra), undefined);
const category = key => LIBRARY_GROUPS.flatMap(group => group.categories).find(row => row.key === key);
const presets = { textstyle: [{ id: 'a' }], textanim: [{ id: 'b' }], lut: [{ id: 'c' }] };

test('resolver の sourceKind と置き場情報を写し、他の手掛かりから再判定しない', () => {
    for (const sourceKind of ['own', 'site', 'lab']) {
        const input = raw('one', { sourceKind, folder: '旅行', machineTags: ['origin:own'] });
        const item = toResolverAssetCatalogViewItem(input, undefined);
        for (const key of ['sourceKind', 'folder', 'libraryDir', 'addedAt', 'mediaFile']) assert.equal(item[key], input[key]);
        assert.equal(libraryItemSource(item), sourceKind);
    }
    assert.equal(libraryItemSource({ origin: 'resolver', tags: ['origin:own'] }), undefined);
    assert.equal(libraryItemSource({ origin: 'local' }), 'site');
});

test('機械用タグを表示・検索へ混ぜず、パック所属には使う', () => {
    const machineTags = ['origin:site', 'site:sample', 'folder:旅行', 'license:subscription', 'pack:sample'];
    const item = view('one', { tags: ['明るい'], machineTags });
    assert.deepEqual(item.tags, ['明るい']);
    for (const query of machineTags) assert.equal(filterLibraryCatalogItems([item], 'all', query, 'all').length, 0);
    assert.equal(filterLibraryCatalogItems([item], 'all', '明るい', 'all').length, 1);
    assert.equal(groupCatalogItemsByPack([item], [{ id: 'sample' }]).groups[0].items.length, 1);
});

test('件数・カテゴリ結果で同じ出どころを適用し、外部索引も site に含む', () => {
    const items = [view('own', { tags: ['sfx'] }), view('site', { sourceKind: 'site' }), view('lab', { sourceKind: 'lab' }),
        { ...view('index'), origin: 'local', libraryDir: undefined }];
    const expected = { all: [3, 1], own: [0, 1], site: [2, 0], lab: [1, 0] };
    for (const [source, [bgm, sfx]] of Object.entries(expected)) {
        for (const [key, count] of [['bgm', bgm], ['sfx', sfx]]) {
            const definition = category(key);
            assert.equal(countLibraryCategory(definition, source, items, presets, 12, []), count);
            assert.equal(filterLibraryCatalogItems(items, source, '', definition.chipKey).length, count);
        }
        for (const key of ['textstyle', 'textanim', 'lut', 'transition']) {
            assert.equal(countLibraryCategory(category(key), source, items, presets, 12, []),
                source === 'all' || source === 'lab' ? (key === 'transition' ? 12 : 1) : 0);
        }
    }
});

test('最近の帯は新しい順・フォルダで集約・最大8件・入力不変', () => {
    const items = Array.from({ length: 12 }, (_, i) => view(`n${i}`, { addedAt: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
    items.push(view('folder-a', { folder: '旅行', tags: ['sfx'] }), view('folder-b', { folder: '旅行' }), view('folder-c', { folder: '旅行' }));
    const before = JSON.stringify(items);
    const entries = recentLibraryEntries(items, 'all');
    assert.equal(entries.length, 8);
    assert.deepEqual(entries[0], { key: 'folder:旅行', label: '旅行', folder: '旅行', category: 'sfx', itemKey: 'audio/folder-a', count: 3 });
    assert.equal(entries[1].itemKey, 'audio/n11');
    assert.equal(entries[7].itemKey, 'audio/n5');
    assert.equal(JSON.stringify(items), before);
    assert.equal(filterLibraryCatalogItems(items, 'own', '', 'audio:bgm', '旅行').length, 2);
});

test('帯は own/site と使用済み Lab。空・未使用 Lab・未取得・無効日付は非表示', () => {
    assert.deepEqual(recentLibraryEntries([], 'all'), []);
    const items = [view('own'), view('site', { sourceKind: 'site' }), view('lab', { sourceKind: 'lab' }),
        view('invalid', { addedAt: 'invalid' }), view('remote', { libraryDir: undefined }),
        { ...view('index'), origin: 'local' }];
    assert.equal(recentLibraryEntries(items, 'all').length, 2);
    assert.equal(recentLibraryEntries(items, 'own').length, 1);
    assert.equal(recentLibraryEntries(items, 'site').length, 1);
    assert.deepEqual(recentLibraryEntries(items, 'lab'), []);
    const usedLab = { ...view('used-lab', { sourceKind: 'lab' }), usageCount: 2 };
    assert.deepEqual(recentLibraryEntries([usedLab], 'lab').map(entry => entry.itemKey), [usedLab.key]);
});

test('置き場の主メディアとサムネは file URI。空白・日本語・# をエンコード', () => {
    const item = raw('one', { libraryDir: '/tmp/素材 置き場/audio/one', preview: 'preview.png' });
    const urls = resolveResolverCatalogUrls(item, 'https://example.test/catalog/');
    assert.equal(urls.mediaUrl, pathToFileURL(`${item.libraryDir}/${item.mediaFile}`).href);
    assert.equal(urls.previewUrl, pathToFileURL(`${item.libraryDir}/preview.png`).href);
    assert.equal(canPlaceLibraryAsset(toResolverAssetCatalogViewItem(item, urls.previewUrl, urls.mediaUrl)), true);
    assert.equal(resolveResolverCatalogUrls({ ...item, mediaFile: null, preview: null }, 'https://example.test/').mediaUrl, undefined);
    assert.equal(resolveResolverCatalogUrls({ category: 'audio', files: [{ name: 'x.mp3', key: 'x.mp3' }] }, 'https://example.test/').mediaUrl, 'https://example.test/x.mp3');
});

test('取得済みLabの相対サムネキーと複数テイク試聴は catalog base を維持する', () => {
    const item = raw('lab', { sourceKind: 'lab', preview: 'audio/lab/v1/preview.png', mediaFile: null,
        files: [{ name: 'take-a.mp3', key: 'audio/lab/v1/take-a.mp3' }, { name: 'take-b.mp3', key: 'audio/lab/v1/take-b.mp3' }] });
    assert.deepEqual(resolveResolverCatalogUrls(item, 'https://example.test/'), {
        previewUrl: 'https://example.test/audio/lab/v1/preview.png', mediaUrl: 'https://example.test/audio/lab/v1/take-a.mp3'
    });
    assert.equal(resolveResolverCatalogUrls(raw('offline'), null).mediaUrl, pathToFileURL('/tmp/library/audio/offline/音 #1.wav').href);
});
