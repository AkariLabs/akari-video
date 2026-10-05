import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/browser/akari-shell-inner-chrome.ts', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../src/browser/akari-theme-frontend-module.ts', import.meta.url), 'utf8');
const registrySource = readFileSync(require.resolve('@theia/core/lib/common/command'), 'utf8');

test('Theia puts the later select-all handler before the native document handler', () => {
    assert.match(registrySource, /registerHandler\(commandId, handler\)\s*\{[\s\S]*?handlers\.unshift\(handler\)/);
    assert.match(registrySource, /getActiveHandler\(commandId,[\s\S]*?for \(const handler of handlers\)/);
});

test('shell command handler absorbs select all only outside selectable text', () => {
    assert.match(moduleSource, /bind\(CommandContribution\)\.toService\(AkariShellInnerChromeContribution\)/);
    assert.match(source, /class AkariShellInnerChromeContribution implements [^{]*CommandContribution/);
    const body = source.match(/registerCommands\(commands: CommandRegistry\): void \{([\s\S]*?)\n    \}/)?.[1];
    assert.ok(body, 'command contribution must register the select-all handler');
    assert.match(body, /isSelectableTextFocus\(document\.activeElement\)/);
    const js = ts.transpileModule(`function register(commands) {${body}}\nexports.register = register;`, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const document = { activeElement: null, execCommand: () => assert.fail('native selectAll must not run') };
    const context = { exports: {}, document, CommonCommands: { SELECT_ALL: { id: 'core.selectAll' } },
        isSelectableTextFocus: focus => focus?.selectable === true };
    vm.runInNewContext(js, context);
    let commandId, handler;
    context.exports.register({ registerHandler: (id, value) => { commandId = id; handler = value; } });
    assert.equal(commandId, 'core.selectAll');
    assert.equal(handler.isEnabled(), true);
    assert.equal(handler.execute(), undefined);
    document.activeElement = { selectable: true };
    assert.equal(handler.isEnabled(), false, 'input, editor, terminal and readable documents fall through');
});
