import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

test('Escape は待機中だけ書き出しダイアログを閉じる', () => {
    const raw = readFileSync(new URL('../src/browser/export-dialog/akari-export-dialog.tsx', import.meta.url), 'utf8');
    assert.match(raw, /this\.node\.addEventListener\('keydown', this\.onEscapeKeyDown, true\)/);
    assert.match(raw, /event\.stopPropagation\(\);\s*this\.handleEscape\(event\)/);
    const source = ts.createSourceFile('akari-export-dialog.tsx', raw,
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const dialog = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariExportDialog');
    const method = dialog.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'handleEscape');
    assert.ok(method);
    const compiled = ts.transpileModule(`class Harness { ${method.getText(source)} } exports.Harness = Harness;`,
        { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    runInNewContext(compiled, { exports });
    for (const [phase, shouldClose] of [['setup', true], ['done', true], ['linting', false], ['rendering', false]]) {
        const harness = new exports.Harness();
        harness.session = { snapshot: { status: { phase } } };
        let closed = 0;
        harness.close = () => { closed++; };
        harness.handleEscape({ key: 'Escape' });
        assert.equal(closed, Number(shouldClose), phase);
    }
});
