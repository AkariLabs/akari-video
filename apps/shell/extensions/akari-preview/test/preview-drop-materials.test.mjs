import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
    explorerMaterial, mediaKindFromPath, nearestOutputPoint, projectFileKey, sameProjectFile
} from '../lib/common/preview-drop-geometry.js';

const require = createRequire(import.meta.url);
const { PreviewLibraryDrop } = require('../lib/browser/preview-library-drop.js');

test('枠外の点は最寄りの出力端へ寄せ、元の座標系を変えない', () => {
    const rect = { x: 100, y: 50, width: 400, height: 225 };
    const output = { width: 1280, height: 720 };
    assert.deepEqual(nearestOutputPoint({ x: 40, y: 162.5 }, rect, output), { x: 0, y: 360 });
    assert.deepEqual(nearestOutputPoint({ x: 560, y: 310 }, rect, output), { x: 1280, y: 720 });
    assert.deepEqual(nearestOutputPoint({ x: 300, y: 100 }, rect, output), { x: 640, y: 160 });
    assert.equal(nearestOutputPoint({ x: NaN, y: 100 }, rect, output), undefined);
});

test('edit URI は NFC・dot・macOS の固定 symlink を正規化し、大文字小文字を維持する', () => {
    assert.equal(projectFileKey('file:///tmp/Cafe%CC%81/./project/../project/edit.json/'),
        'file:///private/tmp/Café/project/edit.json');
    assert.equal(sameProjectFile('file:///tmp/Cafe%CC%81/project/edit.json',
        'file:///private/tmp/Caf%C3%A9/project/edit.json'), true);
    assert.equal(sameProjectFile('file:///var/demo/project/edit.json',
        'file:///private/var/demo/project/edit.json'), true);
    assert.equal(sameProjectFile('file:///tmp/Demo/project/edit.json',
        'file:///private/tmp/demo/project/edit.json'), false);
});

test('Explorer の URI はプロジェクト内メディアだけ相対パスと種類へ直す', () => {
    const rootEdit = 'file:///tmp/Cafe%CC%81/edit.json';
    const projectEdit = 'file:///tmp/Cafe%CC%81/project/edit.json';
    assert.deepEqual(explorerMaterial('file:///private/tmp/Caf%C3%A9/assets/clip.mp4', rootEdit),
        { relativePath: 'assets/clip.mp4', kind: 'video' });
    assert.deepEqual(explorerMaterial('file:///tmp/Cafe%CC%81/project/assets/photo.PNG', projectEdit),
        { relativePath: 'assets/photo.PNG', kind: 'image' });
    assert.deepEqual(explorerMaterial('file:///tmp/Cafe%CC%81/project/assets/music.m4a', projectEdit),
        { relativePath: 'assets/music.m4a', kind: 'audio' });
    assert.equal(explorerMaterial('file:///tmp/Cafe%CC%81/assets/clip.mp4', projectEdit), 'outside');
    assert.equal(explorerMaterial('file:///tmp/other/assets/clip.mp4', rootEdit), 'outside');
    assert.equal(explorerMaterial('file:///tmp/Cafe%CC%81/project/assets/readme.txt', projectEdit), undefined);
    assert.equal(mediaKindFromPath('assets/clip.MOV'), 'video');
    assert.equal(mediaKindFromPath('assets/clip.exe'), undefined);
});

function element(document) {
    const listeners = new Map();
    return {
        ownerDocument: document, dataset: {}, style: {}, children: [], listeners,
        addEventListener(type, listener) { listeners.set(type, listener); },
        appendChild(child) { this.children.push(child); return child; },
        append(...children) { this.children.push(...children); },
        replaceChildren() { this.children = []; },
        remove() { this.removed = true; },
        getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 800, height: 500 }; }
    };
}

