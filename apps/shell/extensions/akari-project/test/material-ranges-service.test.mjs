import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const source = ts.createSourceFile('service.ts', readFileSync(new URL('../src/node/akari-project-service.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
const service = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariProjectServiceImpl');
const names = ['readMaterialRanges', 'writeMaterialRange', 'readJsonFile', 'writeJsonAtomic'];
const methods = service.members.filter(node => ts.isMethodDeclaration(node) && names.includes(node.name?.getText(source)))
    .map(node => node.getText(source)).join('\n');
const code = ts.transpileModule(`class Harness { materialRangeWrites = new Map(); fsPath(uri) { return uri; } ${methods} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('material ranges merge, recover invalid JSON, and rename a complete temporary file', async () => {
    const files = new Map();
    const writes = [];
    const fs = {
        readFile: async path => {
            if (!files.has(path)) throw new Error('missing');
            return files.get(path);
        },
        mkdir: async () => {},
        writeFile: async (path, value) => { files.set(path, value); writes.push(['write', path]); },
        rename: async (from, to) => {
            assert.equal(files.has(from), true);
            writes.push(['rename', from, to]);
            files.set(to, files.get(from)); files.delete(from);
        }
    };
    const Harness = new Function('join', 'dirname', 'fs', 'process', `${code}; return Harness;`)(join, dirname, fs, process);
    const instance = new Harness();
    const path = join('project', '.akari', 'material-ranges.json');
    files.set(path, JSON.stringify({ extra: { keep: true }, version: 1,
        ranges: { 'assets/old.mp4': { in: 1, out: 4 } } }));
    await instance.writeMaterialRange('project', 'assets/new.mp4', { in: 2, out: 6 });
    assert.deepEqual(JSON.parse(files.get(path)), { extra: { keep: true }, version: 1,
        ranges: { 'assets/old.mp4': { in: 1, out: 4 }, 'assets/new.mp4': { in: 2, out: 6 } } });
    assert.deepEqual(writes.map(step => step[0]), ['write', 'rename']);
    assert.equal(writes[0][1], writes[1][1]);
    assert.equal(writes[1][2], path);
    await instance.writeMaterialRange('project', 'assets/old.mp4', null);
    assert.deepEqual(await instance.readMaterialRanges('project'), { 'assets/new.mp4': { in: 2, out: 6 } });
    await Promise.all([
        instance.writeMaterialRange('project', 'assets/parallel-a.mp4', { in: 0, out: 2 }),
        instance.writeMaterialRange('project', 'assets/parallel-b.mp4', { in: 1, out: 3 })
    ]);
    assert.ok((await instance.readMaterialRanges('project'))['assets/parallel-a.mp4']);
    assert.ok((await instance.readMaterialRanges('project'))['assets/parallel-b.mp4']);
    files.set(path, '{invalid');
    assert.deepEqual(await instance.readMaterialRanges('project'), {});
    await instance.writeMaterialRange('project', 'assets/reset.mp4', { in: 0, out: 3 });
    assert.deepEqual(await instance.readMaterialRanges('project'), { 'assets/reset.mp4': { in: 0, out: 3 } });
});
