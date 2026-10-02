import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  applyCaptionStylePresets, registerLibraryTextstylePresets,
  registeredLibraryTextstylePresets, resolveTextstyleCatalog, TEXTSTYLE_CATALOG,
  updateCaptionStylePresetInSource,
} from '../lib/index.js';
import { loadTextstyleCatalogSync, readLibraryTextstylePresets, resolveTextstyleLibraryRoots } from '../lib/textstyle-library-node.js';
import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';

const fixtureRoot = fileURLToPath(new URL('./fixtures/library-textstyle/', import.meta.url));

test('built-in ids win and the browser registration is the default library', () => {
  const presets = [
    { id: 'neon', name: 'Other neon', category: 'test', style: { color: '#123456' }, origin: 'library' },
    { id: 'library-gold-sample', name: 'Gold', category: 'test', style: { fill: { type: 'solid', color: '#fff' } }, origin: 'library' },
  ];
  try {
    registerLibraryTextstylePresets(presets);
    assert.equal(registeredLibraryTextstylePresets().length, 2);
    const result = resolveTextstyleCatalog();
    assert.equal(result.catalog.neon, TEXTSTYLE_CATALOG.neon);
    assert.deepEqual(result.conflicts, ['neon']);
    assert.match(result.warnings[0], /captions\.style-preset-library-shadowed: neon/u);
    assert.equal(result.catalog['library-gold-sample'].origin, 'library');
  } finally {
    registerLibraryTextstylePresets([]);
  }
});

test('reader keeps v1 style fields and catalog resolves installed presets', () => {
  const read = readLibraryTextstylePresets({ roots: [fixtureRoot] });
  assert.deepEqual(read.warnings, []);
  assert.deepEqual(read.presets.map(preset => preset.id).sort(), ['library-gold-sample', 'neon']);
  const gold = read.presets.find(preset => preset.id === 'library-gold-sample');
  assert.deepEqual(gold.style.strokes, [
    { color: '#382400', width_px: 9, offset_x: 2, offset_y: 3 },
    { color: '#f3d36d', width_px: 4 },
  ]);
  assert.deepEqual(gold.style.fill.stops.map(stop => stop.at), [0, 50, 100]);
  const catalog = loadTextstyleCatalogSync({ roots: [fixtureRoot] });
  assert.equal(catalog.catalog.neon, TEXTSTYLE_CATALOG.neon);
  assert.deepEqual(catalog.conflicts, ['neon']);
  assert.match(catalog.warnings.join('\n'), /style-preset-library-shadowed/u);
  const resolved = applyCaptionStylePresets([{ id: 'c1', style_preset: 'library-gold-sample' }], catalog.catalog);
  assert.deepEqual(resolved.unresolved, []);
  assert.deepEqual(resolved.root[0].text_style.strokes, gold.style.strokes);
  assert.deepEqual(resolved.root[0].text_style.fill, gold.style.fill);
});

test('reader skips invalid entries and the first root wins', () => {
  const root = mkdtempSync(join(tmpdir(), 'akari-textstyle-reader-'));
  try {
    const good = join(root, 'textstyle', 'library-gold-sample');
    const bad = join(root, 'textstyle', 'broken');
    mkdirSync(good, { recursive: true });
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(good, 'preset.json'), JSON.stringify({ format: 'akari-textstyle', id: 'library-gold-sample', style: { color: '#000' } }));
    writeFileSync(join(bad, 'preset.json'), JSON.stringify({ format: 'wrong', id: 'broken', style: {} }));
    const result = readLibraryTextstylePresets({ roots: [fixtureRoot, root] });
    assert.equal(result.presets.find(preset => preset.id === 'library-gold-sample').style.color, undefined);
    assert.match(result.warnings.join('\n'), /broken/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applying a library preset removes caption overrides that shadow its style', () => {
  const source = JSON.stringify({ captions: [{ id: 'c1', start: 0, end: 1, text: 'Gold',
    text_style: { size_px: 40, color: '#ffffff', strokes: [{ color: '#000000', width_px: 1 }] } }] });
  const catalog = loadTextstyleCatalogSync({ roots: [fixtureRoot] }).catalog;
  const updated = updateCaptionStylePresetInSource(source, ['c1'], 'library-gold-sample', { catalog });
  assert.equal(updated.changed, 1);
  const caption = JSON.parse(updated.source).captions[0];
  assert.equal(caption.style_preset, 'library-gold-sample');
  assert.deepEqual(caption.text_style, { color: '#ffffff' });
});

test('library root mirror follows creator-root for env, home and location migration', () => {
  const root = mkdtempSync(join(tmpdir(), 'akari-textstyle-roots-'));
  try {
    const home = join(root, 'home');
    const selected = join(root, 'selected');
    const previous = join(root, 'previous');
    mkdirSync(home); mkdirSync(selected); mkdirSync(previous);
    const cases = [
      { AKARI_HOME: home },
      { AKARI_HOME: home, AKARI_LIBRARY_ROOT: selected },
      { AKARI_HOME: home, HOME: root },
    ];
    for (const env of cases) {
      assert.deepEqual(resolveTextstyleLibraryRoots(env).read, resolveAssetLibraryRoots(env).read);
    }
    assert.deepEqual(resolveTextstyleLibraryRoots({ HOME: root }, { platform: 'linux' }).read,
      resolveAssetLibraryRoots({ HOME: root }, { platform: 'linux' }).read);
    writeFileSync(join(home, 'library-location.json'), JSON.stringify({ version: 0, state: 'migrating', root: selected, previousRoot: previous }));
    assert.deepEqual(resolveTextstyleLibraryRoots({ AKARI_HOME: home }).read,
      resolveAssetLibraryRoots({ AKARI_HOME: home }).read);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
