import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
    DEFAULT_SOURCE_ID,
    parseEdit,
    projectLegacyEdit,
    readInternalEdit,
    readInternalSources
} from '../lib/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(packageRoot, '../..');

function findEditJson(root) {
    const found = [];
    const walk = (directory) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') continue;
                walk(path);
            } else if (entry.name === 'edit.json') {
                found.push(path);
            }
        }
    };
    if (statSync(root, { throwIfNoEntry: false })) walk(root);
    return found;
}

const items = (internal) => internal.tracks.flatMap(track => track.items);
const itemById = (internal, id) => items(internal).find(item => item.id === id);

// ---------------------------------------------------------------------------
// 版を問わない読み込み: v0/v1 は種別別配列へ 1 ビットも変えずに戻せる
// ---------------------------------------------------------------------------

test('v0/v1 の全 fixture が内部表現を往復しても種別別配列と完全一致する', () => {
    const files = [
        ...findEditJson(join(repositoryRoot, 'packages/schemas/examples')),
        ...findEditJson(join(repositoryRoot, 'packages/edit-lint/fixtures')),
        ...findEditJson(join(repositoryRoot, 'dev-fixtures')),
        ...findEditJson(join(repositoryRoot, 'templates'))
    ];
    assert.ok(files.length > 100, `検査対象が少なすぎます: ${files.length}`);
    let checked = 0;
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        let raw;
        try {
            raw = JSON.parse(text);
        } catch {
            continue;
        }
        if (raw?.version === 2) continue;
        const expected = parseEdit(text);
        delete expected.origins;
        const actual = projectLegacyEdit(readInternalEdit(text));
        assert.deepEqual(actual, expected, `${file} の射影が旧読み取り器と一致しません`);
        checked += 1;
    }
    assert.ok(checked > 100, `検査できた v0/v1 が少なすぎます: ${checked}`);
});

test('素材表は版を問わず同じ形（v0 の単一宣言も鍵 1 個の表になる）', () => {
    const v0 = readInternalSources(JSON.stringify({ source: { path: 'a.mp4', proxy: null }, cuts: [] }));
    assert.deepEqual(v0.map(entry => [entry.id, entry.path, entry.isDefault, entry.declarationPath]),
        [[DEFAULT_SOURCE_ID, 'a.mp4', true, 'source']]);

    const v1 = readInternalSources(JSON.stringify({
        version: 1,
        sources: [{ id: 'hero', path: 'a.mp4', proxy: null }, { id: 'b', path: 'b.mp4', proxy: 'p.mp4' }],
        cuts: []
    }));
    assert.deepEqual(v1.map(entry => [entry.id, entry.path, entry.proxy, entry.isDefault]),
        [['hero', 'a.mp4', null, false], ['b', 'b.mp4', 'p.mp4', false]]);

    const v2 = readInternalSources(JSON.stringify({
        version: 2,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'hero', path: 'a.mp4' }],
        tracks: []
    }));
    assert.deepEqual(v2.map(entry => [entry.id, entry.path, entry.isDefault]), [['hero', 'a.mp4', false]]);

    // 壊れた宣言も表から落とさない（「path が不正」と言えるように declaredPath は残す）。
    const broken = readInternalSources(JSON.stringify({ source: { path: 42 } }));
    assert.equal(broken.length, 1);
    assert.equal(broken[0].path, undefined);
    assert.equal(broken[0].declaredPath, 42);
});

// ---------------------------------------------------------------------------
// 内部表現の形
// ---------------------------------------------------------------------------

test('相対参照（暗黙 at）は読み込み層で解決し、items は常に絶対位置を持つ', () => {
    const internal = readInternalEdit(JSON.stringify({
        version: 1,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'a', path: 'a.mp4', proxy: null }],
        cuts: [
            { src: 'a', in: 0, out: 2 },
            { src: 'a', in: 5, out: 8 },
            { src: 'a', in: 0, out: 4, speed: 2 }
        ]
    }));
    assert.deepEqual(items(internal).map(item => [item.at, item.duration]), [[0, 2], [2, 3], [5, 2]]);
    // 宣言レコード側は宣言どおり（暗黙のまま）— 書き戻しの宛先だから。
    assert.equal(items(internal)[1].declaration.at, undefined);
});

