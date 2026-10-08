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

test('外の行は札・利用条件・サムネを示し、本体が無い行は渡せない', () => {
    const tab = new HandoffVibeDockTab();
    const notices = [];
    Object.assign(tab, { commands: { executeCommand: async () => [] }, tabs: { refreshBadges() {} }, items: [
        { uri: 'file:///tmp/image.png', path: '/tmp/image.png', name: '画像（example.com）', origin: 'scratch',
            badge: '外', fresh: true, status: 'ready', thumb: 'data:image/jpeg;base64,AA' },
        { uri: '', path: '', name: '画像（example.org）', origin: 'scratch', badge: '外', fresh: false, status: 'url_only' }
    ] });
    const host = new Node();
    const view = tab.render(host, { status: { set: message => { notices.push(message); return { dispose() {} }; } } });
    const rows = walk(host).filter(node => node.tag === 'button');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].draggable, true);
    assert.equal(rows[1].draggable, false);
    assert.equal(walk(rows[0]).some(node => node.tag === 'img' && node.alt === ''), true);
    assert.equal(walk(rows[0]).some(node => node.textContent === '外'), true);
    assert.equal(walk(rows[0]).some(node => node.textContent === '利用条件: 不明'), true);
    assert.equal(walk(rows[1]).some(node => node.textContent === '本体なし（渡せません）・利用条件: 不明'), true);
    assert.equal(rows[1].className.includes('akari-vibe-handoff-external-unavailable'), true);
    assert.equal(rows[0].className.includes('akari-vibe-handoff-external-unavailable'), false);
    rows[1].fire('click');
    assert.deepEqual(notices, ['本体が取れていないため渡せません']);
    view.dispose();
});
