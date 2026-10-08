import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NowVibeDockTab } = require('../lib/browser/vibe-dock-tabs.js');
const { VibeDockState } = require('../lib/common/vibe-dock-state.js');
class Node {
    constructor() { this.children = []; this.style = {}; this.listeners = {}; this.textContent = ''; this.className = ''; }
    append(...values) { this.children.push(...values); }
    replaceChildren(...values) { this.children = [...values]; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    setAttribute() {}
    click() { this.listeners.click?.(); }
}
const all = node => [node, ...node.children.flatMap(all)];

test('操作の札は注釈を作らず、戻すと薄くなりやり直しで戻る', () => {
    const previous = globalThis.document;
    globalThis.document = { createElement: () => new Node() };
    const tab = new NowVibeDockTab();
    Object.assign(tab, { state: new VibeDockState({ getItem: () => null, setItem() {} }), commands: {} });
    const host = new Node();
    let undone = 0;
    try {
        tab.render(host, {});
        tab.acceptAction('やりました: 動画だけ', '操作', 'jev-1', () => { undone++; tab.markActionUndone('jev-1'); });
        assert.ok(all(host).some(node => node.textContent === '操作'));
        all(host).find(node => node.textContent === '戻す').click();
        assert.equal(undone, 1);
        assert.ok(all(host).some(node => node.style.textDecoration === 'line-through'));
        tab.markActionRedone('jev-1');
        assert.ok(all(host).some(node => node.textContent === '戻す'));
    } finally { globalThis.document = previous; }
});
