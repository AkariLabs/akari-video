import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('service.ts',
    readFileSync(new URL('../src/node/akari-project-service.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const service = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariProjectServiceImpl');
const method = service.members.find(member => member.name?.getText(source) === 'runResolverScript');
const code = ts.transpileModule('class Harness { ' + method.getText(source) + ' }',
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
let killed = 0;
const spawn = () => {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = () => {};
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { killed++; return true; };
    return child;
};
const Harness = new Function('spawn', 'process', code + '\nreturn Harness;')(spawn, process);

test('取り寄せ子プロセスが止まれば上限で打ち切り理由を返す', async () => {
    const result = await new Harness().runResolverScript('pending', undefined, 20);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /時間切れ/);
    assert.equal(killed, 1);
});
