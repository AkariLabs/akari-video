import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PreviewLibraryDrop } = require('../lib/browser/preview-library-drop.js');

function element(ownerDocument) {
    const listeners = new Map();
    return {
        ownerDocument, dataset: {}, style: {}, children: [], listeners,
        addEventListener(type, listener) { listeners.set(type, listener); },
        appendChild(child) { this.children.push(child); return child; },
        append(...children) { this.children.push(...children); },
        replaceChildren() { this.children = []; },
        remove() { this.removed = true; },
        getBoundingClientRect() { return { x: 283, y: 39, width: 780, height: 358.5 }; }
    };
}

test('ジオメトリが未取得でも層を即表示し、応答後に仮枠を描いて dispose で外す', async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const windowListeners = new Map();
    const document = {
        createElement() { return element(document); },
        createTextNode(text) { return { textContent: text }; }
    };
    const window = {
        addEventListener(type, listener) { windowListeners.set(type, listener); },
        removeEventListener(type) { windowListeners.delete(type); },
        setTimeout, clearTimeout
    };
    globalThis.window = window;
    globalThis.document = document;
    let dispose;
    try {
        const node = element(document);
        const iframe = {
            offsetWidth: 780, offsetHeight: 359, clientLeft: 0, clientTop: 0,
            getBoundingClientRect: () => ({ x: 283, y: 39, width: 780, height: 358.5 })
        };
        node.querySelector = () => iframe;
        const messages = [];
        const commandCalls = [];
        let previewTime = 12;
        const receivers = new Set();
        const widget = {
            node, isAttached: true,
            onDidDispose(listener) { dispose = listener; },
            onMessage(listener) { receivers.add(listener); return { dispose: () => receivers.delete(listener) }; },
            sendMessage(message) { messages.push(message); }
        };
        const commands = { async executeCommand(...args) {
            commandCalls.push(args);
            if (args[0] === 'akari.timeline.addMaterialAtOutputPoint') previewTime = 0;
            if (args[0] === 'akari.preview.seekOutput') previewTime = args[1].time;
            if (args[0] === 'akari.timeline.addShapeAt') return 'shape-1';
            return args[0] === 'akari.catalog.resolveMaterial'
                ? { relativePath: 'assets/still/photo.png', kind: 'image' } : undefined;
        } };
        const drop = new PreviewLibraryDrop(widget, commands, {},
            () => 'edit.json', () => ({ width: 1280, height: 720 }), () => false);
        windowListeners.get('akari.library.dragStart')({ detail: {
            kind: 'asset', key: 'still/photo', category: 'still', title: '写真', width: 4000, height: 3000
        } });
        assert.equal(node.children.length, 1, '通信を待たずに層が付く');
        const layer = node.children[0];
        assert.ok(Number(layer.style.zIndex) > 999, 'Theia の透明オーバーレイより前面');
        const ghost = layer.children[0];
        assert.equal(ghost.style.display, 'none');
        let prevented = false;
        const over = { clientX: 670, clientY: 190, dataTransfer: {},
            preventDefault() { prevented = true; }, stopPropagation() {} };
        layer.listeners.get('dragover')(over);
        assert.equal(prevented, true);
        assert.equal(over.dataTransfer.dropEffect, 'copy');
        assert.equal(messages.length, 1);
        drop.lastGeometryRequestAt = Date.now() - 300;
        layer.listeners.get('dragover')(over);
        assert.equal(messages.length, 2, '未取得なら次の dragover で再問い合わせする');
        for (const receive of [...receivers]) receive({
            type: 'akari-preview-library-drop-geometry', requestId: messages.at(-1).requestId,
            rect: { x: 150.9, y: 16, width: 478.2, height: 269 },
            viewport: { width: 780, height: 359 }, time: 12, fps: 30,
            canvasDropTargets: [{ id: 'g', name: '導入', at: 300, duration: 150, trackIndex: 0, itemIndex: 0 }]
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(ghost.style.display, 'block');
        assert.match(ghost.children.at(-1).textContent, /0:12\.0 → 0:15\.0/);
        assert.equal(ghost.children.at(-1).dataset.akariCanvasDropHint, 'true');
        assert.match(ghost.children.at(-1).textContent, /導入 に入ります/);
        layer.listeners.get('dragover')({ ...over, altKey: true });
        assert.equal(ghost.children.at(-1).dataset.akariCanvasDropHint, 'false');
        window.setTimeout = (callback, delay) => setTimeout(callback, delay === 2500 ? 0 : delay);
        layer.listeners.get('drop')({ clientX: 670, clientY: 190, altKey: true,
            dataTransfer: { getData: () => JSON.stringify({ kind: 'asset', key: 'still/photo', category: 'still' }) },
            preventDefault() {}, stopPropagation() {} });
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(commandCalls.at(-2)[0], 'akari.timeline.addMaterialAtOutputPoint',
            '再問い合わせが未回答でも直前の枠を使って置く');
        assert.equal(commandCalls.at(-2)[1].t, 12);
        assert.equal(commandCalls.at(-2)[1].outsideCanvas, true);
        assert.equal(commandCalls.at(-2)[1].canvasAware, undefined);
        assert.deepEqual(commandCalls.at(-1), ['akari.preview.seekOutput',
            { editUri: 'edit.json', time: 12, waitForReady: true }]);
        assert.equal(previewTime, 12, '追加時の再読込で 0 秒に戻っても配置時刻へ復帰する');
        windowListeners.get('akari.library.dragStart')({ detail: {
            kind: 'asset', key: 'still/photo', category: 'still', title: '写真'
        } });
        const nextLayer = node.children.at(-1);
        nextLayer.listeners.get('dragover')({ ...over, altKey: false });
        for (const receive of [...receivers]) receive({
            type: 'akari-preview-library-drop-geometry', requestId: messages.at(-1).requestId,
            rect: { x: 150.9, y: 16, width: 478.2, height: 269 },
            viewport: { width: 780, height: 359 }, time: 12, fps: 30,
            canvasDropTargets: [{ id: 'g', name: '導入', at: 300, duration: 150, trackIndex: 0, itemIndex: 0, depth: 0 }]
        });
        nextLayer.listeners.get('drop')({ clientX: 670, clientY: 190, altKey: false,
            dataTransfer: { getData: () => JSON.stringify({ kind: 'asset', key: 'still/photo', category: 'still' }) },
            preventDefault() {}, stopPropagation() {} });
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(commandCalls.at(-2)[1].canvasAware, true);
        assert.equal(commandCalls.at(-2)[1].outsideCanvas, false);
        windowListeners.get('akari.library.dragStart')({ detail: {
            kind: 'shape', preset: 'star-5', name: '星', vb: [100, 95]
        } });
        const shapeLayer = node.children.at(-1);
        shapeLayer.listeners.get('dragover')({ ...over, altKey: false });
        for (const receive of [...receivers]) receive({
            type: 'akari-preview-library-drop-geometry', requestId: messages.at(-1).requestId,
            rect: { x: 150.9, y: 16, width: 478.2, height: 269 },
            viewport: { width: 780, height: 359 }, time: 12, fps: 30,
            canvasDropTargets: [{ id: 'g', name: '導入', at: 300, duration: 150, trackIndex: 0, itemIndex: 0 }]
        });
        await new Promise(resolve => setImmediate(resolve));
        const shapeGhost = shapeLayer.children[0];
        assert.equal(shapeGhost.children[0].textContent, '星');
        assert.ok(Math.abs(Number.parseFloat(shapeGhost.style.width) - 89.66) < 0.1);
        assert.match(shapeGhost.children.at(-1).textContent, /0:12\.0 → 0:15\.0 · 導入 に入ります/);
        const frame = drop.geometry.rect;
        shapeLayer.listeners.get('drop')({ clientX: 670, clientY: 190, altKey: false,
            dataTransfer: { getData: () => JSON.stringify({ kind: 'shape', preset: 'star-5', name: '星', vb: [100, 95] }) },
            preventDefault() {}, stopPropagation() {} });
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(commandCalls.at(-2)[0], 'akari.timeline.addShapeAt');
        assert.equal(commandCalls.at(-2)[1].preset, 'star-5');
        assert.equal(commandCalls.at(-2)[1].t, 12);
        assert.ok(Math.abs(commandCalls.at(-2)[1].center.x - (670 - frame.x) * 1280 / frame.width) < 0.01);
        assert.ok(Math.abs(commandCalls.at(-2)[1].center.y - (190 - frame.y) * 720 / frame.height) < 0.01);
        assert.equal(commandCalls.at(-2)[1].canvasAware, true);
        assert.deepEqual(commandCalls.at(-1), ['akari.preview.seekOutput',
            { editUri: 'edit.json', time: 12, waitForReady: true }]);
        windowListeners.get('akari.library.dragStart')({ detail: {
            kind: 'shape', preset: 'line-dash-tri-tri', name: 'ライン', vb: [100, 20]
        } });
        const lineLayer = node.children.at(-1);
        lineLayer.listeners.get('dragover')({ ...over, altKey: true });
        for (const receive of [...receivers]) receive({
            type: 'akari-preview-library-drop-geometry', requestId: messages.at(-1).requestId,
            rect: { x: 150.9, y: 16, width: 478.2, height: 269 },
            viewport: { width: 780, height: 359 }, time: 12, fps: 30,
            canvasDropTargets: [{ id: 'g', name: '導入', at: 300, duration: 150, trackIndex: 0, itemIndex: 0 }]
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(lineLayer.children[0].children.at(-1).dataset.akariCanvasDropHint, 'false');
        lineLayer.listeners.get('drop')({ clientX: 670, clientY: 190, altKey: true,
            dataTransfer: { getData: () => JSON.stringify({ kind: 'shape', preset: 'line-dash-tri-tri', vb: [100, 20] }) },
            preventDefault() {}, stopPropagation() {} });
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(commandCalls.at(-2)[1].preset, 'line-dash-tri-tri');
        assert.equal(commandCalls.at(-2)[1].outsideCanvas, true);
        assert.equal(commandCalls.at(-2)[1].canvasAware, undefined);
        dispose();
        assert.equal(layer.removed, true);
        assert.equal(windowListeners.has('akari.library.dragStart'), false);
    } finally {
        dispose?.();
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});
