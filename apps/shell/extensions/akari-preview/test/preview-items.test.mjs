import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { readInternalEdit } from '@akari-video/edit-store';
import { collectItems, hasInlineCaptions, readPreviewInternalEdit } from '../lib/common/preview-items.js';

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(extensionRoot, '../../../..');

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

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const declarationsOf = (raw, key) => (Array.isArray(raw?.[key]) ? raw[key] : []).map(v => (isRecord(v) ? v : {}));

/**
 * loadPreviewModel が要約に流し込む宣言レコード列は、旧実装が読んでいた生配列と
 * **同じ内容・同じ順序**であること（差し替えたのは「どこから取るか」だけで、
 * 何が要約に入るかは 1 件も変えていない）を実プロジェクト由来の fixture 全数で示す。
 */
test('内部表現から集めた宣言列が、旧実装の生 cuts[] / overlays[] / layers[] と全数一致する', () => {
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
        const internal = readInternalEdit(text);
        for (const [bucket, key] of [['cuts', 'cuts'], ['overlays', 'overlays'], ['layers', 'layers']]) {
            const actual = collectItems(internal, bucket).map(item => item.declaration);
            assert.deepEqual(actual, declarationsOf(raw, key), `${file} の ${bucket} が一致しません`);
        }
        // layers[] のラベル（`layers[N]`）に使う添字も宣言配列の位置と一致する。
        assert.deepEqual(
            collectItems(internal, 'layers').map(item => item.legacy.index),
            declarationsOf(raw, 'layers').map((_, index) => index),
            `${file} の layers[] の添字が宣言位置と一致しません`
        );
        assert.equal(hasInlineCaptions(internal), Array.isArray(raw?.captions) && raw.captions.length > 0);
        checked += 1;
    }
    assert.ok(checked > 100, `検査できた v0/v1 が少なすぎます: ${checked}`);
});

test('timeline.tracks 未宣言では外部字幕または埋め込み字幕から captions 段を導出する', () => {
    const base = {
        version: 1,
        output: { width: 1280, height: 720, fps: 30 },
        sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
        cuts: [{ src: 'main', in: 0, out: 1 }],
        overlays: []
    };
    const external = readPreviewInternalEdit(JSON.stringify(base), true);
    assert.equal(external.tracks.at(-1).legacy.kind, 'captions');

    const inline = readPreviewInternalEdit(JSON.stringify({
        ...base,
        captions: [{ id: 'c1', start: 0, end: 1, text: 'inline' }]
    }), false);
    assert.equal(inline.tracks.at(-1).legacy.kind, 'captions');

    const none = readPreviewInternalEdit(JSON.stringify(base), false);
    assert.equal(none.tracks.some(track => track.legacy.kind === 'captions'), false);
});

test('種別ごとの分岐は source.kind 1 箇所（v2 の 4 種別が同じ 3 バケットへ落ちる）', () => {
    const internal = readInternalEdit(JSON.stringify({
        version: 2,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'hero', path: 'footage/hero.mp4' }],
        tracks: [
            { id: 'v1', lane: 'visual', items: [{ id: 'c1', at: 0, duration: 30, source: { kind: 'media', src: 'hero', in: 0, out: 1 } }] },
            { id: 'v2', lane: 'visual', items: [{ id: 'o1', at: 0, duration: 30, source: { kind: 'html', path: 'overlays/a.html' } }] },
            { id: 'v3', lane: 'visual', items: [{ id: 'l1', at: 0, duration: 30, source: { kind: 'telop', preset: 'p', baked: 'out/l.mov' } }] },
            { id: 'v4', lane: 'visual', items: [{ id: 'f1', at: 0, duration: 30, source: { kind: 'filter', filter: { type: 'invert' } } }] },
            { id: 'a1', lane: 'audio', items: [{ id: 's1', at: 0, duration: 30, source: { kind: 'media', src: 'hero', in: 0, out: 1 } }] }
        ]
    }));
    assert.deepEqual(collectItems(internal, 'cuts').map(item => item.id), ['c1']);
    assert.deepEqual(collectItems(internal, 'overlays').map(item => item.id), ['o1']);
    assert.deepEqual(collectItems(internal, 'layers').map(item => item.id), ['l1', 'f1']);
});
