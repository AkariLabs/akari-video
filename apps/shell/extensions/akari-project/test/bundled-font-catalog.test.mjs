import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

const repoRoot = fileURLToPath(new URL('../../../../..', import.meta.url));
const developmentCatalog = join(repoRoot, 'catalog');

class BundledCatalogService extends AkariProjectServiceImpl {
    constructor(resources, availableCatalog) {
        super();
        this.resources = resources;
        this.availableCatalog = availableCatalog;
        this.checkedDirectories = [];
    }

    resourcesPath() { return this.resources; }

    async isDirectory(candidate) {
        this.checkedDirectories.push(candidate);
        return candidate === this.availableCatalog;
    }
}

test('固定候補を保ったまま Resources/catalog を上方探索より先に見つける', async () => {
    const resources = resolve('/bundled-app/Contents/Resources');
    const catalog = join(resources, 'catalog');
    const service = new BundledCatalogService(resources, catalog);
    service.isFile = async () => { throw new Error('上方探索に進んだ'); };

    assert.equal(await service.findBundledCatalog(), catalog);
    assert.equal(service.checkedDirectories.at(-1), catalog);
    assert.equal(service.checkedDirectories.length, 5);
});

test('Resources/catalog のフォント項目数は開発時 catalog/font と一致する', async t => {
    const scratch = join(repoRoot, '.tmp-lane');
    await mkdir(scratch, { recursive: true });
    const resources = join(scratch, `bundled-count-${process.pid}-${Date.now()}`, 'Resources');
    t.after(() => rm(resolve(resources, '..'), { recursive: true, force: true }));
    const catalog = join(resources, 'catalog');
    await cp(developmentCatalog, catalog, { recursive: true });
    const service = new BundledCatalogService(resources, catalog);
    const expected = (await readdir(join(developmentCatalog, 'font'), { withFileTypes: true }))
        .filter(entry => entry.isDirectory()).length;

    const { items } = await service.loadLocalCatalogViewItems(undefined);
    const fonts = items.filter(item => item.category === 'font');
    const nonFonts = items.filter(item => item.category !== 'font');
    assert.ok(expected > 0);
    assert.equal(fonts.length, expected);
    assert.ok(nonFonts.length > 0, '実カタログのフォント以外も検査する');
    for (const item of items) {
        assert.ok(item.previewUrl === undefined || typeof item.previewUrl === 'string', item.key);
    }
    assert.equal(fonts.find(item => item.id === 'noto-sans-jp')?.previewUrl,
        pathToFileURL(join(catalog, 'font', 'noto-sans-jp', 'row.webp')).toString());
    assert.ok(fonts.some(item => item.previewUrl?.startsWith('file:')));
    assert.equal(await service.findBundledCatalog(), catalog);
});

test('Resources/catalog の兄弟 assets/font を同梱済みと判定する', async t => {
    const scratch = join(repoRoot, '.tmp-lane');
    await mkdir(scratch, { recursive: true });
    const resources = join(scratch, `bundled-font-${process.pid}-${Date.now()}`, 'Resources');
    t.after(() => rm(resolve(resources, '..'), { recursive: true, force: true }));
    const catalog = join(resources, 'catalog');
    const fontId = 'noto-sans-jp';
    await mkdir(join(catalog, 'font', fontId), { recursive: true });
    await mkdir(join(resources, 'assets', 'font', fontId), { recursive: true });
    await writeFile(join(catalog, 'font', fontId, 'meta.json'),
        await readFile(join(developmentCatalog, 'font', fontId, 'meta.json')));

    const service = new BundledCatalogService(resources, catalog);
    const keys = await service.loadInstalledCatalogKeys(catalog);
    assert.ok(keys.has(`font/${fontId}`));
    const { items } = await service.loadLocalCatalogViewItems(undefined);
    assert.equal(items.find(item => item.key === `font/${fontId}`)?.installed, true);
});
