import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveListChannel } from '../lib/browser/home/project-list-channel.js';

const base = {
    scope: 'project',
    override: undefined,
    workspaceChannel: '日常',
    channels: ['日常', '旅'],
    lastChannel: '旅',
    fallback: '既定'
};

test('project は有効な指定チャンネルをワークスペースより優先する', () => {
    assert.equal(resolveListChannel({ ...base, override: '旅' }), '旅');
});

test('project は指定がなければワークスペースのチャンネルを使う', () => {
    assert.equal(resolveListChannel(base), '日常');
});

test('無効な指定は覚えず、ワークスペースのチャンネルを使う', () => {
    assert.equal(resolveListChannel({ ...base, override: '不存在' }), '日常');
});

test('ワークスペースのチャンネルがなければ保存値を使う', () => {
    assert.equal(resolveListChannel({ ...base, workspaceChannel: undefined }), '旅');
});

test('channel は指定とワークスペースを無視して保存値を使う', () => {
    assert.equal(resolveListChannel({ ...base, scope: 'channel', override: '日常' }), '旅');
});

test('保存値が使えなければチャンネル一覧の先頭を使う', () => {
    assert.equal(resolveListChannel({ ...base, scope: 'channel', lastChannel: '不存在' }), '日常');
});

test('チャンネル一覧が空なら既定値を使う', () => {
    assert.equal(resolveListChannel({ ...base, scope: 'channel', channels: [], lastChannel: null }), '既定');
});
