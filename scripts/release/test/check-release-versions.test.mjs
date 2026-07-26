import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkReleaseVersions, parseTag } from '../check-release-versions.mjs';

async function withFixtureRepo(versions, callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-release-gate-test-'));
  try {
    await mkdir(join(root, 'apps/shell'), { recursive: true });
    await mkdir(join(root, 'packages/akari-launcher'), { recursive: true });
    await mkdir(join(root, 'plugin/.claude-plugin'), { recursive: true });
    if (versions.shell !== undefined) {
      await writeFile(join(root, 'apps/shell/package.json'), JSON.stringify({ version: versions.shell }), 'utf8');
    }
    if (versions.cli !== undefined) {
      await writeFile(
        join(root, 'packages/akari-launcher/package.json'),
        JSON.stringify({ version: versions.cli }),
        'utf8'
      );
    }
    if (versions.plugin !== undefined) {
      await writeFile(
        join(root, 'plugin/.claude-plugin/plugin.json'),
        JSON.stringify({ version: versions.plugin }),
        'utf8'
      );
    }
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('parseTag: vX.Y.Z を受理し X.Y.Z を返す。それ以外は null', () => {
  assert.equal(parseTag('v0.1.0'), '0.1.0');
  assert.equal(parseTag('v1.2.3'), '1.2.3');
  assert.equal(parseTag('0.1.0'), null);
  assert.equal(parseTag('v0.1'), null);
  assert.equal(parseTag('vX.Y.Z'), null);
  assert.equal(parseTag(''), null);
  assert.equal(parseTag(undefined), null);
});

test('checkReleaseVersions: 一致ケース — shell/cli/plugin が全てタグと同じ version で PASS', async () => {
  await withFixtureRepo({ shell: '0.1.0', cli: '0.1.0', plugin: '0.1.0' }, async (repoRoot) => {
    const result = await checkReleaseVersions('v0.1.0', { repoRoot });
    assert.equal(result.ok, true);
    assert.equal(result.tagVersion, '0.1.0');
    assert.deepEqual(result.mismatches, []);
    assert.ok(result.messages[0].includes('PASS'));
  });
});

test('checkReleaseVersions: 不一致ケース — shell だけズレていたら FAIL し、ラベル付きで報告する', async () => {
  await withFixtureRepo({ shell: '0.0.1', cli: '0.1.0', plugin: '0.1.0' }, async (repoRoot) => {
    const result = await checkReleaseVersions('v0.1.0', { repoRoot });
    assert.equal(result.ok, false);
    assert.equal(result.mismatches.length, 1);
    assert.match(result.mismatches[0].label, /shell/);
    assert.match(result.mismatches[0].reason, /0\.0\.1/);
    assert.ok(result.messages.some((m) => m.includes('shell')));
    assert.ok(result.messages[0].includes('FAIL'));
  });
});

test('checkReleaseVersions: 不一致ケース — 複数コンポーネントがズレていたら全部報告する', async () => {
  await withFixtureRepo({ shell: '0.0.1', cli: '0.2.0', plugin: '0.1.0' }, async (repoRoot) => {
    const result = await checkReleaseVersions('v0.1.0', { repoRoot });
    assert.equal(result.ok, false);
    assert.equal(result.mismatches.length, 2);
    const labels = result.mismatches.map((m) => m.label).join('\n');
    assert.match(labels, /shell/);
    assert.match(labels, /cli/);
  });
});

test('checkReleaseVersions: version フィールド欠落は不一致として扱う', async () => {
  await withFixtureRepo({ shell: '0.1.0', cli: '0.1.0', plugin: undefined }, async (repoRoot) => {
    await writeFile(join(repoRoot, 'plugin/.claude-plugin/plugin.json'), JSON.stringify({ name: 'akari' }), 'utf8');
    const result = await checkReleaseVersions('v0.1.0', { repoRoot });
    assert.equal(result.ok, false);
    assert.equal(result.mismatches.length, 1);
    assert.match(result.mismatches[0].label, /plugin/);
  });
});

test('checkReleaseVersions: 読み込み不能な package.json は不一致として報告する（存在しないパス）', async () => {
  await withFixtureRepo({ shell: '0.1.0', cli: '0.1.0' }, async (repoRoot) => {
    // plugin.json を意図的に作らない
    const result = await checkReleaseVersions('v0.1.0', { repoRoot });
    assert.equal(result.ok, false);
    const pluginMismatch = result.mismatches.find((m) => /plugin/.test(m.label));
    assert.ok(pluginMismatch, 'plugin の読み込み失敗が mismatches に含まれること');
    assert.match(pluginMismatch.reason, /読み込み失敗/);
  });
});

test('checkReleaseVersions: タグ名の形式が不正なら version 読み込みより先にエラーを返す', async () => {
  const result = await checkReleaseVersions('0.1.0', { repoRoot: '/path/does/not/exist' });
  assert.equal(result.ok, false);
  assert.equal(result.tagVersion, null);
  assert.equal(result.mismatches.length, 0);
  assert.ok(result.messages[0].includes('形式'));
});
