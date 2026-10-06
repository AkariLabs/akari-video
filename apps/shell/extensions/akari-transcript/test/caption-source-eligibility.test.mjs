import test from 'node:test';
import assert from 'node:assert/strict';
import { captionSourceEligibility, selectCaptionSources } from '../lib/common/caption-source-eligibility.js';

const source = path => ({ id: path, path });

test('画像、書き出し、無音動画、非メディアを理由付きで除外する', () => {
    for (const extension of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'svg', 'avif']) {
        assert.deepEqual(captionSourceEligibility(source(`thumb.${extension.toUpperCase()}`)),
            { status: 'excluded', reason: '画像には音声がありません' });
    }
    for (const path of ['exports/master.mp4', 'exports/a/b/master.mp4', 'exports\\a\\master.MP4', './exports/x.mp4']) {
        assert.deepEqual(captionSourceEligibility(source(path)),
            { status: 'excluded', reason: '書き出した完成品です（元の素材から起こします）' });
    }
    for (const path of ['project/exports/nested/master.mp4', 'assets/exports/x.mp4',
        'assets/exports-old/x.mp4', 'D:/撮影/exports/take.mp4']) {
        assert.deepEqual(captionSourceEligibility(source(path)), { status: 'voice' });
    }
    assert.deepEqual(captionSourceEligibility(source('D:/撮影/exports/take.mp4'), { projectRoot: 'D:/撮影' }),
        { status: 'excluded', reason: '書き出した完成品です（元の素材から起こします）' });
    assert.deepEqual(captionSourceEligibility(source('screen.MP4'), { hasAudio: false }),
        { status: 'excluded', reason: '音声トラックが入っていません' });
    assert.deepEqual(captionSourceEligibility(source('notes.txt')),
        { status: 'excluded', reason: '音声・動画のファイルではありません' });
});

test('BGM を分け、音声不明なら動画も候補に残す', () => {
    assert.deepEqual(captionSourceEligibility(source('bgm.MP3'), { isBgm: true }),
        { status: 'bgm', reason: 'BGM として置いた音です' });
    for (const path of ['take.mp4', 'mic.wav', 'SCREEN.MOV']) {
        assert.deepEqual(captionSourceEligibility(source(path)), { status: 'voice' });
    }
});

test('台本の候補は声のある動画とマイク音声の二件だけ', () => {
    const edit = {
        sources: ['take.mp4', 'screen.mp4', 'mic.wav', 'bgm.mp3', 'thumb.png', 'exports/master.mp4']
            .map((path, index) => ({ id: `s${index}`, path })),
        audio: { bgm: { path: 'bgm.mp3' } }
    };
    assert.deepEqual(selectCaptionSources(edit, { 'take.mp4': true, 'screen.mp4': false }).map(item => item.path),
        ['take.mp4', 'mic.wav']);
});

test('音声トラックで BGM 役に置かれた source を除外する', () => {
    const edit = { sources: [{ id: 'music', path: 'assets/music.M4A' }, { id: 'voice', path: 'assets/mic.WAV' }],
        tracks: [{ lane: 'audio', items: [{ role: 'bgm', source: { kind: 'media', src: 'music' } }] }] };
    assert.deepEqual(selectCaptionSources(edit).map(item => item.id), ['voice']);
});

test('プロジェクトルートが分かる絶対パスの書き出しだけを候補から外す', () => {
    const edit = { sources: [source('D:/撮影/exports/master.mp4'), source('D:/他/exports/take.mp4')] };
    assert.deepEqual(selectCaptionSources(edit, {}, 'D:/撮影').map(item => item.path), ['D:/他/exports/take.mp4']);
});
