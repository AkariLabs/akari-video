import assert from 'node:assert/strict';
import test from 'node:test';

import {
    markServedPreviewMedia, previewWatchedMediaChange, previewWatchedMediaSets, watchUnservedPreviewMedia
} from '../lib/common/preview-watched-media.js';
import { methodBody, readHandlerSource } from './helpers/handler-source.mjs';

const suffix = uri => uri.split('/').slice(-2).join('/');
const isStill = uri => /\.(png|jpe?g|webp)$/u.test(uri);
const sets = (previous, model) => previewWatchedMediaSets(previous, model, suffix, isStill);
const change = (watched, uri) => previewWatchedMediaChange(watched, uri, suffix(uri));

const still = 'file:///project/assets/generated/map.png';
const video = 'file:///project/assets/clip.mp4';
const fragmentImage = 'file:///project/assets/generated/background.png';

test('配信できなかった素材は、届いた合図で読み直す対象になる', () => {
    const watched = sets({}, { unservedUris: [fragmentImage], cutSourceUris: [] });
    assert.equal(change(watched, fragmentImage), 'unserved');
    // watcher が realpath 済みの別の先頭で通知しても、末尾の一致で拾う。
    assert.equal(previewWatchedMediaChange(watched, 'file:///real/project/assets/generated/background.png',
        'generated/background.png'), 'unserved');
    assert.equal(change(watched, 'file:///project/assets/other.png'), undefined);
});

test('届いて配信できた断片の画像は見張りから外れる（以後は追跡対象の資産として扱われる）', () => {
    const waiting = sets({}, { unservedUris: [fragmentImage], cutSourceUris: [] });
    const arrived = sets(waiting, { unservedUris: [], cutSourceUris: [] });
    assert.equal(change(arrived, fragmentImage), undefined);
});

test('静止画の cut ソースは配信できていても見張る（同じ名前での作り直しを拾う）', () => {
    const watched = sets({}, { cutSourceUris: [still, video] });
    assert.equal(change(watched, still), 'served');
    assert.equal(change(watched, video), undefined);
});

test('配信できなかった cut ソースは、再構築で配信できるまで「まだ配信できていない」のまま持ち越す', () => {
    // 再構築で静止画の cut ソースの配信に失敗した。
    const failed = watchUnservedPreviewMedia(sets({}, { cutSourceUris: [still, video] }), still, suffix);
    assert.equal(change(failed, still), 'unserved');
    // 直後に差分なし・差分更新の読み直しが走っても（cut ソースの配信は試さない）、配信済みに戻さない。
    const reloaded = sets(failed, { cutSourceUris: [still, video] });
    assert.equal(change(reloaded, still), 'unserved');
    assert.equal(change(sets(reloaded, { cutSourceUris: [still, video] }), still), 'unserved');
    // 再構築で配信できたら「配信できている」へ移る。見張りは続く。
    const served = markServedPreviewMedia(reloaded, still, suffix);
    assert.equal(change(served, still), 'served');
    assert.equal(change(sets(served, { cutSourceUris: [still, video] }), still), 'served');
    // cuts から外れたら持ち越さない。
    assert.equal(change(sets(failed, { cutSourceUris: [video] }), still), undefined);
});

test('一度待った動画の cut ソースは、cuts が使っている間は見張り続ける', () => {
    const failed = watchUnservedPreviewMedia(sets({}, { cutSourceUris: [video] }), video, suffix);
    assert.equal(change(failed, video), 'unserved');
    // 届いて再構築で配信できた: unserved ではないが、書き足しを拾うため見張りは続く。
    const arrived = markServedPreviewMedia(sets(failed, { cutSourceUris: [video] }), video, suffix);
    assert.equal(change(arrived, video), 'served');
    assert.equal(change(sets(arrived, { cutSourceUris: [video] }), video), 'served');
    // cuts から外れたら見張らない。
    assert.equal(change(sets(arrived, { cutSourceUris: [] }), video), undefined);
});

test('控えの更新は元の控えを書き換えない', () => {
    const before = sets({}, { cutSourceUris: [still] });
    const failed = watchUnservedPreviewMedia(before, video, suffix);
    assert.equal(change(before, video), undefined);
    assert.equal(change(failed, video), 'unserved');
    assert.equal(change(failed, still), 'served');
    const served = markServedPreviewMedia(failed, video, suffix);
    assert.equal(change(failed, video), 'unserved');
    assert.equal(change(served, video), 'served');
});

