import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineEdgeAutoScroll } from '../lib/browser/timeline/timeline-edge-auto-scroll.js';

test('a held pointer advances repeatedly and the dragged item follows it', () => {
    const request = globalThis.requestAnimationFrame;
    const cancel = globalThis.cancelAnimationFrame;
    const frames = new Map();
    let nextId = 0;
    globalThis.requestAnimationFrame = callback => { const id = ++nextId; frames.set(id, callback); return id; };
    globalThis.cancelAnimationFrame = id => { frames.delete(id); };
    try {
        let start = 0;
        const followed = [];
        const scroller = new TimelineEdgeAutoScroll(
            () => ({ left: 0, right: 1000, duration: 100 }),
            delta => { start += delta; return true; },
            (x, y) => followed.push([x, y, start])
        );
        scroller.update(1000, 20);
        for (let i = 0; i < 3; i++) {
            const [id, callback] = frames.entries().next().value;
            frames.delete(id);
            callback();
        }
        assert.ok(Math.abs(start - 3.6) < 1e-9);
        assert.equal(followed.length, 3);
        assert.deepEqual(followed[2].slice(0, 2), [1000, 20]);
        scroller.stop();
        assert.equal(frames.size, 0);
    } finally {
        globalThis.requestAnimationFrame = request;
        globalThis.cancelAnimationFrame = cancel;
    }
});
