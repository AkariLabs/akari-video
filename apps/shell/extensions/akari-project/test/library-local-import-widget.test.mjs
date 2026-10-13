import './support/i18n-ja.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { findMember } from './helpers/role-buckets-source.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const projectJa = require('../../../../../packages/i18n/locales/ja/project.json');
const URI = require('@theia/core/lib/common/uri').default;
const methods = ['handleDrop', 'pickLibraryImport', 'refreshLibraryFonts', 'finishLibraryImport', 'reportLibraryImportResult',
    // 検索欄は非制御なので、絞り込みを触る処理は必ず入力欄へ書き戻す（IME のため）。
    'syncSearchInput'];
const code = ts.transpileModule(`class Handler { ${methods.map(name => findMember(name, { in: 'widget' }).text).join('\n')}\n${findMember('storeMaterialInLibrary', { in: 'materials' }).text} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const createHandler = (window, CustomEvent) => new Function('URI', 'isOsFileDropInput', 'requestAnimationFrame',
    'window', 'CustomEvent', `${code}; return Handler;`)(URI,
    types => types.includes('Files') || types.includes('text/uri-list'), fn => fn(), window, CustomEvent);
const Handler = createHandler();
const sheetSource = ts.createSourceFile('sheet.tsx', readFileSync(new URL('../src/browser/library-import-sheet.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const sheetHelpers = ['libraryImportReadinessText', 'focusLibraryImportSheet'].map(name => sheetSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(sheetSource)).join('\n');
const { libraryImportReadinessText, focusLibraryImportSheet } = new Function(`${ts.transpileModule(sheetHelpers.replace(/^export /gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText}; return { libraryImportReadinessText, focusLibraryImportSheet };`)();
function fixture(HandlerClass = Handler) {
    const calls = [];
    const handler = new HandlerClass();
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
    handler.host = {};
    handler.host.projectService = { planLibraryImport: async paths => { calls.push(paths); return plan; }, applyLibraryImport: async value => { assert.equal(value, plan); return result; } };
    handler.host.reportLibraryImportResult = value => assert.equal(value, result);
    handler.host.loadAssetCatalogView = async () => calls.push('reload-library');
    await handler.storeMaterialInLibrary({ uri: URI.fromFilePath('/project/assets/one.wav') });
    assert.deepEqual(calls, [['/project/assets/one.wav'], 'reload-library']);
    calls.length = 0;
    await handler.storeMaterialInLibrary({ reference: { id: 'one' } }); assert.deepEqual(calls, []);
});
test('取り込み後はフィルタを解除しホーム再読込→帯を表示', async () => {
    const { handler, calls } = fixture();
    Object.assign(handler, { libraryCategory: 'sfx', librarySourceFilter: 'lab', libraryFolderFilter: 'old', catalogQuery: 'old',
        assetCatalogItems: [], reportLibraryImportResult() {}, loadAssetCatalogView: async () => calls.push('reload'),
        node: { querySelector: () => ({ scrollIntoView: () => calls.push('scroll') }) } });
    await handler.finishLibraryImport({ added: [], duplicates: [], rejected: [], failures: [] });
    assert.deepEqual([handler.topView, handler.libraryCategory, handler.librarySourceFilter, handler.libraryFolderFilter, handler.catalogQuery, handler.catalogCategory], ['catalog', undefined, 'all', undefined, '', 'all']);
    assert.deepEqual(calls, ['reload', 'update', 'scroll']);
});
test('シートを開く focus はスクロール容器の scrollTop を変えない', () => {
    const container = { clientHeight: 190, scrollHeight: 720, scrollTop: 137 };
    const dialog = { focus(options) { if (!options?.preventScroll) container.scrollTop = 561; } };
    focusLibraryImportSheet(dialog);
    assert.equal(container.scrollTop, 137);
    const sheet = readFileSync(new URL('../src/browser/library-import-sheet.tsx', import.meta.url), 'utf8');
    assert.match(sheet, /return createPortal\(<div className='akari-library-import'/);
    assert.match(sheet, /focusLibraryImportSheet\(dialog\.current\)/);
    assert.match(sheet, /<\/div>, props\.overlayHost\);/);
});
test('シート先頭行は rejected 0 件と 2 件の両方で確認済みを表示', () => {
    assert.equal(libraryImportReadinessText(0), '✓ 全部読み込めることを確認しました');
    assert.equal(libraryImportReadinessText(2), '✓ 全部読み込めることを確認しました（取り込まない 2 件）');
});
test('完了トーストは件数だけ、rejected・プレースホルダ警告を繰り返さず失敗だけ通知', () => {
    const { handler } = fixture();
    const info = [], warn = [];
    handler.messages = { info: value => info.push(value), warn: value => warn.push(value) };
    handler.reportLibraryImportResult({ added: [{ warnings: ['サムネイルはプレースホルダです'] }],
        duplicates: [{ title: '既存' }], rejected: [{ path: '/bad.docx', reason: '対象外' }],
        failures: [{ path: '/broken.wav', reason: '読み取れません' }] });
    assert.deepEqual(info, ['1 件を取り込みました']);
    assert.deepEqual(warn, ['/broken.wav: 読み取れません']);
});

test('フォントを含む取り込みは件数と場所を一度だけ通知し、それ以外は件数を通知する', () => {
    const { handler } = fixture();
    const info = [], warn = [];
    handler.messages = { info: value => info.push(value), warn: value => warn.push(value) };
    handler.reportLibraryImportResult({ added: [{ category: 'font', id: 'my-font' }, { category: 'audio', id: 'music' }],
        failures: [{ path: '/broken.wav', reason: '読み取れません' }] });
    assert.deepEqual(info, ['2 件を取り込みました。フォントは「テキスト › フォント」にあります']);
    assert.deepEqual(warn, ['/broken.wav: 読み取れません']);
    info.length = 0;
    handler.reportLibraryImportResult({ added: [{ category: 'audio', id: 'music' }], failures: [] });
    assert.deepEqual(info, ['1 件を取り込みました']);
});

test('フォント取り込み後はプレビューを読み直し、テキストのフォント行へ移動する', async () => {
    const events = [];
    const window = { dispatchEvent: event => events.push(event.type) };
    class CustomEvent { constructor(type) { this.type = type; } }
    const { handler, calls } = fixture(createHandler(window, CustomEvent));
    const editUri = 'file:///project/edit.json';
    const imported = { category: 'font', id: 'my-font', key: 'font/my-font', libraryDir: '/library/font/my-font' };
    Object.assign(handler, {
        workflow: { workspaceRoot: { resolve: value => {
            assert.equal(value, 'edit.json');
            return { normalizePath: () => ({ toString: () => editUri }) };
        } } },
        commandService: { executeCommand: async (...args) => calls.push(args) },
        ensureLibraryStyleFonts: () => calls.push('style-fonts'),
        libraryStyleFontsRequested: true,
        assetCatalogItems: [],
        reportLibraryImportResult: () => calls.push('report'),
        loadAssetCatalogView: async () => { handler.assetCatalogItems = [imported]; calls.push('reload'); },
        focusAssetCard: async (...args) => calls.push(['focus', ...args]),
        node: { querySelector: selector => { calls.push(['query', selector]); return undefined; } }
    });
    await handler.finishLibraryImport({ added: [imported], duplicates: [], rejected: [], failures: [] });
    assert.deepEqual(calls, ['report', ['akari.preview.refreshFontAssets', { editUri }], 'style-fonts',
        'reload', 'update', ['focus', 'catalog', imported.key, false]]);
    assert.deepEqual(events, ['akari.library.fontsChanged']);
    assert.equal(handler.libraryStyleFontsRequested, false);
    assert.equal(handler.libraryTextLookOpen, true);
    assert.equal(handler.libraryTextTab, 'font');
    assert.ok(!calls.some(call => Array.isArray(call) && call[1] === '[data-recent-strip]'));
});

const jsxAttributes = node => new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attribute =>
    [attribute.name.text, attribute.initializer && ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : attribute.initializer?.getText(sheetSource)]));
const descendants = (node, predicate) => {
    const matches = [];
    const visit = current => { if (predicate(current)) matches.push(current); ts.forEachChild(current, visit); };
    visit(node);
    return matches;
};
test('追加メニューは 5 行の名前と説明を持つ', () => {
    const source = sheetSource.getFullText();
    const menu = source.slice(source.indexOf("role='menu'"), source.indexOf("{checkOpen &&"));
    assert.equal(globalThis.t('project.library.importSheet.addLibraryAction'), 'ライブラリに追加');
    assert.equal((menu.match(/role='menuitem'/g) ?? []).length, 5);
    for (const label of ['ローカルから取り込む', '素材サイトでさがす', 'URL を貼って入れる', '素材の置き場を変える…', 'ライブラリを点検',
        'この Mac のファイルやフォルダ', 'このパソコンのファイルやフォルダ', 'Lab と、無料で使える配布サイト', '配布ページの URL から取り込む']) {
        const keys = Object.keys(projectJa).filter(key => projectJa[key] === label);
        assert.ok(keys.some(key => menu.includes(`t('${key}')`)), label);
        assert.ok(keys.some(key => globalThis.t(key) === label), label);
    }
    assert.match(menu, /akari-import-soon'>\{t\('project\.library\.importSheet\.comingLaterLabel'\)\}/);
    assert.equal(globalThis.t('project.library.importSheet.comingLaterLabel'), '今後');
});
test('各シートの主ボタンは 1 つ以下で、タブは選択状態を持つ', () => {
    for (const marker of ['data-akari-local-import-sheet', 'data-akari-site-sheet', 'data-akari-library-check-sheet']) {
        const sheet = descendants(sheetSource, node => ts.isJsxElement(node) && jsxAttributes(node.openingElement).has(marker))[0];
        assert.ok(sheet, marker);
        const buttons = descendants(sheet, node => ts.isJsxOpeningElement(node) && node.tagName.getText(sheetSource) === 'button');
        assert.ok(buttons.length > 0, marker);
        const primary = buttons.filter(node => {
            const classes = jsxAttributes(node).get('className')?.split(/\s+/) ?? [];
            assert.ok(classes.includes('theia-button'), node.getText(sheetSource));
            return !classes.some(value => ['secondary', 'quiet', 'danger'].includes(value));
        });
        assert.ok(primary.length <= 1, `${marker}: ${primary.length} 主ボタン`);
    }
    const tablist = descendants(sheetSource, node => ts.isJsxElement(node) && jsxAttributes(node.openingElement).get('role') === 'tablist')[0];
    assert.ok(tablist);
    assert.ok(jsxAttributes(tablist.openingElement).get('className')?.split(/\s+/).includes('akari-seg'));
    const tab = descendants(tablist, node => ts.isJsxOpeningElement(node) && jsxAttributes(node).get('role') === 'tab')[0];
    assert.ok(tab && jsxAttributes(tab).has('aria-selected'));
});
