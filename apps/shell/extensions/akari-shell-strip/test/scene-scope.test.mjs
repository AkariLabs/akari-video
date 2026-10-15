import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import uriModule from '@theia/core/lib/common/uri.js';
const URI = uriModule.default ?? uriModule;
const source = readFileSync(new URL('../src/browser/akari-scope-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('scope.ts', source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'hasProjectEdit');
const code = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const hasProjectEdit = new Function(`${code.replace(/^export\s+/, '')}\nreturn hasProjectEdit;`)();

test('single project scope remains based on root edit', async () => {
    const root = new URI('file:///tmp/p1');
    const files = { exists: async uri => uri.path.toString().endsWith('/edit.json'), resolve: async () => { throw Error('should not read scenes'); } };
    assert.equal(await hasProjectEdit(files, root), true);
});

test('scene project scope checks one level of scene edits', async () => {
    const root = new URI('file:///tmp/p1');
    const files = {
        exists: async uri => uri.path.toString().endsWith('/s02/edit.json'),
        resolve: async () => ({ children: ['s01', 's02'].map(name => ({ isDirectory: true, resource: root.resolve(`scenes/${name}`) })) })
    };
    assert.equal(await hasProjectEdit(files, root), true);
    assert.equal(await hasProjectEdit({ ...files, exists: async () => false }, root), false);
});