test('host は読み込みのたびに控えを作り直し、配信の成否と watcher の両方につないでいる', () => {
    const source = readHandlerSource();
    // どの経路（差分なし・差分更新・再構築・失敗）でも、モデルを読んだ直後に作り直す。
    assert.match(source, /markStage\('model-loaded', 'ok'\);\s*\/\/[^\n]*\n\s*const mediaWatch = kind === 'output'\s*\? this\.beginPreviewMediaWatch\?\.\(widget, model, identityUri, kind, editSource !== undefined\) : undefined;/u);
    // 代表ソースとそれ以外の cut ソースの配信の成否を控える。
    assert.match(source, /this\.noteUnservedPreviewMedia\?\.\(mediaWatch, videoUri\);/u);
    assert.match(source, /if \(videoStream\) this\.noteServedPreviewMedia\?\.\(mediaWatch, videoUri\);/u);
    assert.match(source, /sources\[\] のストリームを開けませんでした[^\n]*\n\s*this\.noteUnservedPreviewMedia\?\.\(mediaWatch, entry\.uri\);/u);
    assert.equal(source.split('this.noteServedPreviewMedia?.(mediaWatch, entry.uri);').length - 1, 2);
    // 断片の中の届いていない画像と、資産ストリームの失敗を控える。合成の読み込みが落ちる経路でも捨てない。
    assert.match(source, /for \(const uri of result\.unserved \?\? \[\]\) noteUnserved\(new URI\(uri\)\);/u);
    assert.match(source, /if \(assetUri\) noteUnserved\(assetUri\);/u);
    assert.equal(source.split(/\n\s*unservedUris,\n/u).length - 1, 2);
    // 届くのを待っている素材の通知は、直後の猶予で落とさない。
    assert.match(source, /const watchedMedia = previewWatchedMediaChange\(widget, key, suffix\);/u);
    assert.match(source, /if \(watchedMedia !== 'unserved' && added && Date\.now\(\) - added < RECENT_WRITE_WINDOW_MS/u);
    // 素材だけの変更はモデルの差分に出ないので、再構築で読み直す。
    assert.match(source, /this\.queueRefresh\(widget, identityUri, kind, undefined, nonModelResourceChanged \|\| watchedMediaChanged\);/u);
});

const stubUri = value => ({ toString: () => value, path: { base: value.split('/').pop() } });

async function mediaWatchSubject(overrides = {}) {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const ts = require('typescript');
    const vm = await import('node:vm');
    const names = ['beginPreviewMediaWatch', 'noteUnservedPreviewMedia', 'noteServedPreviewMedia', 'recheckUnservedPreviewMedia'];
    const code = ts.transpileModule(`class Subject {\n${names.map(name => methodBody(name)).join('\n')}\n}\nexports.Subject = Subject;`,
        { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const context = { exports: {}, previewWatchedMediaSets, watchUnservedPreviewMedia, markServedPreviewMedia,
        isImageLayerSrc: name => /\.(png|jpe?g|webp)$/u.test(name), Set, Map, Date, Promise };
    vm.runInContext(code, vm.createContext(context));
    const subject = new context.exports.Subject();
    const refreshes = [];
    Object.assign(subject, {
        resourceSuffix: uri => suffix(uri.toString()),
        fileService: { exists: async uri => (overrides.existing ?? []).includes(uri.toString()) },
        queueRefresh: (...args) => refreshes.push(args)
    });
    return { subject, refreshes };
}

const modelWith = (cutSources, unserved = []) => ({
    summary: { cuts: cutSources.map((_, index) => ({ src: `s${index}` })) },
    sourcesById: new Map(cutSources.map((uri, index) => [`s${index}`, { uri: stubUri(uri) }])),
    unservedUris: unserved.map(stubUri)
});
const settle = () => new Promise(resolve => setImmediate(resolve));

test('確かめてから見張り始めるまでの間に届いた素材は、もう一度確かめて読み直す（待ち続けている素材では繰り返さない）', async () => {
    const identity = stubUri('file:///project/edit.json');
    // 断片の画像は「無い」と確かめたあと、控えに入る前に届いていた。
    const { subject, refreshes } = await mediaWatchSubject({ existing: [fragmentImage] });
    const widget = {};
    subject.beginPreviewMediaWatch(widget, modelWith([], [fragmentImage]), identity, 'output', false);
    await settle();
    assert.equal(refreshes.length, 1);
    assert.equal(refreshes[0][4], true, '届いた素材を配信し直すため再構築する');
    // 次の読み直しでも配信できない（形式が合わないなど）なら、確かめ直さない。
    subject.beginPreviewMediaWatch(widget, modelWith([], [fragmentImage]), identity, 'output', false);
    await settle();
    assert.equal(refreshes.length, 1);

    // まだ届いていなければ読み直さない。
    const waiting = await mediaWatchSubject();
    const watch = waiting.subject.beginPreviewMediaWatch({}, modelWith([still]), identity, 'output', false);
    waiting.subject.noteUnservedPreviewMedia(watch, stubUri(still));
    await settle();
    assert.equal(waiting.refreshes.length, 0);
});

test('見張り始めた直後の猶予は、アプリ自身の保存で配信できた素材にだけ付く', async () => {
    const identity = stubUri('file:///project/edit.json');
    const { subject } = await mediaWatchSubject();
    // アプリ自身の取り込み: 新しく見張り始めた静止画の cut ソースが配信できた。
    const own = {};
    subject.noteServedPreviewMedia(subject.beginPreviewMediaWatch(own, modelWith([still]), identity, 'output', true), stubUri(still));
    assert.equal(own.akariPreviewJustAddedUris?.has(still), true);
    assert.equal(change(own, still), 'served');
    // 外からの書き込み（エージェント・CLI）には付けない。書き込み途中の続きを落とさない。
    const external = {};
    subject.noteServedPreviewMedia(subject.beginPreviewMediaWatch(external, modelWith([still]), identity, 'output', false), stubUri(still));
    assert.equal(external.akariPreviewJustAddedUris, undefined);
    // 待っていた素材が届いて配信できたときも付けない。
    const waited = {};
    subject.noteUnservedPreviewMedia(subject.beginPreviewMediaWatch(waited, modelWith([still]), identity, 'output', true), stubUri(still));
    assert.equal(change(waited, still), 'unserved');
    subject.noteServedPreviewMedia(subject.beginPreviewMediaWatch(waited, modelWith([still]), identity, 'output', true), stubUri(still));
    assert.equal(change(waited, still), 'served');
    assert.equal(waited.akariPreviewJustAddedUris, undefined);
});
