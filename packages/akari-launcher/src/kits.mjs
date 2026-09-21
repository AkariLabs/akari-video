import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync,
  readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync
} from 'node:fs';
import path from 'node:path';

import { resolveLauncherAssets } from './repo-assets.mjs';
const creatorRootModulePath = resolveLauncherAssets().creatorRootModulePath;
const creatorRoot = creatorRootModulePath ? await import(pathToFileURL(creatorRootModulePath).href) : null;
function resolveAssetLibraryRoots(env) {
  if (!creatorRoot) throw new Error('creator-root が見つからないため素材の置き場を解決できません。AKARI Video を再インストールしてください。');
  return creatorRoot.resolveAssetLibraryRoots(env);
}

const KITS_SCHEMA = 'akari-installed-kits/v0';
const INSTALLED_ASSETS_SCHEMA = 'akari-installed-assets/v0';
const PLUGIN_DESCRIPTION = 'AKARI Video 拡張キットのスキルをまとめて提供するローカルプラグイン。';

function parseVersion(value) {
  const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)$/u);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function satisfies(version, range) {
  const actual = parseVersion(version);
  const match = String(range).match(/^(\^|~|>=)?(\d+\.\d+\.\d+)$/u);
  if (!actual || !match) return false;
  const required = parseVersion(match[2]);
  if (compareVersions(actual, required) < 0) return false;
  if (match[1] === '^') {
    return actual[0] === required[0] && (required[0] !== 0 || actual[1] === required[1]);
  }
  if (match[1] === '~') return actual[0] === required[0] && actual[1] === required[1];
  if (match[1] === '>=') return true;
  return compareVersions(actual, required) === 0;
}

export function readKitManifest(kitDir) {
  const manifestPath = path.join(kitDir, 'manifest.json');
  return existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
}

export function checkRequires(manifest, { cliVersion, runtimeIds = [], entitledProductIds = [] }) {
  const blockers = [];
  const warnings = [];
  const requires = manifest?.requires ?? {};
  if (!satisfies(cliVersion, requires.cli)) {
    blockers.push(`CLI ${requires.cli} が必要です（現在 ${cliVersion}）。AKARI Video を更新してください。`);
  }
  const availableRuntimes = new Set(runtimeIds);
  for (const runtimeId of requires.runtimes ?? []) {
    if (!availableRuntimes.has(runtimeId)) {
      blockers.push(`runtime ${runtimeId} がありません。このアプリ版ではキットを利用できません。`);
    }
  }
  const entitled = new Set(entitledProductIds);
  for (const productId of requires.products ?? []) {
    if (!entitled.has(productId)) {
      warnings.push(`依存商品 ${productId} の購入が確認できません。\`akari store install ${productId}\` で導入してください。`);
    }
  }
  return { ok: blockers.length === 0, blockers, warnings };
}

function safeKitPath(kitDir, ...parts) {
  const root = path.resolve(kitDir);
  const candidate = path.resolve(root, ...parts);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`キット外のパスは参照できません: ${parts.join('/')}`);
  }
  return candidate;
}

