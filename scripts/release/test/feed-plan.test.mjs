import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertReleaseFlags, compareReleaseVersions, planFeedFiles } from '../feed-plan.mjs';
import { prepareFeedUpload } from '../prepare-feed-upload.mjs';

test('リリースのタグ形とフラグを検査する', () => {
  assert.equal(assertReleaseFlags('v1.1.0-beta.1', { isPrerelease: true }), 'prerelease');
  assert.equal(assertReleaseFlags('v1.1.0', { isPrerelease: false, stableInput: true }), 'stable');
  assert.equal(assertReleaseFlags('v1.1.0', { stableInput: false }), 'stable');
  assert.throws(() => assertReleaseFlags('v1.1.0-beta.1', { stableInput: true }), /一致/);
  assert.throws(() => assertReleaseFlags('v1.1.0-beta.1', { isPrerelease: false }), /一致/);
  assert.throws(() => assertReleaseFlags('v1.1.0', { isPrerelease: true }), /一致/);
});

test('安定版は beta より新しく、次の beta より古い', () => {
  const versions = ['1.0.2', '1.1.0-beta.1', '1.1.0-beta.2', '1.1.0', '1.1.1', '1.2.0-beta.1'];
  for (let i = 1; i < versions.length; i++) assert.equal(compareReleaseVersions(versions[i - 1], versions[i]), -1);
});

test('beta は prerelease 系列だけ、stable は旧 beta より新しい時だけ両系列', () => {
  assert.deepEqual(planFeedFiles('v1.1.0-beta.2', '1.1.0-beta.1').files,
    ['prerelease.json', 'prerelease.yml', 'prerelease-mac.yml']);
  assert.equal(planFeedFiles('v1.1.0', '1.1.0-beta.3').updatePrerelease, true);
  assert.equal(planFeedFiles('v1.1.1', '1.2.0-beta.1').updatePrerelease, false);
  assert.deepEqual(planFeedFiles('v1.1.0-beta.1', '1.1.0-beta.2').files, []);
  assert.equal(planFeedFiles('v1.1.0', null).updatePrerelease, true);
});

test('dry_run もタグ形を通り、ビルドメタデータ名は固定', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /resolve-tag:[\s\S]*assertReleaseFlags[\s\S]*dry_run/);
  assert.match(workflow, /--config\.detectUpdateChannel=false/g);
  assert.match(workflow, /npm publish --provenance --access public --tag/);
});

test('feed-only の実ファイル: beta は prerelease だけ、安定版は比較に応じて両系列', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-feed-plan-'));
  try {
    const input = join(root, 'input'), output = join(root, 'output');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(input);
    const manifest = version => `version: ${version}\nfiles:\n  - url: shell-win-setup.exe\npath: shell-win-setup.exe\n`;
    async function seed(version, channel) {
      await writeFile(join(input, 'latest.json'), JSON.stringify({ product: version, channel }));
      await writeFile(join(input, 'latest.yml'), manifest(version));
      await writeFile(join(input, 'latest-mac.yml'), manifest(version));
    }
    await seed('1.1.0-beta.1', 'prerelease');
    const betaFiles = await prepareFeedUpload('v1.1.0-beta.1', input, output);
    assert.deepEqual(betaFiles, ['prerelease.json', 'prerelease.yml', 'prerelease-mac.yml']);
    assert.deepEqual((await readdir(output)).sort(), [...betaFiles].sort());
    assert.match(await readFile(join(output, 'prerelease.yml'), 'utf8'), /v1\.1\.0-beta\.1/);
    await seed('1.1.0', 'stable');
    const stableFiles = await prepareFeedUpload('v1.1.0', input, output, join(output, 'prerelease.json'));
    assert.equal(stableFiles.length, 8);
    assert.equal(JSON.parse(await readFile(join(output, 'prerelease.json'), 'utf8')).product, '1.1.0');
  } finally { await rm(root, { recursive: true, force: true }); }
});
