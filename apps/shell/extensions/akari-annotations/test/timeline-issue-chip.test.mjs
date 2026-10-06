import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineIssueCopyText, timelineIssueHeading, timelineIssueLabel, timelineIssueRows }
    from '../lib/common/timeline-issue-chip.js';
import { TimelineIssueChip, TIMELINE_ISSUE_ID } from '../lib/browser/timeline/timeline-issue-chip.js';

const finding = index => ({ severity: 'error', check: 'references.files',
    message: `素材 ${index} が見つかりません`, path: `sources[${index}].path` });

test('issue label and heading carry the current count', () => {
    assert.equal(timelineIssueLabel(1), '⚠ 課題 1');
    assert.equal(timelineIssueHeading(3), '保存前からある課題 3 件（この編集で増えたものではありません）');
    assert.equal(timelineIssueHeading(1, '9.9.9'),
        'このプロジェクトは新しい版（v9.9.9）で保存されています。'
        + 'いまの版の検証は新しい機能を知らないため、誤ってエラーを出すことがあります。 '
        + '保存前からある課題 1 件（この編集で増えたものではありません）');
});

test('popup rows stop at ten and copy text retains all findings', () => {
    const findings = Array.from({ length: 12 }, (_, index) => finding(index));
    const { rows, remaining } = timelineIssueRows(findings);
    assert.equal(rows.length, 10);
    assert.equal(remaining, 2);
    assert.equal(rows[0], 'error · references.files · 素材 0 が見つかりません · sources[0].path');
    assert.equal(timelineIssueCopyText(findings).split('\n').length, 12);
    assert.match(timelineIssueCopyText(findings), /sources\[11\]\.path/);
});

test('persistent issue uses a separate status entry without a timeout', () => {
    const previousSet = globalThis.setTimeout;
    globalThis.setTimeout = () => { throw new Error('persistent issue must not start a timer'); };
    const calls = [];
    const chip = new TimelineIssueChip({
        setElement: async (id, entry) => { calls.push([id, entry]); },
        removeElement: async id => { calls.push([id, null]); }
    }, { removeEventListener() {} }, () => {});
    try {
        chip.setFindings([finding(0)]);
        assert.equal(calls[0][0], TIMELINE_ISSUE_ID);
        assert.equal(calls[0][1].text, '⚠ 課題 1');
        assert.equal(calls[0][1].alignment, 0);
        chip.setFindings([]);
        assert.deepEqual(calls[1], [TIMELINE_ISSUE_ID, null]);
    } finally {
        chip.dispose();
        globalThis.setTimeout = previousSet;
    }
});

test('window blur closes the popup and removes its listener', () => {
    const listeners = new Map();
    let removed = false;
    const element = () => ({
        dataset: {}, style: {}, offsetWidth: 200,
        setAttribute() {}, appendChild() {}, append() {},
        remove() { removed = true; }
    });
    const doc = {
        createElement: element,
        body: { append() {} },
        addEventListener() {}, removeEventListener() {},
        defaultView: {
            innerWidth: 800, innerHeight: 600,
            addEventListener: (name, listener) => listeners.set(name, listener),
            removeEventListener: name => listeners.delete(name)
        }
    };
    const chip = new TimelineIssueChip({
        setElement: async () => {}, removeElement: async () => {}
    }, doc, () => {});
    chip.setFindings([finding(0)]);
    chip.toggle({ getBoundingClientRect: () => ({ left: 100, top: 580 }) });
    assert.equal(typeof listeners.get('blur'), 'function');
    listeners.get('blur')();
    assert.equal(removed, true);
    assert.equal(listeners.has('blur'), false);
    chip.dispose();
});

test('a full-window backdrop closes with the popup on pointerdown', () => {
    const appended = [];
    const element = () => ({
        dataset: {}, style: {}, offsetWidth: 200, removed: false,
        setAttribute() {}, appendChild() {}, append() {},
        remove() { this.removed = true; }
    });
    const doc = {
        createElement: element,
        body: { append: (...nodes) => appended.push(...nodes) },
        addEventListener() {}, removeEventListener() {},
        defaultView: {
            innerWidth: 800, innerHeight: 600,
            addEventListener() {}, removeEventListener() {}
        }
    };
    const chip = new TimelineIssueChip({
        setElement: async () => {}, removeElement: async () => {}
    }, doc, () => {});
    chip.setFindings([finding(0)]);
    chip.toggle({ getBoundingClientRect: () => ({ left: 100, top: 580 }) });
    assert.deepEqual(appended.map(node => node.dataset.testid),
        ['akari-timeline-issue-backdrop', 'akari-timeline-issue-popup']);
    appended[0].onpointerdown();
    assert.equal(appended[0].removed, true);
    assert.equal(appended[1].removed, true);
    assert.equal(chip.backdrop, undefined);
    assert.equal(chip.popup, undefined);
    chip.dispose();
});
