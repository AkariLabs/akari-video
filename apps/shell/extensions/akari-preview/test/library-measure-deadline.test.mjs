import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('preview.ts', source, ts.ScriptTarget.Latest, true);
const owner = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariPreviewOpenHandler');
const member = owner.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'measureOverlayBox');
const compiled = ts.transpileModule(`class Handler { ${member.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const URI = class {
    constructor(value) { this.value = value; }
    normalizePath() { return this; }
    toString() { return this.value; }
    get path() { return { base: this.value.split('/').at(-1) }; }
    get parent() { return new URI(this.value.slice(0, this.value.lastIndexOf('/'))); }
    resolve(name) { return new URI(`${this.value}/${name}`); }
};
const measure = runInContext(`${compiled}\nHandler.prototype.measureOverlayBox`,
    createContext({ URI, Date, Map, JSON, Math, Promise, setTimeout, clearTimeout, setInterval, clearInterval }));

test('プレビューが開かない場合も枠測定は 1 秒で返す', async () => {
    const host = { overlayMeasureCache: new Map(), openOutputPreviews: new Map(),
        getOrOpenPreview: () => new Promise(() => {}) };
    const started = Date.now();
    assert.equal(await measure.call(host, { editUri: 'file:///edit.json', fragment: '<div>title</div>' }), undefined);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 900 && elapsed < 1250, `elapsed=${elapsed}`);
});

test('同じ fragment と vars の枠はプレビューへ再送しない', async () => {
    let listener;
    let requests = 0;
    const box = { x: 10, y: 20, width: 300, height: 80 };
    const widget = { isDisposed: false, isAttached: true,
        onMessage(callback) { listener = callback; return { dispose() {} }; },
        sendMessage(message) {
            requests++;
            queueMicrotask(() => listener({ type: 'akari-preview-overlay-box', requestId: message.requestId, box }));
        } };
    const host = { overlayMeasureCache: new Map(), openOutputPreviews: new Map([['file:///edit.json', widget]]),
        previewDiagnostics: { note() {} } };
    const request = { editUri: 'file:///edit.json', fragment: '<div>title</div>', vars: { '--color': 'red' } };
    assert.deepEqual({ ...await measure.call(host, request) }, box);
    assert.deepEqual({ ...await measure.call(host, request) }, box);
    assert.equal(requests, 1);
});

test('参照台帳だけの変更はプレビュー全体を作り直さない', () => {
    let declaration;
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleFilesChanged') declaration = node;
        ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.ok(declaration);
    const compiled = ts.transpileModule(`const handleFilesChanged = ${declaration.initializer.getText(ast)};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const editUri = new URI('file:///project/edit.json');
    const widget = { akariPreviewEditUri: editUri };
    const calls = [];
    const host = { resourceSuffix: uri => uri.path.base, queueRefresh: (...args) => calls.push(args) };
    const handler = runInContext(`(function () { ${compiled}; return handleFilesChanged; }).call(host)`,
        createContext({ host, widget, kind: 'output', identityUri: editUri, placement: undefined, Date, Set }));
    handler({ changes: [{ resource: new URI('file:///project/.akari/asset-references.json') }] });
    assert.deepEqual(calls, [[widget, editUri, 'output', undefined, false]]);
});
