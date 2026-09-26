import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

test('node returns still estimates from the ai-models catalog', async () => {
    const catalog = JSON.parse(await readFile(
        new URL('../../../../../packages/schemas/ai-models.json', import.meta.url), 'utf8'));
    const model = catalog.models.find(row => row.id === 'fal:gpt-image-2.5-flare');
    assert.ok(model, 'fal Flare のカタログ行がある');
    assert.equal(model.price?.unit, 'usd_per_image');
    const catalogResult = await new AkariAnnotationsServiceImpl().readGenerationCatalog();
    assert.deepEqual(catalogResult.stillEstimate, { prices: model.price.by_quality_1024, asOf: model.price.as_of });
});

test('静止画の価格だけを読めなくても動画モデルのカタログを返す', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'akari-still-price-'));
    const genPath = fileURLToPath(new URL('../../../../../packages/schemas/gen-models.json', import.meta.url));
    const stillPath = join(dir, 'ai-models.json');
    try {
        for (const value of [undefined, '{broken', JSON.stringify({ version: 1, models: [] }),
            JSON.stringify({ version: 1, models: [{ id: 'fal:gpt-image-2.5-flare', price: null }] })]) {
            if (value !== undefined) await writeFile(stillPath, value);
            const service = new AkariAnnotationsServiceImpl();
            service.findGenerationAsset = async target => {
                if (target === 'packages/schemas/gen-models.json') return genPath;
                if (value === undefined) throw new Error('ai-models.json が無い');
                return stillPath;
            };
            const catalog = await service.readGenerationCatalog();
            assert.ok(catalog.models.some(row => row.kind === 'video'));
            assert.equal(Object.hasOwn(catalog, 'stillEstimate'), false);
        }
    } finally { await rm(dir, { recursive: true, force: true }); }
});
