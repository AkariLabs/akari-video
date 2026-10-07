import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import Module from 'node:module';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === '@theia/core/shared/inversify') return { injectable: () => value => value, inject: () => () => {} };
    if (request === '@theia/core/lib/common') return { DisposableCollection: class { dispose() {} push() {} } };
    if (request === '@theia/filesystem/lib/browser/file-service') return { FileService: class {} };
    if (request === '@theia/workspace/lib/browser/workspace-service') return { WorkspaceService: class {} };
    if (request === '../common/analysis-summary') return { deriveAnalysisDurationSeconds: () => 0, formatDurationBadge: () => '' };
    if (request === './akari-workflow-service') return { AkariWorkflowService: class {} };
    return originalLoad.call(this, request, parent, isMain);
};
const { HandoffProvider } = require('../lib/browser/handoff-provider.js');
const { ScratchCommands, SCRATCH_LIST_COMMAND } = require('../lib/browser/scratch-commands.js');
Module._load = originalLoad;

const root = { toString: () => 'file:///project', resolve: value => ({ toString: () => `file:///project/${value}` }) };
const file = (name, path) => ({ isDirectory: false, resource: { toString: () => `file://${path}`,
    path: { base: name, fsPath: () => path } } });

test('(g) handoff merges scratch facts while retaining output and material rows', async () => {
    let enabled = true;
    globalThis.window = { localStorage: { getItem: () => enabled ? '1' : null },
        electronAkariProject: { scratch: { list: async () => [{ ref: 'scratch:20261008-123456-abcdef',
            id: '20261008-123456-abcdef', kind: 'scratch-image', origin: 'external', label: '画像（example.com）',
            badges: ['外', '利用条件: 不明'], status: 'ready', path: '/scratch/image.png', quality: 'full',
            capturedAt: '2026-10-08T00:00:00+09:00', flags: [] }] } } };
    const provider = new HandoffProvider();
    Object.assign(provider, { workflow: { workspaceRoot: root }, root, children: async uri => {
        const value = uri.toString();
        return value.endsWith('/exports') ? [file('out.mp4', '/project/exports/out.mp4')]
            : value.endsWith('/assets') ? [] : value === 'file:///project' ? [file('mat.png', '/project/mat.png')] : [];
    }, materialFiles: async () => [], badge: async (_root, _file, origin) => origin === 'output' ? '書き出し' : '画像' });
    const items = await provider.list();
    assert.equal(items.length, 3);
    assert.deepEqual(items.map(item => item.origin), ['scratch', 'material', 'output']);
    assert.deepEqual(items[0].badges, ['外', '利用条件: 不明']);
    assert.equal(items[0].name, '画像（example.com）');
    assert.deepEqual(items.filter(item => item.origin !== 'scratch').map(item => [item.name, item.badge, item.fresh]),
        [['mat.png', '画像', false], ['out.mp4', '書き出し', false]]);
    enabled = false;
    assert.deepEqual(await provider.list(), []);
    enabled = true; delete window.electronAkariProject.scratch;
    assert.equal((await provider.list()).length, 2);
});

test('(i) Jev scratch.list command matches registration; discard and promote stay unregistered', async () => {
    const actions = JSON.parse(readFileSync(new URL('../../../../../packages/akari-vibe/src/jev/jev-actions.json', import.meta.url), 'utf8'));
    const list = actions.find?.(item => item.id === 'scratch.list') ?? actions.actions?.find(item => item.id === 'scratch.list');
    const discard = actions.find?.(item => item.id === 'scratch.discard') ?? actions.actions?.find(item => item.id === 'scratch.discard');
    const promote = actions.find?.(item => item.id === 'scratch.promote') ?? actions.actions?.find(item => item.id === 'scratch.promote');
    assert.equal(list.commands[0].commandId, SCRATCH_LIST_COMMAND);
    assert.deepEqual(discard.commands, []); assert.deepEqual(promote.commands, []);
    const handlers = new Map();
    const commands = new ScratchCommands();
    commands.registerCommands({ registerCommand: (command, handler) => handlers.set(command.id, handler.execute) });
    assert.equal(handlers.has(SCRATCH_LIST_COMMAND), true);
    window.electronAkariProject.scratch = { list: async () => [{ status: 'ready' }, { status: 'url_only' }] };
    assert.deepEqual(await handlers.get(SCRATCH_LIST_COMMAND)({ status: 'ready' }), [{ status: 'ready' }]);
});

test('(g) scratch is listed even before a workspace is opened', async () => {
    globalThis.window = { localStorage: { getItem: () => '1' }, electronAkariProject: { scratch: { list: async () => [{
        ref: 'scratch:20261008-123456-abcdef', id: '20261008-123456-abcdef', label: '画像（example.com）',
        badges: ['外', '利用条件: 不明'], status: 'url_only', quality: 'unknown', flags: []
    }] } } };
    const provider = new HandoffProvider();
    Object.assign(provider, { workflow: { workspaceRoot: undefined }, workspace: { roots: [] } });
    const items = await provider.list();
    assert.equal(items.length, 1);
    assert.equal(items[0].origin, 'scratch');
    assert.equal(items[0].status, 'url_only');
});
