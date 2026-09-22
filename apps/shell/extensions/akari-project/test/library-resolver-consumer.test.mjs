import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { composeState } from '../../../../../packages/asset-resolver/src/state.mjs';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';
import { filterLibraryCatalogItems } from '../lib/common/library-source-view.js';

test('オフラインの実置き場を resolver → loadResolverCatalogItems で読み、BGM/SFXとfile URIを保持', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-library-consumer-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const env = { AKARI_HOME: join(root, 'home'), AKARI_LIBRARY_ROOT: join(root, 'library'),
        AKARI_CREATOR_ROOT: join(root, 'creator'), AKARI_ASSETS_CATALOG: 'https://offline.invalid/catalog.json' };
    for (const [id, tags, source] of [['site-bgm', ['明るい'], { url: 'https://example.test/song' }], ['own-sfx', ['sfx', 'origin:own'], undefined]]) {
        const dir = join(env.AKARI_LIBRARY_ROOT, 'audio', id);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'meta.json'), JSON.stringify({ id, category: 'audio', title: id, tags, source, license: { spdx: 'CC0-1.0' } }));
        await writeFile(join(dir, 'sound.wav'), Buffer.alloc(44));
    }
    const state = await composeState({ env, fetchImpl: async () => { throw new Error('offline fixture'); } });
    const service = Object.create(AkariProjectServiceImpl.prototype);
    service.findAssetResolverSrcDir = async () => '/fixture/resolver';
    service.runResolverScript = async () => ({ code: 0, stdout: JSON.stringify(state), stderr: '' });
    const result = await service.loadResolverCatalogItems();
    assert.equal(result.status, 'ok');
    assert.equal(result.items.length, 2);
    for (const [source, category, id] of [['site', 'audio:bgm', 'site-bgm'], ['own', 'audio:sfx', 'own-sfx']]) {
        const [item] = filterLibraryCatalogItems(result.items, source, '', category);
        assert.equal(item.id, id);
        assert.equal(item.mediaUrl, pathToFileURL(join(env.AKARI_LIBRARY_ROOT, 'audio', id, 'sound.wav')).href);
        assert.equal(item.state, 'cached');
        assert.ok(item.addedAt);
        assert.ok(!item.tags.some(tag => tag.startsWith('origin:')));
    }
});
