import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadCatalog, derivedAllowedCommandIds, validateValue, toCommandInstructions} from '../src/jev/jev-actions.mjs';
import {validateCatalog} from '../src/jev/validate-actions.mjs';

const catalog = loadCatalog();
const copy = () => structuredClone(catalog);

test('the catalog covers the contracted action families and preserves the 33 baseline IDs', () => {
    assert.equal(validateCatalog(catalog).ok, true);
    const ids = new Set(catalog.actions.map(action => action.id));
    for (const [letter, length] of [['A', 7], ['B', 6], ['C', 4], ['D', 3], ['E', 4]]) {
        for (let n = 1; n <= length; n++) assert.ok(ids.has(`${letter}${n}`));
    }
    for (const prefix of ['roughCanvas.', 'browser.', 'scratch.']) assert.ok([...ids].some(id => id.startsWith(prefix)));
    assert.deepEqual(derivedAllowedCommandIds(catalog), catalog.baseAllowedCommandIds);
    assert.equal(catalog.baseAllowedCommandIds.length, 33);
    assert.ok(Object.isFrozen(catalog.actions[0].valueSchema));
});

test('catalog validator rejects unsafe or inconsistent edits', () => {
    const cases = [
        value => { value.baseAllowedCommandIds.pop(); },
        value => { value.actions.push(structuredClone(value.actions[0])); },
        value => { value.actions.find(action => action.id === 'E1').commands.push({commandId:'akari.example.bad'}); },
        value => { value.actions.find(action => action.id === 'A1').available = true; },
        value => { value.actions.find(action => action.id === 'A1').commands[0].commandId = 'akari.catalog.open'; },
        value => { value.actions.find(action => action.id === 'D1').action = 'data.delete'; },
        value => { value.actions.find(action => action.id === 'D1').commands[0].commandId = 'akari.data.delete'; },
        value => { value.actions.find(action => action.id === 'D1').valueSchema.properties.key.enum = ['jev.mode']; },
        value => { value.actions.find(action => action.id === 'A1').valueSchema.unknown = true; },
    ];
    for (const mutate of cases) {
        const value = copy(); mutate(value);
        assert.equal(validateCatalog(value).ok, false, JSON.stringify(value.actions.at(-1)));
    }
});

test('B3 expands to two ordered commands and invalid values stop', () => {
    const action = catalog.actions.find(row => row.id === 'B3');
    assert.deepEqual(toCommandInstructions(action, {seconds:42}), [
        {commandId:'akari.timeline.seek', args:{seconds:42}},
        {commandId:'akari.preview.seekOutput', args:{time:42}},
    ]);
    assert.equal(toCommandInstructions(action, {seconds:Infinity}), null);
});

test('shared value cases give the same JS decisions', () => {
    const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/jev-values.json', import.meta.url)));
    for (const row of cases) assert.equal(validateValue(row.schema, row.value), row.ok);
});
