import assert from 'node:assert/strict';
import test from 'node:test';

import {
    newlyServedWatchedMedia, previewWatchedMediaChange, previewWatchedMediaSets, watchUnservedPreviewMedia
} from '../lib/common/preview-watched-media.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const suffix = uri => uri.split('/').slice(-2).join('/');
const isStill = uri => /\.(png|jpe?g|webp)$/u.test(uri);
const sets = (previous, model) => previewWatchedMediaSets(previous, model, suffix, isStill);

const still = 'file:///project/assets/generated/map.png';
const video = 'file:///project/assets/clip.mp4';
const fragmentImage = 'file:///project/assets/generated/background.png';

test('配信できなかった素材は、届いた合図で読み直す対象になる', () => {
    const watched = sets({}, { unservedUris: [fragmentImage], cutSourceUris: [] });
    assert.equal(previewWatchedMediaChange(watched, fragmentImage, suffix(fragmentImage)), 'unserved');
    // watcher が realpath 済みの別の先頭で通知しても、末尾の一致で拾う。
    assert.equal(previewWatchedMediaChange(watched, 'file:///real/project/assets/generated/background.png',
        'generated/background.png'), 'unserved');
    assert.equal(previewWatchedMediaChange(watched, 'file:///project/assets/other.png', 'assets/other.png'), undefined);
});

test('届いて配信できた断片の画像は見張りから外れる（以後は追跡対象の資産として扱われる）', () => {
    const waiting = sets({}, { unservedUris: [fragmentImage], cutSourceUris: [] });
    const arrived = sets(waiting, { unservedUris: [], cutSourceUris: [] });
    assert.equal(previewWatchedMediaChange(arrived, fragmentImage, suffix(fragmentImage)), undefined);
});

test('静止画の cut ソースは配信できていても見張る（同じ名前での作り直しを拾う）', () => {
    const watched = sets({}, { cutSourceUris: [still, video] });
    assert.equal(previewWatchedMediaChange(watched, still, suffix(still)), 'served');
    assert.equal(previewWatchedMediaChange(watched, video, suffix(video)), undefined);
});

test('一度待った動画の cut ソースは、cuts が使っている間は見張り続ける', () => {
    const failed = watchUnservedPreviewMedia(sets({}, { cutSourceUris: [video] }), video, suffix);
    assert.equal(previewWatchedMediaChange(failed, video, suffix(video)), 'unserved');
    // 届いたあとの読み直し: 配信できたので unserved ではないが、書き足しを拾うため見張りは続く。
    const arrived = sets(failed, { cutSourceUris: [video] });
    assert.equal(previewWatchedMediaChange(arrived, video, suffix(video)), 'served');
    assert.equal(previewWatchedMediaChange(sets(arrived, { cutSourceUris: [video] }), video, suffix(video)), 'served');
    // cuts から外れたら見張らない。
    assert.equal(previewWatchedMediaChange(sets(arrived, { cutSourceUris: [] }), video, suffix(video)), undefined);
});

test('読み直しの途中で足した素材は、元の控えを書き換えない', () => {
    const before = sets({}, { cutSourceUris: [still] });
    const after = watchUnservedPreviewMedia(before, video, suffix);
    assert.equal(previewWatchedMediaChange(before, video, suffix(video)), undefined);
    assert.equal(previewWatchedMediaChange(after, video, suffix(video)), 'unserved');
    assert.equal(previewWatchedMediaChange(after, still, suffix(still)), 'served');
});

test('見張り始めた直後の印は、配信できている素材にだけ付く', () => {
    const first = sets({}, { unservedUris: [fragmentImage], cutSourceUris: [still] });
    assert.deepEqual(newlyServedWatchedMedia({}, first), { resources: [still], suffixes: [suffix(still)] });
    // 2 回目の読み直しでは新しく見張り始めたものが無い。
    assert.deepEqual(newlyServedWatchedMedia(first, sets(first, { unservedUris: [fragmentImage], cutSourceUris: [still] })),
        { resources: [], suffixes: [] });
    // 待っていた素材が届いても印は付かない（届いた直後の書き足しを読み直しにつなげる）。
    const waiting = watchUnservedPreviewMedia(sets({}, { cutSourceUris: [video] }), video, suffix);
    assert.deepEqual(newlyServedWatchedMedia(waiting, sets(waiting, { cutSourceUris: [video] })),
        { resources: [], suffixes: [] });
});

test('host は読み込みのたびに控えを作り直し、配信の失敗と watcher の両方につないでいる', () => {
    const source = readHandlerSource();
    // どの経路（差分なし・差分更新・再構築・失敗）でも、モデルを読んだ直後に作り直す。
    assert.match(source, /markStage\('model-loaded', 'ok'\);\s*\/\/[^\n]*\n\s*if \(kind === 'output'\) this\.updateWatchedPreviewMedia\?\.\(widget, model\);/u);
    // 代表ソースとそれ以外の cut ソースの配信失敗を控える。
    assert.match(source, /this\.watchUnservedPreviewMedia\?\.\(widget, videoUri\);/u);
    assert.match(source, /sources\[\] のストリームを開けませんでした[^\n]*\n\s*this\.watchUnservedPreviewMedia\?\.\(widget, entry\.uri\);/u);
    // 断片の中の届いていない画像と、資産ストリームの失敗を控える。
    assert.match(source, /for \(const uri of result\.unserved \?\? \[\]\) noteUnserved\(new URI\(uri\)\);/u);
    assert.match(source, /if \(assetUri\) noteUnserved\(assetUri\);/u);
    // 届くのを待っている素材の通知は、直後の猶予で落とさない。
    assert.match(source, /const watchedMedia = previewWatchedMediaChange\(widget, key, suffix\);/u);
    assert.match(source, /if \(watchedMedia !== 'unserved' && added && Date\.now\(\) - added < RECENT_WRITE_WINDOW_MS/u);
    // 素材だけの変更はモデルの差分に出ないので、落ち着くのを待ってから再構築で読み直す。
    assert.match(source, /this\.queueRefresh\(widget, identityUri, kind, undefined, true\), WATCHED_MEDIA_SETTLE_MS\);/u);
    assert.match(source, /this\.queueRefresh\(widget, identityUri, kind, undefined, nonModelResourceChanged \|\| watchedMediaChanged\);/u);
});
