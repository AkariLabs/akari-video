import test from 'node:test';
import assert from 'node:assert/strict';
import { countReferences } from '../lib/common/project-reference-check.js';

test('countReferences: N 回出現 → N', () => {
    const doc = 'assets/clip.mp4 と assets/clip.mp4 を使い、最後にもう一度 assets/clip.mp4。';
    assert.equal(countReferences([doc], 'assets/clip.mp4', false), 3);
});

test('countReferences: 0 回 → 0', () => {
    assert.equal(countReferences(['何も参照していません'], 'assets/clip.mp4', false), 0);
});

test('countReferences: ディレクトリは relativePath 単体 + trailing slash prefix の両方を数える', () => {
    // 'assets/group' 単体に 1 マッチ、'assets/group/' prefix にも 1 マッチ（同じ 1 箇所への
    // 言及でも司令塔裁定どおり単純合算 = 2）。
    const doc = '参照: assets/group/meta.json';
    assert.equal(countReferences([doc], 'assets/group', true), 2);
});

test('countReferences: ディレクトリでも配下パスが無ければ単体一致分のみ', () => {
    const doc = 'assets/group という名前のフォルダ';
    assert.equal(countReferences([doc], 'assets/group', true), 1);
});

test('countReferences: 複数ドキュメント（edit.json + captions.json）は合算される', () => {
    const editJson = 'assets/clip.mp4 assets/clip.mp4';
    const captionsJson = 'assets/clip.mp4';
    assert.equal(countReferences([editJson, captionsJson], 'assets/clip.mp4', false), 3);
});

test('countReferences: documents が空なら 0', () => {
    assert.equal(countReferences([], 'assets/clip.mp4', false), 0);
});
