import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { fontNames, readFontNames, matchFontCatalog } from '../src/font-names.mjs';

function sfnt(records, signature = 'ttf') {
  const strings = records.map(row => {
    if (row.bytes) return row.bytes;
    const bytes = Buffer.alloc(row.value.length * 2);
    for (let i = 0; i < row.value.length; i++) bytes.writeUInt16BE(row.value.charCodeAt(i), i * 2);
    return bytes;
  });
  const length = 6 + records.length * 12 + strings.reduce((sum, bytes) => sum + bytes.length, 0);
  const bytes = Buffer.alloc(28 + length);
  if (signature === 'otf') bytes.write('OTTO', 0, 'ascii'); else bytes.writeUInt32BE(0x00010000, 0);
  bytes.writeUInt16BE(1, 4);
  bytes.write('name', 12, 'ascii');
  bytes.writeUInt32BE(28, 20);
  bytes.writeUInt32BE(length, 24);
  bytes.writeUInt16BE(records.length, 30);
  bytes.writeUInt16BE(6 + records.length * 12, 32);
  let offset = 0;
  for (let i = 0; i < records.length; i++) {
    const row = records[i], at = 34 + i * 12;
    bytes.writeUInt16BE(row.platform ?? 3, at);
    bytes.writeUInt16BE(row.encoding ?? 1, at + 2);
    bytes.writeUInt16BE(row.language ?? 0x0409, at + 4);
    bytes.writeUInt16BE(row.id, at + 6);
    bytes.writeUInt16BE(strings[i].length, at + 8);
    bytes.writeUInt16BE(offset, at + 10);
    strings[i].copy(bytes, 34 + records.length * 12 + offset);
    offset += strings[i].length;
  }
  return bytes;
}

test('Japanese family, preferred family, full and PostScript names are collected', () => {
  const names = fontNames(sfnt([
    { id: 1, value: 'English Family' }, { id: 1, value: '日本語書体', language: 0x0411 },
    { id: 16, value: 'Preferred Family' }, { id: 4, value: 'Preferred Family Regular' },
    { id: 6, value: 'PreferredFamily-Regular' },
  ]));
  assert.equal(names.family, 'Preferred Family');
  assert.equal(names.familyJa, '日本語書体');
  assert.ok(names.all.includes('PreferredFamily-Regular'));
  assert.ok(names.fullNames.includes('Preferred Family Regular'));
  assert.equal(fontNames(Buffer.from('broken')), undefined);
  assert.equal(fontNames(Buffer.from('wOF2' + '\0'.repeat(20))), undefined);
});

test('Mac Japanese names decode as Shift JIS while unsupported encodings are ignored', () => {
  const names = fontNames(sfnt([
    { id: 1, value: 'English Family' },
    { id: 1, platform: 1, encoding: 1, language: 11, bytes: Buffer.from([0x82, 0xa0]) },
    { id: 4, platform: 1, encoding: 2, language: 11, bytes: Buffer.from([0x82, 0xa0]) },
  ]));
  assert.equal(names.familyJa, 'あ');
  assert.equal(names.family, 'English Family');
  assert.ok(names.all.includes('あ'));
});

test('TTC first face and WOFF name table use the same names; positioned reads skip glyph bytes', t => {
  const face = sfnt([{ id: 1, value: 'First Family' }, { id: 4, value: 'First Family Regular' }], 'otf');
  const ttc = Buffer.alloc(16 + face.length);
  ttc.write('ttcf', 0, 'ascii');
  ttc.writeUInt32BE(1, 8);
  ttc.writeUInt32BE(16, 12);
  face.copy(ttc, 16);
  ttc.writeUInt32BE(44, 16 + 20);
  assert.equal(fontNames(ttc).family, 'First Family');
  assert.equal(fontNames(ttc).familyJa, undefined);
  const table = face.subarray(28);
  const zipped = deflateSync(table);
  const woff = Buffer.alloc(64 + zipped.length);
  woff.write('wOFF', 0, 'ascii');
  woff.writeUInt16BE(1, 12);
  woff.write('name', 44, 'ascii');
  woff.writeUInt32BE(64, 48);
  woff.writeUInt32BE(zipped.length, 52);
  woff.writeUInt32BE(table.length, 56);
  zipped.copy(woff, 64);
  assert.equal(fontNames(woff).family, 'First Family');
  const root = mkdtempSync(join(tmpdir(), 'font-names-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'first.woff');
  writeFileSync(file, Buffer.concat([woff, Buffer.alloc(100_000)]));
  assert.equal(readFontNames(file).family, 'First Family');
  assert.equal(matchFontCatalog(['-'], [{ id: 'x', title: '_', aliases: [] }]), undefined);
});
