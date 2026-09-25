import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PreviewLibraryDrop } = require('../lib/browser/preview-library-drop.js');

test('空所でも drop を受け、一言とボタンから落とした点に文字を置く', async () => {
    const beforeWindow = globalThis.window, beforeDocument = globalThis.document;
    const listeners = new Map();
    const makeElement = () => ({ dataset: {}, style: {}, children: [], listeners: new Map(),
        addEventListener(type, listener) { this.listeners.set(type, listener); },
        appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); },
        remove() { this.removed = true; }, contains() { return false; },
        getBoundingClientRect() { return { x: 0, y: 0, width: 1000, height: 600 }; } });
    const body = makeElement();
    const document = { body, createElement: makeElement, createTextNode: textContent => ({ textContent }),
        addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener(type) { listeners.delete(type); } };
    const window = { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
    globalThis.window = window; globalThis.document = document;
    try {
        const node = makeElement(); node.ownerDocument = document;
        const calls = [];
        const widget = { node, isAttached: true, onDidDispose() {}, sendMessage() {} };
        const drop = new PreviewLibraryDrop(widget, { executeCommand: async (...args) => { calls.push(args); } }, {},
            () => 'edit.json', () => ({ width: 1000, height: 600 }), () => false);
        drop.active = { kind: 'textstyle', id: 'news' };
        drop.geometry = { rect: { x: 0, y: 0, width: 1000, height: 600 }, time: 2,
            output: { width: 1000, height: 600 } };
        drop.queryGeometry = async () => drop.geometry;
        drop.queryHit = async () => undefined;
        drop.show();
        const transfer = { dropEffect: 'none', getData: () => JSON.stringify(drop.active) };
        const event = { clientX: 300, clientY: 180, dataTransfer: transfer,
            preventDefault() {}, stopPropagation() {} };
        drop.over(event);
        assert.equal(transfer.dropEffect, 'copy', '空所でも drop イベントを受ける');
        assert.equal(drop.layer.style.cursor, 'not-allowed');
        await drop.drop(event);
        const prompt = body.children.at(-1);
        assert.equal(prompt.dataset.akariPreviewApplyMiss, 'textstyle');
        const button = prompt.children.find(child => child.dataset?.akariPreviewApplyAddText);
        assert.equal(button.textContent, 'このスタイルで文字を追加');
        button.listeners.get('click')();
        assert.equal(prompt.removed, true);
        assert.deepEqual(calls, [['akari.caption.placeText',
            { start: 2, center: { x: 0.3, y: 0.3 }, stylePreset: 'news' }, 'edit.json']]);
        assert.equal(listeners.has('pointerdown'), false);
        drop.showApplyMiss({ kind: 'mystyle', style: { parts: [] } }, drop.geometry ?? { time: 2,
            output: { width: 1000, height: 600 } }, { x: 300, y: 180 }, { x: 300, y: 180 }, 'edit.json');
        const another = body.children.at(-1);
        listeners.get('pointerdown')({ target: makeElement() });
        assert.equal(another.removed, true, '外を押すと閉じる');
        drop.dispose();
    } finally { globalThis.window = beforeWindow; globalThis.document = beforeDocument; }
});
