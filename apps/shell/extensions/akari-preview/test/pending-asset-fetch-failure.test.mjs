import assert from 'node:assert/strict';
import test from 'node:test';
import { PendingAssetFetchStore, summarizeFetchFailure } from '../lib/common/pending-asset-fetch.js';

test('failure reasons are latest per key, consumed once, and expire', () => {
    const store = new PendingAssetFetchStore();
    const original = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
        store.noteFailureReason('a', 'first');
        store.noteFailureReason('a', 'latest');
        store.noteFailureReason('b', 'other');
        assert.equal(store.takeFailureReason('a'), 'latest');
        assert.equal(store.takeFailureReason('a'), undefined);
        now += 60_001;
        assert.equal(store.takeFailureReason('b'), 'other');
        store.noteFailureReason('c', 'stale');
        now += 600_001;
        assert.equal(store.takeFailureReason('c'), undefined);
    } finally {
        Date.now = original;
    }
});

test('summary joins first reason line and limits length', () => {
    assert.equal(summarizeFetchFailure('\n Failed \n- source invalid\n- next'), 'Failed: source invalid');
    assert.equal(summarizeFetchFailure('x'.repeat(150)).length, 120);
    assert.equal(summarizeFetchFailure('\n\n'), '');
});
