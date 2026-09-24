import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/browser/akari-project-contribution.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('akari-project-contribution.ts', source, ts.ScriptTarget.Latest, true);
const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariProjectContribution');
const registerCommands = cls.members.find(node => node.name?.getText(ast) === 'registerCommands').getText(ast);
const compiled = ts.transpileModule(`class Contribution { ${registerCommands} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const names = ['LIST_MY_STYLES_COMMAND_ID', 'NEW_AKARI_PROJECT', 'SHOW_AKARI_CHANGES',
    'TOGGLE_AKARI_DEVELOPER_MODE', 'DISCONNECT_AKARI_STORE_ACCOUNT',
    'AKARI_REVEAL_IN_FILE_MANAGER', 'AKARI_REVEAL_PROJECT_ROOT', 'AKARI_SHOW_ASSET_INFO'];
const Contribution = new Function(...names, `${compiled}; return Contribution;`)(
    'akari.library.listMyStyles', ...names.slice(1).map(id => ({ id })));

test('内部コマンドは引数なしで棚の最小形だけを返す', async () => {
    const contribution = new Contribution();
    let calls = 0;
    contribution.projectService = { listMyStyles: async (...args) => {
        assert.deepEqual(args, []);
        calls++;
        return [{ id: 'favorite', name: 'お気に入り', uid: 'private-uid',
            parts: [{ kind: 'look', text_style: { color: '#ff0000' }, scope: 'caption' },
                { kind: 'motion', scope: 'caption' }] }];
    } };
    const handlers = new Map();
    contribution.registerCommands({ registerCommand: (command, handler) => handlers.set(command.id, { command, handler }) });
    const { command, handler } = handlers.get('akari.library.listMyStyles');
    assert.deepEqual(command, { id: 'akari.library.listMyStyles' });
    assert.deepEqual(await handler.execute(), [{ id: 'favorite', name: 'お気に入り', parts: [
        { kind: 'look', text_style: { color: '#ff0000' } }, { kind: 'motion' }
    ] }]);
    assert.equal(calls, 1);
});
