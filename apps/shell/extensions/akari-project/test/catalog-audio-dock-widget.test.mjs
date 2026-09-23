import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const text = readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('widget.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
assert.ok(widget);
const method = name => {
    const member = widget.members.find(node => node.name?.getText(source) === name);
    assert.ok(member, `${name} が存在する`);
    return member.getText(source);
};
const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
const code = ts.transpileModule(`class Handler {
    ${['renderMaterialsPane', 'renderCatalogAudioDock', 'toggleCatalogAudio', 'stopCatalogAudio'].map(method).join('\n')}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React } }).outputText;
const Handler = new Function('React', 'AKARI_RADIUS', 'AKARI_BORDER', 'AKARI_SURFACE', 'AKARI_INK', `${code}\nreturn Handler;`)(
    react, { panel: 8 }, { hairline: '1px solid gray' }, { raised: 'gray' }, 'black'
);
const walk = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined;
    if (predicate(node)) return node;
    for (const child of node.props?.children ?? []) {
        const found = walk(child, predicate);
        if (found) return found;
    }
    return undefined;
};

function fixture() {
    const handler = new Handler();
    const calls = { pause: 0, play: 0, updates: 0 };
    handler.catalogAudioElement = {
        pause: () => { calls.pause++; },
        play: () => { calls.play++; return Promise.resolve(); }
    };
    handler.update = () => { calls.updates++; };
    handler.topView = 'catalog';
    handler.renderGenerationPickBand = () => undefined;
    handler.renderTopControls = () => undefined;
    handler.renderCatalogTab = () => react.createElement('div', { 'data-catalog-list': true });
    handler.renderMaterialsTab = () => undefined;
    handler.renderBundleMaterials = () => undefined;
    return { handler, calls };
}

test('カテゴリ・パックの一覧外に、下端固定の試聴ドックを描画する', () => {
    for (const name of ['renderCatalogBody', 'renderLibraryPackBody']) {
        assert.doesNotMatch(method(name), /renderCatalogAudio(?:Bar|Dock)\s*\(/);
    }
    const { handler } = fixture();
    const item = { key: 'audio/bgm', title: '曲名', mediaUrl: 'sample.mp3' };
    handler.toggleCatalogAudio(item);
    const tree = handler.renderMaterialsPane();
    const scroll = walk(tree, node => node.props?.style?.overflow === 'auto');
    const dock = walk(tree, node => node.props?.['data-akari-catalog-audio-dock'] !== undefined);
    assert.ok(scroll && dock);
    assert.equal(walk(scroll, node => node === dock), undefined, 'ドックは一覧スクロール領域の外');
    assert.equal(dock.props.style.position, 'absolute');
    assert.equal(dock.props.style.bottom, '8px');
    assert.equal(scroll.props.style.paddingBottom, '56px');
    assert.equal(walk(dock, node => node.props?.['data-akari-catalog-audio-bar-stop'] !== undefined)?.props.children[0], '停止');
    let stopped = false;
    dock.props.onClick({ stopPropagation: () => { stopped = true; } });
    assert.equal(stopped, true, 'ドック内クリックは一覧の面外クリックへ伝えない');
    assert.match(text, /animation: akari-catalog-audio-dock-enter 180ms/);
    assert.match(text, /prefers-reduced-motion: reduce/);
});

test('再クリック・停止・× で再生状態を閉じ、別カードなら共有プレイヤーを切り替える', () => {
    const { handler, calls } = fixture();
    const first = { key: 'audio/first', title: '最初', mediaUrl: 'first.mp3' };
    const second = { key: 'audio/second', title: '次', mediaUrl: 'second.mp3' };
    handler.toggleCatalogAudio(first);
    assert.equal(handler.playingCatalogAudioKey, first.key);
    handler.toggleCatalogAudio(first);
    assert.equal(handler.playingCatalogAudioKey, undefined);
    assert.equal(handler.renderCatalogAudioDock(), undefined);
    handler.toggleCatalogAudio(first);
    handler.toggleCatalogAudio(second);
    assert.equal(handler.playingCatalogAudioKey, second.key);
    assert.equal(handler.playingCatalogAudioTitle, second.title);
    assert.equal(handler.catalogAudioElement.src, second.mediaUrl);
    const dock = handler.renderCatalogAudioDock();
    walk(dock, node => node.props?.['data-akari-catalog-audio-bar-stop'] !== undefined).props.onClick();
    assert.equal(handler.playingCatalogAudioKey, undefined);
    handler.toggleCatalogAudio(first);
    let stopped = false;
    walk(handler.renderCatalogAudioDock(), node => node.props?.['data-akari-catalog-audio-dock-close'] !== undefined)
        .props.onClick({ stopPropagation: () => { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(handler.playingCatalogAudioKey, undefined);
    assert.equal(calls.play, 4);
    assert.ok(calls.pause >= 4);
});

test('候補棚では試聴を止め、ドックを表示しない', () => {
    const { handler } = fixture();
    handler.toggleCatalogAudio({ key: 'audio/a', title: '曲', mediaUrl: 'a.mp3' });
    handler.materialSwap = { request: {} };
    assert.equal(walk(handler.renderMaterialsPane(), node => node.props?.['data-akari-catalog-audio-dock'] !== undefined), undefined);
    assert.match(method('openMaterialSwap'), /if \(this\.playingCatalogAudioKey\) this\.stopCatalogAudio\(\);[\s\S]*this\.materialSwap\s*=/);
});
