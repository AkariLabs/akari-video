import test from 'node:test';
import assert from 'node:assert/strict';
import { assetGroupOpenTarget } from '../lib/common/asset-group-open-target.js';

const files = (...names) => names.map(name => ({ name, isDirectory: false }));

for (const category of ['overlay', 'still']) {
    test(`${category}: 断片を見本画像より優先する`, () => {
        assert.equal(assetGroupOpenTarget(files('preview.png', 'meta.json', 'fragment.html'), category), 'fragment.html');
    });
}

test('font: 大小を問わず書体を名前昇順で選び、入力を変更しない', () => {
    const children = files('z.ttf', 'B.OTF', 'a.woff2', 'preview.png', 'meta.json');
    const before = structuredClone(children);
    assert.equal(assetGroupOpenTarget(children, 'font'), 'B.OTF');
    assert.deepEqual(children, before);
    for (const name of ['a.TTF', 'a.otf', 'a.WOFF2']) {
        assert.equal(assetGroupOpenTarget(files(name, 'meta.json'), 'font'), name);
    }
});

test('audio / 種別なし: 従来どおり見本画像、メタデータの順で選ぶ', () => {
    for (const category of ['audio', '', undefined, 'unknown']) {
        assert.equal(assetGroupOpenTarget(files('fragment.html', 'a.ttf', 'preview.png', 'meta.json'), category), 'preview.png');
        assert.equal(assetGroupOpenTarget(files('meta.json'), category), 'meta.json');
    }
});

test('断片・書体なし: 見本画像、メタデータ、undefined へフォールバックする', () => {
    for (const category of ['overlay', 'still', 'font']) {
        assert.equal(assetGroupOpenTarget(files('preview.png', 'meta.json'), category), 'preview.png');
        assert.equal(assetGroupOpenTarget(files('meta.json'), category), 'meta.json');
        assert.equal(assetGroupOpenTarget([], category), undefined);
    }
});

test('同名のディレクトリはクリック先に選ばない', () => {
    const directories = ['fragment.html', 'a.ttf', 'preview.png', 'meta.json'].map(name => ({ name, isDirectory: true }));
    for (const category of ['overlay', 'still', 'font', 'audio']) {
        assert.equal(assetGroupOpenTarget(directories, category), undefined);
        assert.equal(assetGroupOpenTarget([...directories, ...files('meta.json')], category), 'meta.json');
    }
});
