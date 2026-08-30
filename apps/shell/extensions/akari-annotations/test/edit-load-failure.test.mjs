import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readEditV2 } from '@akari-video/edit-store/lib/edit-v2.js';
import { classifyEditLoadFailure, ReportedEditLoadFailure } from '../lib/common/edit-load-failure.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = new URL('../../../../../packages/edit-store/test/fixtures/edit-v2.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

test('v2 の未定義 item キーを検証した例外はメッセージ全文つきの notice になる', () => {
  const invalid = structuredClone(fixture);
  invalid.tracks[0].items[0].source.name = '未定義キー';

  let validationError;
  try {
    readEditV2(invalid);
  } catch (error) {
    validationError = error;
  }

  assert.ok(validationError instanceof Error);
  const failure = classifyEditLoadFailure(validationError);
  assert.equal(failure.kind, 'invalid');
  assert.equal(failure.notice, `edit.json を読み込めませんでした: ${validationError.message}`);
  assert.match(failure.notice, /未定義キーを使用できません: name/);
});

test('Theia の 2 種類の NotFound 相当エラーは missing になる', () => {
  assert.deepEqual(classifyEditLoadFailure({ fileOperationResult: 1 }), { kind: 'missing' });
  assert.deepEqual(classifyEditLoadFailure({ code: 'EntryNotFound' }), { kind: 'missing' });
});

test('正常な v2 edit.json では分類器に到達しない', () => {
  let classified = false;
  try {
    assert.equal(readEditV2(fixture).version, 2);
  } catch (error) {
    classified = true;
    classifyEditLoadFailure(error);
  }
  assert.equal(classified, false);
});

test('旧版 edit.json の変換 blockers を通知済みの失敗は notice を上書きしない', () => {
  assert.deepEqual(
    classifyEditLoadFailure(new ReportedEditLoadFailure('古い edit.json を読み取り専用で開けません。')),
    { kind: 'reported' }
  );

  const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');
  const reloadStart = source.indexOf('protected async reloadEdit');
  const resolveStart = source.indexOf('protected async resolveLegacyEditForOpen', reloadStart);
  const reloadMethod = source.slice(reloadStart, resolveStart);
  const resolveEnd = source.indexOf('protected setLegacyReadOnly', resolveStart);
  const resolveMethod = source.slice(resolveStart, resolveEnd);

  assert.match(resolveMethod, /planned\.blockers\.join\('\s*\/\s*'\)[\s\S]*return undefined/);
  assert.match(reloadMethod, /throw new ReportedEditLoadFailure\(/);
});

test('reloadEdit は読み込み例外を分類し、invalid を notice と console に出す', () => {
  const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');
  const start = source.indexOf('protected async reloadEdit');
  const end = source.indexOf('protected async resolveLegacyEditForOpen', start);
  const method = source.slice(start, end);

  assert.match(
    method,
    /catch \(error\) \{[\s\S]*classifyEditLoadFailure\(error\)[\s\S]*failure\.kind === 'invalid'[\s\S]*this\.showNotice\(failure\.notice\)[\s\S]*console\.error\('\[akari-annotations\] edit\.json を読み込めませんでした', error\)/
  );
});
