import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
class Node {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.value = ''; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
    fire(name, event = {}) { for (const listener of this.listeners[name] ?? []) listener(event); }
    click() { this.fire('click'); }
}
globalThis.document = { createElement: tag => new Node(tag) };
const walk = node => [node, ...node.children.flatMap(walk)];
const { NowVibeDockTab } = require('../lib/browser/vibe-dock-tabs.js');
const { VibeDockState } = require('../lib/common/vibe-dock-state.js');

test('Enter はタスク、隣のボタンはすぐ頼む。空と IME 中は無反応', () => {
    const state = new VibeDockState({ getItem: () => null, setItem() {} });
    const events = [];
    state.onDidSubmitInstruction(value => events.push(value));
    const tab = new NowVibeDockTab();
    Object.assign(tab, { state });
    const host = new Node();
    const view = tab.render(host, {});
    const input = walk(host).find(child => child.tag === 'input');
    const button = walk(host).find(child => child.tag === 'button' && child.textContent === 'すぐ');
    input.fire('keydown', { key: 'Enter', isComposing: false });
    button.click();
    input.value = '最初のタスク';
    input.fire('keydown', { key: 'Enter', isComposing: true });
    assert.equal(events.length, 0);
    input.fire('keydown', { key: 'Enter', isComposing: false });
    assert.deepEqual(events, [{ text: '最初のタスク', mode: 'task' }]);
    assert.equal(input.value, '');
    assert.ok(walk(host).some(node => node.className === 'akari-vibe-utt' && node.children.some(child => child.textContent === '最初のタスク')));
    input.value = 'すぐ頼むタスク';
    button.click();
    assert.deepEqual(events[1], { text: 'すぐ頼むタスク', mode: 'send' });
    assert.equal(input.value, '');
    view.dispose();
});
