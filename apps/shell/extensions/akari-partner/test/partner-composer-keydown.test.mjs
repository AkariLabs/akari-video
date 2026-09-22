import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.createSourceFile('partner.tsx', readFileSync(
    new URL('../src/browser/akari-partner-widget.tsx', import.meta.url), 'utf8'
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === 'onKeyDown') {
        assert.equal(handler, undefined);
        handler = node.initializer.expression;
    }
    ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handler);
const js = ts.transpileModule(handler.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText.trim().replace(/;$/, '');

function dispatch({ key = 'Enter', isComposing = false, keyCode = 13 } = {}) {
    let sends = 0;
    let prevented = 0;
    const widget = { submitComposer: () => { sends++; } };
    const onKeyDown = new Function(`return function () { return (${js}); };`)().call(widget);
    onKeyDown({ key, nativeEvent: { isComposing, keyCode }, preventDefault: () => { prevented++; } });
    return { sends, prevented };
}

test('IME 変換確定 Enter は送信せず、確定後の Enter は送信する', () => {
    assert.deepEqual(dispatch({ isComposing: true }), { sends: 0, prevented: 0 });
    assert.deepEqual(dispatch({ keyCode: 229 }), { sends: 0, prevented: 0 });
    assert.deepEqual(dispatch(), { sends: 1, prevented: 1 });
    assert.deepEqual(dispatch({ key: 'a' }), { sends: 0, prevented: 0 });
});
