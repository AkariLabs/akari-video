import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PreviewLibraryDrop } = require('../lib/browser/preview-library-drop.js');

function harness() {
    const previousWindow = globalThis.window, previousDocument = globalThis.document;
    const listeners = new Map();
    const makeElement = () => ({ dataset: {}, style: {}, children: [], listeners: new Map(),
        addEventListener(type, listener) { this.listeners.set(type, listener); },
        appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); },
        replaceChildren() { this.children = []; }, remove() { this.removed = true; },
        contains() { return false; },
        getBoundingClientRect() { return { x: 0, y: 0, width: 1000, height: 600 }; } });
    const body = makeElement();
    const document = { body, createElement: makeElement, createTextNode: textContent => ({ textContent }),
        addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener(type) { listeners.delete(type); } };
    globalThis.window = { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
    globalThis.document = document;
    const node = makeElement(); node.ownerDocument = document;
    const calls = [];
    const widget = { node, isAttached: true, onDidDispose() {}, sendMessage() {} };
    const drop = new PreviewLibraryDrop(widget, { executeCommand: async (...args) => { calls.push(args); } }, {},
        () => 'edit.json', () => ({ width: 1000, height: 600 }), () => false);
    const geometry = { rect: { x: 0, y: 0, width: 1000, height: 600 }, time: 12, fps: 30,
        canvases: [{ id: 'g', name: 'キャンバス 1', at: 300, duration: 150, trackIndex: 0, itemIndex: 0 }],
        output: { width: 1000, height: 600 } };
    drop.geometry = geometry;
    drop.queryGeometry = async () => geometry;
    return { drop, calls, body, listeners, restore() {
        drop.dispose(); globalThis.window = previousWindow; globalThis.document = previousDocument;
    } };
}

function dropEvent(payload, altKey = false) {
    return { clientX: 300, clientY: 180, altKey,
        dataTransfer: { getData: () => JSON.stringify(payload) }, preventDefault() {}, stopPropagation() {} };
}

test('文字へのヒットは適用し、空所はキャンバス内に文字を置く', async () => {
    const h = harness();
    try {
        const payload = { kind: 'textstyle', id: 'news' };
        h.drop.active = payload;
        h.drop.queryHit = async () => ({ kind: 'caption', id: 'c1' });
        await h.drop.drop(dropEvent(payload));
        assert.deepEqual(h.calls, [['akari.timeline.applyLibraryItem',
            { payload, target: { kind: 'caption', id: 'c1' }, editUri: 'edit.json' }]]);

        h.drop.active = payload;
        h.drop.queryHit = async () => undefined;
        await h.drop.drop(dropEvent(payload));
        assert.deepEqual(h.calls.at(-1), ['akari.caption.placeText',
            { start: 12, center: { x: 0.3, y: 0.3 }, stylePreset: 'news', canvasAware: true,
                outsideCanvas: false }, 'edit.json']);
        assert.equal(h.body.children.length, 0, '配置可能な空所では選択を求めない');

        const myStyle = { kind: 'mystyle', style: { parts: [] } };
        h.drop.active = myStyle;
        await h.drop.drop(dropEvent(myStyle, true));
        assert.deepEqual(h.calls.at(-1), ['akari.caption.placeText',
            { start: 12, center: { x: 0.3, y: 0.3 }, myStyle: myStyle.style,
                outsideCanvas: true }, 'edit.json']);
    } finally { h.restore(); }
});

test('ドラッグ中は当てる表示とキャンバスに置く表示を切り替える', () => {
    const h = harness();
    try {
        h.drop.active = { kind: 'textstyle', id: 'news' };
        h.drop.show();
        h.drop.drawGhost(300, 180);
        const ghost = h.drop.ghost;
        assert.match(ghost.children.at(-1).textContent, /キャンバス 1 に入ります/);
        assert.equal(ghost.children.at(-1).dataset.akariCanvasDropHint, 'true');
        h.drop.hoverHit = { kind: 'caption', id: 'c1' };
        h.drop.drawGhost(300, 180);
        assert.equal(ghost.children.length, 1);
        assert.equal(ghost.children[0].textContent, '文字に当てます');
        h.drop.hoverHit = undefined;
        h.drop.outside = true;
        h.drop.drawGhost(300, 180);
        assert.equal(ghost.children.at(-1).dataset.akariCanvasDropHint, 'false');
    } finally { h.restore(); }
});

test('置く用途がない素材を空所へ落とすと対象を案内する', async () => {
    const h = harness();
    try {
        const payload = { kind: 'lut', id: 'warm' };
        h.drop.active = payload;
        h.drop.queryHit = async () => undefined;
        await h.drop.drop(dropEvent(payload));
        assert.equal(h.calls.length, 0);
        const prompt = h.body.children.at(-1);
        assert.equal(prompt.dataset.akariPreviewApplyMiss, 'lut');
        assert.equal(prompt.children[0].textContent, '写真や映像の上に落としてください。');
        h.listeners.get('pointerdown')({ target: h.body });
        assert.equal(prompt.removed, true);
    } finally { h.restore(); }
});
