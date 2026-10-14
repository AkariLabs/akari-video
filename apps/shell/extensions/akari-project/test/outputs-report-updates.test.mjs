import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import uriModule from '@theia/core/lib/common/uri.js';

const URI = uriModule.default ?? uriModule;
const source = readFileSync(new URL('../src/browser/akari-outputs-pane.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('outputs.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariOutputsPane');
const body = ['handleOutputsFileChange', 'reconcileOutputs']
    .map(name => declaration.members.find(node => node.name?.getText(ast) === name)?.getText(ast)).join('\n');
const code = ts.transpileModule(`class Pane { ${body} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
    const timers = new Set();
    const Pane = new Function('setTimeout', 'clearTimeout', 'isEditDataFileName', 'URI', `${code}\nreturn Pane;`)(
        callback => { const timer = { callback }; timers.add(timer); return timer; },
        timer => timers.delete(timer), name => name === 'edit.json', URI
    );
    const pane = new Pane();
    const root = new URI('file:///project');
    const report = root.resolve('.akari/reports/edit-lint-report.html');
    const edit = root.resolve('edit.json');
    const captions = root.resolve('captions.json');
    const known = [report, edit, captions];
    const present = new Map(known.map(uri => [uri.toString(), { resource: uri, mtime: 2, size: 10 }]));
    pane.outputs = known.map(uri => ({ uri, kind: uri === report ? 'report' : 'data', mtime: 1, size: 5 }));
    pane.outputsLoadedOnce = true;
    pane.changedOutputUris = new Set();
    let loads = 0;
    let updates = 0;
    const reads = [];
    pane.host = {
        workflow: { workspaceRoot: root },
        projectDataFiles: [{ name: 'edit.json' }, { name: 'captions.json' }],
        rootPlanFiles: [], rootReportFiles: [], update: () => { updates++; }
    };
    pane.collectTopLevelFiles = async folder => {
        reads.push(folder.toString());
        return [...present.values()].filter(file => file.resource.parent.toString() === folder.toString());
    };
    pane.collectPlanFiles = async () => { reads.push('planning'); return []; };
    pane.collectRootFilesNamed = async () => [];
    pane.buildOutputEntry = async (_root, file, kind) => ({ uri: file.resource, kind, mtime: file.mtime, size: file.size });
    pane.loadOutputs = async () => { loads++; };
    const watched = { exportsUri: root.resolve('exports'), reportsUri: root.resolve('.akari/reports'), planningUri: root.resolve('planning') };
    const event = (uri, type = 0) => ({ changes: [{ resource: uri, type }] });
    const drain = async () => {
        for (const timer of [...timers]) if (timers.delete(timer)) timer.callback();
        await new Promise(resolve => setImmediate(resolve));
    };
    return { pane, root, report, edit, captions, present, watched, event, drain, reads, timers,
        get loads() { return loads; }, get updates() { return updates; } };
}

test('字幕・edit・レポートの保存と rename は既存項目だけ更新する', async () => {
    const f = fixture();
    for (const uri of [f.captions, f.edit, f.report]) {
        f.pane.handleOutputsFileChange(f.root, f.watched, f.event(uri, 2));
        f.pane.handleOutputsFileChange(f.root, f.watched, f.event(uri, 1));
    }
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.root.resolve('captions.json.123.tmp'), 2));
    await f.drain();
    assert.equal(f.loads, 0);
    assert.equal(f.updates, 1);
    assert.ok(f.pane.outputs.every(entry => entry.mtime === 2));
    assert.deepEqual(f.reads.sort(), [f.root.toString(), f.watched.reportsUri.toString()].sort());
});

test('新しい成果物の名前が増えたときだけ全件を読む', async () => {
    const f = fixture();
    const added = f.watched.reportsUri.resolve('new-report.html');
    f.present.set(added.toString(), { resource: added, mtime: 2, size: 10 });
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(added, 1));
    await f.drain();
    await f.drain();
    assert.equal(f.loads, 1);
});

test('レポートが一時的に消えても復帰すれば全件を読まない', async () => {
    const f = fixture();
    f.present.delete(f.report.toString());
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.report, 2));
    await f.drain();
    f.present.set(f.report.toString(), { resource: f.report, mtime: 2, size: 10 });
    await f.drain();
    assert.equal(f.loads, 0);
});

test('名前の再確認中に別の通知が来てもタイマーを一つにまとめる', async () => {
    const f = fixture();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    const collect = f.pane.collectTopLevelFiles;
    let first = true;
    f.pane.collectTopLevelFiles = async folder => {
        if (first && folder.toString() === f.watched.reportsUri.toString()) {
            first = false;
            entered();
            await held;
        }
        return collect(folder);
    };
    f.present.delete(f.report.toString());
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.report, 2));
    await f.drain();
    await waiting;
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.report, 0));
    assert.equal(f.timers.size, 1);
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.timers.size, 1);
    await f.drain();
    assert.equal(f.loads, 1);
    assert.equal(f.timers.size, 0);
});
