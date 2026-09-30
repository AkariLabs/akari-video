import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { groupChatLines } = require('../../lib/onboarding/chat-model.js');

test('完成例の前置きは注記、依頼と連続する AI の返事は別々の吹き出し', () => {
    const result = groupChatLines(['完成例です。この動画は、AI にこう頼んでつくりました。', '> 編集して',
        '素材を確認します。', 'akari media probe file.mp4', '37 秒', 'edit.json', '本編を置きました']);
    assert.equal(result.note, '完成例です。この動画は、AI にこう頼んでつくりました。');
    assert.deepEqual(result.messages.map(message => message.role), ['user', 'assistant']);
    assert.equal(result.messages[1].lines.length, 5);
    assert.deepEqual(result.messages[1].lines.map(line => line.kind), ['text', 'code', 'text', 'code', 'text']);
});

test('作業ログも複数行を一つの AI メッセージにまとめる', () => {
    const result = groupChatLines(['字幕を作りました', 'edit-lint .', '問題なし']);
    assert.equal(result.note, undefined);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].lines.length, 3);
});