function replaceSymlink(source, destination, {
  platform = process.platform,
  relativeTarget,
  symlinkSyncImpl = symlinkSync
} = {}) {
  if (existsSync(destination) || (() => { try { lstatSync(destination); return true; } catch { return false; } })()) {
    const stat = lstatSync(destination);
    if (!stat.isSymbolicLink()) return { status: 'occupied' };
    rmSync(destination);
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  const target = relativeTarget ?? path.relative(path.dirname(destination), source);
  try {
    symlinkSyncImpl(target, destination, 'dir');
    return { status: 'linked', target };
  } catch (error) {
    if (platform === 'win32' && error?.code === 'EPERM') return { status: 'permission-denied' };
    throw error;
  }
}

function listAssetFiles(assetRoot, current = assetRoot) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const filePath = path.join(current, entry.name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(...listAssetFiles(assetRoot, filePath));
    } else if (stat.isFile()) {
      const content = readFileSync(filePath);
      files.push({
        path: path.relative(assetRoot, filePath).split(path.sep).join('/'),
        bytes: stat.size,
        sha256: createHash('sha256').update(content).digest('hex')
      });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function installedAssetItem(source, asset, manifest) {
  const assetRoot = realpathSync(source);
  let title = asset.id;
  try {
    const meta = JSON.parse(readFileSync(path.join(assetRoot, 'meta.json'), 'utf8'));
    if (typeof meta.title === 'string' && meta.title) title = meta.title;
  } catch {
    // validate-asset が検査済み。配布環境で検査器が無い場合だけ id へフォールバックする。
  }
  return {
    id: asset.id,
    title,
    path: ['assets', asset.category, asset.id].join('/'),
    version: manifest.version,
    files: listAssetFiles(assetRoot)
  };
}

export function linkKitAssets(kitDir, manifest, home, options = {}) {
  const warnings = [];
  const linked = [];
  const items = [];
  const assets = options.assets?.schemasSourceDir !== undefined
    ? options.assets
    : resolveLauncherAssets(options.assets);
  const validator = options.validateAssetPath
    ?? (assets.schemasSourceDir ? path.join(assets.schemasSourceDir, 'bin', 'validate-asset.mjs') : null);
  for (const asset of manifest.assets ?? []) {
    const source = safeKitPath(kitDir, 'assets', asset.category, asset.id);
    if (validator && existsSync(validator)) {
      const result = (options.spawnSyncImpl ?? spawnSync)(process.execPath, [validator, source], { stdio: 'pipe' });
      if (result.status !== 0) {
        warnings.push(`素材 ${asset.category}/${asset.id} は検査に失敗したためリンクしませんでした。`);
        continue;
      }
    } else {
      warnings.push(`素材 ${asset.category}/${asset.id} の検査ツールが見つからないため検査をスキップしました。`);
    }
    const destination = path.join(resolveAssetLibraryRoots({ ...(options.env ?? process.env), AKARI_HOME: home }).write, asset.category, asset.id);
    const result = replaceSymlink(source, destination, options);
    if (result.status === 'occupied') {
      warnings.push(`既存の実ディレクトリを保持しました: ${destination}`);
    } else if (result.status === 'permission-denied') {
      warnings.push(`symlink を作成できませんでした（Windows の権限を確認してください）: ${destination}`);
    } else {
      linked.push({ category: asset.category, id: asset.id });
      items.push(installedAssetItem(source, asset, manifest));
    }
  }
  return { linked, items, warnings };
}

function readInstalledAssetsIndex(home, env = process.env) {
  const indexPath = path.join(resolveAssetLibraryRoots({ ...env, AKARI_HOME: home }).write, 'installed.json');
  if (!existsSync(indexPath)) return { schema: INSTALLED_ASSETS_SCHEMA, packs: {} };
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  if (index?.schema !== INSTALLED_ASSETS_SCHEMA
    || !index.packs || typeof index.packs !== 'object' || Array.isArray(index.packs)) {
    throw new Error(`導入済み素材索引の形式が想定と違います: ${indexPath}`);
  }
  return index;
}

function writeInstalledAssetsIndex(home, index, env = process.env) {
  const indexPath = path.join(resolveAssetLibraryRoots({ ...env, AKARI_HOME: home }).write, 'installed.json');
  mkdirSync(path.dirname(indexPath), { recursive: true });
  const temporary = `${indexPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, indexPath);
}

export function registerKitAssets(home, manifest, kitDir, items, env = process.env) {
  const root = path.resolve(kitDir);
  const storeRoot = path.join(resolveAssetLibraryRoots({ ...env, AKARI_HOME: home }).write, 'store', manifest.id);
  if (root !== storeRoot && !root.startsWith(`${storeRoot}${path.sep}`)) {
    throw new Error(`キット素材の root が展開先の外を指しています: ${root}`);
  }
  const index = readInstalledAssetsIndex(home, env);
  index.packs[manifest.id] = {
    version: manifest.version,
    installedAt: new Date().toISOString(),
    root,
    items
  };
  writeInstalledAssetsIndex(home, index, env);
  return items;
}

function unregisterKitAssets(home, productId, env = process.env) {
  const indexPath = path.join(resolveAssetLibraryRoots({ ...env, AKARI_HOME: home }).write, 'installed.json');
  if (!existsSync(indexPath)) return;
  const index = readInstalledAssetsIndex(home, env);
  if (!Object.hasOwn(index.packs, productId)) return;
  delete index.packs[productId];
  writeInstalledAssetsIndex(home, index, env);
}

export function linkKitSkills(kitDir, manifest, home, options = {}) {
  const warnings = [];
  const blockers = [];
  const linked = [];
  const planned = [];
  for (const skill of manifest.skills ?? []) {
    const source = safeKitPath(kitDir, skill.dir);
    const destination = path.join(home, 'kits', 'plugin', 'skills', skill.name);
    try {
      const stat = lstatSync(destination);
      if (!stat.isSymbolicLink()) {
        blockers.push(`スキル名 ${skill.name} は既存の実ディレクトリと重複しています。`);
        continue;
      }
      const current = path.resolve(path.dirname(destination), readlinkSync(destination));
      if (current !== source) {
        blockers.push(`スキル名 ${skill.name} は別のキットと重複しています。`);
        continue;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    planned.push({ skill, source, destination });
  }
  if (blockers.length > 0) return { linked, blockers, warnings };
  for (const { skill, source, destination } of planned) {
    const result = replaceSymlink(source, destination, options);
    if (result.status === 'permission-denied') {
      warnings.push(`symlink を作成できませんでした（Windows の権限を確認してください）: ${destination}`);
    } else {
      linked.push(skill.name);
    }
  }
  return { linked, blockers, warnings };
}

export function readKitsLedger(home) {
  const ledgerPath = path.join(home, 'kits', 'installed.json');
  if (!existsSync(ledgerPath)) return { schema: KITS_SCHEMA, kits: [] };
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  if (ledger?.schema !== KITS_SCHEMA || !Array.isArray(ledger.kits)) {
    throw new Error(`拡張キット台帳の形式が想定と違います: ${ledgerPath}`);
  }
  return ledger;
}

export function writeKitsLedger(home, entry) {
  const ledger = readKitsLedger(home);
  ledger.kits = [...ledger.kits.filter((kit) => kit.id !== entry.id), entry];
  const ledgerPath = path.join(home, 'kits', 'installed.json');
  mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const temporary = `${ledgerPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, ledgerPath);
  return ledger;
}

export function removeKit(home, productId, env = process.env) {
  const ledger = readKitsLedger(home);
  const entry = ledger.kits.find((kit) => kit.id === productId);
  if (!entry) return false;
  for (const name of entry.skills ?? []) removeOwnedSymlink(path.join(home, 'kits', 'plugin', 'skills', name), entry.kitDir);
  for (const asset of entry.assets ?? []) {
    for (const root of resolveAssetLibraryRoots({ ...env, AKARI_HOME: home }).read) removeOwnedSymlink(path.join(root, asset.category, asset.id), entry.kitDir);
  }
  ledger.kits = ledger.kits.filter((kit) => kit.id !== productId);
  const ledgerPath = path.join(home, 'kits', 'installed.json');
  const temporary = `${ledgerPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, ledgerPath);
  unregisterKitAssets(home, productId, env);
  return true;
}

function removeOwnedSymlink(linkPath, kitDir) {
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return;
    const target = path.resolve(path.dirname(linkPath), readlinkSync(linkPath));
    if (target === path.resolve(kitDir) || target.startsWith(`${path.resolve(kitDir)}${path.sep}`)) rmSync(linkPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export function ensureKitsMarketplace(home) {
  const marketplacePath = path.join(home, 'kits', '.claude-plugin', 'marketplace.json');
  const pluginPath = path.join(home, 'kits', 'plugin', '.claude-plugin', 'plugin.json');
  const marketplace = {
    name: 'akari-kits',
    owner: { name: 'AKARI Video' },
    plugins: [{ name: 'akari-kits', source: './plugin', description: PLUGIN_DESCRIPTION }]
  };
  const plugin = { name: 'akari-kits', description: PLUGIN_DESCRIPTION };
  for (const [filePath, value] of [[marketplacePath, marketplace], [pluginPath, plugin]]) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const content = `${JSON.stringify(value, null, 2)}\n`;
    if (!existsSync(filePath) || readFileSync(filePath, 'utf8') !== content) writeFileSync(filePath, content);
  }
  return { marketplacePath, pluginPath };
}

export function enableHint() {
  return [
    'Claude Code で拡張キットを有効化してください:',
    '  claude plugin marketplace add ~/.akari/kits',
    '  claude plugin install akari-kits@akari-kits',
    'claude が PATH に無い場合は、Claude Code のプラグイン設定で ~/.akari/kits を marketplace として追加してください。'
  ].join('\n');
}
