import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { readInternalEdit } from '@akari-video/edit-store';
import { collectItems, hasInlineCaptions, readPreviewInternalEdit } from '../lib/common/preview-items.js';
import { toV2Edit } from './helpers/v2-fixture.mjs';

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
 * loadPreviewModel が要約へ流す全 visual item が、v2 の単一 reader から
 * cuts / overlays / layers のどれか 1 つへ入ることを実 fixture で示す。
 */
test('移行可能な実 fixture の全 visual item が内部表現の 3 バケットへ過不足なく入る', () => {
    const files = [
        ...findEditJson(join(repositoryRoot, 'packages/schemas/examples')),
        ...findEditJson(join(repositoryRoot, 'packages/edit-lint/fixtures/v2-valid'))
    ];
    assert.ok(files.length > 90, `検査対象が少なすぎます: ${files.length}`);
    let checked = 0;
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        let raw;
        try {
            raw = JSON.parse(text);
        } catch {
            continue;
        }
        let edit;
        try {
            edit = toV2Edit(raw);
        } catch {
            continue;
        }
        let internal;
        try {
            internal = readInternalEdit(edit);
        } catch {
            continue;
        }
        // captions content track は内部表現では描画用の袋 item を持つが、この bridge の
        // cuts / overlays / layers ではなく専用 captions 経路が消費する。
        const visual = internal.tracks.filter(track => track.lane === 'visual').flatMap(track => track.items)
            .filter(item => ['media', 'html', 'telop', 'filter'].includes(item.source.kind));
        const collected = ['cuts', 'overlays', 'layers'].flatMap(bucket => collectItems(internal, bucket));
        assert.equal(collected.length, visual.length, `${file} の visual item 数が一致しません`);
        assert.deepEqual(
            [...collected.map(item => item.id)].sort(),
            [...visual.map(item => item.id)].sort(),
            `${file} の visual item がバケット間で欠落または重複しています`
        );
        assert.equal(hasInlineCaptions(internal), Array.isArray(raw?.captions) && raw.captions.length > 0);
        checked += 1;
    }
    assert.ok(checked >= 43, `検査できた v2 / 移行 fixture が少なすぎます: ${checked}`);
});

test('v2 移行時に外部字幕または埋め込み字幕から captions 段を導出する', () => {
    const legacy = {
        version: 1,
        output: { width: 1280, height: 720, fps: 30 },
        sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
        cuts: [{ src: 'main', in: 0, out: 1 }],
        overlays: []
    };
    const external = readPreviewInternalEdit(JSON.stringify(toV2Edit(legacy, { hasCaptions: true })), true);
    assert.equal(external.tracks.at(-1).legacy.kind, 'captions');

    const inline = readPreviewInternalEdit(JSON.stringify(toV2Edit({
        ...legacy,
        captions: [{ id: 'c1', start: 0, end: 1, text: 'inline' }]
    })), false);
    assert.equal(inline.tracks.at(-1).legacy.kind, 'captions');

    const none = readPreviewInternalEdit(JSON.stringify(toV2Edit(legacy)), false);
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
