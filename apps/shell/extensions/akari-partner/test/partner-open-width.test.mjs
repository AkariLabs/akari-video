import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const text = readFileSync(new URL('../src/browser/akari-partner-command-contribution.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('commands.ts', text, ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'partnerPanelWidth');
const code = ts.transpileModule(declaration.getText(source).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const partnerPanelWidth = new Function(`${code}\nreturn partnerPanelWidth;`)();

test('閉じた右パネルは画面幅の 36% にする', () => {
    assert.equal(partnerPanelWidth(1000, undefined), 360);
});

test('40% を超える右パネルだけ縮める', () => {
    assert.equal(partnerPanelWidth(1000, 401), 360);
    assert.equal(partnerPanelWidth(1000, 400), undefined);
});

test('右パネルの指定幅は 400px を上限にする', () => {
    assert.equal(partnerPanelWidth(1280, undefined), 400);
});
