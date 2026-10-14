import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = ts.createSourceFile('chat.ts', readFileSync(new URL('../src/browser/akari-chat-contribution.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariChatContribution');
const methods = owner.members.filter(node => ['show', 'registerCommands'].includes(node.name?.getText(source)))
    .map(node => node.getText(source)).join('\n');
const compiled = ts.transpileModule(`class Contribution { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const Contribution = new Function('ChatCommands', 'AkariChatWidget', `${compiled}\nreturn Contribution;`)(
    { OPEN: { id: 'open' }, PREFILL: { id: 'prefill' }, ATTACH: { id: 'attach' } }, { ID: 'chat-widget' });

test('添付とコマンド完了はチャットの活性化待ちに阻まれない', async () => {
    const calls = [];
    const widget = { id: 'chat-widget', isAttached: false, attach: attachments => calls.push(['attach', attachments]) };
    const contribution = Object.create(Contribution.prototype);
    contribution.allowed = () => true;
    contribution.widgets = { getOrCreateWidget: async () => widget };
    contribution.shell = {
        addWidget: async () => { calls.push('add'); widget.isAttached = true; },
        activateWidget: () => { calls.push('activate'); return new Promise(() => {}); }
    };
    let execute;
    contribution.registerCommands({ registerCommand(command, handler) {
        if (command.id === 'attach') execute = handler.execute;
    } });
    const attachments = [{ kind: 'review' }];
    const result = await Promise.race([
        execute({ attachments }).then(() => 'done'),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 50))
    ]);
    assert.equal(result, 'done');
    assert.deepEqual(calls, ['add', ['attach', attachments], 'activate']);
});