test('素材 MIME・イベント・Explorer tree-node を受けて配置し、枠外では寄せる', async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousRaf = globalThis.requestAnimationFrame;
    const previousImage = globalThis.Image;
    const thumbnails = [];
    const listeners = new Map();
    const document = { body: { children: [], appendChild(node) { this.children.push(node); } },
        createElement() { return element(document); }, createElementNS() { const node = element(document); node.setAttribute = () => {}; return node; },
        createTextNode(text) { return { textContent: text }; } };
    const window = { addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type) { listeners.delete(type); }, setTimeout, clearTimeout };
    globalThis.document = document;
    globalThis.window = window;
    globalThis.requestAnimationFrame = callback => { callback(); };
    globalThis.Image = class { set src(value) { this.url = value; thumbnails.push(this); } };
    const commands = [];
    const warnings = [];
    const receivers = new Set();
    const node = element(document);
    node.querySelector = () => ({ offsetWidth: 800, offsetHeight: 500, clientLeft: 0, clientTop: 0,
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 500 }) });
    const widget = { node, isAttached: true, onDidDispose() {},
        onMessage(listener) { receivers.add(listener); return { dispose: () => receivers.delete(listener) }; },
        sendMessage(message) {
            if (message.type === 'akari-preview-library-drop-geometry-request') queueMicrotask(() => {
                for (const receive of [...receivers]) receive({ type: 'akari-preview-library-drop-geometry',
                    requestId: message.requestId, rect: { x: 100, y: 50, width: 600, height: 338 },
                    viewport: { width: 800, height: 500 }, time: 6, fps: 30 });
            });
        } };
    const drop = new PreviewLibraryDrop(widget, { async executeCommand(...args) { commands.push(args); } },
        { warn(message) { warnings.push(message); } }, () => 'file:///tmp/demo/project/edit.json',
        () => ({ width: 1280, height: 720 }), () => false);
    const transfer = (mime, data) => ({ types: [mime], getData(type) { return type === mime ? data : ''; },
        setDragImage(node) { this.image = node; } });
    const event = dataTransfer => ({ clientX: 50, clientY: 250, altKey: false, dataTransfer,
        preventDefault() {}, stopPropagation() {} });
    const sample = () => document.body.children.find(child => child.dataset.akariDragSample && !child.removed);
    try {
        for (const kind of ['video', 'image', 'audio']) {
            const data = JSON.stringify({ relativePath: `assets/${kind}.${kind === 'audio' ? 'm4a' : kind === 'image' ? 'png' : 'mp4'}`,
                kind, name: kind });
            listeners.get('akari.material.dragStart')({ type: 'akari.material.dragStart', detail: data });
            assert.equal(node.children.at(-1).dataset.akariPreviewLibraryDrop, 'true');
            const drag = transfer('application/x-akari-material', data);
            listeners.get('dragstart')({ clientX: 900, clientY: 250, dataTransfer: drag });
            assert.equal(drag.image.width, 1);
            assert.equal(drag.image.height, 1);
            assert.equal(drag.image.removed, true, '透明のネイティブ画像だけ片付ける');
            assert.equal(sample().dataset.akariDragSample, 'true');
            assert.equal(sample().style.display, 'flex', 'widget 外では見本を出す');
            listeners.get('dragover')({ clientX: 50, clientY: 250 });
            assert.equal(sample().style.display, 'none', 'widget 上では仮枠だけにする');
            listeners.get('drag')({ clientX: 850, clientY: 300 });
            assert.equal(sample().style.display, 'flex');
            assert.equal(sample().style.left, '864px');
            assert.equal(sample().style.top, '314px');
            await new Promise(resolve => setImmediate(resolve));
            const layer = node.children.at(-1);
            layer.listeners.get('dragover')(event(drag));
            const ghost = layer.children[0];
            assert.equal(ghost.style.display, 'block');
            assert.match(ghost.children.at(-1).textContent, /0:06\.0 →/);
            layer.listeners.get('drop')(event(drag));
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(sample(), undefined, 'drop 後は見本を片付ける');
            const placed = commands.at(-2);
            assert.equal(placed[0], 'akari.timeline.addMaterialAtOutputPoint');
            assert.equal(placed[1].kind, kind);
            assert.equal(placed[1].t, 6);
            if (kind === 'audio') assert.equal(placed[1].transform, undefined);
            else {
                assert.equal(placed[1].transform.x, -640);
                assert.ok(Math.abs(placed[1].transform.y - (200 * 720 / 338 - 360)) < 0.01);
            }
            assert.equal(commands.at(-1)[0], 'akari.preview.seekOutput');
        }
        const withThumb = { relativePath: 'assets/four-three.png', kind: 'image', thumb: 'four-three.png' };
        listeners.get('akari.material.dragStart')({ type: 'akari.material.dragStart', detail: withThumb });
        await new Promise(resolve => setImmediate(resolve));
        const ratioLayer = node.children.at(-1);
        ratioLayer.listeners.get('dragover')(event(transfer('application/x-akari-material', JSON.stringify(withThumb))));
        const ratioGhost = ratioLayer.children[0];
        const defaultHeight = Number.parseFloat(ratioGhost.style.height);
        const thumbnail = thumbnails.at(-1);
        assert.equal(thumbnail.url, 'four-three.png');
        thumbnail.naturalWidth = 800;
        thumbnail.naturalHeight = 600;
        thumbnail.onload();
        assert.ok(Number.parseFloat(ratioGhost.style.height) > defaultHeight);
        assert.ok(Math.abs(Number.parseFloat(ratioGhost.style.height) - (320 / (4 / 3)) * 338 / 720) < 0.01);
        listeners.get('akari.material.dragEnd')();
        listeners.get('akari.material.dragStart')({ type: 'akari.material.dragStart', detail: withThumb });
        const staleThumbnail = thumbnails.at(-1);
        listeners.get('akari.material.dragStart')({ type: 'akari.material.dragStart', detail: {
            relativePath: 'assets/next.png', kind: 'image'
        } });
        await new Promise(resolve => setImmediate(resolve));
        const nextLayer = node.children.at(-1);
        nextLayer.listeners.get('dragover')(event(transfer('application/x-akari-material', '')));
        const nextHeight = nextLayer.children[0].style.height;
        staleThumbnail.naturalWidth = 800;
        staleThumbnail.naturalHeight = 600;
        staleThumbnail.onload();
        assert.equal(nextLayer.children[0].style.height, nextHeight, '古い thumb の読み込みは次の仮枠を変えない');
        listeners.get('akari.material.dragEnd')();
        listeners.get('akari.library.dragStart')({ type: 'akari.library.dragStart', detail: {
            kind: 'asset', key: 'still/photo', category: 'still', title: '写真', thumb: 'preview.png'
        } });
        const libraryDrag = transfer('application/x-akari-library-item', '');
        listeners.get('dragstart')({ clientX: 850, clientY: 250, dataTransfer: libraryDrag });
        assert.equal(libraryDrag.image.width, 1);
        assert.equal(sample().children[0].src, 'preview.png', 'MIME が読めない dragstart でも見本を表示する');
        listeners.get('akari.library.dragEnd')();
        assert.equal(sample(), undefined);
        for (const [mime, uri, relativePath, kind] of [
            ['tree-node', 'file:///tmp/demo/project/assets/from-tree.mp4', 'assets/from-tree.mp4', 'video'],
            ['text/uri-list', 'file:///private/tmp/demo/project/assets/photo.PNG', 'assets/photo.PNG', 'image'],
            ['text/uri-list', 'file:///tmp/demo/project/assets/audio.wav', 'assets/audio.wav', 'audio']
        ]) {
            const explorer = transfer(mime, uri);
            listeners.get('dragstart')({ dataTransfer: explorer });
            assert.equal(node.children.at(-1).dataset.akariPreviewLibraryDrop, 'true');
            await new Promise(resolve => setImmediate(resolve));
            node.children.at(-1).listeners.get('drop')(event(explorer));
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(commands.at(-2)[1].relativePath, relativePath);
            assert.equal(commands.at(-2)[1].kind, kind);
        }
        const external = transfer('text/uri-list', 'file:///tmp/demo/assets/clip.mp4');
        listeners.get('dragstart')({ dataTransfer: external });
        await new Promise(resolve => setImmediate(resolve));
        const before = commands.length;
        node.children.at(-1).listeners.get('drop')(event(external));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(commands.length, before);
        assert.deepEqual(warnings, ['プロジェクトの中のファイルだけ置けます']);
        listeners.get('akari.library.dragStart')({ type: 'akari.library.dragStart', detail: { kind: 'text' } });
        listeners.get('dragstart')({ clientX: 850, clientY: 200,
            dataTransfer: transfer('application/x-akari-library-item', '') });
        assert.ok(sample());
        assert.equal(sample().children.at(-1).textContent, 'テキスト');
        drop.dispose();
        assert.equal(sample(), undefined, 'dispose でも見本を片付ける');
    } finally {
        drop.dispose();
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
        globalThis.requestAnimationFrame = previousRaf;
        globalThis.Image = previousImage;
    }
});

