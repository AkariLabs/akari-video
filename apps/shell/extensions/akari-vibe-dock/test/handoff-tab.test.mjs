import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
class Node {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
    fire(name, event) { for (const listener of this.listeners[name] ?? []) listener(event); }
}
const walk = node => [node, ...node.children.flatMap(walk)];
globalThis.document = { createElement: tag => new Node(tag) };
const windowListeners = new Map();
globalThis.window = { localStorage: { getItem: () => '1' },
    addEventListener: (name, listener) => { (windowListeners.get(name) ?? windowListeners.set(name, []).get(name)).push(listener); } };
globalThis.Element = class { closest() { return null; } };
const { HandoffVibeDockTab } = require('../lib/browser/handoff-tab.js');

test('渡す行はパスと URI を同時にドラッグし、新着だけを札に数える', async () => {
    const tab = new HandoffVibeDockTab();
    Object.assign(tab, { commands: { executeCommand: async () => [{
        uri: 'file:///tmp/a.mp4', path: '/tmp/a.mp4', name: 'a.mp4',
        origin: 'output', badge: '書き出し', fresh: true
    }] }, tabs: { refreshBadges() {} } });
    await tab.load();
    assert.equal(tab.badge().count, 1);
    const host = new Node();
    const view = tab.render(host, { status: { set() {} } });
    const row = walk(host).find(node => node.attributes['data-handoff-path']);
    const values = new Map();
    let stopped = false;
    row.fire('dragstart', { dataTransfer: { setData: (kind, value) => values.set(kind, value) },
        stopPropagation: () => { stopped = true; } });
    assert.equal(values.get('text/uri-list'), 'file:///tmp/a.mp4');
    assert.equal(values.get('text/plain'), '/tmp/a.mp4');
    assert.equal(values.get('application/vnd.code.uri-list'), 'file:///tmp/a.mp4');
    assert.equal(values.get('application/x-akari-handoff'), '/tmp/a.mp4');
    assert.equal(values.has('application/x-akari-material'), false);
    assert.equal(stopped, true);
    view.dispose();
});

test('渡す行のアプリ内ドロップは window 捕捉で取り込み先へ通さない', () => {
    const tab = new HandoffVibeDockTab();
    Object.assign(tab, { commands: { executeCommand: async () => [] }, tabs: { refreshBadges() {} } });
    tab.onStart();
    let prevented = false;
    let stopped = false;
    const event = { dataTransfer: { types: ['text/uri-list', 'application/x-akari-handoff'] },
        target: new Element(), preventDefault: () => { prevented = true; },
        stopImmediatePropagation: () => { stopped = true; } };
    for (const listener of windowListeners.get('drop') ?? []) listener(event);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
});
