import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCube, readLut, sampleLutTrilinear, renderLutPreview, renderReferenceFrame } from '../preview-art.mjs';
import { CELL_WIDTH, CELL_HEIGHT, renderTransition, sourcePixel, transitionVocabulary } from '../../transitions/preview-art.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const records = path => readFileSync(join(root, path), 'utf8').trim().split('\n').map(JSON.parse);
const digest = path => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');

test('identity LUT and known LUT pixel use trilinear interpolation', () => {
  const rows = [];
  for (let b = 0; b < 2; b += 1) for (let g = 0; g < 2; g += 1) for (let r = 0; r < 2; r += 1)
    rows.push(`${r} ${g} ${b}`);
  const identity = parseCube(`LUT_3D_SIZE 2\n${rows.join('\n')}\n`);
  const input = [.4, .3, .2];
  sampleLutTrilinear(identity, input).forEach((value, i) => assert.ok(Math.abs(value - input[i]) < 1e-7));
  const natural = readLut(join(root, 'presets/luts/natural/natural.cube'));
  const actual = sampleLutTrilinear(natural, input);
  const expected = [.40380859756469734, .2824424533843994, .16235959947109221];
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-7));
  const art = renderLutPreview(natural);
  assert.equal(art.width, 320);
  assert.equal(art.height, 180);
  const before = art.palette[art.indices[80 * art.width + 76]];
  const after = art.palette[art.indices[80 * art.width + 236]];
  assert.notDeepEqual(after, before);
});

test('reference frame contains sky, gray and skin ramps', () => {
  const art = renderReferenceFrame();
  const colors = (fromX, toX, fromY, toY) => {
    const found = new Set();
    for (let y = fromY; y < toY; y += 1) for (let x = fromX; x < toX; x += 1)
      found.add(art.indices[y * art.width + x]);
    return found;
  };
  assert.deepEqual(colors(0, 30, 0, 74), new Set([0, 1]));
  assert.deepEqual(colors(0, 160, 164, 180), new Set([2, 3, 4]));
  assert.deepEqual(colors(64, 89, 65, 102), new Set([5, 6]));
});

// One fixed pixel in the 50% frame for every vocabulary entry. These are the
// displayed palette RGB values, so changes to the sampled movement are visible.
const midPixels = [
  ['dissolve',17,8,'27,93,143'], ['fade',30,15,'126,99,104'],
  ['fade-black',43,22,'0,0,0'], ['fade-white',56,29,'172,217,204'],
  ['fade-grays',69,36,'93,97,103'], ['wipe-left',82,43,'225,104,65'],
  ['wipe-right',24,12,'225,104,65'], ['wipe-up',37,19,'145,219,237'],
  ['wipe-down',50,26,'225,104,65'], ['radial',63,33,'225,104,65'],
  ['slide-left',76,40,'225,104,65'], ['slide-right',18,9,'225,104,65'],
  ['slide-up',31,16,'27,93,143'], ['slide-down',44,23,'225,104,65'],
  ['cover-left',57,30,'225,104,65'], ['cover-right',70,37,'27,93,143'],
  ['cover-up',83,44,'225,104,65'], ['cover-down',25,13,'225,104,65'],
  ['reveal-left',38,20,'27,93,143'], ['reveal-right',51,27,'27,93,143'],
  ['reveal-down',64,34,'27,93,143'], ['reveal-up',77,41,'225,104,65'],
  ['circle-open',19,10,'27,93,143'], ['circle-close',32,17,'27,93,143'],
  ['zoom-in',45,24,'27,93,143'], ['squeeze-h',58,31,'145,219,237'],
  ['squeeze-v',71,38,'27,93,143'], ['blur',84,45,'126,99,104'],
  ['pixelize',26,14,'126,99,104'],
];

