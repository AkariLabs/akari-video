import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHomeStats, formatDuration, formatBytes, homeWindowTitle, noticeStage, noticeStorageKey, shouldAutoShowNotice, validateChannelName } from '../../lib/browser/home/home-model.js';

test('only available project statistics are shown and values are formatted', () => {
    assert.deepEqual(buildHomeStats({ duration_s: 222.9, clips: [{}, {}] }, 4, 6_800_000_000), {
        duration: '3:42', clips: '2', assets: '4', bytes: '6.8 GB', lastExport: undefined
    });
    assert.deepEqual(buildHomeStats(null), { duration: undefined, clips: undefined, assets: undefined, bytes: undefined, lastExport: undefined });
    assert.deepEqual(buildHomeStats({ output: { fps: 30 }, tracks: [{ items: [{ at: 0, duration: 90 }, { at: 90, duration: 30 }] }], sources: [{}] }), { duration: '0:04', clips: '2', assets: '1', bytes: undefined, lastExport: undefined });
    assert.equal(formatDuration(-1), undefined);
    assert.equal(formatBytes(Number.NaN), undefined);
});

test('window title uses project and channel, with standalone fallback', () => {
    assert.equal(homeWindowTitle('春の新作レビュー', 'ガジェット実況'), '春の新作レビュー — ガジェット実況');
    assert.equal(homeWindowTitle('春の新作レビュー'), '春の新作レビュー — 単体');
});

test('update notice follows ready, downloading, found priority and stores later by version', () => {
    assert.equal(noticeStage(true, false, false), 'found');
    assert.equal(noticeStage(true, true, false), 'downloading');
    assert.equal(noticeStage(true, true, true), 'ready');
    assert.equal(noticeStage(false, false, false), undefined);
    assert.notEqual(noticeStorageKey('1.0.0'), noticeStorageKey('1.0.1'));
    assert.equal(shouldAutoShowNotice({ stage: 'found', version: '1.0.0' }, undefined, false), true);
    assert.equal(shouldAutoShowNotice({ stage: 'ready', version: '1.0.0' }, { stage: 'found', version: '1.0.0' }, true), false);
    assert.equal(shouldAutoShowNotice({ stage: 'found', version: '1.0.0' }, undefined, false, true), false, '× 後も履歴を残して自動表示だけ止める');
    assert.equal(shouldAutoShowNotice({ stage: 'found', version: '1.0.0' }, { stage: 'found', version: '1.0.0' }, false), false);
});

test('channel name rejects empty, traversal, separators, and existing names', () => {
    assert.ok(validateChannelName('  ', []).error);
    assert.ok(validateChannelName('a/b', []).error);
    assert.ok(validateChannelName('a\\b', []).error);
    assert.ok(validateChannelName('a..b', []).error);
    assert.ok(validateChannelName('料理', ['料理']).error);
    assert.ok(validateChannelName('gadget', ['Gadget']).error);
    assert.deepEqual(validateChannelName('  週末の料理  ', ['ガジェット']), { name: '週末の料理' });
});
