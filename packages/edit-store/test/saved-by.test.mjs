import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SAVED_BY_PATH as WRITE_GATE_SAVED_BY_PATH, setDefaultSavedByAppVersion, writeProjectFilesGuarded, writeSavedByStamp } from '../lib/write-gate.js';
import {
  SAVED_BY_PATH, parseSavedBy, newerSavedByVersion, withNewerVersionLintPrefix
} from '../lib/index.js';
import { compareVersions } from '../../akari-launcher/src/update-check.mjs';

test('ブラウザ入口と Node 書き込み口のスタンプ相対パスは一致する', () => {
  assert.equal(SAVED_BY_PATH, WRITE_GATE_SAVED_BY_PATH);
});

const options = { appVersion: '0.1.86', debounceMs: 1, lintRunner: async () => ({ pass: true, errors: [], findings: [] }) };

test('edit.json の保存だけが writer stamp を更新し、版不明の保存は古い stamp を消す', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-saved-by-'));
  const stampPath = join(root, SAVED_BY_PATH);
  try {
    await writeProjectFilesGuarded(root, { 'edit.json': '{"version":2}' }, options);
    const first = await readFile(stampPath, 'utf8');
    const stamp = parseSavedBy(first);
    assert.equal(stamp?.version, 1);
    assert.equal(stamp?.app, 'akari-video');
    assert.equal(stamp?.appVersion, '0.1.86');
    assert.ok(!Number.isNaN(Date.parse(stamp.savedAt)));
    await writeProjectFilesGuarded(root, { 'captions.json': '{}' }, { ...options, appVersion: '9.9.9' });
    assert.equal(await readFile(stampPath, 'utf8'), first);
    await writeProjectFilesGuarded(root, { 'edit.json': '{"version":2,"cuts":[]}' }, { ...options, appVersion: undefined });
    await assert.rejects(readFile(stampPath, 'utf8'), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('新しい版だけを検出し、検証前置きは版があるときだけ付く', () => {
  const text = JSON.stringify({ version: 1, app: 'akari-video', appVersion: '9.9.9', savedAt: '2026-09-26T00:00:00.000Z' });
  assert.equal(newerSavedByVersion(text, '0.1.86', compareVersions), '9.9.9');
  assert.equal(newerSavedByVersion(text, '9.9.9', compareVersions), undefined);
  assert.equal(newerSavedByVersion(undefined, '0.1.86', compareVersions), undefined);
  const message = '保存後の検証で問題が見つかりました: [v2.mask-video]';
  assert.equal(withNewerVersionLintPrefix(message), message);
  assert.match(withNewerVersionLintPrefix(message, '9.9.9'), /^このプロジェクトは新しい版（v9\.9\.9）で保存されています。.*保存後の検証で問題が見つかりました/s);
});

test('プロセス既定の版は options 未指定の保存に使われ、明示版が優先する', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-saved-by-default-'));
  try {
    setDefaultSavedByAppVersion('0.1.87');
    await writeProjectFilesGuarded(root, { 'edit.json': 'first' }, { ...options, appVersion: undefined });
    assert.equal(parseSavedBy(await readFile(join(root, SAVED_BY_PATH), 'utf8'))?.appVersion, '0.1.87');
    await writeProjectFilesGuarded(root, { 'edit.json': 'second' }, options);
    assert.equal(parseSavedBy(await readFile(join(root, SAVED_BY_PATH), 'utf8'))?.appVersion, '0.1.86');
  } finally {
    setDefaultSavedByAppVersion(undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI 用ヘルパーは edit.json に触らず stamp だけを atomic 保存・消去する', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-saved-by-cli-'));
  try {
    await writeSavedByStamp(root, '0.1.86');
    assert.equal(parseSavedBy(await readFile(join(root, SAVED_BY_PATH), 'utf8'))?.appVersion, '0.1.86');
    await assert.rejects(readFile(join(root, 'edit.json'), 'utf8'), { code: 'ENOENT' });
    await writeSavedByStamp(root, undefined);
    await assert.rejects(readFile(join(root, SAVED_BY_PATH), 'utf8'), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
