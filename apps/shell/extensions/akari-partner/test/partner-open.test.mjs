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

test('パートナーを開くだけのコマンドを登録する', () => {
    assert.match(text, /OPEN\s*:\s*\{\s*id:\s*'akari\.partner\.open',\s*label:\s*'パートナーを開く'/);
    assert.ok(registration, 'registerCommands registers AkariPartnerCommands.OPEN');
});

function openHandler() {
    assert.ok(registration);
    const handler = registration.expression.arguments[1];
    const execute = handler.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(source) === 'execute');
    assert.ok(execute && ts.isArrowFunction(execute.initializer));
    return execute.initializer;
}

test('開く処理は接続・オンボーディング・PTY を開始しない', () => {
    const execute = openHandler();
    assert.doesNotMatch(execute.getText(source), /beginRecommended|beginCli|connect|Dialog|terminal|pty/i);
    const calls = [];
    const visit = node => {
        if (ts.isCallExpression(node)) { calls.push(node.expression.getText(source)); }
        ts.forEachChild(node, visit);
    };
    visit(execute);
    assert.deepEqual(calls, [
        'this.widgetManager.getOrCreateWidget', 'this.shell.addWidget', 'this.shell.activateWidget'
    ]);
});

test('未配置なら右ドックへ追加し、配置済みなら前面にするだけ', async () => {
    const code = ts.transpileModule(`const execute = ${openHandler().getText(source)};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    for (const isAttached of [false, true]) {
        const widget = { id: 'akari-partner-onboarding', isAttached };
        const calls = [];
        const context = {
            widgetManager: { async getOrCreateWidget(id) { assert.equal(id, widget.id); return widget; } },
            shell: {
                async addWidget(value, options) { assert.equal(value, widget); calls.push(['add', options]); },
                async activateWidget(id) { calls.push(['activate', id]); }
            }
        };
        // DOM や Theia を起動せず、登録された execute の本体を実行する。
        const execute = new Function('AkariPartnerWidget', `${code}\nreturn execute;`).call(context, { ID: widget.id });
        await execute();
        assert.deepEqual(calls, isAttached ? [['activate', widget.id]]
            : [['add', { area: 'right', rank: 100 }], ['activate', widget.id]]);
    }
});
