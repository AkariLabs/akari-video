import test from 'node:test';
import assert from 'node:assert/strict';
import { channelFromProjectPath, resolveCurrentChannel, saveViewingChannel } from '../lib/browser/channel/channel-context-model.js';

test('project はワークスペースの相対パスから決め、lastChannel を読まない', () => {
    let reads = 0;
    const channel = channelFromProjectPath('channels/旅/videos/夏の記録');
    assert.equal(channel, '旅');
    assert.equal(resolveCurrentChannel('project', ['日常', '旅'], channel, () => { reads++; return '日常'; }), '旅');
    assert.equal(reads, 0);
    assert.equal(channelFromProjectPath('channels/旅/notes/夏の記録'), undefined);
});

test('channel は保存値を優先し、なければ root.json の先頭', () => {
    assert.equal(resolveCurrentChannel('channel', ['日常', '旅'], undefined, () => '旅'), '旅');
    assert.equal(resolveCurrentChannel('channel', ['日常', '旅'], undefined, () => null), '日常');
});

test('選んだチャンネルは lastChannel に書く', () => {
    let saved = '';
    assert.equal(saveViewingChannel('旅', ['日常', '旅'], value => { saved = value; }), true);
    assert.equal(saved, '旅');
    assert.equal(saveViewingChannel('不存在', ['日常', '旅'], value => { saved = value; }), false);
    assert.equal(saved, '旅');
});
