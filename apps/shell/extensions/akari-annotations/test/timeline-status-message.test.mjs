import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineStatusMessage, TIMELINE_MESSAGE_ID, isTimelineWarning,
    installTimelineFooterSink } from '../lib/browser/timeline/timeline-status-message.js';

test('one status entry reports ordinary and warning messages, then clears', () => {
    const calls = [];
    const status = new TimelineStatusMessage({
        setElement: async (id, entry) => { calls.push({ id, entry }); },
        removeElement: async id => { calls.push({ removed: id }); }
    });
    status.show('プレビューをシークしました。');
    assert.equal(calls[0].id, TIMELINE_MESSAGE_ID);
    assert.equal(calls[0].entry.alignment, 1);
    assert.equal(calls[0].entry.priority, -1000);
    assert.equal(calls[0].entry.className, undefined);
    status.show('保存できません');
    assert.equal(calls[1].entry.className, 'akari-timeline-message-warning');
    status.show('');
    assert.deepEqual(calls[2], { removed: TIMELINE_MESSAGE_ID });
    status.dispose();
    assert.equal(isTimelineWarning('注意してください'), true);
});

test('detached footer writes pass through the single status sink', () => {
    const previousNode = globalThis.Node;
    const previousObserver = globalThis.MutationObserver;
    class FakeNode {
        value = '';
        get textContent() { return this.value; }
        set textContent(value) { this.value = value; }
        querySelector() { return null; }
    }
    globalThis.Node = FakeNode;
    globalThis.MutationObserver = class {
        observe() {}
        disconnect() {}
    };
    try {
        const footer = new FakeNode();
        const seen = [];
        const dispose = installTimelineFooterSink(footer, { show: text => seen.push(text) });
        footer.textContent = '操作しました。';
        assert.deepEqual(seen, ['操作しました。']);
        assert.equal(footer.textContent, '操作しました。');
        dispose();
    } finally {
        globalThis.Node = previousNode;
        globalThis.MutationObserver = previousObserver;
    }
});

test('ordinary messages last four seconds and warnings last eight', () => {
    const originalSet = globalThis.setTimeout;
    const originalClear = globalThis.clearTimeout;
    const delays = [];
    globalThis.setTimeout = (_callback, delay) => { delays.push(delay); return delays.length; };
    globalThis.clearTimeout = () => {};
    try {
        const status = new TimelineStatusMessage({
            setElement: async () => {}, removeElement: async () => {}
        });
        status.show('操作しました。');
        status.show('保存できません');
        assert.deepEqual(delays, [4000, 8000]);
        status.dispose();
    } finally {
        globalThis.setTimeout = originalSet;
        globalThis.clearTimeout = originalClear;
    }
});
