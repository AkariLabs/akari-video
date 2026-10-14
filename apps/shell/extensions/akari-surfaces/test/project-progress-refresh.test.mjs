import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import uriModule from '@theia/core/lib/common/uri.js';

const URI = uriModule.default ?? uriModule;
const source = readFileSync(new URL('../src/browser/home/project-progress.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('progress.ts', source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ProjectProgressService');
const body = ['scheduleRefresh', 'refreshEdit'].map(name => declaration.members.find(node => node.name?.getText(ast) === name)?.getText(ast)).join('\n');
const code = ts.transpileModule(`class Progress { ${body} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('保存通知の連続を一回にまとめ、edit.json だけを読む', async () => {
    const timers = new Set();
    const Progress = new Function('setTimeout', 'clearTimeout', `${code}\nreturn Progress;`)(
        callback => { timers.add(callback); return callback; }, timer => timers.delete(timer));
    const service = new Progress();
    service._root = new URI('file:///project');
    service._presence = { planningDocs: 1, assetFiles: 1, editHasContent: false, reportFiles: 0, exportFiles: 0 };
    let editReads = 0, fullReads = 0;
    service.readEditHasContent = async () => { editReads++; return true; };
    service.refresh = async () => { fullReads++; };
    service.update = value => { service._presence = value; };
    for (let index = 0; index < 20; index++) {
        service.pendingEdit = true;
        service.scheduleRefresh();
    }
    assert.equal(timers.size, 1);
    const callback = [...timers][0];
    timers.delete(callback);
    callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(editReads, 1);
    assert.equal(fullReads, 0);
    assert.equal(service._presence.editHasContent, true);
});
