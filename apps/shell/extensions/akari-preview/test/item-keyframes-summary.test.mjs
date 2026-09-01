import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readInternalEdit } from '@akari-video/edit-store';
import {
    buildItemKeyframeSummaryFields,
    resolvePreviewItemKeyframes
} from '../lib/common/item-keyframes-summary.js';
import { expandBagOverlays } from '../lib/common/preview-parts.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, '../../../../../packages/render-cut/test/fixtures/item-keyframes');
const fixtureEdit = () => JSON.parse(readFileSync(join(fixtureRoot, 'edit.json'), 'utf8'));
const htmlByPath = new Map([
    ['overlays/plain.html', readFileSync(join(fixtureRoot, 'overlays/plain.html'), 'utf8')],
    ['overlays/card.html', readFileSync(join(fixtureRoot, 'overlays/card.html'), 'utf8')],
    ['overlays/group.html', readFileSync(join(fixtureRoot, 'overlays/group.html'), 'utf8')]
]);
const bagText = readFileSync(join(fixtureRoot, 'motion/s01.json'), 'utf8');

async function project(raw, readText = async path => {
    if (path === 'motion/s01.json') return bagText;
    throw new Error(`missing mock: ${path}`);
}, onWarning = () => {}) {
    const internal = readInternalEdit(JSON.stringify(raw));
    await resolvePreviewItemKeyframes(internal, { readText, onWarning });
    return expandBagOverlays(internal, path => htmlByPath.get(path) ?? path);
}

test('inline keyframes を summary の整数ローカルフレームとして写す', async () => {
    const overlays = await project(fixtureEdit());
    const fields = buildItemKeyframeSummaryFields(overlays.find(value => value.id === 'plain'));
    assert.deepEqual(fields.keyframes.map(point => point.t), [0, 120]);
    assert.deepEqual(fields.keyframes[1].transform, { x: 400 });
});

test('keyframes が無い overlay には keyframes / opacity のどちらも生やさない', async () => {
    const overlays = await project(fixtureEdit());
    const fields = buildItemKeyframeSummaryFields(overlays.find(value => value.id === 's01.C'));
    assert.deepEqual(fields, {});
    assert.equal(Object.hasOwn(fields, 'opacity'), false);
});

test('keyframes がある overlay の有限な静的 opacity だけを summary に写す', async () => {
    const raw = fixtureEdit();
    raw.tracks[1].items[0].opacity = 0.625;
    const overlays = await project(raw);
    const fields = buildItemKeyframeSummaryFields(overlays.find(value => value.id === 'plain'));
    assert.equal(fields.opacity, 0.625);
});

test('非有限 opacity は keyframes があっても summary に写さない', () => {
    const fields = buildItemKeyframeSummaryFields({
        keyframes: [{ t: 0 }, { t: 1 }],
        opacity: Number.NaN
    });
    assert.deepEqual(Object.keys(fields), ['keyframes']);
});

test('motion 袋参照を item id で解決し count 不一致は無視する', async () => {
    const raw = fixtureEdit();
    raw.tracks[2].items[0].items[0].keyframes.count = 999;
    const references = [];
    const internal = readInternalEdit(JSON.stringify(raw));
    await resolvePreviewItemKeyframes(internal, {
        readText: async path => path === 'motion/s01.json' ? bagText : Promise.reject(new Error(path)),
        onReference: path => references.push(path),
        onWarning: () => {}
    });
    const overlays = expandBagOverlays(internal, path => htmlByPath.get(path) ?? path);
    const fields = buildItemKeyframeSummaryFields(overlays.find(value => value.id === 's01.B'));
    assert.deepEqual(fields.keyframes.map(point => point.t), [0, 60, 120]);
    assert.deepEqual(references, ['motion/s01.json']);
});

test('motion 袋欠落は warning に留めて overlay を静的値で残す', async () => {
    const warnings = [];
    const overlays = await project(
        fixtureEdit(),
        async () => { throw new Error('ENOENT'); },
        (message, error) => warnings.push([message, error])
    );
    assert.deepEqual(buildItemKeyframeSummaryFields(overlays.find(value => value.id === 's01.B')), {});
    assert.match(warnings[0][0], /^\[akari-preview\] motion bag motion\/s01\.json could not be read/);
    assert.equal(warnings[0][1].message, 'ENOENT');
});

test('motion 袋の形が違う場合も warning に留めて静的値で残す', async () => {
    const warnings = [];
    const overlays = await project(
        fixtureEdit(),
        async () => JSON.stringify({ version: 1, items: [] }),
        message => warnings.push(message)
    );
    assert.deepEqual(buildItemKeyframeSummaryFields(overlays.find(value => value.id === 's01.B')), {});
    assert.match(warnings[0], /motion bag motion\/s01\.json has no items object/);
});

test('純グループの子の inline keyframes と opacity を整数フレームのまま写す', async () => {
    const overlays = await project(fixtureEdit());
    const child = overlays.find(value => value.id === 'g1.first');
    const fields = buildItemKeyframeSummaryFields(child);
    assert.deepEqual(fields.keyframes.map(point => point.t), [0, 120]);
    assert.deepEqual(fields.keyframes.map(point => point.opacity), [0, 1]);
});
