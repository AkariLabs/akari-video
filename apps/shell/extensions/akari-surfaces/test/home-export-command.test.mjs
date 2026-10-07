import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('akari-home-widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test('ホームの書き出し入口は共有コマンドを一度だけ呼ぶ', async () => {
    const imported = ast.statements.some(node => ts.isImportDeclaration(node)
        && node.moduleSpecifier.text === 'akari-shell-strip/lib/browser/akari-export-toolbar-contribution'
        && node.importClause?.namedBindings?.elements?.some(element => element.name.text === 'OPEN_EXPORT_DIALOG'));
    assert.equal(imported, true);
    const home = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariHomeWidget');
    const method = home?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'openExportDialog');
    assert.ok(method?.body);
    assert.doesNotMatch(method.getText(ast), /exportDialog\.open|prepareCurrentProject|fileService\.exists/);
    const code = ts.transpileModule(`class Home { ${method.getText(ast)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const Home = new Function('OPEN_EXPORT_DIALOG', `${code}\nreturn Home;`)({ id: 'akari.export.openDialog' });
    const calls = [];
    const instance = Object.assign(new Home(), {
        commands: { executeCommand: async id => { calls.push(id); } },
        exportDialog: { open: () => { throw new Error('直接開いてはいけない'); } }
    });
    await instance.openExportDialog();
    assert.deepEqual(calls, ['akari.export.openDialog']);
});
