import { after as afterI18n } from 'node:test';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18n(() => setLanguage(undefined));
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { resolvePromptRoute } from '../lib/common/prompt-route.js';

const text = readFileSync(new URL('../src/browser/akari-partner-command-contribution.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('commands.ts', text, ts.ScriptTarget.Latest, true);
const contribution = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariPartnerCommandContribution');
const register = contribution.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'registerCommands');
const registration = register.body.statements.find(node => ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === 'registry.registerCommand' &&
    node.expression.arguments[0]?.getText(source) === 'AkariPartnerCommands.OPEN');
const injectRegistration = register.body.statements.find(node => ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === 'registry.registerCommand' &&
    node.expression.arguments[0]?.getText(source) === 'AkariPartnerCommands.INJECT_PROMPT');

test('パートナーを開くコマンドを登録する', () => {
    assert.match(text, /OPEN\s*:\s*\{\s*id:\s*'akari\.partner\.open'/);
    assert.ok(registration);
});

function openHandler(context) {
    const handler = registration.expression.arguments[1];
    const execute = handler.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(source) === 'execute');
    const code = ts.transpileModule(`const execute = ${execute.initializer.getText(source)};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    return new Function('AkariPartnerWidget', 'PartnerWebWidget', `${code}\nreturn execute;`)
        .call(context, { ID: 'akari-partner-onboarding' }, { ID: 'akari-partner-web' });
}

test('生きた端末、Web、onboarding の順に表示する', async () => {
    for (const target of ['terminal', 'web', 'onboarding']) {
        const calls = [];
        const context = {
            liveTerminal: () => target === 'terminal' ? { id: 'terminal-1' } : undefined,
            widgetManager: {
                getWidget: async () => target === 'web' ? { id: 'akari-partner-web', isRunning: () => true } : undefined,
                getOrCreateWidget: async () => ({ id: 'akari-partner-onboarding', isAttached: true })
            },
            shell: {
                revealWidget: async id => calls.push(['reveal', id]),
                activateWidget: async id => calls.push(['activate', id])
            }
        };
        await openHandler(context)();
        assert.deepEqual(calls, [target === 'onboarding'
            ? ['activate', 'akari-partner-onboarding']
            : ['reveal', target === 'web' ? 'akari-partner-web' : 'terminal-1']]);
    }
});

function injectHandler(context, registry) {
    const handler = injectRegistration.expression.arguments[1];
    const execute = handler.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(source) === 'execute');
    const code = ts.transpileModule(`const execute = ${execute.initializer.getText(source)};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    return new Function('AkariPartnerWidget', 'PartnerWebWidget', 'resolvePromptRoute', 'PARTNER_CATALOG',
        'AkariPartnerCommands', 'registry', 't', `${code}\nreturn execute;`).call(context,
        { ID: 'partner' }, { ID: 'web' }, resolvePromptRoute,
        [{ form: 'extension', agent: 'test-agent', name: 'Test Partner' }],
        { OPEN: { id: 'partner.open' } }, registry, key => key);
}

function injectContext(overrides = {}) {
    const calls = [];
    const widget = { hasDeliveryChannel: false, reattachDeliveryTerminal: () => false, sendFromExternal: () => false };
    const context = {
        widgetManager: { getOrCreateWidget: async () => widget, getWidget: async () => undefined },
        liveTerminal: () => undefined,
        extensionTarget: () => undefined,
        clipboard: { writeText: async text => calls.push(['copy', text]) },
        messages: { warn: (...args) => { calls.push(['warn', ...args]); return Promise.resolve(undefined); },
            info: (...args) => calls.push(['info', ...args]) },
        shell: { revealWidget: async id => calls.push(['reveal', id]) },
        ...overrides
    };
    return { calls, widget, context, registry: { executeCommand: async id => calls.push(['command', id]) } };
}

test('依頼文のコピーに失敗したら false を返す', async () => {
    const setup = injectContext();
    setup.context.extensionTarget = () => ({ form: 'extension', agent: 'test-agent' });
    setup.context.clipboard.writeText = async () => { throw new Error('copy failed'); };
    assert.equal(await injectHandler(setup.context, setup.registry)('request'), false);
    assert.ok(setup.calls.some(call => call[0] === 'warn'));
});

test('パートナーが無いとき案内の選択を待たず false を返す', async () => {
    const setup = injectContext();
    setup.context.messages.warn = () => new Promise(() => undefined);
    const result = await Promise.race([
        injectHandler(setup.context, setup.registry)('request'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('waited for warning choice')), 100))
    ]);
    assert.equal(result, false);
});

test('PTY のつなぎ直しに失敗したら拡張機能へのコピーへ落ちる', async () => {
    const setup = injectContext();
    setup.context.liveTerminal = () => ({ id: 'terminal' });
    setup.context.extensionTarget = () => ({ form: 'extension', agent: 'test-agent', focusCommandId: 'focus.partner' });
    assert.equal(await injectHandler(setup.context, setup.registry)('request'), 'copied');
    assert.deepEqual(setup.calls.slice(0, 2), [['copy', 'request'], ['command', 'focus.partner']]);
});

test('パートナーを開く選択では依頼文をコピーしてから開く', async () => {
    const setup = injectContext();
    setup.context.messages.warn = () => Promise.resolve('partner.navigation.commands.openPartnerAction');
    assert.equal(await injectHandler(setup.context, setup.registry)('request'), false);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(setup.calls, [
        ['copy', 'request'],
        ['info', 'partner.navigation.commands.requestCopiedOpenPartnerInfo'],
        ['command', 'partner.open']
    ]);
});
