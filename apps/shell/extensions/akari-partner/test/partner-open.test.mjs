import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const text = readFileSync(new URL('../src/browser/akari-partner-command-contribution.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('commands.ts', text, ts.ScriptTarget.Latest, true);
const contribution = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariPartnerCommandContribution');
const register = contribution.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'registerCommands');
const registration = register.body.statements.find(node => ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === 'registry.registerCommand' &&
    node.expression.arguments[0]?.getText(source) === 'AkariPartnerCommands.OPEN');

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
