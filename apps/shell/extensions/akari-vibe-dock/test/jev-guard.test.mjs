import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JevHandGuard } = require('../lib/browser/jev-hand-guard.js');

test('同じ面への手の操作だけ 500ms 見送る', () => {
    const previous = globalThis.Element;
    class FakeElement { closest(selector) { return selector.includes('theia-left-panel') ? this : null; } }
    globalThis.Element = FakeElement;
    let now = 1000;
    const guard = new JevHandGuard(() => now);
    try {
        guard.record({ target: new FakeElement() });
        assert.equal(guard.busy('left'), true);
        assert.equal(guard.busy('main'), false);
        now = 1499;
        assert.equal(guard.busy('left'), true);
        now = 1500;
        assert.equal(guard.busy('left'), false);
    } finally { globalThis.Element = previous; }
});
