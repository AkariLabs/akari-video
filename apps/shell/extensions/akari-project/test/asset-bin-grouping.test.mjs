import test from 'node:test';
import assert from 'node:assert/strict';
import { isAssetBinGroupDirectory } from '../lib/common/asset-bin-grouping.js';

// 素材箱グルーピング判定の単体テスト（task.md 決定事項2: meta.json を含むディレクトリ = 1 カード）。

test('isAssetBinGroupDirectory: meta.json を含む — true（1 素材として打ち切り）', () => {
    const children = [
        { name: 'meta.json', isDirectory: false },
        { name: 'fragment.html', isDirectory: false },
        { name: 'preview.png', isDirectory: false }
    ];
    assert.equal(isAssetBinGroupDirectory(children), true);
});

test('isAssetBinGroupDirectory: meta.json を含まない — false（従来どおりファイル単位）', () => {
    const children = [
        { name: 'clip.mp4', isDirectory: false },
        { name: 'take.wav', isDirectory: false }
    ];
    assert.equal(isAssetBinGroupDirectory(children), false);
});

test('isAssetBinGroupDirectory: 子が空 — false', () => {
    assert.equal(isAssetBinGroupDirectory([]), false);
});

test('isAssetBinGroupDirectory: meta.json という名前の「ディレクトリ」はファイルとみなさない — false', () => {
    const children = [
        { name: 'meta.json', isDirectory: true },
        { name: 'clip.mp4', isDirectory: false }
    ];
    assert.equal(isAssetBinGroupDirectory(children), false);
});

test('isAssetBinGroupDirectory: 旧配置 assets/<id>/ 直下でも判定は同じ（深さに依存しない）', () => {
    // 呼び出し側が「訪れたディレクトリの直下」を渡す契約なので、ディレクトリの深さ自体は
    // この関数のシグネチャに現れない — 同じ children 形なら新旧どちらの配置でも同じ結果になる。
    const oldLayoutChildren = [
        { name: 'meta.json', isDirectory: false },
        { name: 'fragment.html', isDirectory: false }
    ];
    const newLayoutChildren = [
        { name: 'meta.json', isDirectory: false },
        { name: 'fragment.html', isDirectory: false }
    ];
    assert.equal(isAssetBinGroupDirectory(oldLayoutChildren), true);
    assert.equal(isAssetBinGroupDirectory(newLayoutChildren), true);
});

test('isAssetBinGroupDirectory: サブディレクトリだけがあり meta.json が無い — false（再帰継続の合図）', () => {
    const children = [
        { name: 'mini-still', isDirectory: true },
        { name: 'br-typing-laptop', isDirectory: true }
    ];
    assert.equal(isAssetBinGroupDirectory(children), false);
});
