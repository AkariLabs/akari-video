import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ALLOWED_COMMAND_IDS as judgementIds} from '../../../../../packages/akari-vibe/src/exec-support/companion-commands.mjs';
import {loadCatalog, derivedAllowedCommandIds} from '../../../../../packages/akari-vibe/src/jev/jev-actions.mjs';
import {validateCatalog} from '../../../../../packages/akari-vibe/src/jev/validate-actions.mjs';
import {generateJevActions, generatedData} from '../scripts/gen-jev-actions.mjs';
import {ALLOWED_COMMAND_IDS as shellIds} from '../lib/common/companion-allowlist.js';
import {validateValue} from '../lib/common/jev-catalog-validate.js';

const BASE_ALLOWED_COMMAND_IDS = [
    'akari.preview.ensureVisible', 'akari.preview.seekOutput', 'akari.preview.togglePlayback',
    'akari.preview.play', 'akari.preview.pause', 'akari.preview.setFullscreen', 'akari.preview.setViewZoom',
    'akari.preview.setPlaybackRate', 'akari.preview.setLoopRange', 'akari.preview.enterCropMode',
    'akari.preview.openPerspectivePanel', 'akari.preview.pulseItem', 'akari.preview.showZoneHint',
    'akari.timeline.focusItem', 'akari.timeline.seek', 'akari.timeline.setView', 'akari.timeline.setTool',
    'akari.timeline.setSnap', 'akari.timeline.reveal', 'akari.inspector.open', 'akari.daihon.open', 'akari.cuts.open',
    'akari.transcribe.openDialog', 'akari.catalog.open', 'akari.catalog.importAsset', 'akari.catalog.listCategories', 'akari.menu.focus',
    'akari.menu.listSkills', 'akari.menu.listOpenTargets', 'akari.review.open',
    'akari.review.board.open', 'akari.partner.open', 'akari.settings.open',
];

test('the original 33 IDs remain the ordered prefix on both sides', () => {
    assert.equal(BASE_ALLOWED_COMMAND_IDS.length, 33);
    assert.deepEqual(loadCatalog().baseAllowedCommandIds, BASE_ALLOWED_COMMAND_IDS);
    assert.deepEqual(judgementIds.slice(0, 33), BASE_ALLOWED_COMMAND_IDS);
    assert.deepEqual(shellIds.slice(0, 33), BASE_ALLOWED_COMMAND_IDS);
});

test('a removed baseline ID fails catalog validation', () => {
    const catalog = structuredClone(loadCatalog());
    catalog.baseAllowedCommandIds.pop();
    assert.equal(validateCatalog(catalog).ok, false);
    assert.notDeepEqual(catalog.baseAllowedCommandIds, BASE_ALLOWED_COMMAND_IDS);
});

test('an unavailable command cannot enter either source of allowed IDs', () => {
    const original = loadCatalog();
    const placeholder = original.actions.find(action => action.id === 'D2').commands[0].commandId;
    const inBase = structuredClone(original);
    inBase.baseAllowedCommandIds[0] = placeholder;
    assert.equal(validateCatalog(inBase).ok, false);
    assert.ok(validateCatalog(inBase).errors.some(error => error.includes('unavailable command entered allowlist')));

    const inAvailable = structuredClone(original);
    const available = inAvailable.actions.find(action => action.id === 'A4');
    available.owner = 'J2';
    available.commands[0].commandId = placeholder;
    assert.equal(validateCatalog(inAvailable).ok, false);
    assert.ok(validateCatalog(inAvailable).errors.some(error => error.includes('unavailable command entered allowlist')));
});

test('changing one generated character fails the regeneration byte comparison', () => {
    const committed = fs.readFileSync(new URL('../src/common/jev-actions.generated.ts', import.meta.url));
    const generated = generateJevActions(loadCatalog());
    const original = Buffer.from(generated);
    const mutated = Buffer.from('#' + generated.slice(1));
    assert.ok(original.equals(committed));
    assert.equal(mutated.length, original.length);
    assert.equal(mutated.equals(committed), false);
});

test('unavailable action command IDs are absent from both allowlists', () => {
    const selected = new Set(['C2', 'D2', 'D3']);
    const actions = loadCatalog().actions.filter(action => selected.has(action.id) ||
        ['roughCanvas.', 'browser.', 'scratch.'].some(prefix => action.id.startsWith(prefix)));
    assert.equal(actions.length, 17);
    const commandIds = actions.flatMap(action => {
        assert.equal(action.available, false, action.id);
        return action.commands.map(command => command.commandId);
    });
    assert.equal(commandIds.length, 14);
    assert.ok(commandIds.includes('akari.settings.setTimelineDefault'));
    for (const id of commandIds) {
        assert.equal(judgementIds.includes(id), false, `judgement: ${id}`);
        assert.equal(shellIds.includes(id), false, `shell: ${id}`);
    }
});

test('a new shipped action is derived, validated, while an unavailable action stays out', () => {
    const catalog = structuredClone(loadCatalog());
    const action = catalog.actions.find(row => row.id === 'A1');
    action.id = 'example'; action.action = 'setThing'; action.target = 'example';
    action.owner = 'J2'; action.contract = 'example'; action.available = true;
    action.needsUi = ['example.receptor']; catalog.uiReceptors['example.receptor'] = 'shipped';
    action.commands = [{commandId:'akari.example.setThing', argsMap:{name:'value.thing'}}];
    action.valueSchema = {type:'object', properties:{thing:{type:'string', maxLength:4}}, required:['thing'], additionalProperties:false};
    assert.equal(validateCatalog(catalog).ok, true);
    assert.deepEqual(derivedAllowedCommandIds(catalog).slice(0, 33), catalog.baseAllowedCommandIds);
    assert.ok(derivedAllowedCommandIds(catalog).includes('akari.example.setThing'));
    assert.ok(!derivedAllowedCommandIds(catalog).includes('akari.sketch.open'));
    const source = generateJevActions(catalog);
    assert.match(source, /akari\.example\.setThing/);
    const generated = generatedData(catalog);
    assert.ok(generated.derived.includes('akari.example.setThing'));
    const schema = generated.schemas['akari.example.setThing'];
    assert.equal(validateValue(schema, {name:'yes'}), true);
    assert.equal(validateValue(schema, {name:'longer'}), false);
    assert.equal(validateValue(schema, {name:'yes', extra:true}), false);
});

test('the shell and judgement share value-schema decisions', () => {
    const cases = JSON.parse(fs.readFileSync(new URL('../../../../../packages/akari-vibe/test/fixtures/jev-values.json', import.meta.url)));
    for (const row of cases) assert.equal(validateValue(row.schema, row.value), row.ok);
});
