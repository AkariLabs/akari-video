import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { INSPECTOR_LOOK_PRESETS, matchLookPreset } from '../lib/browser/inspector/look-presets.js';
import { updateInspectorAdjust } from '../lib/browser/inspector/adjust-fields.js';
import { buildLutOptions, lutOptionLabel } from '../lib/browser/inspector/lut-options.js';
import { nextAdjustCompareState } from '../lib/browser/inspector/adjust-compare.js';
import * as fields from '../lib/browser/inspector/adjust-fields.js';

const root = new URL('../../../../../presets/looks/', import.meta.url);
const catalog = readFileSync(new URL('index.jsonl', root), 'utf8').trim().split(/\r?\n/u)
  .map(JSON.parse).filter(entry => entry.kind === 'look').map(({ id, name }) => ({
    id, name, adjust: JSON.parse(readFileSync(new URL(`${id}.json`, root), 'utf8')).adjust
  }));

test('look catalog ids, names and exact adjustments match in order', () => {
  assert.deepEqual(INSPECTOR_LOOK_PRESETS, catalog);
});
test('missing look is named in synchronization assertion', () => {
  assert.throws(() => assert.deepEqual(catalog.slice(1), INSPECTOR_LOOK_PRESETS), error => {
    assert.equal(error.code, 'ERR_ASSERTION');
    assert.ok(error.message.includes(catalog[0].name));
    return true;
  });
});
for (const preset of catalog) test(`look matching and tolerance: ${preset.name}`, () => {
  assert.equal(matchLookPreset(preset.adjust), preset.id);
  for (const [delta, expected] of [[0.01, undefined], [1e-7, preset.id], [1e-5, undefined]]) {
    assert.equal(matchLookPreset({ ...preset.adjust, basic: {
      ...preset.adjust.basic, exposure: (preset.adjust.basic?.exposure ?? 0) + delta
    }, lut: { lut: 'natural' }, sections: { basic: false } }), expected);
  }
});
test('look replaces basic and wheels in one write and preserves other adjustments', () => {
  const preserved = { lut: { lut: 'natural', intensity: 0.4 }, curves: { r: [{ in: 0, out: 0.1 }] },
    hue: { hue: [{ hue: 0, value: 0.6 }] }, sections: { basic: false }, future: { value: 1 } };
  const current = { ...preserved, basic: { exposure: 2, vibrance: 0.7 }, wheels: { offset: { r: 0.1 } } };
  const before = structuredClone(current);
  assert.deepEqual(updateInspectorAdjust(current, 'adjust', catalog[0].adjust), { ...preserved, ...catalog[0].adjust });
  assert.deepEqual(current, before);
  assert.deepEqual(updateInspectorAdjust(current, 'adjust', null), preserved);
  assert.equal(updateInspectorAdjust({}, 'adjust', { basic: { exposure: 0 }, wheels: { lift: { r: 0 } } }), null);
  for (const invalid of [[], 4, { basic: [] }, { basic: { wrong: 1 } }, { basic: { exposure: 4 } },
    { wheels: { wrong: {} } }, { wheels: { lift: { r: 1 } } }, { wheels: [] }]) {
    assert.throws(() => updateInspectorAdjust(current, 'adjust', invalid), /[ぁ-んァ-ヶ一-龠]/u);
  }
});
test('LUT labels compose bundled and project options and round trip values', () => {
  const options = buildLutOptions(['assets/luts/My.CUBE']);
  assert.equal(options.length, 12);
  assert.deepEqual(options[0], { label: 'なし', value: null });
  assert.deepEqual(options.at(-1), { label: 'My.CUBE（プロジェクト）', value: 'assets/luts/My.CUBE' });
  assert.equal(lutOptionLabel('unknown'), 'unknown');
  assert.equal(lutOptionLabel(undefined), 'なし');
  assert.equal(updateInspectorAdjust({ lut: { lut: 'natural', intensity: 0.4 } }, 'adjust.lut.lut', options.at(-1).value).lut.intensity, 0.4);
});
test('compare releases once on selection change, tab departure and disposal', () => {
  const target = { kind: 'cut', index: 0 };
  const current = { target, enabled: true };
  assert.equal(nextAdjustCompareState(current, { target: { ...target }, activeTab: 'adjust' }).state, current);
  for (const next of [{ target: { kind: 'cut', index: 1 }, activeTab: 'adjust' },
    { target, activeTab: 'video' }, { activeTab: '' }]) {
    const result = nextAdjustCompareState(current, next);
    assert.deepEqual(result, { state: undefined, release: target });
    assert.equal(nextAdjustCompareState(result.state, next).release, undefined);
  }
});

test('look row sends exactly one replacement request and custom sends none', async () => {
  const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function ADJUST_SECTIONS(');
  const factory = source.slice(start, source.indexOf('\n/**', start));
  const dependencies = { readInspectorAdjustSnapshot: fields.readInspectorAdjustSnapshot,
    INSPECTOR_ADJUST_BASIC_FIELDS: fields.INSPECTOR_ADJUST_BASIC_FIELDS,
    formatInspectorAdjustValue: fields.formatInspectorAdjustValue,
    createInspectorAdjustWriteRequest: fields.createInspectorAdjustWriteRequest,
    INSPECTOR_LOOK_PRESETS, matchLookPreset, buildLutOptions,
    ACTIVE_ADJUST_SECTIONS: ['基本補正', 'RGB', 'ホイール', 'Hue', 'LUT'] };
  const js = ts.transpileModule(factory, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const sections = new Function(...Object.keys(dependencies), js + '; return ADJUST_SECTIONS;')(...Object.values(dependencies));
  const writes = [];
  const snapshot = { kind: 'item', id: 'media-1', adjust: {} };
  const write = async request => { writes.push(request); return { ok: true }; };
  const row = sections(snapshot, write, { projectLutRefs: [] })[0].fields[0];
  assert.equal(row.name, 'adjust-look');
  assert.equal(row.getValue(), 'カスタム');
  await row.write(snapshot, catalog[0].name);
  assert.deepEqual(writes, [{ kind: 'item-field', id: 'media-1', path: 'adjust', value: catalog[0].adjust }]);
  await row.write(snapshot, 'カスタム');
  assert.equal(writes.length, 1);
  assert.equal((await row.write(snapshot, 'missing')).ok, false);
  const disabled = sections({ ...snapshot, adjust: { sections: { basic: false } } }, write, { projectLutRefs: [] })[0].fields[0];
  assert.equal((await disabled.write(snapshot, catalog[0].name)).ok, false);
  assert.equal(writes.length, 1);
});
