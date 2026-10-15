import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import uriModule from '@theia/core/lib/common/uri.js';
const URI = uriModule.default ?? uriModule;

const source = readFileSync(new URL('../src/browser/akari-materials-pane.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('materials.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const rootFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'materialSourceRoot');
const rootCode = ts.transpileModule(rootFunction.getText(ast).replace(/^export\s+/u, ''),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const materialSourceRoot = new Function(`${rootCode}\nreturn materialSourceRoot;`)();

test('common thumbnails use the project root, local thumbnails use the scene root', async () => {
    const scene = new URI('file:///creator/channels/test/videos/p1/scenes/s01');
    const project = scene.parent.parent;
    assert.equal(materialSourceRoot(scene, {}).toString(), scene.toString());
    assert.equal(materialSourceRoot(scene, { commonSourceUri: project.resolve('assets/common.png').toString() }).toString(), project.toString());

    const paneClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariMaterialsPane');
    const method = paneClass.members.find(node => node.name?.getText(ast) === 'hydrateCachedThumbnails');
    const methodCode = ts.transpileModule(`class Pane { ${method.getText(ast)} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const Pane = new Function('materialSourceRoot', `${methodCode}\nreturn Pane;`)(materialSourceRoot);
    const pane = new Pane();
    pane.materialsGeneration = 1;
    const calls = [];
    pane.host = { projectService: { resolveMaterialThumbnail: async (...args) => {
        calls.push(args);
        return { available: true, cacheRelativePath: '.akari/cache/thumbnails/blue.png' };
    } }, update: () => {} };
    const common = { kind: 'image', analyzed: false, relativePath: 'assets/common.png', commonSourceUri: project.resolve('assets/common.png').toString() };
    const local = { kind: 'image', analyzed: false, relativePath: 'assets/local.png' };
    await pane.hydrateCachedThumbnails(scene, 1, [common, local]);
    assert.deepEqual(calls.map(call => [call[0], call[1]]), [
        [project.toString(), 'assets/common.png'], [scene.toString(), 'assets/local.png']
    ]);
    assert.equal(common.thumbnailUri.toString(), project.resolve('.akari/cache/thumbnails/blue.png').toString());
    assert.equal(local.thumbnailUri.toString(), scene.resolve('.akari/cache/thumbnails/blue.png').toString());
});

test('common preview and supplemental media queries retain the project source', () => {
    assert.match(source, /entry\.thumbnailUri = child\.resource/u);
    assert.match(source, /materialMeta\(group\.root\.toString\(\)/u);
    assert.match(source, /resolveMaterialStrip\(sourceRoot\.toString\(\)/u);
    assert.match(source, /<MaterialCardHoverPreview assetUri=\{entry\.uri\.toString\(\)\}/u);
});
