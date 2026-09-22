import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const source = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
const methods = ['handleDrop', 'pickLibraryImport', 'storeMaterialInLibrary', 'finishLibraryImport'];
const code = ts.transpileModule(`class Handler { ${methods.map(name => widget.members.find(member => member.name?.getText(source) === name).getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Handler = new Function('URI', 'isOsFileDropInput', 'requestAnimationFrame', `${code}; return Handler;`)(URI, types => types.includes('Files') || types.includes('text/uri-list'), fn => fn());
function fixture() {
    const calls = [];
    const handler = new Handler();
    Object.assign(handler, { topView: 'catalog', update() { calls.push('update'); }, setDragActive() {},
        resolveDroppedFilePath: file => file.path, classifyDropped() { calls.push('classify-project'); return { accepted: [{ name: 'one.wav' }], rejectedCount: 0 }; },
        importDropped: value => calls.push(value), messages: { warn: value => calls.push(value), error: value => calls.push(value) } });
    return { handler, calls };
}
const event = (files, uriList = '') => ({ preventDefault() {}, stopPropagation() {}, dataTransfer: { files, types: ['Files'], getData: () => uriList } });
test('catalog ドロップは形式を判定せずフォルダ・cube・docx も plan へ。project は従来処理のみ', () => {
    const { handler, calls } = fixture();
    const paths = ['/input/folder', '/input/look.cube', '/input/doc.docx'];
    handler.handleDrop(event(paths.map(path => ({ path }))));
    assert.deepEqual(handler.libraryImportRequest.paths, paths);
    assert.deepEqual(calls, ['update']);
    handler.topView = 'materials'; calls.length = 0;
    handler.handleDrop(event(paths.map(path => ({ path }))));
    assert.deepEqual(calls, ['classify-project', [{ name: 'one.wav' }]]);
});
test('URI ドロップ、内部ドラッグの除外、元パス欠落の表示', () => {
    const { handler, calls } = fixture();
    handler.handleDrop(event([], '# comment\nfile:///input/space%20name\nhttps://example.com'));
    assert.deepEqual(handler.libraryImportRequest.paths, ['/input/space name']);
    handler.libraryImportRequest = undefined; calls.length = 0;
    const internal = event([]); internal.dataTransfer.types = ['application/x-akari-material'];
    handler.handleDrop(internal); assert.deepEqual(calls, []);
    handler.handleDrop(event([{ name: 'no-path' }]));
    assert.equal(handler.libraryImportRequest, undefined); assert.match(calls[0], /場所を読み取れません/);
});
test('ダイアログは macOS の両方と他 OS の 2 ボタンに対応、複数選択・キャンセル', async () => {
    const { handler } = fixture(); let options;
    handler.dialogs = { showOpenDialog: async value => { options = value; return [URI.fromFilePath('/one'), URI.fromFilePath('/two')]; } };
    for (const [mode, files, folders] of [['both', true, true], ['files', true, false], ['folders', false, true]]) {
        assert.deepEqual(await handler.pickLibraryImport(mode), ['/one', '/two']);
        assert.deepEqual([options.canSelectFiles, options.canSelectFolders, options.canSelectMany], [files, folders, true]);
    }
    handler.dialogs.showOpenDialog = async () => undefined;
    assert.deepEqual(await handler.pickLibraryImport('both'), []);
});
test('ライブラリに保管は単一ファイル plan/apply だけでプロジェクト操作なし', async () => {
    const { handler, calls } = fixture();
    const plan = { items: [{ path: '/project/assets/one.wav' }] };
    const result = { added: [], duplicates: [], rejected: [], failures: [] };
    handler.projectService = { planLibraryImport: async paths => { calls.push(paths); return plan; }, applyLibraryImport: async value => { assert.equal(value, plan); return result; } };
    handler.reportLibraryImportResult = value => assert.equal(value, result);
    handler.loadAssetCatalogView = async () => calls.push('reload-library');
    await handler.storeMaterialInLibrary({ uri: URI.fromFilePath('/project/assets/one.wav') });
    assert.deepEqual(calls, [['/project/assets/one.wav'], 'reload-library']);
    calls.length = 0;
    await handler.storeMaterialInLibrary({ reference: { id: 'one' } }); assert.deepEqual(calls, []);
});
test('取り込み後はフィルタを解除しホーム再読込→帯を表示', async () => {
    const { handler, calls } = fixture();
    Object.assign(handler, { libraryCategory: 'sfx', librarySourceFilter: 'lab', libraryFolderFilter: 'old', catalogQuery: 'old',
        reportLibraryImportResult() {}, loadAssetCatalogView: async () => calls.push('reload'),
        node: { querySelector: () => ({ scrollIntoView: () => calls.push('scroll') }) } });
    await handler.finishLibraryImport({});
    assert.deepEqual([handler.topView, handler.libraryCategory, handler.librarySourceFilter, handler.libraryFolderFilter, handler.catalogQuery, handler.catalogCategory], ['catalog', undefined, 'all', undefined, '', 'all']);
    assert.deepEqual(calls, ['reload', 'update', 'scroll']);
});
