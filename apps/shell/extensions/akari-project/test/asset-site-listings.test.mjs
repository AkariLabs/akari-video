import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

class SiteCatalogService extends AkariProjectServiceImpl {
    constructor(root) {
        super();
        this.root = root;
    }

    async resolveCatalogRoot() { return pathToFileURL(this.root).toString(); }
}

test('読めないおすすめだけを飛ばしてサイトと残りのおすすめを返す', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-site-listings-'));
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
        const site = {
            id: 'example', name: 'Example', tab: 'audio', entry_url: 'https://example.com/assets',
            hosts: ['example.com'], download_hosts: [], price: 'free',
            terms: { summary_ja: '利用条件', source_url: 'https://example.com/terms', checked_at: '2026-10-14' },
            attribution: { required: false, text: '' }, direct_fetch_allowed: false,
            recommendations: ['audio/first', 'audio/broken', 'audio/last']
        };
        await mkdir(join(root, 'sites'), { recursive: true });
        await writeFile(join(root, 'sites', 'example.json'), JSON.stringify(site));
        for (const id of ['first', 'last']) {
            await mkdir(join(root, 'audio', id), { recursive: true });
            await writeFile(join(root, 'audio', id, 'meta.json'), JSON.stringify({
                title: id, source: { url: `https://example.com/${id}` }
            }));
        }
        // 壊れた参照は meta.json を置かない。
        const listings = await new SiteCatalogService(root).getAssetSiteListings();
        assert.deepEqual(listings.map(listing => listing.site.id), ['example']);
        assert.deepEqual(listings[0].recommendations.map(item => item.id), ['audio/first', 'audio/last']);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0][0], /example.*audio\/broken/);
    } finally {
        console.warn = originalWarn;
        await rm(root, { recursive: true, force: true });
    }
});
