import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
class Node {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; this.disabled = false; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
    fire(name, event = {}) { for (const listener of this.listeners[name] ?? []) listener(event); }
    click() { if (!this.disabled) this.fire('click'); }
}
const walk = node => [node, ...node.children.flatMap(walk)];
globalThis.document = { createElement: tag => new Node(tag) };
globalThis.window = { confirm: () => true, addEventListener() {}, localStorage: { getItem: () => null } };
const { NextVibeDockTab, nextTargetLabel } = require('../lib/browser/next-tab.js');

const tick = () => new Promise(resolve => setImmediate(resolve));
const row = n => ({ id: `t-${String(n).padStart(4, '0')}`, source: 'annotation', state: 'unsent', body: `本文 ${n}`,
    target: 'ui:timeline:cut:1', actions: [{ id: 'send', label: '頼む' }, { id: 'dismiss', label: '無視' }] });

test('次タブは order 20・警告バッジ・上位 7 行を表示する', async () => {
    const tab = new NextVibeDockTab();
    const calls = [];
    Object.assign(tab, { commands: { executeCommand: async (id, arg) => {
        calls.push([id, arg]);
        return { rows: Array.from({ length: 8 }, (_, i) => row(i + 1)),
            summary: { unsent: 8, sent: 1, review: 1, done: 0 }, clipboardPending: 1 };
    } }, tabs: { refreshBadges() {} } });
    assert.equal(tab.order, 20);
    assert.equal(nextTargetLabel('ui:timeline:cut:1'), 'C2');
    await tab.load();
    assert.deepEqual(tab.badge(), { count: 9, tone: 'warn' });
    const host = new Node();
    const view = tab.render(host, {});
    await tick();
    assert.equal(walk(host).filter(node => node.attributes['data-task-id']).length, 7);
    assert.ok(walk(host).some(node => node.textContent === '貼り付け待ち 1 件'));
    view.dispose();
});

test('選択したタスクだけをまとめて頼む', async () => {
    const tab = new NextVibeDockTab();
    const calls = [];
    Object.assign(tab, { commands: { executeCommand: async (id, arg) => {
        calls.push([id, arg]);
        return id === 'akari.tasks.nextRows'
            ? { rows: [row(1), row(2)], summary: { unsent: 2, sent: 0, review: 0, done: 0 } }
            : { sent: arg?.ids ?? [] };
    } }, tabs: { refreshBadges() {} } });
    await tab.load();
    const host = new Node();
    const view = tab.render(host, {});
    await tick();
    const checkbox = walk(host).find(node => node.tag === 'input' && node.attributes['aria-label'] === 't-0001 を選ぶ');
    checkbox.checked = true;
    checkbox.fire('change');
    walk(host).find(node => node.tag === 'button' && node.textContent === 'まとめて頼む').click();
    await tick();
    assert.deepEqual(calls.find(call => call[0] === 'akari.tasks.send'), ['akari.tasks.send', { ids: ['t-0001'] }]);
    view.dispose();
});
