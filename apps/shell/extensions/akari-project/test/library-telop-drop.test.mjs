import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { memberText } from '../../akari-annotations/test/helpers/widget-source.mjs';

const method = memberText('handleMaterialDrop', { in: 'widget' });
const code = ts.transpileModule(`class DropHandler { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const DropHandler = new Function('LIBRARY_DRAG_MIME', `${code}\nreturn DropHandler;`)('application/x-akari-library-item');

test('未購入テロップのドロップは促しのシートを呼び、配置しない', async () => {
    const handler = new DropHandler();
    const calls = [];
    handler.isMaterialDragTransfer = () => true;
    handler.materialPanelDropPoint = () => ({ zone: 'strip', x: 100, y: 10 });
    handler.stopMaterialDragAutoScroll = () => {};
    handler.hideMaterialGhost = () => calls.push('hide');
    handler.commands = { executeCommand: async (...args) => calls.push(args) };
    const payload = { kind: 'overlay', key: 'overlay/telop-fixture', id: 'telop-fixture',
        category: 'overlay', title: 'テロップ', locked: true, price: 1980 };
    handler.handleMaterialDrop({ clientX: 100, clientY: 10, target: null,
        dataTransfer: { types: ['application/x-akari-library-item'], getData: () => JSON.stringify(payload) },
        preventDefault() {}, stopPropagation() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['hide', ['akari.library.showPremiumPrompt', { key: payload.key }]]);
});
