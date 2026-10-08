import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL_DOC_KINDS, channelDocFileName, channelDocTemplate, resolveChannelDocFileName } from '../lib/browser/channel/channel-docs.js';

test('チャンネル文書は 4 種類の日本語テンプレートを持つ', () => {
    assert.deepEqual([...CHANNEL_DOC_KINDS], ['channel', 'design', 'people', 'notes']);
    assert.deepEqual(CHANNEL_DOC_KINDS.map(channelDocFileName), ['channel.md', 'design.md', 'people.md', 'notes.md']);
    for (const kind of CHANNEL_DOC_KINDS) {
        const template = channelDocTemplate(kind, 'テスト');
        assert.match(template, /^# テスト の/);
        assert.ok((template.match(/^## /gm) ?? []).length >= 4);
    }
    const people = channelDocTemplate('people', 'テスト');
    for (const field of ['名前', '読み', '別名', '写真', '使う場面']) assert.match(people, new RegExp(field));
});

test('チャンネル設計は旧 design.md を開ける', () => {
    assert.equal(resolveChannelDocFileName('channel', name => name === 'design.md'), 'design.md');
    assert.equal(resolveChannelDocFileName('channel', name => name === 'channel.md' || name === 'design.md'), 'channel.md');
    assert.equal(resolveChannelDocFileName('design', name => name === 'channel.md'), undefined);
});
