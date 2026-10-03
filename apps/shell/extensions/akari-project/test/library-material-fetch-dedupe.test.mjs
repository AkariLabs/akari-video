import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { canPlaceLibraryAsset, localLibraryAssetPlacementSource, resolveLibraryAssetMedia } from '../lib/common/library-asset-placement.js';

const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const source = ts.createSourceFile('widget.tsx',
    readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
const method = widget.members.find(member => member.name?.getText(source) === 'resolveCatalogMaterial');
const code = ts.transpileModule('class Handler { ' + method.getText(source) + ' }',
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Handler = new Function('URI', 'canPlaceLibraryAsset', 'localLibraryAssetPlacementSource', 'resolveLibraryAssetMedia',
    code + '\nreturn Handler;')(URI, canPlaceLibraryAsset, localLibraryAssetPlacementSource, resolveLibraryAssetMedia);

test('同じ素材を同時に二度置いても取得は一回で結果を共有する', async () => {
    const item = { origin: 'resolver', key: 'audio/sample', id: 'sample', category: 'audio',
        title: '素材', state: 'available', mediaUrl: 'https://example.test/b.mp3' };
    const handler = new Handler(), calls = [], messages = [];
    handler.workflow = { workspaceRoot: URI.fromFilePath('/project') };
    handler.assetCatalogItems = [item];
    handler.resolvingAssetKeys = new Set();
    handler.update = () => {};
    handler.loadMaterials = async () => {};
    handler.showPremiumPrompt = () => false;
    handler.messages = { warn: message => messages.push(message), error: message => messages.push(message) };
    handler.files = { resolve: async () => ({ children: ['a.mp3', 'b.mp3'].map(name => ({ name, isDirectory: false })) }) };
    handler.toAssetBinChildren = stat => stat.children;
    let finish;
    handler.projectService = { resolveAsset: async (...args) => {
        calls.push(args);
        return new Promise(resolve => { finish = resolve; });
    } };
    const first = handler.resolveCatalogMaterial(item.key);
    const second = handler.resolveCatalogMaterial(item.key);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    finish({ success: true, projectAssetPath: '/project/assets/audio/sample' });
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, { relativePath: 'assets/audio/sample/b.mp3', kind: 'audio' });
    assert.deepEqual(b, a);
    assert.deepEqual(messages, []);
});
