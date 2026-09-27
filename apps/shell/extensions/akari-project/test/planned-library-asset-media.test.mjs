import test from 'node:test';
import assert from 'node:assert/strict';
import { selectResolverPlannedMediaName, toResolverAssetCatalogViewItem } from '../lib/common/asset-catalog-view.js';
import { plannedLibraryAssetMedia } from '../lib/common/library-asset-placement.js';

const files = (...names) => names.map(name => ({ name, key: `k/${name}` }));

for (const [label, category, list, expected] of [
    ['still の画像 1 本', 'still', files('meta.json', 'bg.png', 'preview.png'), 'bg.png'],
    ['still の画像 2 本', 'still', files('one.png', 'two.jpg'), undefined],
    ['still が preview.png だけ', 'still', files('meta.json', 'preview.png'), undefined],
    ['broll の動画 1 本', 'broll', files('clip.mp4', 'preview.png', 'meta.json'), 'clip.mp4'],
    ['broll の動画 0 本', 'broll', files('meta.json', 'preview.png'), undefined],
    ['audio の音 1 本', 'audio', files('se.wav', 'meta.json'), 'se.wav'],
    ['overlay は対象外', 'overlay', files('still.png', 'fragment.html'), undefined],
    ['files[] が無い（有料）', 'still', undefined, undefined],
    ['名前にディレクトリを含む', 'still', files('sub/bg.png'), undefined],
    ['名前が空', 'still', [{ key: 'k' }], undefined]
]) {
    test(`selectResolverPlannedMediaName: ${label}`, () => {
        assert.equal(selectResolverPlannedMediaName({ category, files: list }), expected);
    });
}

test('toResolverAssetCatalogViewItem が plannedMediaName を載せる', () => {
    const item = toResolverAssetCatalogViewItem({
        id: 'bg-000001', category: 'still', title: '朝の草原', files: files('meta.json', 'bg.png', 'preview.png')
    }, undefined, undefined);
    assert.equal(item.plannedMediaName, 'bg.png');
    const unknown = toResolverAssetCatalogViewItem({
        id: 'bg-000002', category: 'still', title: '2 枚', files: files('one.png', 'two.png')
    }, undefined, undefined);
    assert.equal('plannedMediaName' in unknown, false);
});

const base = { origin: 'resolver', category: 'still', state: 'available', id: 'bg-000001', price: 0 };

test('plannedLibraryAssetMedia: plannedMediaName から置き先を組む', () => {
    assert.deepEqual(plannedLibraryAssetMedia({ ...base, plannedMediaName: 'bg.png' }),
        { relativePath: 'assets/still/bg-000001/bg.png', kind: 'image', mediaName: 'bg.png' });
});

test('plannedLibraryAssetMedia: 取得済みは mediaFile を使う', () => {
    assert.deepEqual(plannedLibraryAssetMedia({ ...base, state: 'cached', mediaFile: 'photo.jpg' }),
        { relativePath: 'assets/still/bg-000001/photo.jpg', kind: 'image', mediaName: 'photo.jpg' });
});

test('plannedLibraryAssetMedia: broll と audio の種別', () => {
    assert.equal(plannedLibraryAssetMedia({ ...base, category: 'broll', plannedMediaName: 'clip.mp4' }).kind, 'video');
    assert.equal(plannedLibraryAssetMedia({ ...base, category: 'audio', plannedMediaName: 'se.wav' }).kind, 'audio');
});

for (const [label, item] of [
    ['名前が無い', { ...base }],
    ['種別が合わない（html）', { ...base, plannedMediaName: 'fragment.html' }],
    ['種別が合わない（画像カテゴリに音）', { ...base, plannedMediaName: 'se.wav' }],
    ['preview.png', { ...base, plannedMediaName: 'preview.png' }],
    ['隠しファイル', { ...base, plannedMediaName: '.bg.png' }],
    ['名前にディレクトリ', { ...base, plannedMediaName: 'a/bg.png' }],
    ['id にディレクトリ', { ...base, id: 'a/b', plannedMediaName: 'bg.png' }],
    ['id が ..', { ...base, id: '..', plannedMediaName: 'bg.png' }],
    ['未購入（locked）', { ...base, state: 'locked', plannedMediaName: 'bg.png' }],
    ['有料', { ...base, price: 500, plannedMediaName: 'bg.png' }],
    ['置き場（own）', { ...base, sourceKind: 'own', plannedMediaName: 'bg.png' }],
    ['置き場（site）', { ...base, sourceKind: 'site', plannedMediaName: 'bg.png' }],
    ['local 由来', { ...base, origin: 'local', plannedMediaName: 'bg.png' }],
    ['置けないカテゴリ', { ...base, category: 'overlay', plannedMediaName: 'bg.png' }]
]) {
    test(`plannedLibraryAssetMedia: ${label} は当てない`, () => {
        assert.equal(plannedLibraryAssetMedia(item), undefined);
    });
}
