import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/channel/akari-channel-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('channel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariChannelWidget');
const member = declaration.members.find(node => node.name?.getText(ast) === 'refreshStages');
const code = ts.transpileModule(`class Channel { ${member.getText(ast)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('札の読みの途中に届いた通知は一回へ畳む', async () => {
    const Channel = new Function(`${code}\nreturn Channel;`)();
    const widget = new Channel();
    widget.isVisible = true;
    widget.stageRefreshPending = new Set();
    widget.stageRefreshAll = false;
    let release;
    const firstRead = new Promise(resolve => { release = resolve; });
    const reads = [];
    widget.readStages = async keys => { reads.push([...keys]); if (reads.length === 1) await firstRead; };
    const first = widget.refreshStages(new Set(['main/one']));
    for (let index = 0; index < 20; index++) void widget.refreshStages(new Set(['main/one', 'main/two']));
    release();
    await first;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(reads, [['main/one'], ['main/one', 'main/two']]);
});
