import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { referencePresentation } from '../lib/common/project-asset-reference.js';
import { resolveLibraryAssetMedia } from '../lib/common/library-asset-placement.js';
import { assetGroupOpenTarget } from '../lib/common/asset-group-open-target.js';
import { countReferences } from '../lib/common/project-reference-check.js';
const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const React = require('react');
const source = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
const names = ['buildReferenceMaterials', 'retryMaterialReference', 'removeMaterialReference', 'confirmReferenceImpact', 'bundleMaterials', 'renderBundleMaterials'];
const code = ts.transpileModule(`class Handler { ${names.map(name => widget.members.find(member => member.name?.getText(source) === name).getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React } }).outputText;
function fixture() {
    const dialogs = [], calls = [];
    let approve = true;
    const ConfirmDialog = class { constructor(options) { dialogs.push(options); } async open() { return approve; } };
    const Handler = new Function('URI', 'React', 'referencePresentation', 'resolveLibraryAssetMedia', 'assetGroupOpenTarget', 'countReferences', 'ConfirmDialog', 'AKARI_BORDER', `${code}; return Handler;`)(URI, React, referencePresentation, resolveLibraryAssetMedia, assetGroupOpenTarget, countReferences, ConfirmDialog, { hairline: 'none' });
    const handler = new Handler();
    const root = URI.fromFilePath('/project');
    Object.assign(handler, { workflow: { workspaceRoot: root }, assetCatalogItems: [], update() {},
        messages: { info() {}, error: value => { throw Error(value); } },
        projectService: { removeProjectAssetReference: async (...args) => calls.push(args) },
        loadMaterials: async () => calls.push('reload'),
        files: { resolve: async uri => { if (uri.toString().startsWith('file:///project')) throw Error('missing'); return { resource: uri, children: [] }; } },
        toAssetBinChildren: stat => stat.children,
        buildAssetGroupEntry: async (_, stat) => ({ uri: stat.resource.resolve('meta.json'), name: 'title', kind: 'audio', analyzed: false, unorganized: false })
    });
    return { handler, root, dialogs, calls, reject: () => { approve = false; } };
}
const reference = { category: 'audio', id: 'sound', tags: [], sourceKind: 'lab', libraryDir: '/library/audio/sound', files: [{ name: 'sound.wav', path: '/legacy/audio/sound/sound.wav', bytes: 10 }] };

test('台帳→参照カードは媒体の実ルートを使い、宣言パスを保つ。欠落も表示入力に残す', async () => {
    const f = fixture();
    const missing = { ...reference, id: 'missing', libraryDir: undefined, files: [] };
    const cards = await f.handler.buildReferenceMaterials(f.root, [reference, missing]);
    assert.equal(cards.length, 2);
    assert.equal(cards[0].mediaRelativePath, 'assets/audio/sound/sound.wav');
    assert.equal(cards[0].uri.toString(), 'file:///legacy/audio/sound/sound.wav');
    assert.equal(cards[0].reference.id, 'sound');
    assert.equal(cards[0].missing, false);
    assert.equal(cards[1].missing, true);
    assert.equal(referencePresentation(cards[1].reference).recovery, 'もう一度取得');
    assert.equal(referencePresentation({ ...missing, tags: ['origin:site'] }, true).recovery, '入れ直してください');
});

test('コピー時代の実体には参照カードを重ねない。空ディレクトリなら参照を表示', async () => {
    const f = fixture();
    f.handler.files.resolve = async uri => ({ resource: uri, children: [{ name: 'sound.wav', isDirectory: false }] });
    assert.deepEqual(await f.handler.buildReferenceMaterials(f.root, [reference]), []);
    f.handler.files.resolve = async uri => ({ resource: uri, children: [] });
    assert.equal((await f.handler.buildReferenceMaterials(f.root, [reference])).length, 1);
});

test('外す前に edit.json 使用件数を一度ずつ数え、キャンセルでは台帳を変えない', async () => {
    const f = fixture();
    f.handler.readProjectReferenceDocuments = async () => ({ failed: false, documents: [JSON.stringify({ paths: ['assets/audio/sound/sound.wav', 'assets/audio/sound/sound.wav', 'assets/audio/sound-extra/other.wav'] })] });
    const card = { reference, relativePath: 'assets/audio/sound' };
    f.reject();
    await f.handler.removeMaterialReference(card);
    assert.match(f.dialogs[0].msg, /2 箇所参照/);
    assert.equal(f.calls.length, 0);
    const g = fixture();
    g.handler.readProjectReferenceDocuments = f.handler.readProjectReferenceDocuments;
    await g.handler.removeMaterialReference(card);
    assert.deepEqual(g.calls, [['file:///project', reference], 'reload']);
});

function renderedText(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node !== 'object') return String(node);
    if (Array.isArray(node)) return node.map(renderedText).join(' ');
    return renderedText(node.props?.children);
}

test('まとめるは dry-run→件数・容量・権利警告→実行。部分成功の成功と失敗を表示', async () => {
    const f = fixture(), calls = [];
    const result = { planned: [reference], bytes: 1048576, unknownSizeCount: 0, restrictedCount: 1,
        materialized: ['audio/success'], failures: [{ key: 'audio/missing', message: 'offline' }] };
    f.handler.projectService.bundleProjectAssets = async (_, dry) => { calls.push(dry); if (!dry) assert.equal(f.dialogs.length, 1); return result; };
    await f.handler.bundleMaterials();
    assert.deepEqual(calls, [true, false]);
    assert.match(f.dialogs[0].msg, /1 件・1\.00 MB/);
    assert.match(f.dialogs[0].msg, /再配布できない素材が 1 件含まれます/);
    const text = renderedText(f.handler.renderBundleMaterials());
    assert.match(text, /audio\/success/); assert.match(text, /audio\/missing.*offline/);
    assert.equal(f.handler.bundleBusy, false);
    f.reject(); calls.length = 0;
    await f.handler.bundleMaterials();
    assert.deepEqual(calls, [true]);
});


test('Lab の欠落媒体はメタデータだけ残っていても強制再取得する', async () => {
    const f = fixture();
    f.handler.projectService.resolveAsset = async (...args) => { f.calls.push(args); return { success: true }; };
    await f.handler.retryMaterialReference({ reference });
    assert.deepEqual(f.calls, [['sound', 'file:///project', { force: true }], 'reload']);
});
