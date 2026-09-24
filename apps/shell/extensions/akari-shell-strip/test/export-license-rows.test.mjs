import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLicenseRows } from '../lib/browser/export-dialog/export-license-rows.js';

const finding = (check, name, credit = '') => ({ check, details: { asset: name, name, credit } });

test('license rows show counts, first three names, overflow and copy text', () => {
  const rows = buildLicenseRows([
    ...['一', '二', '三', '四'].map(name => finding('license.non-commercial', name)),
    finding('license.unknown', '不明'),
    finding('license.attribution', '表示', '表示する文面'),
  ]);
  assert.deepEqual(rows.map(row => [row.kind, row.label]), [
    ['non-commercial', '商用利用できない素材が 4 件'],
    ['unknown', 'ライセンスが分からない素材が 1 件'],
    ['attribution', '帰属表示が必要な素材が 1 件'],
  ]);
  assert.equal(rows[0].preview, '一、二、三、ほか 1 件');
  assert.deepEqual(rows[2].credits, ['表示する文面']);
  assert.deepEqual(buildLicenseRows([]), []);
});
