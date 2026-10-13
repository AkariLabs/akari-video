import assert from 'node:assert/strict';
import test from 'node:test';

import { RecentCaptionEchoVerifier } from '../lib/common/recent-caption-echo.js';

test('recent watcher 通知をまとめ、窓の終わりに最新の内容を一回確認する', () => {
    const scheduled = new Map();
    let nextId = 0;
    let reads = 0;
    const verifier = new RecentCaptionEchoVerifier(() => { reads++; },
        (callback, delay) => { const id = ++nextId; scheduled.set(id, { callback, delay }); return id; },
        id => { scheduled.delete(id); });
    verifier.request(1000, 1200);
    verifier.request(1300, 1400);
    verifier.request(1600, 1700);
    assert.equal(reads, 0);
    assert.equal(scheduled.size, 1);
    const [{ callback, delay }] = [...scheduled.values()];
    assert.equal(delay, 920);
    callback();
    assert.equal(reads, 1);
    verifier.dispose();
});
