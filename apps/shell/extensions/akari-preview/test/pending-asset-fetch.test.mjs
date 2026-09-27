import test from 'node:test';
import assert from 'node:assert/strict';
import { PendingAssetFetchStore, pendingAssetFetchKey } from '../lib/common/pending-asset-fetch.js';

test('begin / end で控えが増えて減る', () => {
    const store = new PendingAssetFetchStore();
    assert.equal(store.size, 0);
    store.begin({ relativePath: 'assets/still/bg-1/bg.png', kind: 'image', thumb: 'https://example/p.png' });
    assert.equal(store.size, 1);
    assert.equal(store.has('assets/still/bg-1/bg.png'), true);
    assert.equal(store.get('assets/still/bg-1/bg.png').thumb, 'https://example/p.png');
    store.end('assets/still/bg-1/bg.png');
    assert.equal(store.size, 0);
    assert.equal(store.has('assets/still/bg-1/bg.png'), false);
});

test('区切りの揺れを正規化して照合する', () => {
    const store = new PendingAssetFetchStore();
    store.begin({ relativePath: 'assets\\still\\bg-1\\bg.png', kind: 'image' });
    assert.equal(store.has('assets/still/bg-1/bg.png'), true);
    assert.equal(pendingAssetFetchKey('a\\b'), 'a/b');
});

test('startedAt は渡されなければ現在時刻で入る', () => {
    const store = new PendingAssetFetchStore();
    store.begin({ relativePath: 'assets/broll/clip-1/clip.mp4', kind: 'video', startedAt: 42 });
    assert.equal(store.get('assets/broll/clip-1/clip.mp4').startedAt, 42);
    store.begin({ relativePath: 'assets/audio/se-1/se.wav', kind: 'audio' });
    assert.ok(store.get('assets/audio/se-1/se.wav').startedAt > 0);
});

test('空の参照は控えない', () => {
    const store = new PendingAssetFetchStore();
    store.begin({ relativePath: '', kind: 'image' });
    assert.equal(store.size, 0);
});

test('変化のたびに聞き手へ 1 回だけ届く。無かったものの end は黙る', () => {
    const store = new PendingAssetFetchStore();
    const seen = [];
    const subscription = store.onChanged(path => seen.push(path));
    store.begin({ relativePath: 'assets/still/bg-2/bg.png', kind: 'image' });
    store.end('assets/still/bg-2/bg.png');
    store.end('assets/still/bg-2/bg.png');
    assert.deepEqual(seen, ['assets/still/bg-2/bg.png', 'assets/still/bg-2/bg.png']);
    subscription.dispose();
    store.begin({ relativePath: 'assets/still/bg-3/bg.png', kind: 'image' });
    assert.equal(seen.length, 2);
});

test('聞き手が投げても他の聞き手は止まらない', () => {
    const store = new PendingAssetFetchStore();
    const seen = [];
    store.onChanged(() => { throw new Error('壊れた聞き手'); });
    store.onChanged(path => seen.push(path));
    store.begin({ relativePath: 'assets/still/bg-4/bg.png', kind: 'image' });
    assert.deepEqual(seen, ['assets/still/bg-4/bg.png']);
});
