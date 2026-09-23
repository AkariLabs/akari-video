import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('akari-review-panel-widget.ts', readFileSync(
    new URL('../src/browser/akari-review-panel-widget.ts', import.meta.url), 'utf8'
), ts.ScriptTarget.Latest, true);
const names = ['captureReviewScrollAnchor', 'restoreReviewScrollTop'];
const functions = names.map(name => {
    const declaration = source.statements.find(statement => ts.isFunctionDeclaration(statement)
        && statement.name?.text === name);
    assert.ok(declaration, name);
    return declaration.getText(source).replace(/^export /, '');
});
const code = ts.transpileModule(functions.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;
const [capture, restore] = new Function(`${code}\nreturn [${names.join(', ')}];`)();

function row(id, top, bottom = top + 60) {
    return { id, top, bottom };
}

test('表示先頭が残るときは画面上の位置を保つ', () => {
    const anchor = capture([row('a', 80), row('b', 140)], 100, 120);
    assert.deepEqual(anchor, { id: 'a', offset: -20, order: ['a', 'b'] });
    assert.equal(restore(anchor, [row('a', 80), row('b', 140)], 100, 120, 500), 120);
});

test('表示先頭が消えたときは旧順の次の項目を同じ位置に置く', () => {
    const anchor = capture([row('a', 80), row('b', 140), row('c', 200)], 100, 120);
    assert.equal(restore(anchor, [row('b', 140), row('c', 200)], 100, 120, 500), 180);
});

test('次の項目も無ければ旧順の前の項目を使う', () => {
    const anchor = capture([row('a', 20), row('b', 80)], 100, 120);
    assert.equal(restore(anchor, [row('a', 80)], 100, 120, 500), 120);
});

test('上に行が追加されても表示中の項目の位置を保つ', () => {
    const anchor = capture([row('a', 80), row('b', 140)], 100, 120);
    assert.equal(restore(anchor, [row('new', 80), row('a', 140), row('b', 200)], 100, 120, 500), 180);
});

test('末尾では最大 scrollTop にクランプする', () => {
    const anchor = capture([row('a', 80)], 100, 120);
    assert.equal(restore(anchor, [row('a', 380)], 100, 120, 200), 200);
});

test('先頭表示中は新しい行が来ても scrollTop 0 のまま', () => {
    const anchor = capture([row('a', 100)], 100, 0);
    assert.equal(anchor, undefined);
    assert.equal(restore(anchor, [row('new', 100), row('a', 160)], 100, 0, 500), 0);
});
