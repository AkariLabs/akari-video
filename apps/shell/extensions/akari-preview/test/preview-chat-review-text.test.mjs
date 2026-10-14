import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { describeReviewAttachments } = require('../lib/browser/preview-chat-review-text.js');
const { describeAttachments } = require('../../akari-chat/lib/common/chat-attachments.js');

const attachments = [
    { kind: 'review', label: 'ペン', review: { tool: 'pen', source: 'exports/draft.mp4', sourceLabel: '下書き v2',
        time: 12, elements: ['テロップ「軽い」'], text: '上に動かす', thumbnail: 'data:image/jpeg;base64,AAAA' } },
    { kind: 'review', label: '範囲', review: { tool: 'range', source: 'edit.json', sourceLabel: '編集プレビュー',
        time: 62, timeEnd: 65, text: 'ここを短くする' } }
];

test('チャットの文章化と画像パス以外の書式が一致し、末尾に改行を付ける', () => {
    const expected = describeAttachments(attachments);
    assert.equal(describeReviewAttachments(attachments), expected + '\n');
    const withImage = describeReviewAttachments(attachments, new Map([[0, '.akari/review/attachments/one.jpg']]));
    assert.equal(withImage.replace(' [コマの絵: .akari/review/attachments/one.jpg]', ''), expected + '\n');
    assert.equal(withImage.split('\n').length, 3);
});

test('レビュー本文に改行があっても一件一行にする', () => {
    const dirty = [{ ...attachments[0], review: { ...attachments[0].review, text: '上に\r\n動かす' } }];
    assert.equal(describeReviewAttachments(dirty).split('\n').length, 2);
    assert.match(describeReviewAttachments(dirty), /上に 動かす/);
});

test('メモが空でも時刻・道具・対象・ソースを渡す', () => {
    const empty = [{ ...attachments[0], review: { ...attachments[0].review, text: '' } }];
    const text = describeReviewAttachments(empty);
    assert.match(text, /0:12 ペン（テロップ「軽い」付近） \[exports\/draft\.mp4\]/u);
    assert.doesNotMatch(text, /:  \[/u);
});
