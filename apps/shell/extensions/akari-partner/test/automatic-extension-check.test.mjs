import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('partner-extension-updater.ts', readFileSync(new URL('../src/browser/partner-extension-updater.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'PartnerExtensionUpdater');
const method = owner.members.find(node => node.name?.getText(source) === 'runStartupCheck');
const compiled = ts.transpileModule(`class Updater { ${method.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const runStartupCheck = new Function('PARTNER_CATALOG', `${compiled}\nreturn Updater.prototype.runStartupCheck;`)([
    { form: 'extension', extensionId: 'example.extension', name: 'Example' }
]);

test('Open VSX automatic check obeys persisted autoCheck', async () => {
    const calls = [];
    let commandResult = false;
    const updater = {
        commands: { executeCommand: async id => {
            assert.equal(id, 'akari.update.isAutoCheckEnabled');
            return commandResult;
        } },
        checkAndUpdate: async () => { calls.push('Open VSX'); return { kind: 'up-to-date' }; }
    };
    await runStartupCheck.call(updater);
    assert.equal(calls.length, 0);
    commandResult = undefined;
    await runStartupCheck.call(updater);
    assert.equal(calls.length, 0);
    updater.commands.executeCommand = async () => { throw new Error('command missing'); };
    await runStartupCheck.call(updater);
    assert.equal(calls.length, 0);
    updater.commands.executeCommand = async () => true;
    await runStartupCheck.call(updater);
    assert.deepEqual(calls, ['Open VSX']);
});
