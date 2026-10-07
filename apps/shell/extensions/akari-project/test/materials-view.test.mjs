import test from 'node:test';
import assert from 'node:assert/strict';
import { isMaterialsList, materialViewKind, visibleMaterials } from '../lib/common/materials-view.js';

const entries = [
    { name: 'zeta.mp4', kind: 'video', durationSeconds: 10, importedAt: '2024-01-03', createdAt: '2020-01-01' },
    { name: 'alpha.wav', kind: 'audio', durationSeconds: 20, importedAt: '2024-01-01', createdAt: '2021-01-01' },
    { name: 'beta.png', kind: 'image', durationSeconds: 5, importedAt: '2024-01-02', createdAt: '2022-01-01' },
    { name: 'page.html', kind: 'video', assetGroup: { category: 'overlay' } },
];
const names = (filter, query, sort) => visibleMaterials(entries, filter, query, sort).map(entry => entry.name);

test('six sort options use metadata and place missing values last', () => {
    assert.deepEqual(names([], '', 'imported-desc'), ['zeta.mp4', 'beta.png', 'alpha.wav', 'page.html']);
    assert.deepEqual(names([], '', 'imported-asc'), ['alpha.wav', 'beta.png', 'zeta.mp4', 'page.html']);
    assert.deepEqual(names([], '', 'name'), ['alpha.wav', 'beta.png', 'page.html', 'zeta.mp4']);
    assert.deepEqual(names([], '', 'dur'), ['alpha.wav', 'zeta.mp4', 'beta.png', 'page.html']);
    assert.deepEqual(names([], '', 'kind'), ['alpha.wav', 'beta.png', 'page.html', 'zeta.mp4']);
    assert.deepEqual(names([], '', 'created'), ['beta.png', 'alpha.wav', 'zeta.mp4', 'page.html']);
});

test('multiple kinds are OR; search is AND; groups belong to other', () => {
    assert.equal(materialViewKind(entries[3]), 'other');
    assert.deepEqual(names(['video', 'other'], '', 'name'), ['page.html', 'zeta.mp4']);
    assert.deepEqual(names(['video', 'other'], 'PAGE', 'name'), ['page.html']);
    assert.deepEqual(names(['audio'], 'page', 'name'), []);
});

test('only list mode requests rows', () => {
    assert.equal(isMaterialsList('grid'), false);
    assert.equal(isMaterialsList('list'), true);
});
