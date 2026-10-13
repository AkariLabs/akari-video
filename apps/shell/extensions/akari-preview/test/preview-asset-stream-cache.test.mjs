import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import URI from '@theia/core/lib/common/uri.js';
import { readHandlerCompiled } from './helpers/handler-source.mjs';

const require = createRequire(import.meta.url);
const Uri = URI.default ?? URI;

const compiled = readHandlerCompiled();
const method = name => {
    const start = compiled.search(new RegExp(`^    async ${name}\\(`, 'mu'));
    assert.ok(start >= 0, name);
    return compiled.slice(start, compiled.indexOf('\n    }', start) + 6);
};

test('同じ素材パスを再読み込みしても stream を作り直さない', async () => {
    const Host = vm.runInNewContext(`(class {
        sharedAssetStreams = new Map();
        sharedAssetStreamKeys = new Map();
        ${method('createAssetStream')}
        ${method('disposeAssetStreams')}
    })`, { console });
    const host = new Host();
    let creates = 0;
    let disposes = 0;
    host.currentWorkspaceRoots = async () => [];
    host.previewService = {
        async createAssetStream() { creates++; return { id: `stream-${creates}`, url: 'asset-url' }; },
        async disposeAssetStream() { disposes++; }
    };
    const first = await host.createAssetStream({ assetUri: 'asset-a' });
    const second = await host.createAssetStream({ assetUri: 'asset-a' });
    assert.equal(first.id, second.id);
    assert.equal(creates, 1);
    await host.disposeAssetStreams([first.id]);
    assert.equal(disposes, 0);
    await host.disposeAssetStreams([second.id]);
    assert.equal(disposes, 1);
});

test('edit が変わっても同じ素材パスの解決 RPC は一回にする', async () => {
    const Host = vm.runInNewContext(`(class { ${method('resolveEditAssetUri')} })`, {
        edit_asset_path_1: require('../lib/common/edit-asset-path.js'), uri_1: { default: Uri }
    });
    const host = new Host();
    let resolves = 0;
    host.currentWorkspaceRoots = async () => [];
    host.previewService = { async resolveProjectAssetUri() {
        resolves++;
        return 'file:///project/assets/clip.mp4';
    } };
    const edit = new Uri('file:///project/edit.json');
    await Promise.all([
        host.resolveEditAssetUri('assets/clip.mp4', edit),
        host.resolveEditAssetUri('assets/clip.mp4', edit)
    ]);
    await host.resolveEditAssetUri('assets/clip.mp4', edit);
    assert.equal(resolves, 1);
    host.assetResolutionCache.clear();
    await host.resolveEditAssetUri('assets/clip.mp4', edit);
    assert.equal(resolves, 2);
});
