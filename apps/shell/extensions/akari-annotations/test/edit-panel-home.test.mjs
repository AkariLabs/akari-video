import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { viewAfterHomeTabClick } from '../lib/browser/inspector/home-tab.js';
import { appendHomeTuneTiles, homeTuneTiles } from '../lib/browser/inspector/home-tune.js';
import { tabsForKind } from '../lib/browser/inspector/tab-model.js';
import { appendImageAiPanel } from '../lib/browser/inspector/image-ai-panel.js';
import { appendAiMaterialView } from '../lib/browser/inspector/ai-material-view.js';
import { appendAiTiles } from '../lib/browser/inspector/ai-tiles.js';

class Node {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.attributes = new Map(); this.style = {}; this.listeners = new Map(); this.className = ''; this.textContent = ''; this.isConnected = true; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    click() { this.listeners.get('click')?.(); }
}
function withDom(run) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
    try { return run(); } finally {
        if (previous) Object.defineProperty(globalThis, 'document', previous);
        else delete globalThis.document;
    }
}
function find(root, predicate) {
    if (predicate(root)) return root;
    for (const child of root.children) { const found = find(child, predicate); if (found) return found; }
}

test('ホームは専用画面から一覧へ戻り、押せるタイルが一つだけなら専用画面を保つ', () => {
    assert.equal(viewAfterHomeTabClick({ currentView: 'still', enabledTileCount: 2 }), 'tiles');
    assert.equal(viewAfterHomeTabClick({ currentView: 'video', enabledTileCount: 1, soleTileView: 'video' }), 'video');
    assert.equal(viewAfterHomeTabClick({ currentView: 'tiles', enabledTileCount: 3 }), 'tiles');
    assert.equal(viewAfterHomeTabClick({ currentView: 'tiles', enabledTileCount: 1, soleTileView: 'video' }), 'tiles');
});

test('ホームは作る・直すの棚を分けて描く', () => withDom(() => {
    const root = new Node();
    appendAiTiles(root, [
        { group: 'make', tiles: [{ id: 'still', label: '静止画', image: 'still', enabled: true }] },
        { group: 'refine', tiles: [{ id: 'transcribe', label: '文字起こし', image: 'transcribe', enabled: false, reason: '声のある素材で使えます' }] }
    ], () => {});
    assert.ok(find(root, node => node.textContent === '作る'));
    assert.ok(find(root, node => node.textContent === '直す'));
}));

test('整える: 映像の四つの近道と音声の一つの近道', () => {
    assert.deepEqual(homeTuneTiles('cut', tabsForKind('cut')).map(({ id, tabId, sectionId, enabled }) =>
        [id, tabId, sectionId, enabled]), [
        ['position', 'video', 'transform', true], ['color', 'adjust', undefined, true],
        ['volume', 'audio', undefined, true], ['motion', 'motion', undefined, true]
    ]);
    assert.deepEqual(homeTuneTiles('audio', tabsForKind('audio')).map(tile => tile.id), ['volume']);
    assert.deepEqual(homeTuneTiles('caption', tabsForKind('caption')), []);
});

test('整える: 押せないタブは理由つきグレー、押しても移動しない', () => {
    withDom(() => {
        const tiles = homeTuneTiles('layer', tabsForKind('layer'));
        assert.deepEqual(tiles.filter(tile => !tile.enabled).map(tile => tile.id), ['color', 'volume']);
        const root = new Node();
        const targets = [];
        appendHomeTuneTiles(root, tiles, target => targets.push(target));
        const disabled = find(root, node => node.attributes.get('data-akari-home-tune') === 'color');
        assert.match(disabled.className, /akari-inspector-ai-disabled/u);
        assert.equal(disabled.attributes.get('aria-disabled'), 'true');
        assert.equal(find(disabled, node => node.className === 'akari-inspector-ai-reason').textContent, '映像の素材で使えます');
        disabled.click();
        assert.deepEqual(targets, []);
        find(root, node => node.attributes.get('data-akari-home-tune') === 'position').click();
        assert.deepEqual(targets, [{ tabId: 'video', sectionId: 'transform' }]);
    });
});

test('素材のホームタブは単一タイルの専用パネルを保つ', () => withDom(() => {
    const root = new Node();
    const changed = [];
    appendAiMaterialView(root, {
        selection: { mediaKind: 'audio', name: 'voice.wav', relativePath: 'voice.wav', projectRoot: 'file:///fixture' },
        tab: 'generation', view: 'transcribe', summary: { state: 'none', segments: [], total: 0 }, running: false,
        commands: { executeCommand: async () => {} }, onTab: tab => changed.push(['tab', tab]),
        onView: view => changed.push(['view', view]), onDialogResult: () => {}
    });
    const home = find(root, node => node.attributes.get('data-akari-inspector-ai-tab') === 'generation');
    assert.equal(home.textContent, 'ホーム');
    home.click();
    assert.deepEqual(changed, [['tab', 'generation'], ['view', 'transcribe']]);
}));

test('画像 AI と widget の近日専用節を描かない', () => withDom(() => {
    const root = new Node();
    appendImageAiPanel(root, { projectRootUri: 'file:///fixture', itemId: 'photo-1',
        state: { itemId: 'photo-1', phase: 'closed' }, service: {}, openSettings: () => {}, adopt: async () => ({ ok: true }) });
    assert.ok(find(root, node => node.textContent === '高画質化'));
    assert.equal(find(root, node => node.textContent.includes('近日')), undefined);
    const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
    const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
    const method = widget.members.find(node => node.name?.getText(ast) === 'appendAdjustPreviewSection').getText(ast);
    const code = ts.transpileModule(`class Harness { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const Harness = new Function(`${code}; return Harness;`)();
    const instance = new Harness();
    instance.body = new Node();
    instance.appendAdjustPreviewSection({ id: 'preview', label: '近日', build: () => new Node() }, 'cut');
    assert.equal(instance.body.children.length, 0);
}));
