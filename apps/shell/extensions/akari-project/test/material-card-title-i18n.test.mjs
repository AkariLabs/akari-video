import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { materialCardTitle, materialStoredName, referenceMaterialBaseName,
    referenceMaterialCardTitle } from '../lib/common/material-card-layout.js';

test('material group card uses translated display title without changing metadata', () => {
    const meta = { id: 'asset-id', title: '基底', i18n: { en: { title: 'English asset' } } };
    const before = structuredClone(meta);
    assert.equal(materialCardTitle(meta, 'fallback', 'en'), 'English asset');
    assert.equal(materialCardTitle(meta, 'fallback', 'ja'), '基底');
    assert.equal(materialCardTitle(undefined, 'fallback', 'en'), 'fallback');
    assert.deepEqual(meta, before);
});

test('reference cards keep Japanese precedence and use only actual English translations', () => {
    const reference = { id: 'asset-id', title: '台帳名' };
    const known = { title: 'English catalog', baseTitle: 'カタログ名',
        i18n: { en: { title: 'English catalog' } } };
    const card = { name: 'English library', baseName: 'ライブラリ名' };
    assert.equal(referenceMaterialCardTitle(reference, known, card, 'ja'),
        reference.title ?? known.title ?? reference.id);
    assert.equal(referenceMaterialCardTitle(reference, known, card, 'en'), 'English library');
    assert.equal(referenceMaterialCardTitle(reference, known, undefined, 'en'), 'English catalog');
    assert.equal(referenceMaterialCardTitle(reference, { title: 'カタログ名' },
        { name: 'ライブラリ名', baseName: 'ライブラリ名' }, 'en'), '台帳名');
    assert.equal(referenceMaterialBaseName(reference, known), '台帳名');
    assert.equal(referenceMaterialCardTitle({ id: 'asset-id' }, undefined, undefined, 'ja'), 'asset-id');
});

test('persistent material operations use the base name while the selection event keeps the display name', () => {
    assert.equal(materialStoredName({ name: 'English library', baseName: 'ライブラリ名' }), 'ライブラリ名');
    assert.equal(materialStoredName({ name: 'clip.mp4' }), 'clip.mp4');
    const source = readFileSync(new URL('../src/browser/akari-materials-pane.tsx', import.meta.url), 'utf8');
    assert.match(source, /availableAssetName\(assetsUri, materialStoredName\(entry\)\)/u);
    assert.match(source, /name: materialStoredName\(entry\)/u);
    assert.match(source, /AKARI_MATERIAL_SELECTED_EVENT[\s\S]*?name: entry\.name/u);
});