test('each transition has a fixed midpoint pixel and a five-frame strip', () => {
  const vocabulary = transitionVocabulary();
  assert.equal(vocabulary.length, 29);
  assert.deepEqual(vocabulary.map(entry => entry.id), midPixels.map(([id]) => id));
  for (const [id, x, y, expected] of midPixels) {
    const entry = vocabulary.find(item => item.id === id);
    const art = renderTransition(entry.previewKind, [0, .5, 1]);
    const color = art.palette[art.indices[y * art.width + 96 + x]];
    assert.equal(color.join(','), expected, id);
    const strip = renderTransition(entry.previewKind, [0, .25, .5, .75, 1]);
    assert.equal(strip.width, 480);
    assert.equal(strip.height, 54);
    assert.equal(strip.indices[y * strip.width + 2 * 96 + x], art.indices[y * art.width + 96 + x], id);
  }
});

test('all 29 transitions start with the untouched A image and end with the untouched B image', () => {
  const expected = Object.fromEntries(['a', 'b'].map(which => {
    const bytes = new Uint8Array(CELL_WIDTH * CELL_HEIGHT * 3);
    for (let y = 0; y < CELL_HEIGHT; y += 1) for (let x = 0; x < CELL_WIDTH; x += 1)
      bytes.set(sourcePixel(which, x, y), (y * CELL_WIDTH + x) * 3);
    return [which, bytes];
  }));
  for (const entry of transitionVocabulary()) for (const frames of [[0, .5, 1], [0, .25, .5, .75, 1]]) {
    const art = renderTransition(entry.previewKind, frames);
    for (const [which, frame] of [['a', 0], ['b', frames.length - 1]]) {
      const actual = new Uint8Array(expected[which].length);
      for (let y = 0; y < CELL_HEIGHT; y += 1) for (let x = 0; x < CELL_WIDTH; x += 1)
        actual.set(art.palette[art.indices[y * art.width + frame * CELL_WIDTH + x]],
          (y * CELL_WIDTH + x) * 3);
      assert.ok(Buffer.from(actual).equals(Buffer.from(expected[which])),
        `${entry.id}: ${frames.length} frames, ${which} endpoint differs`);
    }
  }
});

test('two full bakes are byte-identical; every index preview exists within budget', () => {
  const run = () => {
    const result = spawnSync(process.execPath, ['presets/luts/bake-previews.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const snapshot = () => {
    const luts = records('presets/luts/index.jsonl');
    const transitions = records('presets/transitions/index.jsonl');
    assert.equal(luts.length, 10);
    assert.equal(transitions.length, 29);
    assert.deepEqual(transitions.map(entry => entry.id), transitionVocabulary().map(entry => entry.id));
    const files = ['presets/luts/index.jsonl', 'presets/luts/reference-frame.webp', 'presets/transitions/index.jsonl',
      'evidence/v1-preset-previews/contact-sheet.png'];
    let lutBytes = 0; let transitionBytes = 0;
    for (const [directory, rows, keys] of [
      ['luts', luts, ['preview']], ['transitions', transitions, ['preview', 'preview_strip']],
    ]) for (const row of rows) for (const key of keys) {
      const path = `presets/${directory}/${row[key]}`;
      assert.ok(existsSync(join(root, path)), path);
      const bytes = readFileSync(join(root, path));
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 16), 'WEBPVP8L');
      assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
      if (directory === 'luts') lutBytes += bytes.length; else transitionBytes += bytes.length;
      files.push(path);
    }
    lutBytes += statSync(join(root, 'presets/luts/reference-frame.webp')).size;
    assert.ok(lutBytes <= 200_000, `LUT previews: ${lutBytes} bytes`);
    assert.ok(transitionBytes <= 1_000_000, `transition previews: ${transitionBytes} bytes`);
    assert.ok(luts.every(entry => statSync(join(root, 'presets/luts', entry.preview)).size <= 20_000));
    return Object.fromEntries(files.map(path => [path, digest(path)]));
  };
  run(); const first = snapshot();
  run(); const second = snapshot();
  assert.deepEqual(second, first);
});
