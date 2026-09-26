import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { stillFalPrices, stillFalPriceAsOf } from '../lib/browser/inspector/ai-still-panel.js';

test('browser fal still estimates match the ai-models catalog price and date', async () => {
    const catalog = JSON.parse(await readFile(
        new URL('../../../../../packages/schemas/ai-models.json', import.meta.url), 'utf8'));
    const model = catalog.models.find(row => row.id === 'fal:gpt-image-2.5-flare');
    assert.ok(model, 'fal Flare のカタログ行がある');
    assert.equal(model.price?.unit, 'usd_per_image');
    assert.deepEqual(stillFalPrices, model.price.by_quality_1024);
    assert.equal(stillFalPriceAsOf, model.price.as_of);
});
