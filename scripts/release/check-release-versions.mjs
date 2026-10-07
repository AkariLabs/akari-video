#!/usr/bin/env node
// 版整合ゲート — タグ名（例 v0.1.0）と各コンポーネントの現在 version を照合する。
// 契約（非公開の内部リポジトリ akari-video-internal 側で管理）:
// 「タグ ↔ 各 package.json 版 ↔ latest.json の一致」を CI で機械検証し、ズレたらリリース
// 作成を失敗させる。ここではタグ ↔ 各 package.json / plugin.json と shell の
// package.json ↔ 2 つの package-lock.json の一致を扱う
// （latest.json との一致は gen-latest-json.mjs がタグ版を全成分へ使うため保証される）。
//
// 使い方:
//   node scripts/release/check-release-versions.mjs [v0.1.0]
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = join(here, '..', '..');

export const COMPONENTS = [
  { label: 'shell (apps/shell/package.json)', relPath: 'apps/shell/package.json' },
  { label: 'cli (packages/akari-launcher/package.json)', relPath: 'packages/akari-launcher/package.json' },
  { label: 'plugin (plugin/.claude-plugin/plugin.json)', relPath: 'plugin/.claude-plugin/plugin.json' }
];

export const TAG_RE = /^v(\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?)$/;

const SHELL_LOCK_FIELDS = [
  { label: 'apps/shell/package-lock.json トップ', relPath: 'apps/shell/package-lock.json', getVersion: lock => lock.version },
  { label: 'apps/shell/package-lock.json packages[""]', relPath: 'apps/shell/package-lock.json', getVersion: lock => lock.packages?.['']?.version },
  { label: 'package-lock.json packages["apps/shell"]', relPath: 'package-lock.json', getVersion: lock => lock.packages?.['apps/shell']?.version }
];

// "v0.1.0" -> "0.1.0"。vX.Y.Z 形式でなければ null。
export function parseTag(tag) {
  const m = typeof tag === 'string' ? tag.match(TAG_RE) : null;
  return m ? m[1] : null;
}

// 戻り値: { ok, tagVersion, mismatches: [{label, path, version, reason}], messages: string[] }
export async function checkReleaseVersions(tag, { repoRoot = defaultRepoRoot, components = COMPONENTS } = {}) {
  const tagVersion = parseTag(tag);
  if (!tagVersion) {
    return {
      ok: false,
      tagVersion: null,
      mismatches: [],
      messages: [`タグ名の形式が不正です（vX.Y.Z または vX.Y.Z-beta.N、N≥1）: "${tag}"`]
    };
  }

  const mismatches = [];
  let shellVersion = null;
  for (const component of components) {
    const path = join(repoRoot, component.relPath);
    let version = null;
    try {
      const raw = await readFile(path, 'utf8');
      version = JSON.parse(raw).version ?? null;
      if (component.relPath === 'apps/shell/package.json') shellVersion = version;
    } catch (error) {
      mismatches.push({
        label: component.label,
        path,
        version: null,
        reason: `読み込み失敗（${error.code ?? error.message}）`
      });
      continue;
    }
    if (version !== tagVersion) {
      mismatches.push({
        label: component.label,
        path,
        version,
        reason: `version が ${tagVersion} と不一致（実際: ${version ?? '(version フィールドなし)'}）`
      });
    }
  }

  if (shellVersion !== null) {
    const locks = new Map();
    for (const field of SHELL_LOCK_FIELDS) {
      const path = join(repoRoot, field.relPath);
      let version = null;
      try {
        if (!locks.has(path)) locks.set(path, JSON.parse(await readFile(path, 'utf8')));
        version = field.getVersion(locks.get(path)) ?? null;
      } catch (error) {
        mismatches.push({ label: field.label, path, version: null, reason: `読み込み失敗（${error.code ?? error.message}）` });
        continue;
      }
      if (version !== shellVersion) {
        mismatches.push({
          label: field.label,
          path,
          version,
          reason: `shell package.json の version ${shellVersion} と不一致（実際: ${version ?? '(version フィールドなし)'}）`
        });
      }
    }
  }

  const ok = mismatches.length === 0;
  const messages = ok
    ? [`版整合ゲート PASS: タグ ${tag} と shell / cli / plugin / shell ロックファイルの version が全て一致（${tagVersion}）`]
    : [
        `版整合ゲート FAIL: タグ ${tag}（プロダクト版 ${tagVersion}）と以下がズレています`,
        ...mismatches.map((m) => `  - ${m.label}: ${m.reason}`)
      ];

  return { ok, tagVersion, mismatches, messages };
}

async function main() {
  let tag = process.argv[2];
  if (!tag) {
    try {
      const shell = JSON.parse(await readFile(join(defaultRepoRoot, 'apps/shell/package.json'), 'utf8'));
      tag = `v${shell.version}`;
    } catch (error) {
      console.error(`shell package.json の読み込み失敗（${error.code ?? error.message}）`);
      process.exitCode = 1;
      return;
    }
  }
  const result = await checkReleaseVersions(tag);
  for (const line of result.messages) {
    if (result.ok) console.log(line);
    else console.error(line);
  }
  process.exitCode = result.ok ? 0 : 1;
}

// 両辺 realpath（AGENTS.md の規約）。失敗時は false = 実行しない（fail-closed）
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  await main();
}
