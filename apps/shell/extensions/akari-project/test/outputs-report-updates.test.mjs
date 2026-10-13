import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import uriModule from '@theia/core/lib/common/uri.js';
import { createRequire } from 'node:module';

const URI = uriModule.default ?? uriModule;
const require = createRequire(import.meta.url);
const { isEditDataFileName } = require('../lib/common/edit-data-file.js');
const source = readFileSync(new URL('../src/browser/akari-outputs-pane.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('outputs.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariOutputsPane');
const methods = ['handleOutputsFileChange', 'scheduleOutputsReload', 'reconcileOutputNames', 'refreshOutputMetadata'];
const body = methods.map(name => declaration.members.find(node => node.name?.getText(ast) === name)?.getText(ast)).join('\n');
const code = ts.transpileModule(`class Pane { ${body} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const FileChangeType = { UPDATED: 0, ADDED: 1, DELETED: 2 };

function fixture() {
    const timers = new Set();
    const schedule = callback => { const timer = { callback }; timers.add(timer); return timer; };
    const cancel = timer => timers.delete(timer);
    const Pane = new Function('setTimeout', 'clearTimeout', 'FileChangeType', 'orderDataEntries', 'isEditDataFileName',
        `${code}\nreturn Pane;`)(schedule, cancel, FileChangeType, entries => entries, isEditDataFileName);
    const pane = new Pane();
    const root = new URI('file:///project');
    const reportsUri = root.resolve('.akari/reports');
    const exportsUri = root.resolve('exports');
    const planningUri = root.resolve('planning');
    const reportUri = reportsUri.resolve('edit-lint-report.html');
    const editUri = root.resolve('edit.json');
    const captionsUri = root.resolve('captions.json');
    const entries = [
        { uri: reportUri, name: 'edit-lint-report.html', kind: 'report', mtime: 1, size: 5, title: '旧題' },
        { uri: editUri, name: 'edit.json', kind: 'data', mtime: 1, size: 5 },
        { uri: captionsUri, name: 'captions.json', kind: 'data', mtime: 1, size: 5 }
    ];
    const present = new Map(entries.map(entry => [entry.uri.toString(), entry.uri]));
    pane.outputs = entries;
    pane.pendingMetadataUris = new Set();
    pane.pendingNameCheckFolders = new Set();
    pane.missingNameChecks = new Map();
    let loads = 0, resolves = 0, titles = 0, updates = 0;
    pane.host = { workflow: { workspaceRoot: root }, projectDataFiles: [{ name: 'edit.json' }, { name: 'captions.json' }],
        rootPlanFiles: [], rootReportFiles: [], update: () => { updates++; },
        files: { resolve: async folder => {
            resolves++;
            const children = [...present.values()].filter(uri => uri.parent.toString() === folder.toString())
                .map(uri => ({ resource: uri, mtime: 2, size: 10 }));
            return { children };
        } } };
    pane.collectTopLevelFiles = async folder => (await pane.host.files.resolve(folder)).children;
    pane.readReportTitle = async () => { titles++; return '新題'; };
    pane.readMarkdownTitle = async () => undefined;
    pane.loadOutputs = async () => { loads++; };
    const watched = { exportsUri, reportsUri, planningUri };
    const event = (uri, type) => ({ changes: [{ resource: uri, type }] });
    const drain = async () => {
        for (const timer of [...timers]) {
            if (!timers.delete(timer)) continue;
            timer.callback();
        }
        await new Promise(resolve => setImmediate(resolve));
    };
    return { pane, root, watched, reportUri, editUri, captionsUri, present, event, drain,
        get loads() { return loads; }, get resolves() { return resolves; },
        get titles() { return titles; }, get updates() { return updates; } };
}

test('既存レポートの書き直しは題・日時・サイズだけ更新し、全一覧を読まない', async () => {
    const f = fixture();
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.reportUri, FileChangeType.UPDATED));
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.reportUri, FileChangeType.UPDATED));
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.watched.reportsUri, FileChangeType.UPDATED));
    await f.drain();
    assert.equal(f.loads, 0);
    assert.equal(f.resolves, 1);
    assert.equal(f.titles, 1);
    assert.equal(f.updates, 1);
    assert.equal(f.pane.outputs[0].title, '新題');
});

test('字幕と edit の内容更新はまとめて一回の metadata 解決だけを行う', async () => {
    const f = fixture();
    f.pane.handleOutputsFileChange(f.root, f.watched, { changes: [
        { resource: f.editUri, type: FileChangeType.UPDATED },
        { resource: f.captionsUri, type: FileChangeType.UPDATED }
    ] });
    await f.drain();
    assert.equal(f.loads, 0);
    assert.equal(f.resolves, 1);
    assert.equal(f.titles, 0);
});

test('既存レポートの DELETED → ADDED は名前が同じなら全一覧を読まない', async () => {
    const f = fixture();
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.reportUri, FileChangeType.DELETED));
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.reportUri, FileChangeType.ADDED));
    await f.drain();
    assert.equal(f.loads, 0);
    assert.equal(f.resolves, 1);
    assert.equal(f.titles, 1);
});

test('edit と字幕の rename 通知も名前が同じなら全一覧を読まない', async () => {
    const f = fixture();
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.editUri, FileChangeType.DELETED));
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.editUri, FileChangeType.ADDED));
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.captionsUri, FileChangeType.DELETED));
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.captionsUri, FileChangeType.ADDED));
    await f.drain();
    assert.equal(f.loads, 0);
    assert.equal(f.resolves, 1);
});

test('新しいレポート名が増えたら全一覧を読む', async () => {
    const f = fixture();
    const added = f.watched.reportsUri.resolve('new-report.html');
    f.present.set(added.toString(), added);
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(added, FileChangeType.ADDED));
    await f.drain();
    await f.drain();
    assert.equal(f.loads, 1);
});

test('レポート名が消えたら全一覧を読む', async () => {
    const f = fixture();
    f.present.delete(f.reportUri.toString());
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.reportUri, FileChangeType.DELETED));
    await f.drain();
    await f.drain();
    assert.equal(f.loads, 1);
});

test('字幕の原子的な保存と lint レポート更新で全一覧を読まない', async () => {
    const f = fixture();
    const tmp = f.root.resolve('captions.json.123.tmp');
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.captionsUri, FileChangeType.ADDED));
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(tmp, FileChangeType.DELETED));
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.reportUri, FileChangeType.UPDATED));
    await f.drain();
    assert.equal(f.loads, 0);
    assert.equal(f.titles, 1);
});

test('レポートの一時的な消失は再確認後に戻れば全一覧を読まない', async () => {
    const f = fixture();
    f.present.delete(f.reportUri.toString());
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.reportUri, FileChangeType.DELETED));
    await f.drain();
    f.present.set(f.reportUri.toString(), f.reportUri);
    await f.drain();
    assert.equal(f.loads, 0);
});

test('名前確認と別フォルダの日時更新が重なっても全一覧を読まない', async () => {
    const f = fixture();
    const exportUri = f.watched.exportsUri.resolve('final.mp4');
    f.present.set(exportUri.toString(), exportUri);
    f.pane.outputs.push({ uri: exportUri, name: 'final.mp4', kind: 'export', mtime: 1, size: 5 });
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.captionsUri, FileChangeType.ADDED));
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(exportUri, FileChangeType.UPDATED));
    await f.drain();
    assert.equal(f.loads, 0);
    assert.equal(f.pane.outputs.find(entry => entry.uri.toString() === exportUri.toString()).mtime, 2);
});

test('本当の書き出し追加は同時の名前確認があっても一覧へ反映する', async () => {
    const f = fixture();
    const exportUri = f.watched.exportsUri.resolve('final.mp4');
    f.present.set(exportUri.toString(), exportUri);
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(exportUri, FileChangeType.ADDED));
    f.pane.handleOutputsFileChange(f.root, f.watched, f.event(f.captionsUri, FileChangeType.ADDED));
    await f.drain();
    assert.equal(f.loads, 1);
});
