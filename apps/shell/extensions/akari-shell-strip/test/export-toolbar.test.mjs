import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { EDIT_JSON_MISSING_TOOLTIP, exportToolbarState, exportUnavailableReason } from '../lib/common/export-toolbar-state.js';

const source = ts.createSourceFile('export-toolbar.ts', readFileSync(new URL(
    '../src/browser/akari-export-toolbar-contribution.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const contribution = source.statements.find(node => ts.isClassDeclaration(node)
    && node.name?.text === 'AkariExportToolbarContribution');
const method = name => contribution.members.find(member => member.name?.getText(source) === name).getText(source);
const controller = (...names) => {
    const code = ts.transpileModule(`class Controller { ${names.map(method).join('\n')} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
    return new Function('React', 'OPEN_EXPORT_DIALOG', 'exportToolbarState',
        'exportUnavailableReason', `${code}\nreturn Controller;`)(React, { id: 'akari.export.openDialog', label: '書き出し…' },
        exportToolbarState, exportUnavailableReason);
};

test('書き出しコマンドは対象が無ければ止まり、対象があれば準備後に一度だけ開く', async () => {
    const Controller = controller('registerCommands', 'openExportDialog');
    const calls = [];
    const notices = [];
    const state = { workspaceOpened: true, exists: false, selectedEditName: 'edit.json' };
    const instance = Object.assign(new Controller(), {
        availability: { refresh: async () => state },
        messages: { info: message => notices.push(message) },
        exportSession: { running: false, prepareCurrentProject: async () => calls.push('prepare') },
        exportDialog: { open: value => calls.push(['open', value]) }
    });
    let command;
    instance.registerCommands({ registerCommand: (definition, handler) => { command = { definition, handler }; } });
    assert.equal(command.definition.id, 'akari.export.openDialog');
    assert.equal(command.definition.label, '書き出し…');
    await command.handler.execute();
    assert.deepEqual(calls, []);
    assert.deepEqual(notices, [exportUnavailableReason(state)]);
    notices.length = 0;
    state.exists = true;
    await command.handler.execute();
    assert.deepEqual(calls, ['prepare', ['open', false]]);
    assert.deepEqual(notices, []);
    calls.length = 0;
    state.selectedEditName = 'edit.v2.json';
    await command.handler.execute();
    assert.deepEqual(calls, []);
    assert.deepEqual(notices, [exportUnavailableReason(state)]);
    notices.length = 0;
    instance.exportSession.running = true;
    await command.handler.execute();
    assert.deepEqual(calls, ['prepare', ['open', false]]);
    assert.deepEqual(notices, []);
});

test('帯の表示は通常・無効・書き出し中を共有状態から決める', () => {
    const available = { workspaceOpened: true, exists: true, selectedEditName: 'edit.json' };
    assert.deepEqual(exportToolbarState(available, { phase: 'idle' }),
        { disabled: false, title: '書き出し', label: '書き出し' });
    assert.deepEqual(exportToolbarState({ ...available, exists: false }, { phase: 'idle' }),
        { disabled: true, title: EDIT_JSON_MISSING_TOOLTIP, label: '書き出し' });
    assert.match(exportToolbarState({ ...available, selectedEditName: 'edit.v2.json' }, { phase: 'idle' }).title,
        /edit\.json のタブに戻す/);
    assert.deepEqual(exportToolbarState(available, { phase: 'rendering', progressPercent: 63 }),
        { disabled: false, title: '書き出し中の画面を開く', label: '書き出し中 63%' });
    assert.equal(exportToolbarState({ ...available, exists: false }, { phase: 'linting' }).disabled, false);
});

test('帯は本体領域だけに現れ、共有コマンドを呼ぶ', () => {
    const Controller = controller('registerToolbarItems', 'renderButton');
    let item;
    const calls = [];
    const instance = Object.assign(new Controller(), {
        shell: { getAreaFor: widget => widget.area },
        scopeService: { scope: 'project' },
        availability: { snapshot: { workspaceOpened: true, exists: true, selectedEditName: 'edit.json' } },
        exportSession: { snapshot: { status: { phase: 'linting', progressPercent: 25 } } },
        commands: { executeCommand: id => { calls.push(id); return Promise.resolve(); } },
        changed: { event: () => {} }
    });
    instance.registerToolbarItems({ registerItem: value => { item = value; } });
    assert.equal(item.id, 'akari.export.openDialog.toolbar');
    assert.equal(item.priority, 100);
    assert.equal(item.isVisible({ area: 'main' }), true);
    assert.equal(item.isVisible({ area: 'bottom' }), false);
    instance.scopeService.scope = 'channel';
    assert.equal(item.isVisible({ area: 'main' }), false);
    instance.scopeService.scope = 'project';
    const button = item.render();
    assert.equal(button.props.className, 'theia-button');
    assert.equal(button.props['data-akari-export-toolbar'], 'true');
    assert.equal(button.props.disabled, false);
    assert.equal(button.children[1].children[0], '書き出し中 25%');
    button.props.onClick({ preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(calls, ['akari.export.openDialog']);
});

test('共有状態の変化だけを帯とメニューへ通知する', () => {
    const serviceSource = ts.createSourceFile('availability.ts', readFileSync(new URL(
        '../src/browser/akari-export-availability-service.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const service = serviceSource.statements.find(node => ts.isClassDeclaration(node)
        && node.name?.text === 'AkariExportAvailabilityService');
    const setState = service.members.find(node => node.name?.getText(serviceSource) === 'setState').getText(serviceSource);
    const code = ts.transpileModule(`class Service { ${setState} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const Service = new Function(`${code}\nreturn Service;`)();
    let changes = 0;
    const instance = Object.assign(new Service(), {
        state: { workspaceOpened: false, exists: false, selectedEditName: 'edit.json' },
        changed: { fire: () => changes++ }
    });
    instance.setState({ workspaceOpened: false, exists: false, selectedEditName: 'edit.json' });
    assert.equal(changes, 0);
    instance.setState({ workspaceOpened: true, exists: true, selectedEditName: 'edit.json' });
    assert.equal(changes, 1);
    instance.setState({ workspaceOpened: true, exists: true, selectedEditName: 'edit.v2.json' });
    assert.equal(changes, 2);
});
