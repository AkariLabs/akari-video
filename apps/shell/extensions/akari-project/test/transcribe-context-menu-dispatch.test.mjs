import test from 'node:test';
import assert from 'node:assert/strict';
import { readCompiledSource } from './helpers/role-buckets-source.mjs';
import vm from 'node:vm';
import { captionSourcePathRule } from '../lib/common/caption-source-path-rule.js';

const noopDecorator = () => () => undefined;
const emptyModule = new Proxy({}, { get: () => undefined });
const modules = {
    '@theia/core/shared/inversify': { inject: noopDecorator, injectable: noopDecorator, postConstruct: noopDecorator },
    '@theia/core/lib/browser/widgets/react-widget': { ReactWidget: class {} },
    '@theia/core/lib/common': { DisposableCollection: class {} },
    '@theia/core/shared/react': {},
    '../common/material-card-layout': { materialCardLayout: () => ({ gridGap: '8px', cardMinWidth: '100px' }) },
    '../common/caption-source-path-rule': { captionSourcePathRule }
};
const exports = {};
vm.runInNewContext(readCompiledSource('materials').text, {
    require: id => modules[id] ?? emptyModule,
    exports,
    module: { exports },
    console,
    Error,
    URL,
    Promise,
    Object,
    Array,
    JSON,
    String,
    Symbol,
    Set,
    Map,
    setTimeout,
    clearTimeout
});
const { AkariMaterialsPane } = exports;
const plain = value => JSON.parse(JSON.stringify(value));

function harness(executeCommand) {
    const calls = { commands: [], rpc: [], info: [], error: [], loads: 0 };
    const context = {
        host: {
            workflow: { workspaceRoot: { toString: () => 'file:///project' } },
            commandService: { async executeCommand(...args) { calls.commands.push(args); return executeCommand(...args); } },
            projectService: { async transcribeMaterial(request) { calls.rpc.push(request); } },
            messages: {
                async info(message) { calls.info.push(message); },
                async error(message) { calls.error.push(message); }
            },
            update() {}
        },
        transcriptStateByPath: {},
        async loadMaterials() { calls.loads += 1; }
    };
    return { calls, context, entry: { name: 'voice.wav', kind: 'audio', relativePath: 'assets/voice.wav' } };
}

test('右クリック文字起こしは relativePath 付きで openDialog コマンドを実行する', async () => {
    const { calls, context, entry } = harness(async () => 'opened');
    await AkariMaterialsPane.prototype.transcribeMaterial.call(context, entry);
    assert.deepEqual(plain(calls.commands), [['akari.transcribe.openDialog', {
        projectRoot: 'file:///project', relativePath: 'assets/voice.wav'
    }]]);
    assert.deepEqual(calls.rpc, []);
    assert.equal(calls.loads, 1);
});

test('openDialog が cancelled を返すと中止トーストを出し RPC へはフォールバックしない', async () => {
    const { calls, context, entry } = harness(async () => 'cancelled');
    await AkariMaterialsPane.prototype.transcribeMaterial.call(context, entry);
    assert.deepEqual(calls.info, ['voice.wav: 文字起こしを中止しました']);
    assert.deepEqual(calls.rpc, []);
    assert.equal(calls.loads, 1);
});

test('ポップアップが使えないときは処理を始めずエラーを知らせる', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'NO_ACTIVE_HANDLER' });
    const { calls, context, entry } = harness(async () => { throw missing; });
    await AkariMaterialsPane.prototype.transcribeMaterial.call(context, entry);
    assert.deepEqual(calls.rpc, []);
    assert.deepEqual(calls.error, ['missing']);
    assert.equal(calls.loads, 0);

    const failure = harness(async () => { throw Object.assign(new Error('boom'), { code: 'OTHER' }); });
    await AkariMaterialsPane.prototype.transcribeMaterial.call(failure.context, failure.entry);
    assert.deepEqual(failure.calls.rpc, []);
    assert.deepEqual(failure.calls.error, ['boom']);
});

test('書き出し素材は右クリックからポップアップを開き段 1 で対象外を示す', async () => {
    const { calls, context, entry } = harness(async () => 'opened');
    entry.relativePath = 'exports/master.mp4';
    entry.kind = 'video';
    await AkariMaterialsPane.prototype.transcribeMaterial.call(context, entry);
    assert.deepEqual(plain(calls.commands), [['akari.transcribe.openDialog', {
        projectRoot: 'file:///project', relativePath: 'exports/master.mp4'
    }]]);
    assert.deepEqual(calls.rpc, []);
    assert.deepEqual(calls.info, []);
});
