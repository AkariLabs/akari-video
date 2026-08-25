import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  deriveUpdaterCacheDirName,
  generateAppUpdateYml,
  writeAppUpdateYml
} from '../gen-app-update-yml.mjs';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const EXPECTED_APP_UPDATE_YML = [
  'owner: AkariLabs',
  'repo: akari-video',
  'provider: github',
  "updaterCacheDirName: '@akari-videoshell-updater'",
  ''
].join('\n');

test('実 package.json から electron-builder 生成物とバイト等価の app-update.yml を生成する', async () => {
  assert.equal(await generateAppUpdateYml({ repoRoot }), EXPECTED_APP_UPDATE_YML);
  assert.equal(deriveUpdaterCacheDirName('@akari-video/shell'), '@akari-videoshell-updater');
});

test('指定した出力先へ書き込み、updaterCacheDirName は package name の / 除去 + -updater で導出する', async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'akari-app-update-yml-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const fixtureRepoRoot = join(fixtureRoot, 'repo');
  const shellPackagePath = join(fixtureRepoRoot, 'apps/shell/package.json');
  await mkdir(join(fixtureRepoRoot, 'apps/shell'), { recursive: true });
  await writeFile(
    shellPackagePath,
    JSON.stringify({
      name: '@fixture/video-shell',
      build: { publish: { provider: 'github', owner: 'FixtureOwner', repo: 'fixture-repo' } }
    }),
    'utf8'
  );

  const outputPath = join(fixtureRoot, 'out/resources/app-update.yml');
  await writeAppUpdateYml(outputPath, { repoRoot: fixtureRepoRoot });
  assert.equal(
    await readFile(outputPath, 'utf8'),
    [
      'owner: FixtureOwner',
      'repo: fixture-repo',
      'provider: github',
      "updaterCacheDirName: '@fixturevideo-shell-updater'",
      ''
    ].join('\n')
  );
});