test('アイテムの種別は source.kind 1 軸（cut/overlay/baked/video/filter が全部ここへ落ちる）', () => {
    const internal = readInternalEdit(JSON.stringify({
        version: 1,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'a', path: 'footage/a.mp4', proxy: null }],
        cuts: [{ src: 'a', in: 0, out: 2 }],
        overlays: [{ id: 'ov', html: 'overlays/o.html', start: 0, duration: 1 }],
        layers: [
            { id: 'telop', t: 0, duration: 1, kind: 'baked', src: 'out/telop.mov', preset: 'p1' },
            { id: 'pinp', t: 0, duration: 1, kind: 'video', src: 'footage/b.mp4' },
            { id: 'lut', t: 0, duration: 1, kind: 'filter', filter: { type: 'invert' } }
        ],
        audio: { sfx: [{ path: 'sfx/a.wav', t: 1 }] }
    }));
    const kinds = Object.fromEntries(items(internal).map(item => [item.id, item.source.kind]));
    assert.deepEqual(kinds, {
        'cut-0': 'media', ov: 'html', telop: 'telop', pinp: 'media', lut: 'filter', 'sfx-0': 'media'
    });
    // media は素材表の鍵とパスの両方を持つ（消費者が版ごとの解決規則を持たなくてよい）。
    assert.equal(itemById(internal, 'cut-0').source.sourceId, 'a');
    assert.equal(itemById(internal, 'cut-0').source.path, 'footage/a.mp4');
    assert.equal(itemById(internal, 'pinp').source.path, 'footage/b.mp4');
    assert.equal(itemById(internal, 'ov').source.html, 'overlays/o.html');
    assert.deepEqual(itemById(internal, 'lut').source.filter, { type: 'invert' });
});

test('baked はキャッシュ: 焼き直しても同じ 1 個のクリップ（id と種別が変わらない）', () => {
    const doc = (src) => JSON.stringify({
        version: 1,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'a', path: 'a.mp4', proxy: null }],
        cuts: [{ src: 'a', in: 0, out: 5 }],
        layers: [{ id: 'telop-name', t: 0, duration: 2, kind: 'baked', src, preset: 'ref3_name_rounded' }]
    });
    const before = itemById(readInternalEdit(doc('out/layers/v1.mov')), 'telop-name');
    const after = itemById(readInternalEdit(doc('out/layers/v2.mov')), 'telop-name');
    assert.equal(before.id, after.id);
    assert.equal(before.source.kind, 'telop');
    assert.equal(after.source.kind, 'telop');
    assert.equal(before.source.preset, after.source.preset);
    assert.notEqual(before.source.baked, after.source.baked);
});

test('v2 でも baked の有無は同じアイテムの二態（id も種別も変わらない）', () => {
    const doc = (baked) => JSON.stringify({
        version: 2,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [],
        tracks: [{
            id: 't1', lane: 'visual', items: [{
                id: 'telop-name', at: 0, duration: 60,
                source: { kind: 'telop', preset: 'ref3_name_rounded', ...(baked ? { baked } : {}) }
            }]
        }]
    });
    const unbaked = itemById(readInternalEdit(doc(undefined)), 'telop-name');
    const baked = itemById(readInternalEdit(doc('out/layers/telop.mov')), 'telop-name');
    assert.equal(unbaked.id, baked.id);
    assert.equal(unbaked.source.kind, 'telop');
    assert.equal(baked.source.kind, 'telop');
    assert.equal(unbaked.source.baked, undefined);
    assert.equal(baked.source.baked, 'out/layers/telop.mov');
});

