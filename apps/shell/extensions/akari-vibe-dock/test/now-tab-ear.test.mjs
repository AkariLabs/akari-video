import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NowVibeDockTab } = require('../lib/browser/vibe-dock-tabs.js');
const { VibeDockState } = require('../lib/common/vibe-dock-state.js');

class Node {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = {}; this.className = ''; this.textContent = ''; this.disabled = false; }
    append(...values) { this.children.push(...values); }
    replaceChildren(...values) { this.children = [...values]; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    click() { if (!this.disabled) this.listeners.click?.(); }
    setAttribute() {}
}
const all = root => [root, ...root.children.flatMap(all)];

test('途中経過から札へ、対象消費・注釈保存・タスク化を行い 200 件に収める', async () => {
    const previous = globalThis.document;
    const head = new Node('head');
    globalThis.document = { head, createElement: tag => new Node(tag), createTextNode: text => Object.assign(new Node('#text'), { textContent: text }),
        getElementById: id => all(head).find(node => node.id === id) };
    const state = new VibeDockState({ getItem: () => null, setItem() {} });
    const saved = [];
    const tasks = [];
    const tab = new NowVibeDockTab();
    Object.assign(tab, {
        state, commands: { executeCommand: async (id, input) => { tasks.push([id, input]); return { id: 'task-1' }; } },
        messages: { error() {} }, dictionary: { revert: async () => {} },
        review: { location: { root: { toString: () => 'file:///project' }, reviewUri: { toString: () => 'file:///project/review.json' } } },
        annotations: { createAnnotation: async input => { saved.push(input); return { committed: true }; } }
    });
    const host = new Node();
    try {
        const rendered = tab.render(host, {});
        tab.acceptUtterance({ raw: '途中', text: '途中', applied: [], final: false }, 1);
        assert.equal(all(host).some(node => node.className.includes('akari-vibe-live')), true);
        state.setPointed({ target: 'timeline:cut:1', label: 'カット', at: 1, source: 'dom' });
        tab.acceptUtterance({ raw: 'メモ', text: 'メモ', applied: [], final: true }, 12);
        await new Promise(setImmediate);
        assert.equal(all(host).some(node => node.className.includes('akari-vibe-live')), false);
        assert.equal(state.pointedTarget, undefined);
        assert.equal(saved[0].target, 'ui:timeline:cut:1');
        assert.equal(saved[0].sourceT, 12);
        assert.equal(saved[0].intent, 'voice');
        tab.acceptUtterance({ raw: '次の途中', text: '次の途中', applied: [], final: false }, 13);
        tab.clearPartial();
        assert.equal(all(host).some(node => node.className.includes('akari-vibe-live')), false);
        assert.equal(tab.entries.length, 1);
        const task = all(host).find(node => node.textContent === 'タスクにする');
        task.click(); task.click();
        await new Promise(setImmediate);
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0][1].via, 'voice');
        assert.equal(all(host).some(node => node.textContent === 'タスクにした'), true);
        for (let i = 0; i < 201; i++) tab.acceptUtterance({ raw: String(i), text: String(i), applied: [], final: true }, 0);
        assert.equal(tab.entries.length, 200);
        rendered.dispose();
    } finally { globalThis.document = previous; }
});

test('プロジェクトが無いときは札に理由を出し、保存しない', () => {
    const previous = globalThis.document;
    const head = new Node('head');
    globalThis.document = { head, createElement: tag => new Node(tag), createTextNode: text => Object.assign(new Node('#text'), { textContent: text }),
        getElementById: id => all(head).find(node => node.id === id) };
    const tab = new NowVibeDockTab();
    const state = new VibeDockState({ getItem: () => null, setItem() {} });
    let writes = 0;
    Object.assign(tab, { state, review: { location: undefined }, annotations: { createAnnotation: () => { writes++; } },
        dictionary: {}, commands: {}, messages: {} });
    const host = new Node();
    try {
        tab.render(host, {});
        tab.acceptUtterance({ raw: 'メモ', text: 'メモ', applied: [], final: true }, 0);
        assert.equal(writes, 0);
        assert.equal(all(host).some(node => node.textContent === 'プロジェクトを開くと残せます'), true);
    } finally { globalThis.document = previous; }
});

test('辞書で直した語を示し、元に戻すと本文と辞書の記録を更新する', async () => {
    const previous = globalThis.document;
    const head = new Node('head');
    globalThis.document = { head, createElement: tag => new Node(tag), createTextNode: text => Object.assign(new Node('#text'), { textContent: text }),
        getElementById: id => all(head).find(node => node.id === id) };
    const reverted = [];
    const tab = new NowVibeDockTab();
    Object.assign(tab, { state: new VibeDockState({ getItem: () => null, setItem() {} }),
        review: { location: undefined }, dictionary: { revert: async id => reverted.push(id) }, commands: {}, messages: {} });
    try {
        const host = new Node();
        tab.render(host, {});
        tab.acceptUtterance({ raw: '入れて', text: '追加して', final: true,
            applied: [{ id: 'word-1', from: '入れて', to: '追加して', layer: 'user', range: [0, 4] }] }, 0);
        const word = all(host).find(node => node.className === 'akari-corrected-word');
        assert.ok(word);
        all(word).find(node => node.textContent === '元に戻す').onclick();
        await new Promise(setImmediate);
        assert.equal(tab.entries[0].utterance.text, '入れて');
        assert.deepEqual(reverted, ['word-1']);
    } finally { globalThis.document = previous; }
});
