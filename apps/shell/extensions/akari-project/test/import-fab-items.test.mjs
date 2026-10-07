import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySelectedFiles, importFabItems } from '../lib/common/import-fab-items.js';

test('取り込み項目は指定の順番・文言・近日札で並ぶ', () => {
    assert.deepEqual(importFabItems().map(({ id, label, soon }) => ({ id, label, soon })), [
        { id: 'device', label: 'デバイスから', soon: undefined },
        { id: 'studio', label: 'スタジオ', soon: '近日' },
        { id: 'internet', label: 'インターネットから', soon: undefined }
    ]);
    assert.equal(importFabItems()[1].info,
        'スタジオ（近日）: マイクで録音・画面キャプチャ・カメラで撮影を 1 つの画面で。止めると素材に入ります。');
    assert.equal(importFabItems()[2].info, undefined);
});

const file = (name, sourcePath = `selected/${name}`) => ({ path: { base: name, fsPath: () => sourcePath } });

test('ファイル選択の複数 URI はドロップ経路の入力に変換し、対応外を数える', () => {
    assert.deepEqual(classifySelectedFiles([
        file('clip.MP4'), file('note.txt'), file('voice.wav'), file('photo.JPEG')
    ]), {
        accepted: [
            { name: 'clip.MP4', sourcePath: 'selected/clip.MP4' },
            { name: 'voice.wav', sourcePath: 'selected/voice.wav' },
            { name: 'photo.JPEG', sourcePath: 'selected/photo.JPEG' }
        ],
        rejectedCount: 1
    });
});

test('単一 URI とキャンセルも扱う', () => {
    assert.deepEqual(classifySelectedFiles(file('sound.mp3')), {
        accepted: [{ name: 'sound.mp3', sourcePath: 'selected/sound.mp3' }], rejectedCount: 0
    });
    assert.deepEqual(classifySelectedFiles(undefined), { accepted: [], rejectedCount: 0 });
});
