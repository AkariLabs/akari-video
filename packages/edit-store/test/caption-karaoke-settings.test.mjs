import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCaptions, insertCaptionLine, updateCaptionTextStyleInSource, mergeCaptionTextStyles } from '../lib/caption-store.js';
import { validateCaptionTextStyle, mergeCaptionDisplayStyles, mergeCaptionLineTextStyles,
  resolveCaptionLineStyleVars } from '../lib/caption-display.js';

const fixture = {
  valid: [
    { done_color: '#fb923c', fill: 'char', start_index: 2 },
    { fill: 'word' }, { fill: 'smooth' }, { done_color: '#ffd94a' }, {}
  ],
  invalid: [
    { done_color: 'orange' }, { fill: 'fade' }, { start_index: -1 },
    { start_index: 1.5 }, { other: true }
  ]
};
const schema = JSON.parse(readFileSync(new URL('../../schemas/captions.schema.json', import.meta.url), 'utf8'));
const validator = fileURLToPath(new URL('../../schemas/bin/validate-captions.mjs', import.meta.url));
const row = { id: 'c-0001', start: 0, end: 2, text: 'あいう', speaker: null, sourceRef: null, edited: false };

function validateCli(style) {
  const dir = mkdtempSync(join(tmpdir(), 'akari-karaoke-'));
  try {
    const path = join(dir, 'captions.json');
    writeFileSync(path, JSON.stringify([{ ...row, text_style: { karaoke: style } }]));
    return spawnSync(process.execPath, [validator, path], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('karaoke parity fixture matches schema, strict display validation and CLI', () => {
  const properties = schema.$defs.textStyle.properties.karaoke.properties;
  assert.deepEqual(properties.fill.enum, ['char', 'word', 'smooth']);
  assert.equal(properties.start_index.minimum, 0);
  for (const karaoke of fixture.valid) {
    assert.deepEqual(validateCaptionTextStyle({ karaoke }), { karaoke });
    assert.equal(validateCli(karaoke).status, 0, JSON.stringify(karaoke));
  }
  for (const karaoke of fixture.invalid) {
    assert.throws(() => validateCaptionTextStyle({ karaoke }), JSON.stringify(karaoke));
    assert.notEqual(validateCli(karaoke).status, 0, JSON.stringify(karaoke));
  }
});

test('karaoke parses, merges default by field, updates surgically and round trips', () => {
  const source = JSON.stringify([{ ...row, text_style: { color: '#ffffff', karaoke: { done_color: '#fb923c', fill: 'char' } } }]);
  const parsed = parseCaptions(source).captions[0].textStyle;
  assert.deepEqual(parsed.karaoke, { doneColor: '#fb923c', fill: 'char' });
  assert.deepEqual(mergeCaptionTextStyles({ karaoke: { doneColor: '#ffd94a', startIndex: 1 } }, parsed).karaoke,
    { doneColor: '#fb923c', startIndex: 1, fill: 'char' });
  const updated = updateCaptionTextStyleInSource(source, row.id, { karaoke: { startIndex: 2 } });
  assert.deepEqual(JSON.parse(updated)[0].text_style.karaoke,
    { done_color: '#fb923c', fill: 'char', start_index: 2 });
  const inserted = insertCaptionLine('[]', { ...parseCaptions(updated).captions[0], id: 'c-0002' });
  assert.deepEqual(JSON.parse(inserted)[0].text_style.karaoke,
    { done_color: '#fb923c', fill: 'char', start_index: 2 });
});

test('highlight variable is absent without settings and inherits overridden done color', () => {
  assert.equal(resolveCaptionLineStyleVars({}, undefined)['--caption-highlight-color'], undefined);
  const merged = mergeCaptionDisplayStyles({ karaoke: { done_color: '#ffd94a', fill: 'char' } },
    { karaoke: { done_color: '#fb923c' } });
  assert.deepEqual(merged.karaoke, { done_color: '#fb923c', fill: 'char' });
  assert.equal(resolveCaptionLineStyleVars(merged, undefined)['--caption-highlight-color'], '#fb923c');
  const line = mergeCaptionLineTextStyles({ karaoke: { done_color: '#ffd94a', fill: 'word' } },
    { karaoke: { done_color: '#fb923c' } });
  assert.deepEqual(line.karaoke, { done_color: '#fb923c', fill: 'word' });
  assert.equal(resolveCaptionLineStyleVars(line, undefined)['--caption-highlight-color'], '#fb923c');
});
