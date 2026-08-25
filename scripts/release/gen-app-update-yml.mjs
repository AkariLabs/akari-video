#!/usr/bin/env node
// electron-builder --dir / --prepackaged 経路向けの app-update.yml 生成器。
// apps/shell/package.json の build.publish を正として、electron-builder が通常の
// パッケージング時に Resources へ置くものと同形の更新フィード設定を生成する。

import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = join(here, '..', '..');

export function deriveUpdaterCacheDirName(packageName) {
  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new Error('apps/shell/package.json の name が不正です');
  }
  return `${packageName.replaceAll('/', '')}-updater`;
}

export async function generateAppUpdateYml({ repoRoot = defaultRepoRoot } = {}) {
  const shellPackagePath = join(repoRoot, 'apps/shell/package.json');
  const shellPackage = JSON.parse(await readFile(shellPackagePath, 'utf8'));
  const publish = shellPackage.build?.publish;

  if (
    publish?.provider !== 'github'
    || typeof publish.owner !== 'string'
    || publish.owner.length === 0
    || typeof publish.repo !== 'string'
    || publish.repo.length === 0
  ) {
    throw new Error('apps/shell/package.json の build.publish は GitHub provider の owner/repo を指定してください');
  }

  const updaterCacheDirName = deriveUpdaterCacheDirName(shellPackage.name);
  return [
    `owner: ${publish.owner}`,
    `repo: ${publish.repo}`,
    `provider: ${publish.provider}`,
    `updaterCacheDirName: '${updaterCacheDirName}'`,
    ''
  ].join('\n');
}

export async function writeAppUpdateYml(outputPath, options) {
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('出力先パスを引数で指定してください');
  }
  const yml = await generateAppUpdateYml(options);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, yml, 'utf8');
  return yml;
}

async function main() {
  if (process.argv.length !== 3) {
    console.error('使い方: node scripts/release/gen-app-update-yml.mjs <出力先パス>');
    process.exitCode = 1;
    return;
  }

  try {
    await writeAppUpdateYml(process.argv[2]);
  } catch (error) {
    console.error(`エラー: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  await main();
}
