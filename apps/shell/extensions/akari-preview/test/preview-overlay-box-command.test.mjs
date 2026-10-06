import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { readHandlerSource } from './helpers/handler-source.mjs';

const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const source = ts.createSourceFile('preview.ts', readHandlerSource(),
    ts.ScriptTarget.Latest, true);
const owner = source.statements.find(node => ts.isClassDeclaration(node)
    && node.members.some(member => member.name?.getText(source) === 'measureOverlayBox'));
const method = owner.members.find(member => member.name?.getText(source) === 'measureOverlayBox');
const code = ts.transpileModule(`class Handler { ${method.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const Handler = runInContext(`${code}\nHandler`, createContext({ URI, Promise, Date, Math, JSON, Map,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestReadyPreviewSeek: () => assert.fail('測定では再生位置を動かさない') }));

test('計測コマンドは開いている画面を読み直さず、素材書き換え後の box を待つ', async () => {
    const listeners = new Set();
    const sent = [];
    const widget = {
        id: 'output', isDisposed: false, isAttached: true, akariPreviewPlaybackPageId: 'page',
        get akariPreviewRefresh() { assert.fail('開いているプレビューを読み直さない'); },
        onMessage(listener) { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
        sendMessage(message) {
            sent.push(message);
            if (message.type === 'akari-preview-overlay-box-request') queueMicrotask(() => {
                for (const listener of listeners) listener({ type: 'akari-preview-overlay-box',
                    requestId: message.requestId, box: { x: 10, y: 20, width: 300, height: 90 } });
            });
        }
    };
    const handler = new Handler();
    handler.overlayMeasureCache = new Map();
    handler.openOutputPreviews = new Map([['file:///project/edit.json', widget]]);
    handler.shell = { revealWidget: () => assert.fail('開いているプレビューを再表示しない') };
    handler.currentWorkspaceRoots = async () => [];
    handler.previewService = { rewriteFragmentAssets: async request => {
        assert.equal(request.htmlPath, 'assets/overlay/chalkboard-jp/fragment.html');
        return { html: '<div>書き換え済み</div>', streams: [], warnings: [] };
    } };
    const request = { editUri: 'file:///project/edit.json', fragment: '<div>元</div>',
        relativePath: 'assets/overlay/chalkboard-jp/fragment.html', vars: {} };
    assert.deepEqual({ ...await handler.measureOverlayBox(request) },
    { x: 10, y: 20, width: 300, height: 90 });
    assert.equal(sent[0].fragment, '<div>書き換え済み</div>');
    assert.equal(listeners.size, 0);
    assert.deepEqual({ ...await handler.measureOverlayBox(request) },
        { x: 10, y: 20, width: 300, height: 90 });
    assert.equal(sent.length, 1, '同じ素材と vars は測定結果を再利用する');
    await handler.measureOverlayBox({ ...request, vars: { '--tone': 'blue' } });
    assert.equal(sent.length, 2, 'vars が変われば測り直す');
});