test('複数の出力プレビューでも見本は 1 枚で、drop・dragend・blur で消える', () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousRaf = globalThis.requestAnimationFrame;
    const listeners = new Map();
    const document = { body: { children: [], appendChild(node) { this.children.push(node); } },
        createElement() { return element(document); }, createTextNode(text) { return { textContent: text }; } };
    const window = { addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
    }, removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }, setTimeout, clearTimeout };
    const emit = (type, event) => { for (const listener of [...listeners.get(type) ?? []]) listener(event); };
    globalThis.window = window;
    globalThis.document = document;
    globalThis.requestAnimationFrame = callback => { callback(); };
    const widget = left => {
        const node = element(document);
        node.getBoundingClientRect = () => ({ x: left, y: 0, left, top: 0, width: 800, height: 500 });
        return { node, isAttached: true, onDidDispose() {},
            onMessage() { return { dispose() {} }; }, sendMessage() {} };
    };
    const first = new PreviewLibraryDrop(widget(0), {}, {}, () => 'file:///edit.json',
        () => ({ width: 1280, height: 720 }), () => false);
    const second = new PreviewLibraryDrop(widget(900), {}, {}, () => 'file:///edit.json',
        () => ({ width: 1280, height: 720 }), () => false);
    const samples = () => document.body.children.filter(child => child.dataset.akariDragSample && !child.removed);
    const start = () => {
        const payload = { kind: 'shape', name: '星' };
        emit('akari.library.dragStart', { type: 'akari.library.dragStart', detail: payload });
        const transfer = { types: ['application/x-akari-library-item'], getData: () => JSON.stringify(payload),
            setDragImage(image) { this.image = image; } };
        emit('dragstart', { clientX: 1800, clientY: 200, dataTransfer: transfer });
        assert.equal(transfer.image.width, 1);
        assert.equal(samples().length, 1);
    };
    try {
        start();
        emit('dragover', { clientX: 1000, clientY: 200 });
        assert.equal(samples()[0].style.display, 'none', '別の出力 widget の上でも隠れる');
        emit('dragover', { clientX: 1800, clientY: 200 });
        assert.equal(samples()[0].style.display, 'flex');
        emit('drop', {});
        assert.equal(samples().length, 0);
        start();
        emit('dragend', {});
        assert.equal(samples().length, 0);
        start();
        emit('blur', {});
        assert.equal(samples().length, 0);
    } finally {
        first.dispose();
        second.dispose();
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
        globalThis.requestAnimationFrame = previousRaf;
    }
});
