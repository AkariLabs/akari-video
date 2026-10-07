import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.createSourceFile('partner-extension-updater.ts', readFileSync(new URL('../src/browser/partner-extension-updater.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'PartnerExtensionUpdater');
const methods = ['checkAvailability', 'runStartupCheck'].map(name =>
    owner.members.find(node => node.name?.getText(source) === name).getText(source));
const compiled = ts.transpileModule(`class Updater { ${methods.join('\n')} }\nUpdater`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const catalog = [{ form: 'extension', extensionId: 'example.extension', name: 'Claude Code' }];
const Updater = vm.runInContext(compiled, vm.createContext({
    PARTNER_CATALOG: catalog,
    decideExtensionUpdate: ({ installedVersion, latestVersion }) => ({
        action: installedVersion === latestVersion ? 'none' : 'update',
        reason: installedVersion === latestVersion ? 'up-to-date' : 'newer-available'
    }),
    formatExtensionUpdateNotice: (name, installed, latest) => `${name}: ${installed} → ${latest}`,
    console
}));

function updater(choice = '後で') {
    const calls = [];
    let commandResult = false;
    const subject = new Updater();
    subject.commands = { executeCommand: async id => {
        assert.equal(id, 'akari.update.isAutoCheckEnabled');
        return commandResult;
    } };
    subject.extensionsModel = { resolve: async () => ({ installed: true, installedVersion: '1.0.0' }) };
    subject.vsxRegistryService = { findLatestCompatibleExtension: async ({ extensionId }) => ({
        version: extensionId === 'example.extension' ? '2.1.293' : '3.0.0'
    }) };
    subject.applicationServer = { getApplicationPlatform: async () => 'darwin-arm64' };
    subject.pluginServer = { install: () => { calls.push('install'); } };
    subject.checkAndUpdate = async () => { calls.push('update'); return { kind: 'updated', detail: '更新しました' }; };
    subject.messageService = { info: async (...args) => { calls.push(args); return choice; } };
    subject.windowService = { reload: () => calls.push('reload') };
    return { subject, calls, enable: () => { commandResult = true; } };
}

test('Open VSX automatic check obeys persisted autoCheck', async () => {
    const { subject, calls, enable } = updater();
    await subject.runStartupCheck();
    assert.equal(calls.length, 0);
    subject.commands.executeCommand = async () => undefined;
    await subject.runStartupCheck();
    assert.equal(calls.length, 0);
    subject.commands.executeCommand = async () => { throw new Error('command missing'); };
    await subject.runStartupCheck();
    assert.equal(calls.length, 0);
    subject.commands.executeCommand = async () => true;
    enable();
    await subject.runStartupCheck();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'Claude Code の新しい版 2.1.293 があります');
    assert.equal(calls[0][1], '今すぐ更新');
    assert.equal(calls.includes('install'), false);
    assert.equal(calls.includes('update'), false);
});

test('startup lists each available extension and version on its own line', async () => {
    catalog.push({ form: 'extension', extensionId: 'second.extension', name: 'Pi' });
    try {
        const { subject, calls, enable } = updater();
        enable();
        await subject.runStartupCheck();
        assert.equal(calls[0][0], 'Claude Code の新しい版 2.1.293 があります\nPi の新しい版 3.0.0 があります');
        assert.equal(calls.includes('install'), false);
    } finally {
        catalog.pop();
    }
});

test('startup offers update, then keeps reload confirmation after user chooses it', async () => {
    const { subject, calls, enable } = updater('今すぐ更新');
    enable();
    let messages = 0;
    subject.messageService.info = async (...args) => {
        calls.push(args);
        return ++messages === 1 ? '今すぐ更新' : '今すぐ再読み込み';
    };
    await subject.runStartupCheck();
    assert.equal(calls[0][1], '今すぐ更新');
    assert.equal(calls[1], 'update');
    assert.equal(calls[2][1], '今すぐ再読み込み');
    assert.equal(calls[3], 'reload');
});