test('トラックの配列順が z（0 = 最背面）で、配列添字と常に一致する', () => {
    const internal = readInternalEdit(JSON.stringify({
        version: 1,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'a', path: 'a.mp4', proxy: null }],
        cuts: [{ src: 'a', in: 0, out: 2 }],
        overlays: [{ id: 'ov', html: '<p>x</p>', start: 0, duration: 1 }],
        timeline: {
            tracks: [
                { id: 't-ov', kind: 'overlays', ref: 0 },
                { id: 't-cut', kind: 'cuts', ref: 0 }
            ]
        }
    }));
    assert.deepEqual(internal.tracks.map(track => [track.id, track.z, track.lane]),
        [['t-ov', 0, 'visual'], ['t-cut', 1, 'visual']]);
    assert.deepEqual(internal.tracks.map(track => track.items.map(item => item.id)), [['ov'], ['cut-0']]);
});

test('宣言に無いトラック番号のアイテムも内部表現から落とさない（暗黙トラックを生やす）', () => {
    const internal = readInternalEdit(JSON.stringify({
        version: 1,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'a', path: 'a.mp4', proxy: null }],
        cuts: [{ src: 'a', in: 0, out: 2, track: 0 }, { src: 'a', in: 0, out: 2, track: 3, at: 0 }],
        timeline: { tracks: [{ id: 't1', kind: 'cuts', ref: 0 }] }
    }));
    assert.deepEqual(internal.tracks.map(track => [track.origin, track.legacy.ref]),
        [['declared', 0], ['implicit', 3]]);
    // 旧経路の cuts[] には宣言順のまま両方戻る（画面から消えない）。
    assert.equal(projectLegacyEdit(internal).cuts.length, 2);
});

test('v2 は整数フレームを出力秒へ写して読む（消費者は版も単位も知らない）', () => {
    const internal = readInternalEdit(JSON.stringify({
        version: 2,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'hero', path: 'footage/hero.mp4' }],
        tracks: [
            { id: 'v1', lane: 'visual', items: [{ id: 'c1', at: 30, duration: 60, source: { kind: 'media', src: 'hero', in: 2, out: 4 } }] },
            { id: 'sub', lane: 'visual', content: { from: 'captions.json' } }
        ]
    }));
    const cut = itemById(internal, 'c1');
    assert.equal(cut.at, 1);
    assert.equal(cut.duration, 2);
    assert.equal(cut.source.path, 'footage/hero.mp4');
    // 旧経路の種別別ビューも合成するので、v2 でも同じ描画コードが動く。
    const view = projectLegacyEdit(internal);
    assert.deepEqual(view.cuts, [{ in: 2, out: 4, src: 'hero', at: 1, track: 0 }]);
    assert.deepEqual(view.timeline.tracks.map(track => track.kind), ['cuts', 'captions']);
    assert.equal(view.fps, 30);
});

test('読み込み層の外から版を判定しなくて済むよう、v0/v1/v2 が同じ形で返る', () => {
    const shapes = [
        JSON.stringify({ source: { path: 'a.mp4' }, cuts: [{ in: 0, out: 1 }] }),
        JSON.stringify({ version: 1, sources: [{ id: 'a', path: 'a.mp4', proxy: null }], cuts: [{ src: 'a', in: 0, out: 1 }] }),
        JSON.stringify({
            version: 2, output: { width: 1920, height: 1080, fps: 30 },
            sources: [{ id: 'a', path: 'a.mp4' }],
            tracks: [{ id: 't1', lane: 'visual', items: [{ id: 'c', at: 0, duration: 30, source: { kind: 'media', src: 'a', in: 0, out: 1 } }] }]
        })
    ];
    for (const text of shapes) {
        const internal = readInternalEdit(text);
        const clips = items(internal);
        assert.equal(clips.length, 1);
        assert.equal(clips[0].source.kind, 'media');
        assert.equal(clips[0].source.path, 'a.mp4');
        assert.equal(clips[0].at, 0);
        assert.equal(internal.sources.length, 1);
    }
});
