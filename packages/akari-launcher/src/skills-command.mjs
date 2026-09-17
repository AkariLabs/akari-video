import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const ENTRY_VERSION_FILE = '.akari-entry-version';
const usage = `使い方: akari skills install --entry [--target <dir>]...
        akari skills remove --entry [--target <dir>]...
        akari skills status --json
--target は入口スキル自体の配置先（例: ~/.codex/skills/akari）。既定の 2 か所に追加する。`;

function stat(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function canonicalBase(path) {
  return stat(path) ? realpathSync(path) : resolve(path);
}

export function entryTargets(env = process.env, extra = []) {
  const home = canonicalBase(env.HOME || homedir());
  return [...new Set([
    join(home, '.claude', 'skills', 'akari'),
    join(home, '.agents', 'skills', 'akari'),
    ...extra.map(path => resolve(path)),
  ])];
}

export function resolveEntrySource({ env = process.env, repoRoot = REPO_ROOT } = {}) {
  const home = env.HOME || homedir();
  for (const root of [join(env.AKARI_HOME || join(home, '.akari'), 'app'), repoRoot]) {
    const source = join(root, 'skills', 'akari');
    if (!stat(join(source, 'SKILL.md'))?.isFile()) continue;
    const version = JSON.parse(readFileSync(join(root, 'packages', 'akari-launcher', 'package.json'), 'utf8')).version;
    if (typeof version !== 'string' || !version.trim()) throw new Error(`ランチャー版が不正です: ${root}`);
    return { source, version };
  }
  throw new Error('入口スキル skills/akari/SKILL.md が見つかりません。');
}

// ディレクトリだけでなく配下の SKILL.md / 版印、親の skills がリンクの場合も触らない。
function hasLinkedAncestor(path) {
  for (let current = path; ; current = dirname(current)) {
    if (stat(current)?.isSymbolicLink()) return true;
    if (dirname(current) === current) return false;
  }
}

function hasLinkedContent(path) {
  const info = stat(path);
  if (!info) return false;
  if (info.isSymbolicLink()) return true;
  return info.isDirectory() && readdirSync(path).some(name => hasLinkedContent(join(path, name)));
}

function inspectTarget(path, currentVersion) {
  const info = stat(path);
  const symlink = hasLinkedAncestor(path);
  const marker = join(path, ENTRY_VERSION_FILE);
  const managed = !symlink && info?.isDirectory() === true && stat(marker)?.isFile() === true;
  const version = managed ? readFileSync(marker, 'utf8').trim() : null;
  return { path, exists: info !== null, managed, symlink, version, stale: managed && version !== currentVersion };
}

export function entryStatus(options = {}) {
  const { version } = resolveEntrySource(options);
  return { version, targets: entryTargets(options.env).map(path => inspectTarget(path, version)) };
}

function installTarget(path, source, version, warn) {
  if (hasLinkedAncestor(path) || hasLinkedContent(path) || hasLinkedContent(source)) {
    warn(`symlink は変更しません: ${path}`);
    return false;
  }
  const state = inspectTarget(path, version);
  if (state.exists && !state.managed) {
    warn(`入口スキルの版印がないため変更しません: ${path}`);
    return false;
  }
  mkdirSync(path, { recursive: true });
  cpSync(source, path, { recursive: true });
  // コピーに失敗した場合は旧版印を維持して次の起動で再試行する。
  writeFileSync(join(path, ENTRY_VERSION_FILE), `${version}\n`);
  return true;
}

/** 明示 install 済みの既定先だけを更新する。起動を止めず、出力もしない。 */
export function refreshEntrySkillOnLaunch(options = {}) {
  try {
    const paths = entryTargets(options.env);
    if (!paths.some(path => inspectTarget(path, null).managed)) return;
    const { source, version } = resolveEntrySource(options);
    for (const path of paths) {
      try {
        if (inspectTarget(path, version).stale) installTarget(path, source, version, () => {});
      } catch { /* 次回起動で再試行 */ }
    }
  } catch { /* 入口の更新失敗で他のコマンドを止めない */ }
}

export async function runSkillsCommand(args, options = {}) {
  const log = options.log ?? console.log;
  const warn = options.logError ?? console.error;
  if (args.includes('--help') || args.includes('-h')) {
    log(usage);
    return { exitCode: 0 };
  }
  try {
    const [command, ...flags] = args;
    const extra = [];
    let entry = false;
    let json = false;
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] === '--entry') entry = true;
      else if (flags[i] === '--json') json = true;
      else if (flags[i] === '--target' && flags[i + 1] && !flags[i + 1].startsWith('-')) extra.push(flags[++i]);
      else throw new Error(usage);
    }
    if (command === 'status' && json && !entry && !extra.length) {
      log(JSON.stringify(entryStatus(options), null, 2));
      return { exitCode: 0 };
    }
    if (!['install', 'remove'].includes(command) || !entry || json) throw new Error(usage);
    const paths = entryTargets(options.env, extra);
    const source = command === 'install' ? resolveEntrySource(options) : null;
    let skipped = false;
    for (const path of paths) {
      if (command === 'install') {
        if (installTarget(path, source.source, source.version, warn)) log(`入口スキルを配置しました: ${path}`);
        else skipped = true;
      } else {
        if (!stat(path)) continue;
        const state = inspectTarget(path, null);
        if (!state.managed || hasLinkedContent(path)) {
          warn(`版印がない、または symlink のため削除しません: ${path}`);
          skipped = true;
          continue;
        }
        rmSync(path, { recursive: true });
        log(`入口スキルを削除しました: ${path}`);
      }
    }
    return { exitCode: skipped ? 1 : 0 };
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error));
    return { exitCode: 1 };
  }
}
