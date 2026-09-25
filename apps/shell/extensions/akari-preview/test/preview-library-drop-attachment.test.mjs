import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const sourceText = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('handler.ts', sourceText, ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariPreviewOpenHandler');
const method = declaration.members.find(member => member.name?.getText(source) === 'configurePreview');
const code = ts.transpileModule(`class Handler { ${method.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;

test('共通構成経路は出力 widget にだけ一度取り付け、再構成で増やさない', async () => {
    let created = 0;
    class Drop { constructor(widget) { this.widget = widget; created++; } }
    const Handler = new Function('PreviewLibraryDrop', `${code}\nreturn Handler;`)(Drop);
    const handler = Object.assign(new Handler(), {
        commandService: {}, messages: {}, fullscreenPreviewWidget: undefined,
        doConfigurePreview: async () => {}
    });
    const output = {};
    await handler.configurePreview(output, {}, 'output');
    await handler.configurePreview(output, {}, 'output');
    assert.equal(created, 1);
    assert.equal(output.akariLibraryDrop.widget, output);
    await handler.configurePreview({}, {}, 'raw');
    assert.equal(created, 1);
});

test('復元と通常オープンの両方が共通構成経路を呼ぶ', () => {
    const created = sourceText.slice(sourceText.indexOf('this.widgetManager.onDidCreateWidget('),
        sourceText.indexOf('async openOutput('));
    const opening = sourceText.slice(sourceText.indexOf('protected async getOrOpenPreview('),
        sourceText.indexOf('protected async configurePreview('));
    assert.match(created, /this\.configurePreview\(event\.widget, identityUri, kind/);
    assert.match(opening, /this\.configurePreview\(widget, uri, kind/);
});
