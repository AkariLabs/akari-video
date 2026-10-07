import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('service.ts', readFileSync(new URL('../src/node/akari-project-service.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
const service = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariProjectServiceImpl');
const names = ['readUiState', 'writeUiState', 'readJsonFile', 'writeJsonAtomic'];
const methods = service.members.filter(node => ts.isMethodDeclaration(node) && names.includes(node.name?.getText(source)))
    .map(node => node.getText(source)).join('\n');
const code = ts.transpileModule(`class Harness { fsPath(uri) { return uri; } ${methods} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('ui state merges other keys and recovers from invalid JSON', async () => {
    const files = new Map();
    const fs = {
        readFile: async path => {
            if (!files.has(path)) throw new Error('missing');
            return files.get(path);
        },
        mkdir: async () => {},
        writeFile: async (path, value) => { files.set(path, value); },
        rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); }
    };
    const Harness = new Function('join', 'dirname', 'fs', `${code}; return Harness;`)(join, dirname, fs);
    const instance = new Harness();
    const path = join('project', '.akari', 'ui-state.json');
    files.set(path, JSON.stringify({ sidebar: { open: true }, materialsPane: { extra: 1, sort: 'name' } }));
    await instance.writeUiState('project', { materialsPane: { filter: ['audio'] } });
    assert.deepEqual(await instance.readUiState('project'), {
        sidebar: { open: true }, materialsPane: { extra: 1, sort: 'name', filter: ['audio'] }
    });
    files.set(path, '{broken');
    assert.deepEqual(await instance.readUiState('project'), {});
    await instance.writeUiState('project', { materialsPane: { filter: [], sort: 'imported-desc' } });
    assert.deepEqual(await instance.readUiState('project'), { materialsPane: { filter: [], sort: 'imported-desc' } });
});
